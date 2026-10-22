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
  if (readFileSync(`${MIG}/${f}`, "utf8").startsWith("-- @supabase-only")) { console.log("migration (só Supabase, pulada):", f); continue; }
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
ok("empresa A criada com 7 etapas (inclui Agendamento)", (await su("select count(*)::int n from public.stages where organization_id=$1", [orgA]))[0].n === 7);
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

console.log("\n# Agendamentos e Google Agenda");
await su("insert into public.google_connections (user_id, google_email) values ($1, 'a@gmail.com')", [A]);
await su("insert into public.google_credentials (user_id, refresh_grant) values ($1, 'segredo')", [A]);
ok("usuário vê a própria conexão Google", (await as(A, "select * from public.google_connections")).length === 1);
ok("outro usuário não vê a conexão Google de A", (await as(B, "select * from public.google_connections")).length === 0);
ok("credenciais do Google invisíveis até para o dono", (await as(A, "select * from public.google_credentials")).length === 0);
const ap = await as(A, "insert into public.appointments (organization_id, lead_id, user_id, title, starts_at, ends_at) values ($1,$2,$3,'Reunião', now()+interval '1 day', now()+interval '1 day 1 hour') returning id", [orgA, leadA, A]);
ok("A agenda reunião com lead da própria empresa", ap.length === 1);
ok("B não vê agendamentos de A", (await as(B, "select * from public.appointments")).length === 0);
await expectError("agendamento não pode apontar lead de outra empresa", async () => {
  const leadB = (await su("insert into public.leads (organization_id,pipeline_id,stage_id,name) values ($1,$2,$3,'LB') returning id", [orgB, pipeB, stageB]))[0].id;
  await as(A, "insert into public.appointments (organization_id, lead_id, user_id, title, starts_at, ends_at) values ($1,$2,$3,'X', now(), now()+interval '1 hour')", [orgA, leadB, A]);
}, "42501");
await expectError("A não agenda em nome de outro usuário", () => as(A, "insert into public.appointments (organization_id, lead_id, user_id, title, starts_at, ends_at) values ($1,$2,$3,'X', now(), now()+interval '1 hour')", [orgA, leadA, C]), "42501");
await expectError("fim antes do início é recusado", () => as(A, "insert into public.appointments (organization_id, lead_id, user_id, title, starts_at, ends_at) values ($1,$2,$3,'X', now()+interval '2 hour', now())", [orgA, leadA, A]), "23514");

console.log("\n# Mensagens agendadas");
const sch = (await as(A, "insert into public.scheduled_messages (organization_id, lead_id, created_by, body, send_at) values ($1,$2,$3,'E aí, tudo certo?', now() - interval '1 minute') returning id", [orgA, leadA, A]))[0].id;
await as(A, "insert into public.scheduled_messages (organization_id, lead_id, created_by, body, send_at) values ($1,$2,$3,'Futura', now() + interval '1 day')", [orgA, leadA, A]);
ok("A agenda mensagem para lead da empresa", Boolean(sch));
ok("B não vê mensagens agendadas de A", (await as(B, "select * from public.scheduled_messages")).length === 0);
ok("B não cancela mensagem de A", (await as(B, "update public.scheduled_messages set status='canceled' where id=$1 returning 1", [sch])).length === 0);
await expectError("usuário não marca mensagem como enviada", () => as(A, "update public.scheduled_messages set status='sent' where id=$1", [sch]), "42501");
await expectError("usuário não altera tentativas", () => as(A, "update public.scheduled_messages set attempts=0 where id=$1", [sch]), "42501");
await expectError("usuário não chama o disparador", () => as(A, "select * from public.claim_scheduled_messages(10)"), "42501");
await expectError("agendar para lead de outra empresa é recusado", async () => {
  const lb = (await su("select id from public.leads where organization_id=$1 limit 1", [orgB]))[0].id;
  await as(A, "insert into public.scheduled_messages (organization_id, lead_id, created_by, body, send_at) values ($1,$2,$3,'x', now())", [orgA, lb, A]);
}, "42501");
await expectError("mensagem sem texto nem modelo é recusada", () => as(A, "insert into public.scheduled_messages (organization_id, lead_id, created_by, send_at) values ($1,$2,$3, now())", [orgA, leadA, A]), "23514");
const c1 = await as("service", "select id from public.claim_scheduled_messages(10)");
const c2 = await as("service", "select id from public.claim_scheduled_messages(10)");
ok("disparador pega só as vencidas (1 de 2)", c1.length === 1 && c1[0].id === sch, JSON.stringify(c1));
ok("segunda execução não pega a mesma mensagem (sem duplicar)", c2.length === 0);
ok("mensagem reservada fica 'enviando' com 1 tentativa", (await su("select status, attempts from public.scheduled_messages where id=$1", [sch]))[0].attempts === 1);
await su("update public.scheduled_messages set claimed_at = now() - interval '11 minutes' where id=$1", [sch]);
await as("service", "select id from public.claim_scheduled_messages(10)");
ok("travada há >10 min vira 'falhou' (não reenvia às cegas)", (await su("select status from public.scheduled_messages where id=$1", [sch]))[0].status === "failed");
ok("usuário pode reagendar uma que falhou", (await as(A, "update public.scheduled_messages set status='pending', send_at=now()+interval '1 hour' where id=$1 returning 1", [sch])).length === 1);

console.log("\n# Relatórios, metas e ligações");
await as(A, "insert into public.activities (organization_id, lead_id, actor_id, type, payload) values ($1,$2,$3,'call','{\"outcome\":\"atendeu\"}'), ($1,$2,$3,'call','{\"outcome\":\"nao_atendeu\"}')", [orgA, leadA, A]);
const rm = (await as(A, "select public.report_metrics($1, now() - interval '30 days', now() + interval '1 day') m", [orgA]))[0].m;
ok("métricas: 2 ligações, 1 atendida", rm.calls === 2 && rm.calls_answered === 1, JSON.stringify({ c: rm.calls, a: rm.calls_answered }));
ok("métricas: agendamentos e vendas presentes", typeof rm.appointments === "number" && typeof rm.won_count === "number");
ok("métricas: outra empresa não vê números de A", (await as(B, "select public.report_metrics($1, now() - interval '30 days', now() + interval '1 day') m", [orgA]))[0].m.calls === 0);
const per = "date_trunc('month', now())::date";
ok("dono define meta do mês", (await as(A, `insert into public.monthly_goals (organization_id, period, metric, target) values ($1, ${per}, 'won_count', 10) returning 1`, [orgA])).length === 1);
ok("atendente vê as metas", (await as(C, "select * from public.monthly_goals")).length === 1);
await expectError("atendente não altera metas", () => as(C, `insert into public.monthly_goals (organization_id, period, metric, target) values ($1, ${per}, 'calls', 5)`, [orgA]), "42501");
ok("outra empresa não vê metas de A", (await as(B, "select * from public.monthly_goals")).length === 0);
await expectError("meta precisa ser no dia 1 do mês", () => as(A, "insert into public.monthly_goals (organization_id, period, metric, target) values ($1, '2026-10-15', 'calls', 5)", [orgA]), "23514");
await su("insert into public.report_templates (owner_id, name, file_name, file_mime, file_path) values ($1,'Modelo Yuri','m.pdf','application/pdf','t/a.pdf')", [A]);
ok("dono vê o próprio modelo", (await as(A, "select * from public.report_templates")).length === 1);
ok("outro usuário (mesmo da equipe) não vê o modelo de A", (await as(C, "select * from public.report_templates")).length === 0);
await expectError("usuário não grava configuração de envio direto", () => as(A, "insert into public.report_settings (organization_id, enabled) values ($1, true)", [orgA]), "42501");
ok("comentário do mês salvo pela equipe", (await as(C, `insert into public.report_notes (organization_id, period, notes, updated_by) values ($1, ${per}, 'Feriado reduziu movimento', $2) returning 1`, [orgA, C])).length === 1);
await su(`insert into public.report_runs (organization_id, period, kind, status) values ($1, ${per}, 'auto', 'sent')`, [orgA]);
await expectError("relatório automático do mês não duplica", () => su(`insert into public.report_runs (organization_id, period, kind, status) values ($1, ${per}, 'auto', 'generating')`, [orgA]), "23505");
ok("relatórios manuais podem ser vários", (await su(`insert into public.report_runs (organization_id, period, kind) values ($1, ${per}, 'manual'), ($1, ${per}, 'manual') returning 1`, [orgA])).length === 2);

console.log("\n# Limite de uso");
await expectError("usuário não chama hit_rate_limit", () => as(A, "select public.hit_rate_limit('x', 1, 60)"), "42501");
const hits = [];
for (let i = 0; i < 4; i++) hits.push((await as("service", "select public.hit_rate_limit('voz:teste', 3, 60) ok"))[0].ok);
ok("limite de 3: libera 3 e bloqueia a 4ª", JSON.stringify(hits) === "[true,true,true,false]", JSON.stringify(hits));
await su("update public.rate_limits set window_start = now() - interval '2 minutes' where key='voz:teste'");
ok("janela expirada libera de novo", (await as("service", "select public.hit_rate_limit('voz:teste', 3, 60) ok"))[0].ok === true);

console.log("\n# Painel de métricas");
const wonStage = (await su("select id from public.stages where organization_id=$1 and kind='won'", [orgA]))[0].id;
await as(A, "update public.leads set value=1500 where id=$1", [leadA]);
await as(A, "update public.leads set stage_id=$1 where id=$2", [wonStage, leadA]);
const stats = (await as(A, "select public.dashboard_stats($1, now() - interval '7 days', now() + interval '1 day') s", [orgA]))[0].s;
ok("painel: venda ganha contabilizada", stats.won_count === 1 && Number(stats.won_value) === 1500, JSON.stringify({ w: stats.won_count, v: stats.won_value }));
ok("painel: leads novos no período", stats.new_leads >= 2, String(stats.new_leads));
ok("painel: série diária de mensagens", Array.isArray(stats.messages) && stats.messages.length >= 8, String(stats.messages?.length));
ok("painel: etapas listadas", stats.by_stage.length >= 6);
const statsB = (await as(B, "select public.dashboard_stats($1, now() - interval '7 days', now() + interval '1 day') s", [orgA]))[0].s;
ok("painel: outra empresa não vê números de A", statsB.new_leads === 0 && statsB.won_count === 0 && statsB.by_stage.length === 0);

console.log("\n# Acompanhamento do time comercial");
const sAna = (await as(A, "insert into public.team_sellers (organization_id, name, user_id) values ($1,'Ana (dona)',$2) returning id", [orgA, A]))[0].id;
const sBia = (await as(A, "insert into public.team_sellers (organization_id, name) values ($1,'Bia') returning id", [orgA]))[0].id;
const sCarla = (await as(A, "insert into public.team_sellers (organization_id, name, user_id) values ($1,'Carla',$2) returning id", [orgA, C]))[0].id;
await expectError("vendedor com login de fora da empresa é recusado", () => as(A, "insert into public.team_sellers (organization_id, name, user_id) values ($1,'Intrusa',$2)", [orgA, B]), "23514");
await expectError("atendente não cadastra vendedor", () => as(C, "insert into public.team_sellers (organization_id, name) values ($1,'X')", [orgA]), "42501");
const mInsta = (await as(A, "insert into public.team_metrics (organization_id, name, daily_target, monthly_target) values ($1,'Contatos no Instagram',10,220) returning id", [orgA]))[0].id;
const mCalls = (await as(A, "insert into public.team_metrics (organization_id, name, source) values ($1,'Ligações','calls') returning id", [orgA]))[0].id;
const mWon = (await as(A, "insert into public.team_metrics (organization_id, name, source, unit) values ($1,'Faturamento','won_value','money') returning id", [orgA]))[0].id;
ok("atendente preenche checklist de vendedora sem login", (await as(C, "insert into public.team_entries (organization_id, seller_id, metric_id, day, value, updated_by) values ($1,$2,$3,current_date,7,$4) returning 1", [orgA, sBia, mInsta, C])).length === 1);
ok("vendedora preenche o próprio checklist", (await as(C, "insert into public.team_entries (organization_id, seller_id, metric_id, day, value, updated_by) values ($1,$2,$3,current_date,12,$4) returning 1", [orgA, sCarla, mInsta, C])).length === 1);
await expectError("atendente não preenche checklist de outra vendedora com login", () => as(C, "insert into public.team_entries (organization_id, seller_id, metric_id, day, value, updated_by) values ($1,$2,$3,current_date,99,$4)", [orgA, sAna, mInsta, C]), "42501");
await expectError("indicador automático não aceita lançamento manual", () => as(A, "insert into public.team_entries (organization_id, seller_id, metric_id, day, value, updated_by) values ($1,$2,$3,current_date,5,$4)", [orgA, sAna, mCalls, A]), "23514");
await expectError("lançamento no futuro é recusado", () => as(A, "insert into public.team_entries (organization_id, seller_id, metric_id, day, value, updated_by) values ($1,$2,$3,current_date+10,5,$4)", [orgA, sBia, mInsta, A]), "23514");
await expectError("valor negativo é recusado", () => as(A, "insert into public.team_entries (organization_id, seller_id, metric_id, day, value, updated_by) values ($1,$2,$3,current_date-1,-1,$4)", [orgA, sBia, mInsta, A]), "23514");
ok("mesmo dia atualiza (não duplica)", (await as(C, "insert into public.team_entries (organization_id, seller_id, metric_id, day, value, updated_by) values ($1,$2,$3,current_date,9,$4) on conflict (seller_id, metric_id, day) do update set value=excluded.value, updated_by=excluded.updated_by returning value", [orgA, sBia, mInsta, C]))[0].value === "9.00");
await as(A, "update public.leads set assigned_to=$1 where id=$2", [A, leadA]);
const tv = await as(A, "select seller_id, metric_id, value::float v from public.team_values($1, current_date - 30, current_date, 'UTC')", [orgA]);
const sum = (sel, met) => tv.filter((r) => r.seller_id === sel && r.metric_id === met).reduce((a, r) => a + r.v, 0);
ok("time: lançamentos manuais somados", sum(sBia, mInsta) === 9 && sum(sCarla, mInsta) === 12, JSON.stringify(tv));
ok("time: ligações da vendedora vêm do CRM", sum(sAna, mCalls) === 2, String(sum(sAna, mCalls)));
ok("time: faturamento da vendedora vem das vendas", sum(sAna, mWon) === 1500, String(sum(sAna, mWon)));
ok("time: outra empresa não vê nada", (await as(B, "select * from public.team_values($1, current_date - 30, current_date)", [orgA])).length === 0 && (await as(B, "select * from public.team_entries")).length === 0);

console.log("\n# Time comercial v2 (lojas, função, OS, notas)");
const loja = (await as(A, "insert into public.team_stores (organization_id, name, revenue_goal, os_daily_goal) values ($1,'Matriz',110000,4) returning id", [orgA]))[0].id;
await expectError("atendente não cria loja", () => as(C, "insert into public.team_stores (organization_id, name) values ($1,'X')", [orgA]), "42501");
await as(A, "update public.team_sellers set role='closer', store_id=$1 where id=$2", [loja, sCarla]);
await as(A, "update public.team_sellers set role='sdr', store_id=$1 where id=$2", [loja, sBia]);
const lojaB = (await as(B, "insert into public.team_stores (organization_id, name) values ($1,'Loja B') returning id", [orgB]))[0].id;
await expectError("pessoa não vai para loja de outra empresa", () => as(A, "update public.team_sellers set store_id=$1 where id=$2", [lojaB, sBia]), "23514");
const mLig = (await as(A, "insert into public.team_metrics (organization_id, name, role, daily_target) values ($1,'Ligações SDR','sdr',20) returning id", [orgA]))[0].id;
ok("resultado ligado a uma atividade", (await as(A, "insert into public.team_metrics (organization_id, name, role, result_of) values ($1,'Contatos efetivos','sdr',$2) returning 1", [orgA, mLig])).length === 1);
await expectError("resultado não liga em indicador automático", () => as(A, "insert into public.team_metrics (organization_id, name, result_of) values ($1,'X',$2)", [orgA, mCalls]), "23514");
const mOs = (await as(A, "insert into public.team_metrics (organization_id, name, role, source, daily_target) values ($1,'OS fechadas','closer','os_count',4) returning id", [orgA]))[0].id;
const mFat = (await as(A, "insert into public.team_metrics (organization_id, name, role, source, unit) values ($1,'Faturamento OS','closer','os_value','money') returning id", [orgA]))[0].id;
ok("meta individual fixa (dia/semana/mês)", (await as(A, "insert into public.team_seller_goals (organization_id, seller_id, metric_id, daily_target, weekly_target, monthly_target) values ($1,$2,$3,25,125,500) returning 1", [orgA, sBia, mLig])).length === 1);
await expectError("atendente não altera meta individual", () => as(C, "update public.team_seller_goals set daily_target=1 where seller_id=$1 returning 1", [sBia]).then((r) => { if (!r.length) { const e = new Error("bloqueado"); e.code = "42501"; throw e; } }), "42501");
ok("closer registra OS da própria loja", (await as(C, "insert into public.team_sales (organization_id, seller_id, sdr_id, day, value, os_number, created_by) values ($1,$2,$3,current_date,1850.5,'OS-1001',$4) returning store_id", [orgA, sCarla, sBia, C]))[0].store_id === loja);
await as(C, "insert into public.team_sales (organization_id, seller_id, day, value, created_by) values ($1,$2,current_date,650,$3)", [orgA, sCarla, C]);
await expectError("atendente não registra OS em nome de outra pessoa com login", () => as(C, "insert into public.team_sales (organization_id, seller_id, day, value, created_by) values ($1,$2,current_date,10,$3)", [orgA, sAna, C]), "42501");
await expectError("OS com SDR de outra empresa é recusada", async () => {
  const sB = (await as(B, "insert into public.team_sellers (organization_id, name) values ($1,'SDR B') returning id", [orgB]))[0].id;
  await as(A, "insert into public.team_sales (organization_id, seller_id, sdr_id, day, value, created_by) values ($1,$2,$3,current_date,1,$4)", [orgA, sAna, sB, A]);
}, "23514");
const tv2 = await as(A, "select seller_id, metric_id, value::float v from public.team_values($1, current_date - 1, current_date, 'UTC')", [orgA]);
const sumV2 = (sel, met) => tv2.filter((r) => r.seller_id === sel && r.metric_id === met).reduce((a, r) => a + r.v, 0);
ok("OS fechadas e faturamento saem das OS registradas", sumV2(sCarla, mOs) === 2 && sumV2(sCarla, mFat) === 2500.5, JSON.stringify([sumV2(sCarla, mOs), sumV2(sCarla, mFat)]));
ok("vendedora salva o bloco de notas do dia", (await as(C, "insert into public.team_notes (organization_id, seller_id, day, body, updated_by) values ($1,$2,current_date,'Maria quer orçamento até sexta',$3) returning 1", [orgA, sCarla, C])).length === 1);
ok("equipe lê as notas", (await as(A, "select body from public.team_notes where seller_id=$1", [sCarla]))[0]?.body.includes("Maria"));
await expectError("atendente não escreve no bloco de outra pessoa com login", () => as(C, "insert into public.team_notes (organization_id, seller_id, day, body, updated_by) values ($1,$2,current_date,'x',$3)", [orgA, sAna, C]), "42501");
ok("início da consultoria e marco zero", (await as(A, "insert into public.team_settings (organization_id, cycle_start, baseline) values ($1, '2026-10-14', '{\"x\":10}') returning 1", [orgA])).length === 1);
await expectError("atendente não altera marco zero", () => as(C, "insert into public.team_settings (organization_id) values ($1)", [orgB]), "42501");
ok("outra empresa não vê OS nem notas", (await as(B, "select * from public.team_sales")).length === 0 && (await as(B, "select * from public.team_notes")).length === 0);

console.log(`\n${pass} passaram, ${failN} falharam`);
process.exit(failN ? 1 : 0);
