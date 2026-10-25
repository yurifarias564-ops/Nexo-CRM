// Testes unitários da lógica de servidor (parsers de webhook, telefone, dinheiro, CPF/CNPJ).
// Rodar: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWebhook as parseMeta } from "@/lib/whatsapp/meta";
import { parseWebhook as parseEvo, normalizeRecord, waIdFromKey } from "@/lib/whatsapp/evolution";
import { between, formatPhone, normalizePhone, norm } from "@/lib/utils";
import { isValidCpfCnpj } from "@/lib/asaas";
import { parseMoney } from "@/lib/spreadsheet";
import { bestMatch } from "@/lib/voice";
import { e164, parseHangup, trustedRecordingUrl } from "@/lib/voip/api4com";
import { ResolvedAction, describe as describeAction } from "@/lib/voice-actions";

test("telefone: normaliza formatos brasileiros", () => {
  assert.equal(normalizePhone("(85) 99999-8888"), "5585999998888");
  assert.equal(normalizePhone("+55 85 99999-8888"), "5585999998888");
  assert.equal(normalizePhone("85 3333-4444"), "558533334444");
  assert.equal(normalizePhone("0055 11 91234-5678"), "5511912345678");
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizePhone("123"), null);
  assert.equal(formatPhone("5585999998888"), "+55 (85) 99999-8888");
});

test("dinheiro: aceita formatos BR e internacional", () => {
  assert.equal(parseMoney("R$ 1.234,56"), 1234.56);
  assert.equal(parseMoney("1234.56"), 1234.56);
  assert.equal(parseMoney("1,234.56"), 1234.56);
  assert.equal(parseMoney("2500"), 2500);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("-50"), null);
});

test("CPF/CNPJ: valida dígitos verificadores", () => {
  assert.equal(isValidCpfCnpj("529.982.247-25"), true);
  assert.equal(isValidCpfCnpj("111.111.111-11"), false);
  assert.equal(isValidCpfCnpj("529.982.247-24"), false);
  assert.equal(isValidCpfCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCpfCnpj("11.222.333/0001-80"), false);
});

test("kanban: posição intermediária", () => {
  assert.equal(between(undefined, undefined), 0);
  assert.equal(between(10, 20), 15);
  assert.equal(between(undefined, 0), -1024);
  assert.equal(between(5, undefined), 1029);
});

test("voz: casa nomes ignorando acento e caixa", () => {
  const stages = [{ name: "Novo lead" }, { name: "Negociação" }, { name: "Proposta enviada" }];
  assert.equal(bestMatch(stages, "negociacao")?.name, "Negociação");
  assert.equal(bestMatch(stages, "coluna de negociação")?.name, "Negociação");
  assert.equal(bestMatch(stages, "proposta")?.name, "Proposta enviada");
  assert.equal(bestMatch(stages, "financeiro"), null);
  assert.equal(norm("  Anúncio!! "), "anuncio");
});

test("voz: valida e descreve ações", () => {
  const a = ResolvedAction.parse({
    kind: "move_lead", leadId: "00000000-0000-4000-8000-000000000001", leadName: "Yuri", leadCandidates: [],
    stageId: "00000000-0000-4000-8000-000000000002", stageName: "Negociação",
  });
  assert.equal(describeAction(a), 'Mover Yuri para "Negociação"');
  assert.throws(() => ResolvedAction.parse({ kind: "delete_everything" }));
});

test("Meta: mensagem recebida, status e nome do contato", () => {
  const batches = parseMeta({
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "123" },
      contacts: [{ wa_id: "5585999998888", profile: { name: "Yuri" } }],
      messages: [
        { id: "wamid.1", from: "5585999998888", timestamp: "1700000000", type: "text", text: { body: "Oi!" } },
        { id: "wamid.2", from: "5585999998888", timestamp: "1700000001", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "foto" } },
        { id: "wamid.3", from: "5585999998888", timestamp: "1700000002", type: "reaction", reaction: {} },
      ],
      statuses: [{ id: "wamid.0", status: "read" }],
    } }] }],
  });
  assert.equal(batches.length, 1);
  const b = batches[0]!;
  assert.equal(b.phoneNumberId, "123");
  assert.equal(b.historical, false);
  assert.equal(b.messages.length, 2, "reação deve ser ignorada");
  assert.equal(b.messages[0]!.contact_name, "Yuri");
  assert.equal(b.messages[0]!.body, "Oi!");
  assert.equal(b.messages[0]!.sent_at, new Date(1700000000 * 1000).toISOString());
  assert.equal(b.messages[1]!.type, "image");
  assert.equal(b.messages[1]!.media_ref, "MEDIA1");
  assert.deepEqual(b.statuses, [{ external_id: "wamid.0", status: "read" }]);
});

test("Meta: histórico de coexistência e ecos do celular", () => {
  const [h] = parseMeta({ entry: [{ changes: [{ field: "history", value: {
    metadata: { phone_number_id: "123" },
    history: [{ threads: [{ id: "5511912345678", messages: [
      { id: "h1", from: "5511912345678", timestamp: "1690000000", type: "text", text: { body: "cliente" } },
      { id: "h2", from: "558533334444", timestamp: "1690000100", type: "text", text: { body: "empresa" } },
    ] }] }],
  } }] }] });
  assert.equal(h!.historical, true);
  assert.equal(h!.messages[0]!.direction, "in");
  assert.equal(h!.messages[1]!.direction, "out");
  assert.equal(h!.messages[1]!.wa_id, "5511912345678");

  const [e] = parseMeta({ entry: [{ changes: [{ field: "smb_message_echoes", value: {
    metadata: { phone_number_id: "123" },
    message_echoes: [{ id: "e1", from: "558533334444", to: "5511912345678", timestamp: "1700000000", type: "text", text: { body: "enviado pelo celular" } }],
  } }] }] });
  assert.equal(e!.messages[0]!.direction, "out");
  assert.equal(e!.messages[0]!.wa_id, "5511912345678");
});

test("Meta: payload malformado não quebra", () => {
  assert.deepEqual(parseMeta(null), []);
  assert.deepEqual(parseMeta({ entry: [{ changes: [{ field: "messages", value: {} }] }] }), []);
});

test("Evolution: mensagens, grupos ignorados, LID e eco", () => {
  const evt = parseEvo({ event: "messages.upsert", data: {
    key: { remoteJid: "5585999998888@s.whatsapp.net", fromMe: false, id: "ABC" },
    pushName: "Yuri", message: { conversation: "Olá" }, messageTimestamp: 1700000000,
  } });
  assert.equal(evt.messages.length, 1);
  assert.equal(evt.messages[0]!.wa_id, "5585999998888");
  assert.equal(evt.messages[0]!.direction, "in");
  assert.equal(evt.messages[0]!.contact_name, "Yuri");

  const grp = parseEvo({ event: "MESSAGES_UPSERT", data: { key: { remoteJid: "123@g.us", id: "G" }, message: { conversation: "grupo" } } });
  assert.equal(grp.messages.length, 0, "grupos são ignorados");

  assert.equal(waIdFromKey({ remoteJid: "999@lid", remoteJidAlt: "5585999998888@s.whatsapp.net" }), "5585999998888");
  assert.equal(waIdFromKey({ remoteJid: "999@lid" }), "999@lid");

  const out = normalizeRecord({ key: { remoteJid: "5585999998888@s.whatsapp.net", fromMe: true, id: "OUT1" }, message: { extendedTextMessage: { text: "resposta" } }, messageTimestamp: "1700000000" });
  assert.equal(out?.direction, "out");
  assert.equal(out?.body, "resposta");

  const img = normalizeRecord({ key: { remoteJid: "5585999998888@s.whatsapp.net", id: "IMG" }, message: { ephemeralMessage: { message: { imageMessage: { caption: "foto", mimetype: "image/jpeg" } } } } });
  assert.equal(img?.type, "image");
  assert.equal(img?.media_ref, "IMG", "mídia é baixada sob demanda pelo id");
});

test("Evolution: histórico, status e conexão", () => {
  const set = parseEvo({ event: "messages.set", data: { messages: [
    { key: { remoteJid: "5511912345678@s.whatsapp.net", id: "H1", fromMe: false }, message: { conversation: "antiga" }, messageTimestamp: 1600000000 },
    { key: { remoteJid: "status@broadcast", id: "S" }, message: { conversation: "status" } },
  ] } });
  assert.equal(set.historical, true);
  assert.equal(set.messages.length, 1);

  const upd = parseEvo({ event: "messages.update", data: [{ keyId: "OUT1", status: "READ" }, { keyId: "X", status: "WHATEVER" }] });
  assert.deepEqual(upd.statuses, [{ external_id: "OUT1", status: "read" }]);

  assert.equal(parseEvo({ event: "connection.update", data: { state: "open" } }).connection, "open");
  assert.equal(parseEvo({ event: "qrcode.updated", data: { qrcode: { base64: "data:image/png;base64,AAA" } } }).qr, "data:image/png;base64,AAA");
  assert.deepEqual(parseEvo({}).messages, []);
});

test("Meta: lista só modelos aprovados e enviáveis com texto", async () => {
  const { listTemplates, renderTemplate } = await import("@/lib/whatsapp/meta");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [
    { name: "boas_vindas", language: "pt_BR", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Olá {{1}}, sua proposta de {{2}} está pronta." }] },
    { name: "pendente", language: "pt_BR", status: "PENDING", category: "UTILITY", components: [{ type: "BODY", text: "x" }] },
    { name: "com_imagem", language: "pt_BR", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "y" }] },
    { name: "botao_url", language: "pt_BR", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "z" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://x.com/{{1}}" }] }] },
    { name: "simples", language: "en_US", status: "APPROVED", category: "UTILITY", components: [{ type: "HEADER", format: "TEXT", text: "Oi" }, { type: "BODY", text: "Sem variáveis" }] },
  ] }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    const list = await listTemplates("123", "tok");
    assert.deepEqual(list.map((t) => `${t.name}:${t.params}`), ["boas_vindas:2", "simples:0"]);
    assert.equal(renderTemplate(list[0]!.body, ["Yuri", "R$ 1.500"]), "Olá Yuri, sua proposta de R$ 1.500 está pronta.");
  } finally {
    globalThis.fetch = original;
  }
});

test("mídia: tipo enviado ao WhatsApp a partir do arquivo", async () => {
  const { mediaKind } = await import("@/lib/send");
  assert.equal(mediaKind("image/jpeg"), "image");
  assert.equal(mediaKind("image/webp"), "document", "webp não é aceito como imagem pela Meta");
  assert.equal(mediaKind("video/mp4"), "video");
  assert.equal(mediaKind("audio/ogg"), "audio");
  assert.equal(mediaKind("application/pdf"), "document");
});

test("voz: novas ações (editar lead e enviar mensagem)", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const up = ResolvedAction.parse({ kind: "update_lead", leadId: id, leadName: "Yuri", leadCandidates: [], patch: { phone: "5585999998888" } });
  assert.equal(describeAction(up), "Atualizar Yuri: telefone → +5585999998888");
  const msg = ResolvedAction.parse({ kind: "send_message", leadId: id, leadName: "Yuri", leadCandidates: [], text: "Proposta enviada!" });
  assert.equal(describeAction(msg), 'Enviar WhatsApp para Yuri: "Proposta enviada!"');
  assert.throws(() => ResolvedAction.parse({ kind: "update_lead", leadId: id, leadName: "Y", leadCandidates: [], patch: {} }));
  assert.throws(() => ResolvedAction.parse({ kind: "update_lead", leadId: id, leadName: "Y", leadCandidates: [], patch: { phone: "abc" } }));
});

test("agenda: horário falado vira o instante certo no fuso do usuário", async () => {
  const { zonedToUtc, nowInZone, formatWhen, isValidTimeZone } = await import("@/lib/time");
  assert.equal(zonedToUtc("2026-10-23T10:00", "America/Fortaleza")?.toISOString(), "2026-10-23T13:00:00.000Z");
  assert.equal(zonedToUtc("2026-10-23T10:00", "America/Sao_Paulo")?.toISOString(), "2026-10-23T13:00:00.000Z");
  assert.equal(zonedToUtc("2026-07-01T10:00", "America/New_York")?.toISOString(), "2026-07-01T14:00:00.000Z", "horário de verão");
  assert.equal(zonedToUtc("2026-12-01T10:00", "America/New_York")?.toISOString(), "2026-12-01T15:00:00.000Z", "horário padrão");
  assert.equal(zonedToUtc("amanhã 10h", "America/Fortaleza"), null);
  assert.equal(nowInZone("America/Fortaleza", new Date("2026-10-22T14:02:00Z")), "2026-10-22T11:02 (quinta-feira)");
  assert.equal(formatWhen("2026-10-23T13:00:00.000Z", "America/Fortaleza"), "sex., 23/10 às 10:00");
  assert.equal(isValidTimeZone("America/Fortaleza"), true);
  assert.equal(isValidTimeZone("Marte/Base"), false);
});

test("voz: agendamento descreve horário, etapa e Google Agenda", () => {
  const a = ResolvedAction.parse({
    kind: "schedule_meeting", leadId: "00000000-0000-4000-8000-000000000001", leadName: "Yuri", leadCandidates: [],
    start: "2026-10-23T13:00:00.000Z", end: "2026-10-23T14:00:00.000Z", timeZone: "America/Fortaleza",
    title: "Reunião com Yuri", moveToStage: "Agendamento", google: true,
  });
  assert.equal(describeAction(a), 'Agendar "Reunião com Yuri" — sex., 23/10 às 10:00 (60 min) e mover Yuri para "Agendamento" · Google Agenda');
  assert.throws(() => ResolvedAction.parse({ ...a, start: "amanhã" }));
});

test("mensagem agendada: voz descreve envio e falhas são classificadas", async () => {
  const a = ResolvedAction.parse({
    kind: "schedule_message", leadId: "00000000-0000-4000-8000-000000000001", leadName: "Yuri", leadCandidates: [],
    sendAt: "2026-10-31T12:00:00.000Z", timeZone: "America/Fortaleza",
    text: "E aí, meu patrão, tudo certo? Vamos dar continuidade no nosso atendimento.", provider: "evolution",
  });
  assert.equal(describeAction(a), 'Enviar WhatsApp para Yuri em sáb., 31/10 às 09:00: "E aí, meu patrão, tudo certo? Vamos dar continuidade no nosso atendimento."');

  const { isPermanent, friendly } = await import("@/lib/scheduled");
  const { HttpError } = await import("@/lib/http");
  const { WindowClosedError } = await import("@/lib/send");
  assert.equal(isPermanent(new WindowClosedError()), true, "janela de 24h: não adianta tentar de novo");
  assert.match(friendly(new WindowClosedError()), /modelo/);
  assert.equal(isPermanent(new HttpError(422, "sem telefone")), true);
  assert.equal(isPermanent(new HttpError(502, "WhatsApp fora do ar")), false, "erro do provedor: tenta de novo");
  assert.equal(isPermanent(new HttpError(429, "limite")), false);
  assert.equal(isPermanent(new Error("timeout")), false);
});

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------
import { evaluateGoals, type Metrics, type ReportData } from "@/lib/reports/data";
import { currentPeriod, isLastDayOfMonth, monthRange, periodLabel, previousPeriod, shiftPeriod } from "@/lib/reports/period";
import { renderReportPdf, sanitize } from "@/lib/reports/pdf";
import { factSheet, WrittenReport } from "@/lib/reports/writer";
import { Blueprint, templateKind } from "@/lib/reports/blueprint";
import { PDFDocument } from "pdf-lib";

const metrics = (p: Partial<Metrics> = {}): Metrics => ({
  new_leads: 120, won_count: 18, won_value: 54000, lost_count: 12, calls: 210, calls_answered: 140, scheduled_sent: 60,
  appointments: 35, appointments_held: 28, messages_in: 900, messages_out: 1100, open_count: 40, open_value: 98000,
  by_source: [{ name: "Instagram", count: 70 }, { name: "Indicação", count: 50 }],
  won_by_source: [{ name: "Indicação", count: 11, value: 36000 }], by_stage: [{ name: "Novo", count: 20 }],
  won_by_owner: [{ name: "Ana", count: 10, value: 30000 }], followups: 270, conversion: 60, ...p,
});

test("relatório: metas avaliadas sem IA (bateu / não bateu)", () => {
  const g = evaluateGoals([
    { metric: "won_count", target: 15 }, { metric: "won_value", target: 60000 }, { metric: "calls", target: 210 },
    { metric: "followups", target: 0 }, { metric: "inexistente", target: 5 },
  ], metrics());
  assert.equal(g.length, 3, "ignora meta zerada e métrica desconhecida");
  assert.deepEqual(g.map((x) => [x.metric, x.hit]), [["won_count", true], ["won_value", false], ["calls", true]]);
  assert.equal(g[1]!.pct, 90);
  assert.equal(g[1]!.money, true);
});

test("relatório: períodos e último dia do mês no fuso da empresa", () => {
  assert.equal(previousPeriod("2026-01"), "2025-12");
  assert.equal(shiftPeriod("2026-12", 1), "2027-01");
  assert.equal(shiftPeriod("2026-03", -14), "2025-01");
  assert.equal(periodLabel("2026-10"), "Outubro de 2026");
  const r = monthRange("2026-10", "America/Sao_Paulo");
  assert.equal(r.from.toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-11-01T03:00:00.000Z");
  // 31/10 às 22h em São Paulo = 01/11 01h UTC: ainda é o último dia lá
  const at = new Date("2026-11-01T01:00:00Z");
  assert.equal(isLastDayOfMonth("America/Sao_Paulo", at), true);
  assert.equal(currentPeriod("America/Sao_Paulo", at), "2026-10");
  assert.equal(isLastDayOfMonth("UTC", at), false);
  assert.equal(isLastDayOfMonth("America/Sao_Paulo", new Date("2026-10-30T15:00:00Z")), false);
  assert.equal(isLastDayOfMonth("America/Sao_Paulo", new Date("2027-02-28T15:00:00Z")), true, "fevereiro");
  assert.equal(isLastDayOfMonth("America/Sao_Paulo", new Date("2028-02-28T15:00:00Z")), false, "bissexto");
});

test("relatório: PDF aceita só caracteres da fonte padrão", () => {
  assert.equal(sanitize("Meta → batida ✓ 🚀 ação"), "Meta -> batida OK  ação");
  assert.equal(sanitize("R$ 1.500,00"), "R$ 1.500,00");
});

test("relatório: tipos de modelo aceitos", () => {
  assert.equal(templateKind("application/pdf", "x.bin"), "pdf");
  assert.equal(templateKind("", "Relatório.DOCX"), "docx");
  assert.equal(templateKind("image/png", "foto.png"), null);
  assert.equal(Blueprint.safeParse({ title: "x", tone: "y", sections: [] }).success, false, "precisa de seção");
});

const sampleData = (): ReportData => ({
  orgName: "Clínica Sorriso", period: "2026-10", periodLabel: "Outubro de 2026", timeZone: "America/Sao_Paulo",
  current: metrics(), previous: metrics({ new_leads: 100, won_count: 12, won_value: 40000 }),
  goals: evaluateGoals([{ metric: "won_count", target: 15 }, { metric: "won_value", target: 60000 }], metrics()),
  notes: "Campanha de Instagram pausada dia 10.",
  team: [
    { seller: "Ana", rows: [{ metric: "Contatos no WhatsApp", unit: "count", actual: 700, target: 660, previous: 500 }, { metric: "Faturamento", unit: "money", actual: 30000, target: 40000, previous: 20000 }] },
    { seller: "Bia", rows: [{ metric: "Contatos no WhatsApp", unit: "count", actual: 400, target: 660, previous: 450 }, { metric: "Faturamento", unit: "money", actual: 24000, target: null, previous: 0 }] },
  ],
});

test("relatório: ficha de dados traz números, variação e metas já calculadas", () => {
  const f = factSheet(sampleData());
  assert.match(f, /Leads recebidos: 120 \| 100 \| \+20%/);
  assert.match(f, /\[won_count\] Vendas \(quantidade\): meta 15, realizado 18 \(120%\) → BATEU/);
  assert.match(f, /\[won_value\].*→ NÃO BATEU/);
  assert.match(f, /Campanha de Instagram pausada/);
  assert.match(f, /Contatos no WhatsApp: 700 \| 660 \| 500 → BATEU \(106%\)/);
  assert.match(f, /Contatos no WhatsApp: 400 \| 660 \| 450 → NÃO BATEU/);
});

test("relatório: gera PDF válido com várias páginas", async () => {
  const written = WrittenReport.parse({
    title: "Relatório Mensal de Resultados", headline: "Mês com recorde de vendas → 18 fechamentos 🎉",
    sections: Array.from({ length: 6 }, (_, i) => ({
      title: `Seção ${i + 1}`, paragraphs: ["Texto longo ".repeat(120)], bullets: ["Ponto A", "Ponto B com acentuação: ação, atenção"],
    })),
    goal_comments: [{ metric: "won_count", comment: "Bateu pela alta de indicações." }, { metric: "won_value", comment: "Ticket médio caiu." }],
    next_steps: ["Retomar campanha", "Dobrar follow-up"], whatsapp_caption: "Segue o relatório",
  });
  const bytes = await renderReportPdf(sampleData(), written);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3, `páginas: ${doc.getPageCount()}`);
  assert.match(doc.getTitle() ?? "", /Clínica Sorriso/);
  if (process.env.SAVE_SAMPLE_PDF) (await import("node:fs")).writeFileSync(process.env.SAVE_SAMPLE_PDF, bytes);
});

import { addDays, conv, dayGoalItems, dayProgress, delta as tDelta, filledDays, goalFor, monthDays as tMonthDays, parseBRL, periodAt, periodList, periodScore, totals as tTotals, weekdaysBetween, weekStart, type TeamMetric, type TeamSeller } from "@/lib/team";

const tm = (p: Partial<TeamMetric> & { id: string }): TeamMetric => ({ name: p.id, unit: "count", source: "manual", role: "todos", result_of: null, daily_target: null, weekly_target: null, monthly_target: null, active: true, position: 0, ...p });
const sdr: TeamSeller = { id: "s1", name: "Alison", user_id: null, active: true, position: 0, role: "sdr", store_id: "matriz" };
const closer: TeamSeller = { id: "s2", name: "Lucas", user_id: null, active: true, position: 1, role: "closer", store_id: "matriz" };

test("time: meta individual sobrepõe a padrão; semana e mês derivam da diária (5 e 20 dias úteis)", () => {
  const lig = tm({ id: "lig", role: "sdr", daily_target: 20 });
  assert.deepEqual(goalFor([], lig, "s1"), { daily: 20, weekly: 100, monthly: 400 });
  assert.deepEqual(goalFor([{ seller_id: "s1", metric_id: "lig", daily_target: 25, weekly_target: null, monthly_target: 480 }], lig, "s1"), { daily: 25, weekly: 125, monthly: 480 });
});

test("time: metas por função, % do dia e conversão", () => {
  const ms = [tm({ id: "lig", role: "sdr", daily_target: 20 }), tm({ id: "efet", role: "sdr", result_of: "lig" }), tm({ id: "aval", role: "closer", daily_target: 3 }),
    tm({ id: "os", role: "closer", source: "os_count", daily_target: 4 }), tm({ id: "fat", role: "closer", source: "os_value", unit: "money" })];
  assert.deepEqual(dayGoalItems(ms, [], sdr).map((x) => x.m.id), ["lig"], "SDR só vê metas de SDR; resultado não é meta");
  assert.deepEqual(dayGoalItems(ms, [], closer).map((x) => x.m.id), ["aval", "os"], "closer: atividade + OS; faturamento não entra no dia");
  const vals: Record<string, number> = { aval: 3, os: 2 };
  assert.equal(dayProgress(dayGoalItems(ms, [], closer), (id) => vals[id] ?? 0), 75);
  assert.equal(conv(6, 20), 30);
  assert.equal(conv(1, 0), null);
  assert.equal(periodScore(ms, [], closer, (id) => ({ aval: 60, os: 40, fat: 55000 })[id] ?? 0, 110000), 67, "média de 100%, 50% e 50% (faturamento x meta da loja)");
});

test("time: ciclos de 30 dias a partir do início da consultoria", () => {
  const p = periodAt("2026-10-22", "2026-10-14");
  assert.deepEqual([p.label, p.from, p.to], ["Ciclo 1 · 14/10 a 12/11", "2026-10-14", "2026-11-12"]);
  assert.equal(periodAt("2026-11-13", "2026-10-14").short, "Ciclo 2");
  assert.equal(periodAt("2026-10-22", null).label, "Outubro de 2026");
  assert.equal(periodAt("2026-01-10", null, -1).key, "2025-12");
  assert.equal(periodList("2026-12-20", "2026-10-14").length, 3, "lista só até o ciclo 1");
  assert.equal(weekStart("2026-10-22"), "2026-10-19", "semana começa na segunda");
  assert.equal(weekdaysBetween("2026-10-22", "2026-10-31"), 7);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(tMonthDays("2028-02"), { first: "2028-02-01", last: "2028-02-29", days: 29 });
});

test("time: valores, dias preenchidos e dinheiro em formato brasileiro", () => {
  const vals = [
    { seller_id: "s1", metric_id: "m1", day: "2026-10-01", value: 10 }, { seller_id: "s1", metric_id: "m1", day: "2026-10-02", value: 5 },
    { seller_id: "s1", metric_id: "auto", day: "2026-10-03", value: 3 },
  ];
  assert.equal(tTotals(vals).get("s1:m1"), 15);
  assert.equal(tTotals(vals, "2026-10-02", "2026-10-02").get("s1:m1"), 5);
  assert.equal(filledDays(vals, new Set(["m1"])).get("s1"), 2);
  assert.equal(tDelta(150, 100), 50);
  assert.equal(tDelta(5, 0), null);
  assert.equal(parseBRL("R$ 1.850,50"), 1850.5);
  assert.equal(parseBRL("1850.5"), 1850.5);
  assert.equal(parseBRL("110.000"), 110000, "ponto de milhar");
  assert.equal(parseBRL("1.250.000,00"), 1250000);
  assert.equal(parseBRL("abc"), null);
});

import { parseCallWebhook } from "@/lib/whatsapp/meta-calls";
import { brVariants } from "@/lib/calls";

const wrap = (field: string, value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PN1" }, ...value } }] }] });

test("ligações: webhook da Meta (atendeu, cliente ligando, fim, gravação, permissão)", () => {
  const [a] = parseCallWebhook(wrap("calls", { calls: [{ id: "wacid.1", event: "connect", direction: "BUSINESS_INITIATED", biz_opaque_callback_data: "abc", session: { sdp_type: "answer", sdp: "v=0 answer" } }] }));
  assert.equal(a!.phoneNumberId, "PN1");
  assert.deepEqual([a!.calls[0]!.event, a!.calls[0]!.sdpType, a!.calls[0]!.sdp, a!.calls[0]!.opaque], ["connect", "answer", "v=0 answer", "abc"]);
  const [b] = parseCallWebhook(wrap("calls", { contacts: [{ profile: { name: "Yuri" }, wa_id: "5585999998888" }], calls: [{ id: "wacid.2", from: "5585999998888", event: "connect", direction: "USER_INITIATED", session: { sdp_type: "offer", sdp: "v=0 offer" } }] }));
  assert.equal(b!.contactName, "Yuri");
  assert.deepEqual([b!.calls[0]!.direction, b!.calls[0]!.from, b!.calls[0]!.sdpType], ["USER_INITIATED", "5585999998888", "offer"]);
  const [c] = parseCallWebhook(wrap("calls", { calls: [{ id: "wacid.1", event: "terminate", direction: "BUSINESS_INITIATED", status: "COMPLETED", start_time: "1671644824", end_time: "1671644944", duration: 120 }] }));
  assert.deepEqual([c!.calls[0]!.status, c!.calls[0]!.duration, c!.calls[0]!.startTime], ["COMPLETED", 120, 1671644824]);
  const [d] = parseCallWebhook(wrap("calls", { calls: [{ id: "wacid.1", event: "call_recording_available", call_recording: { type: "audio", audio: { id: "MID", url: "https://x/y", mime_type: "audio/ogg" } } }] }));
  assert.deepEqual(d!.calls[0]!.recording, { id: "MID", url: "https://x/y", mime: "audio/ogg" });
  const [e] = parseCallWebhook(wrap("calls", { statuses: [{ id: "wacid.1", type: "call", status: "RINGING" }, { id: "wamid.x", type: "message", status: "read" }] }));
  assert.deepEqual(e!.statuses, [{ id: "wacid.1", status: "RINGING" }]);
  const [f] = parseCallWebhook(wrap("messages", { messages: [{ from: "5585999998888", type: "interactive", interactive: { type: "call_permission_reply", call_permission_reply: { response: "accept", expiration_timestamp: 1745343479, is_permanent: false, response_source: "user_action" } } }] }));
  assert.deepEqual(f!.permissions[0], { waId: "5585999998888", response: "accept", permanent: false, expiresAt: new Date(1745343479000).toISOString() });
  assert.equal(parseCallWebhook(wrap("messages", { messages: [{ from: "1", type: "text", text: { body: "oi" } }] })).length, 0, "mensagem comum não vira evento de ligação");
});

test("ligações: número com e sem o 9º dígito encontra a mesma conversa", () => {
  assert.deepEqual(brVariants("5585999998888").sort(), ["558599998888", "5585999998888"]);
  assert.deepEqual(brVariants("558599998888").sort(), ["558599998888", "5585999998888"]);
  assert.deepEqual(brVariants("14085551234"), ["14085551234"]);
});

test("whatsapp em 1 clique: troca do código e registro do número chamam a Meta certo", async () => {
  process.env.NEXT_PUBLIC_META_APP_ID = "1145128041279591";
  process.env.META_APP_SECRET = "segredo-teste";
  const es = await import("@/lib/whatsapp/embedded");
  const calls: { url: string; init?: RequestInit }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = String(url).includes("oauth/access_token") ? { access_token: "TOKEN_EMPRESA" } : String(url).includes("phone_numbers") ? { data: [{ id: "PN9", display_phone_number: "+55 85 9999-8888", verified_name: "Notebook CE" }] } : { success: true };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await es.exchangeCode("CODIGO"), "TOKEN_EMPRESA");
    const u = new URL(calls[0]!.url);
    assert.deepEqual([u.pathname.endsWith("/oauth/access_token"), u.searchParams.get("client_id"), u.searchParams.get("client_secret"), u.searchParams.get("code")], [true, "1145128041279591", "segredo-teste", "CODIGO"]);
    assert.equal((await es.listPhones("WABA1", "T"))[0]!.id, "PN9");
    await es.subscribe("WABA1", "T");
    assert.match(calls[2]!.url, /\/WABA1\/subscribed_apps$/);
    await es.register("PN9", "T", "123456");
    assert.match(calls[3]!.url, /\/PN9\/register$/);
    assert.deepEqual(JSON.parse(String(calls[3]!.init?.body)), { messaging_product: "whatsapp", pin: "123456" });
    assert.equal((calls[3]!.init?.headers as Record<string, string>).Authorization, "Bearer T");
  } finally {
    globalThis.fetch = orig;
  }
});

test("Api4Com: telefone no formato da central", () => {
  assert.equal(e164("(85) 99900-3908"), "+5585999003908");
  assert.equal(e164("5585999003908"), "+5585999003908");
  assert.equal(e164("085 3333-4444"), "+558533334444");
  assert.throws(() => e164("123"));
});

test("Api4Com: fim de ligação (webhook)", () => {
  const ev = parseHangup({ eventType: "channel-hangup", id: "abc-1", direction: "outbound", recordUrl: "https://rec.api4com.com/a.mp3", duration: "42", startedAt: "2026-10-24T12:00:00Z", answeredAt: "2026-10-24T12:00:05Z", endedAt: "2026-10-24T12:00:47Z", hangupCause: "NORMAL_CLEARING", metadata: { gateway: "nexo-x", callRowId: "11111111-1111-1111-1111-111111111111" } });
  assert.equal(ev?.id, "abc-1");
  assert.equal(ev?.duration, 42);
  assert.equal(ev?.metadata.callRowId, "11111111-1111-1111-1111-111111111111");
  assert.equal(parseHangup({ eventType: "channel-answer", id: "x" }), null);
  assert.equal(parseHangup({ eventType: "channel-hangup", id: "x", recordUrl: "http://inseguro/a.mp3" })?.recordUrl, null);
  assert.equal(parseHangup("lixo"), null);
});

test("Api4Com: só baixa gravação de endereço público com HTTPS", () => {
  assert.ok(trustedRecordingUrl("https://records.api4com.com/x.mp3"));
  assert.ok(trustedRecordingUrl("https://bucket.s3.amazonaws.com/x.mp3"));
  assert.ok(!trustedRecordingUrl("https://localhost/x.mp3"));
  assert.ok(!trustedRecordingUrl("https://169.254.169.254/latest"));
  assert.ok(!trustedRecordingUrl("http://records.api4com.com/x.mp3"));
  assert.ok(!trustedRecordingUrl("https://user:pw@records.api4com.com/x"));
});

test("Localização: lê coordenadas de link do Google Maps e de texto", async () => {
  const { parseCoords } = await import("@/lib/geo");
  assert.deepEqual(parseCoords("-3.8765, -38.6254"), { latitude: -3.8765, longitude: -38.6254 });
  assert.deepEqual(parseCoords("https://www.google.com/maps/place/Loja/@-3.8765,-38.6254,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-3.8770!4d-38.6260"), { latitude: -3.877, longitude: -38.626 });
  assert.deepEqual(parseCoords("https://maps.google.com/?q=-3.87,-38.62"), { latitude: -3.87, longitude: -38.62 });
  assert.equal(parseCoords("https://maps.app.goo.gl/abc123"), null);
  assert.equal(parseCoords("999, 10"), null);
});

test("Evolution: vídeo bolinha (ptv) recebido vira vídeo marcado como bolinha", () => {
  const r = normalizeRecord({ key: { remoteJid: "5585999998888@s.whatsapp.net", id: "PTV1" }, message: { ptvMessage: { mimetype: "video/mp4" } }, messageTimestamp: "1700000000" });
  assert.equal(r?.type, "video");
  assert.equal(r?.media_mime, "video/mp4;ptv");
});

test("Pix: BR Code igual ao exemplo do Banco Central e chaves normalizadas", async () => {
  const { brCode, normalizePixKey, displayPixKey } = await import("@/lib/pix");
  assert.equal(brCode({ key: "123e4567-e12b-12d1-a456-426655440000", name: "Fulano de Tal", city: "BRASILIA" }),
    "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D");
  const withValue = brCode({ key: "55255981000100", name: "Yuri Farias de Araújo", city: "Maracanaú", amount: 150.5, txid: "PED-123" });
  assert.match(withValue, /540615\d\.50|5406150\.50/);
  assert.match(withValue, /5921Yuri Farias de Araujo/);
  assert.match(withValue, /6009MARACANAU|6009Maracanau/);
  assert.match(withValue, /0506PED123/);
  assert.equal(normalizePixKey("cnpj", "55.255.981/0001-00"), "55255981000100");
  assert.equal(displayPixKey("cnpj", "55255981000100"), "55.255.981/0001-00");
  assert.equal(normalizePixKey("phone", "(85) 99900-3908"), "+5585999003908");
  assert.equal(normalizePixKey("email", " Yuri@Exemplo.com "), "yuri@exemplo.com");
  assert.throws(() => normalizePixKey("cpf", "111.111.111-11"), /CPF inválido/);
  assert.throws(() => normalizePixKey("cnpj", "55.255.981/0001-01"), /CNPJ inválido/);
});

test("WhatsApp QR: queda com sessão encerrada pede QR; queda comum reconecta", async () => {
  const { LOGGED_OUT_CODES, backoffFor } = await import("@/lib/whatsapp/watchdog");
  const closed = parseEvo({ event: "connection.update", data: { instance: "x", state: "close", statusReason: 401 } });
  assert.equal(closed.connection, "close");
  assert.equal(closed.reason, 401);
  assert.ok(LOGGED_OUT_CODES.has(closed.reason!));
  const drop = parseEvo({ event: "CONNECTION_UPDATE", data: { state: "close", statusReason: 428 } });
  assert.ok(!LOGGED_OUT_CODES.has(drop.reason!));
  assert.equal(backoffFor(0), 5);
  assert.equal(backoffFor(99), 300, "espera máxima de 5 min entre tentativas");
});

test("Z-API: mensagens recebidas, enviadas pelo celular, status e conexão", async () => {
  const { parseWebhook: parseZ } = await import("@/lib/whatsapp/zapi");
  const txt = parseZ({ type: "ReceivedCallback", instanceId: "I1", messageId: "M1", phone: "5585999998888", fromMe: false, momment: 1700000000000, senderName: "Cliente", chatName: "Cliente", text: { message: "oi" } });
  assert.equal(txt.messages[0]?.body, "oi");
  assert.equal(txt.messages[0]?.direction, "in");
  assert.equal(txt.messages[0]?.wa_id, "5585999998888");
  assert.equal(txt.messages[0]?.sent_at, new Date(1700000000000).toISOString());
  const mine = parseZ({ type: "ReceivedCallback", messageId: "M2", phone: "5585999998888", fromMe: true, chatName: "Cliente", image: { imageUrl: "https://x.z-api.io/a.jpg", mimeType: "image/jpeg", caption: "foto" } });
  assert.equal(mine.messages[0]?.direction, "out");
  assert.equal(mine.messages[0]?.media_ref, "https://x.z-api.io/a.jpg");
  const ptv = parseZ({ type: "ReceivedCallback", messageId: "M3", phone: "55859", video: { videoUrl: "https://x/v.mp4", caption: "", mimeType: "video/mp4" } });
  assert.equal(ptv.messages[0]?.media_mime, "video/mp4;ptv");
  assert.equal(parseZ({ type: "ReceivedCallback", isGroup: true, messageId: "G", phone: "123-group", text: { message: "x" } }).messages.length, 0, "grupos ficam fora");
  const st = parseZ({ type: "MessageStatusCallback", status: "READ", ids: ["M1", "M2"] });
  assert.deepEqual(st.statuses, [{ external_id: "M1", status: "read" }, { external_id: "M2", status: "read" }]);
  assert.equal(parseZ({ type: "DisconnectedCallback", disconnected: true }).connection, "close");
  assert.equal(parseZ({ type: "ConnectedCallback", connected: true, phone: "5585" }).connection, "open");
});

test("Z-API: mensagem só com @lid fica marcada para juntar na conversa do número", async () => {
  const { parseWebhook: parseZ } = await import("@/lib/whatsapp/zapi");
  const mine = parseZ({ type: "ReceivedCallback", messageId: "L1", phone: "222200401526959@lid", chatLid: "222200401526959@lid", fromMe: true, text: { message: "oi" } });
  assert.equal(mine.messages[0]?.wa_id, "222200401526959");
  assert.equal(mine.messages[0]?.lid, "222200401526959");
  const hers = parseZ({ type: "ReceivedCallback", messageId: "L2", phone: "5585998381570", chatLid: "222200401526959@lid", text: { message: "oi" } });
  assert.equal(hers.messages[0]?.wa_id, "5585998381570", "com número de verdade, usa o número");
  assert.equal(hers.messages[0]?.lid, "222200401526959");
  const noSuffix = parseZ({ type: "ReceivedCallback", messageId: "L3", phone: "222200401526959", chatLid: "222200401526959@lid", fromMe: true, text: { message: "x" } });
  assert.equal(noSuffix.messages[0]?.wa_id, "222200401526959");
});

test("Apagar e editar no celular chegam como alteração (Z-API e Evolution)", async () => {
  const { parseWebhook: parseZ } = await import("@/lib/whatsapp/zapi");
  const del = parseZ({ type: "ReceivedCallback", messageId: "X9", phone: "5585999998888", fromMe: true, notification: "REVOKE" });
  assert.deepEqual(del.changes, [{ external_id: "X9", kind: "delete" }]);
  assert.equal(del.messages.length, 0, "não vira mensagem nova");
  const ed = parseZ({ type: "ReceivedCallback", messageId: "X8", phone: "5585999998888", fromMe: true, isEdit: true, text: { message: "texto novo" } });
  assert.deepEqual(ed.changes, [{ external_id: "X8", kind: "edit", body: "texto novo" }]);
  const evEdit = parseEvo({ event: "messages.edited", data: { key: { id: "E1" }, editedMessage: { conversation: "corrigido" } } });
  assert.deepEqual(evEdit.changes, [{ external_id: "E1", kind: "edit", body: "corrigido" }]);
  const evDel = parseEvo({ event: "MESSAGES_DELETE", data: { id: "E2", remoteJid: "5585@s.whatsapp.net", fromMe: true, status: "DELETED" } });
  assert.deepEqual(evDel.changes, [{ external_id: "E2", kind: "delete" }]);
});

import { splitReply, systemPrompt } from "@/lib/ai/agent";

test("agente de IA: quebra a resposta em até 3 mensagens e limpa markdown", () => {
  assert.deepEqual(splitReply("Oi! Tudo bem?\n\nTemos a **MT-03** sim."), ["Oi! Tudo bem?", "Temos a *MT-03* sim."]);
  assert.deepEqual(splitReply("a\n\nb\n\nc\n\nd"), ["a", "b", "c\n\nd"]);
  assert.deepEqual(splitReply("   "), []);
});

test("agente de IA: prompt traz instruções da empresa, memória e etapas", () => {
  const s = systemPrompt({ name: "Bia", prompt: "Vendemos motos Yamaha.", time_zone: "America/Fortaleza", auto_tags: true }, "Moto Center",
    { name: "Yuri", phone: "5585999990000", stage: "Novo", stages: ["Novo", "Ganho"], tags: ["MT-03"], value: 0, memory: ["Mora em Maracanaú"], summary: null, seller: null }, ["Ana"]);
  assert.match(s, /Você é Bia/);
  assert.match(s, /Vendemos motos Yamaha/);
  assert.match(s, /Mora em Maracanaú/);
  assert.match(s, /etapas disponíveis: Novo, Ganho/);
  assert.match(s, /Tom EXECUTIVO/);
  assert.match(s, /UMA pergunta por mensagem/);
  assert.match(s, /MT-03/);
});

import { checkReply, DEFAULT_RULES, rulesPrompt, stripEmojis, withinHours, withDefaults } from "@/lib/ai/rules";

test("filtro da IA: palavra proibida, preço proibido, desconto e emoji", () => {
  const r = { ...DEFAULT_RULES, forbidden_words: ["garantido", "aprovação"], price_policy: "proibido" as const, emojis: false };
  assert.deepEqual(checkReply("Boa noite, Yuri. Posso ajudar com a MT-03.", r), []);
  assert.ok(checkReply("Seu crédito está garantido!", r).some((x) => x.includes("garantido")));
  assert.ok(checkReply("A aprovacao é rápida", r).some((x) => x.includes("aprovação"))); // sem acento também pega
  assert.ok(checkReply("Ela sai por R$ 33.990", r).some((x) => x.includes("preço")));
  assert.ok(checkReply("Fica 12x de 2.890,00", r).length > 0);
  assert.ok(checkReply("Que ótimo 😄", r).some((x) => x.includes("emoji")));
  assert.equal(stripEmojis("Que ótimo 😄 Até já"), "Que ótimo Até já");
  assert.ok(checkReply("Consigo te dar um desconto de 10%", r).length > 0);
  const ok5 = { ...DEFAULT_RULES, max_discount_pct: 5 };
  assert.deepEqual(checkReply("Posso fazer 5% de desconto à vista", ok5), []);
  assert.ok(checkReply("Faço 8% de desconto", ok5).some((x) => x.includes("acima")));
});

test("filtro da IA: com preço liberado só aceita valores das informações", () => {
  const r = { ...DEFAULT_RULES, price_policy: "liberado" as const, knowledge: "MT-03 a partir de R$ 33.990\nFazer 250: R$ 22.490,00" };
  assert.deepEqual(checkReply("A MT-03 sai a partir de R$ 33.990.", r), []);
  assert.deepEqual(checkReply("A Fazer está R$ 22.490", r), []);
  assert.ok(checkReply("A MT-03 sai por R$ 31.500", r).some((x) => x.includes("31.500")));
});

test("regras da IA: prompt, padrão e horário", () => {
  const r = withDefaults({ goal: "pre_atendimento", forbidden_topics: ["juros"], required_questions: ["Qual modelo?"] });
  assert.equal(r.price_policy, "proibido");
  const p = rulesPrompt(r);
  assert.match(p, /PRÉ-ATENDIMENTO/);
  assert.match(p, /juros/);
  assert.match(p, /1\. Qual modelo\?/);
  const h = { ...r, hours: { ...r.hours, enabled: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" } };
  assert.equal(withinHours(h, "America/Fortaleza", new Date("2026-10-26T13:00:00Z")), true); // seg 10h
  assert.equal(withinHours(h, "America/Fortaleza", new Date("2026-10-26T23:00:00Z")), false); // seg 20h
  assert.equal(withinHours(h, "America/Fortaleza", new Date("2026-10-25T13:00:00Z")), false); // domingo
});

import { classify, findProtocol, newCode, trackedUrl, withProtocol } from "@/lib/tracking/shared";
import { adFrom } from "@/lib/whatsapp/types";
import { parseWebhook as parseZapi } from "@/lib/whatsapp/zapi";

test("rastreio: canal de origem pelas UTMs e ids de clique", () => {
  assert.equal(classify({ utm_source: "facebook", utm_medium: "paid" }), "meta_ads");
  assert.equal(classify({ utm_source: "ig", utm_medium: "cpc" }), "meta_ads");
  assert.equal(classify({ fbclid: "abc" }), "meta_ads");
  assert.equal(classify({ utm_source: "instagram", utm_medium: "bio" }), "bio");
  assert.equal(classify({ utm_source: "instagram", utm_medium: "stories" }), "instagram");
  assert.equal(classify({ gclid: "x" }), "google");
  assert.equal(classify({ utm_source: "tiktok" }), "tiktok");
  assert.equal(classify({ referrer: "https://l.instagram.com/" }), "instagram");
  assert.equal(classify({}), "direto");
  assert.equal(classify({ kind: "site" }), "site");
});

test("rastreio: protocolo na mensagem do WhatsApp", () => {
  const code = newCode();
  assert.match(code, /^[A-Z0-9]{6}$/);
  const msg = withProtocol("Olá! Quero a MT-03", code);
  assert.equal(findProtocol(msg), code);
  assert.equal(findProtocol("oi, protocolo ab12cd"), "AB12CD");
  assert.equal(findProtocol("Olá, tudo bem?"), null);
  assert.equal(trackedUrl("https://x.app", "bio", { utm_source: "instagram", utm_campaign: "{{campaign.name}}", utm_content: "" }), "https://x.app/r/bio?utm_source=instagram&utm_campaign={{campaign.name}}");
});

test("rastreio: anúncio de clique para o WhatsApp (Meta oficial e Z-API)", () => {
  assert.deepEqual(adFrom({ source_id: "1203", source_type: "ad", source_url: "https://fb.me/x", headline: "MT-03 0km", ctwa_clid: "Ab1" }),
    { source_id: "1203", source_url: "https://fb.me/x", source_type: "ad", title: "MT-03 0km", body: null, ctwa_clid: "Ab1" });
  assert.equal(adFrom({ title: "só título" }), null);
  const z = parseZapi({ type: "ReceivedCallback", phone: "5585999990000", messageId: "M1", fromMe: false, momment: 1761350000000, text: { message: "Oi" },
    externalAdReply: { title: "Promo MT-03", sourceId: "999", sourceUrl: "https://fb.me/ad", ctwaClid: "CLID" } });
  assert.equal(z.messages[0]?.ad?.source_id, "999");
  assert.equal(z.messages[0]?.ad?.ctwa_clid, "CLID");
});
