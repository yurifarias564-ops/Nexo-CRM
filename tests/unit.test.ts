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
