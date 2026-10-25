import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";

// Chamadas HTTPS para endereços informados pelo cliente (webhooks, sistemas próprios):
// só endereços públicos, conectando exatamente no IP verificado e sem seguir redirecionamento.

/** Webhook: só endereços públicos (nada de rede interna, localhost, nuvem etc.). */
const BLOCKED = (() => {
  const b = new BlockList();
  for (const [ip, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) b.addSubnet(ip, bits, "ipv4");
  for (const [ip, bits] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) b.addSubnet(ip, bits, "ipv6");
  return b;
})();
const blockedIp = (ip: string) => BLOCKED.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");

/** Confere o endereço e devolve o IP público já verificado (a conexão usa exatamente esse IP). */
export async function publicTarget(raw: string): Promise<{ url: URL; ip: string; family: 4 | 6 }> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Use um endereço https://");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) as 4 | 6 }] : (await lookup(host, { all: true })).map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
  if (!addrs.length || addrs.some((a) => blockedIp(a.address))) throw new Error("Endereço não permitido (rede interna)");
  return { url, ip: addrs[0]!.address, family: addrs[0]!.family };
}

/** POST https para o IP já verificado (sem segunda consulta de DNS e sem seguir redirecionamento). */
export function postPinned(t: { url: URL; ip: string; family: 4 | 6 }, body: string, headers: Record<string, string>, opts: { readBody?: boolean; timeoutMs?: number } = {}): Promise<number> {
  return postPinnedFull(t, body, headers, opts).then((r) => r.status);
}

/** Igual ao postPinned, mas devolve também a resposta (até 256 KB). */
export function postPinnedFull(t: { url: URL; ip: string; family: 4 | 6 }, body: string, headers: Record<string, string>, opts: { readBody?: boolean; timeoutMs?: number } = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(t.url, {
      method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body).toString() }, timeout: opts.timeoutMs ?? 15_000,
      lookup: (_h, opts, cb) => {
        const o = opts as { all?: boolean };
        if (o.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: t.ip, family: t.family }]);
        else cb(null, t.ip, t.family);
      },
    }, (res) => {
      if (!opts.readBody) { res.resume(); resolve({ status: res.statusCode ?? 0, text: "" }); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size <= 262_144) chunks.push(c); else res.destroy(new Error("Resposta grande demais")); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
      res.on("close", () => { if (!res.complete) reject(new Error("Conexão encerrada antes do fim da resposta")); });
    });
    req.on("timeout", () => req.destroy(new Error(`Tempo esgotado (${Math.round((opts.timeoutMs ?? 15_000) / 1000)}s)`)));
    req.on("error", reject);
    req.end(body);
  });
}

