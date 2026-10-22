// Testes de integração do schema: roda as migrations reais num Postgres embutido
// com stubs mínimos do Supabase (auth.uid, papéis, publicação realtime).
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";

const MIG = process.argv[2] ?? new URL("../supabase/migrations", import.meta.url).pathname;
const db = new PGlite({ extensions: { pg_trgm } });

let pass = 0, failN = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { failN++; console.log("  ✗", name, extra); }
};
async function expectError(name, fn, code) {
  try { await fn(); ok(name, false, "(não deu erro)"); }
  catch (e) { ok(name, !code || e.code === code, `(code ${e.code}: ${e.message})`); }
}

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

for (const f of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
  try { await db.exec(readFileSync(`${MIG}/${f}`, "utf8")); console.log("migration ok:", f); }
  catch (e) { console.log("MIGRATION FAILED:", f, e.message); process.exit(1); }
}
await db.exec(`grant all on all tables in schema public to service_role; grant usage, select on all sequences in schema public to service_role;`);

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";

async function as(user, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user === "service" ? "" : (user ?? "")]);
  await db.exec(user === "service" ? "set role service_role" : "set role authenticated");
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("reset role"); }
}
const su = async (sql, p = []) => { await db.exec("reset role"); return (await db.query(sql, p)).rows; };

console.log("\n# Cadastro e criação de empresa");
await su(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'a@x.com','{"full_name":"Ana"}'), ($2,'b@x.com','{}')`, [A, B]);
ok("perfil criado automaticamente", (await su("select count(*)::int n from public.profiles")).at(0).n === 2);
const orgA = (await as(A, "select public.create_organization('Empresa A') id"))[0].id;
const orgB = (await as(B, "select public.create_organization('Empresa B') id"))[0].id;
ok("empresa A criada com 6 etapas", (await su("select count(*)::int n from public.stages where organization_id=$1", [orgA]))[0].n === 6);
ok("assinatura nasce pendente", (await su("select status from public.subscriptions where organization_id=$1", [orgA]))[0].status === "pending");

console.log("\n# Bloqueio sem pagamento (no banco)");
ok("sem pagamento: não vê etapas", (await as(A, "select * from public.stages")).length === 0);
const stageA = (await su("select id from public.stages where organization_id=$1 order by position limit 1", [orgA]))[0].id;
const stageNeg = (await su("select id from public.stages where organization_id=$1 and name='Negociação'", [orgA]))[0].id;
const stageB = (await su("select id from public.stages where organization_id=$1 order by position limit 1", [orgB]))[0].id;
const pipeA = (await su("select pipeline_id from public.stages where id=$1", [stageA]))[0].pipeline_id;
const pipeB = (await su("select pipeline_id from public.stages where id=$1", [stageB]))[0].pipeline_id;
await expectError("sem pagamento: não cria lead", () => as(A, "insert into public.leads (organization_id,pipeline_id,stage_id,name) values ($1,$2,$3,'X')", [orgA, pipeA, stageA]), "42501");
ok("sem pagamento: ainda vê a própria assinatura (tela de cobrança)", (await as(A, "select * from public.subscriptions")).length === 1);
await expectError("usuário não consegue se auto-ativar", async () => {
  const r = await as(A, "update public.subscriptions set status='active' where organization_id=$1 returning 1", [orgA]);
  if (!r.length) { const e = new Error("bloqueado"); e.code = "RLS"; throw e; }
}, "RLS");

await su("update public.subscriptions set status='active', current_period_end=now()+interval '30 days' where organization_id in ($1,$2)", [orgA, orgB]);

console.log("\n# Isolamento entre empresas");
const leadA = (await as(A, "insert into public.leads (organization_id,pipeline_id,stage_id,name,phone) values ($1,$2,$3,'Yuri Farias','5585999998888') returning id", [orgA, pipeA, stageA]))[0].id;
ok("A cria lead na própria empresa", Boolean(leadA));
ok("B não enxerga leads de A", (await as(B, "select * from public.leads")).length === 0);
await expectError("B não insere lead na empresa A", () => as(B, "insert into public.leads (organization_id,pipeline_id,stage_id,name) values ($1,$2,$3,'Hack')", [orgA, pipeA, stageA]), "42501");
await expectError("A não usa etapa da empresa B (anti-adulteração)", () => as(A, "insert into public.leads (organization_id,pipeline_id,stage_id,name) values ($1,$2,$3,'X')", [orgA, pipeB, stageB]), "42501");
ok("B não altera lead de A", (await as(B, "update public.leads set name='hack' where id=$1 returning 1", [leadA])).length === 0);
const tagB = (await su("select id from public.tags where organization_id=$1 limit 1", [orgB]))[0].id;
await expectError("A não aplica tag da empresa B", () => as(A, "insert into public.lead_tags (lead_id,tag_id,organization_id) values ($1,$2,$3)", [leadA, tagB, orgA]), "42501");
await expectError("A não troca empresa ativa para B", () => as(A, "select public.switch_organization($1)", [orgB]), "42501");
await expectError("A não altera current_organization_id direto", () => as(A, "update public.profiles set current_organization_id=$1 where id=$2", [orgB, A]), "42501");

console.log("\n# Movimentação e histórico");
await as(A, "update public.leads set stage_id=$1 where id=$2", [stageNeg, leadA]);
ok("mover lead gera atividade stage_changed", (await su("select count(*)::int n from public.activities where lead_id=$1 and type='stage_changed'", [leadA]))[0].n === 1);
const sr = await as(A, "select * from public.search_leads($1,'yuri',5)", [orgA]);
ok("busca por similaridade encontra 'Yuri Farias'", sr[0]?.id === leadA);
await expectError("não exclui etapa com leads", () => as(A, "delete from public.stages where id=$1", [stageNeg]), "23503");

console.log("\n# Equipe e permissões");
await as(A, "insert into public.organization_invites (organization_id,email,role) values ($1,'c@x.com','agent')", [orgA]);
await su("insert into auth.users (id,email) values ($1,'c@x.com')", [C]);
ok("convite aceito automaticamente no cadastro", (await su("select role from public.organization_members where user_id=$1", [C]))[0]?.role === "agent");
ok("atendente vê leads da empresa", (await as(C, "select * from public.leads")).length === 1);
ok("atendente não exclui lead", (await as(C, "delete from public.leads where id=$1 returning 1", [leadA])).length === 0);
ok("atendente não altera etapas", (await as(C, "update public.stages set name='x' where organization_id=$1 returning 1", [orgA])).length === 0);
ok("atendente não se promove", (await as(C, "update public.organization_members set role='admin' where user_id=$1 returning 1", [C])).length === 0);
ok("dono não pode ser removido", (await as(A, "delete from public.organization_members where user_id=$1 returning 1", [A])).length === 0);

console.log("\n# WhatsApp: ingestão, deduplicação, 9º dígito");
const ch = (await su("insert into public.whatsapp_channels (organization_id,provider,name,status) values ($1,'evolution','Teste','connected') returning id", [orgA]))[0].id;
await su("insert into public.whatsapp_channel_secrets (channel_id, webhook_secret) values ($1,'x')", [ch]);
ok("usuário não lê segredos do canal", (await as(A, "select * from public.whatsapp_channel_secrets")).length === 0);
await expectError("usuário comum não chama ingest_message", () => as(A, "select public.ingest_message($1,'1','n','e1','in','text','oi',null,null,'received',now())", [ch]), "42501");
const ingest = (ext, wa, dir = "in", at = "now()") => as("service", `select public.ingest_message($1,$2,'Cliente',$3,$4,'text','Olá',null,null,'received',${at})`, [ch, wa, ext, dir]);
await ingest("m1", "558599998888"); // 12 dígitos (sem o 9)
ok("9º dígito: mensagem vinculada ao lead existente", (await su("select lead_id from public.conversations where channel_id=$1", [ch]))[0].lead_id === leadA);
await ingest("m1", "558599998888");
ok("reenvio do mesmo evento não duplica", (await su("select count(*)::int n from public.messages where channel_id=$1", [ch]))[0].n === 1);
ok("contador de não lidas = 1", (await su("select unread_count from public.conversations where channel_id=$1", [ch]))[0].unread_count === 1);
await ingest("m2", "5511912345678");
ok("contato novo vira lead automaticamente", (await su("select count(*)::int n from public.leads where organization_id=$1 and phone='5511912345678'", [orgA]))[0].n === 1);
await as("service", "select public.ingest_messages($1, $2::jsonb)", [ch, JSON.stringify([
  { wa_id: "5511912345678", external_id: "h1", direction: "out", body: "antiga", sent_at: "2025-01-01T10:00:00Z", status: "sent" },
  { wa_id: "5511912345678", external_id: "h2", direction: "in", body: "antiga 2", sent_at: "2025-01-01T10:01:00Z" },
])]);
const conv2 = (await su("select * from public.conversations where wa_id='5511912345678'"))[0];
ok("histórico importado não marca como não lido", conv2.unread_count === 1);
ok("histórico antigo não sobrescreve prévia da última mensagem", conv2.last_message_preview === "Olá");
await as("service", "select public.update_message_status($1,'h1','read')", [ch]);
await as("service", "select public.update_message_status($1,'h1','delivered')", [ch]);
ok("status só avança (lido não volta para entregue)", (await su("select status from public.messages where external_id='h1'"))[0].status === "read");
ok("A vê as mensagens da sua empresa", (await as(A, "select * from public.messages")).length === 4);
ok("B não vê mensagens de A", (await as(B, "select * from public.messages")).length === 0);
const convId = (await su("select id from public.conversations where channel_id=$1 limit 1", [ch]))[0].id;
await as(A, "select public.mark_conversation_read($1)", [convId]);
ok("marcar como lida funciona", (await su("select unread_count from public.conversations where id=$1", [convId]))[0].unread_count === 0);

console.log("\n# Vencimento da assinatura");
await su("update public.subscriptions set current_period_end=now()-interval '1 day' where organization_id=$1", [orgA]);
ok("assinatura vencida: acesso bloqueado na hora", (await as(A, "select * from public.leads")).length === 0);
await su("update public.subscriptions set current_period_end=now()+interval '30 days' where organization_id=$1", [orgA]);
ok("pagamento confirmado: acesso volta com os dados intactos", (await as(A, "select * from public.leads")).length === 2);

console.log("\n# Exclusão de funil com leads (cascata)");
const p2 = (await as(A, "insert into public.pipelines (organization_id,name,position) values ($1,'Pós-venda',1) returning id", [orgA]))[0].id;
const s2 = (await as(A, "insert into public.stages (organization_id,pipeline_id,name,position) values ($1,$2,'E1',0) returning id", [orgA, p2]))[0].id;
await as(A, "insert into public.leads (organization_id,pipeline_id,stage_id,name) values ($1,$2,$3,'Z')", [orgA, p2, s2]);
try { await as(A, "delete from public.pipelines where id=$1", [p2]); ok("excluir funil remove etapas e leads dele", (await su("select count(*)::int n from public.leads where pipeline_id=$1", [p2]))[0].n === 0); }
catch (e) { ok("excluir funil remove etapas e leads dele", false, e.message); }

console.log("\n# Relações usadas pela API (embeds do PostgREST)");
const fk = await su(`select count(*)::int n from pg_constraint where contype='f' and conrelid='public.organization_members'::regclass and confrelid='public.profiles'::regclass`);
ok("membros → perfis tem FK direta (nome/e-mail da equipe num select)", fk[0].n === 1);

console.log(`\n${pass} passaram, ${failN} falharam`);
process.exit(failN ? 1 : 0);
