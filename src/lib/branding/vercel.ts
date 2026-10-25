import "server-only";
import { envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { isApex } from "./shared";

// Domínio próprio do cliente: adiciona o domínio ao projeto na Vercel (que emite o certificado HTTPS sozinha)
// e confere o DNS. Precisa das variáveis VERCEL_API_TOKEN e VERCEL_PROJECT_ID (VERCEL_TEAM_ID se o projeto for de um time).

function cfg() {
  const auth = envOptional("VERCEL_API_TOKEN");
  const project = envOptional("VERCEL_PROJECT_ID");
  if (!auth || !project) throw new HttpError(409, "Domínio próprio ainda não ativado no servidor: falta configurar o acesso à Vercel (VERCEL_API_TOKEN e VERCEL_PROJECT_ID).");
  const team = envOptional("VERCEL_TEAM_ID");
  return { auth, project, qs: team ? `?teamId=${encodeURIComponent(team)}` : "" };
}

export const domainsReady = () => Boolean(envOptional("VERCEL_API_TOKEN") && envOptional("VERCEL_PROJECT_ID"));

async function v<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const c = cfg();
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.vercel.com${path}${c.qs ? `${sep}${c.qs.slice(1)}` : ""}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${c.auth}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!res.ok) {
    const code = data.error?.code;
    if (code === "domain_already_in_use" || code === "domain_taken") throw new HttpError(409, "Esse domínio já está em uso em outro projeto da Vercel.");
    if (code === "invalid_domain") throw new HttpError(422, "Domínio inválido.");
    if (res.status === 404 && init.method === "DELETE") return data;
    throw new HttpError(502, `Vercel: ${data.error?.message ?? res.status}`);
  }
  return data;
}

export interface DnsRecord { type: "A" | "CNAME" | "TXT"; name: string; value: string; why: string }
export interface DomainState { verified: boolean; configured: boolean; records: DnsRecord[] }

const host = (domain: string) => {
  const parts = domain.split(".");
  return isApex(domain) ? "@" : parts.slice(0, parts.length - (/\.(com|net|org|gov|edu|art|blog|eco|ind|med|adv|eng|tec)\.br$/.test(domain) ? 3 : 2)).join(".");
};

export async function addDomain(domain: string) {
  const { project } = cfg();
  await v(`/v10/projects/${encodeURIComponent(project)}/domains`, { method: "POST", body: { name: domain } });
  return domainState(domain);
}

export async function removeDomain(domain: string) {
  const { project } = cfg();
  await v(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
}

/** O que falta no DNS do cliente e se já está tudo certo. */
export async function domainState(domain: string): Promise<DomainState> {
  const { project } = cfg();
  type P = { verified?: boolean; verification?: { type: string; domain: string; value: string; reason?: string }[] };
  type C = { misconfigured?: boolean; recommendedIPv4?: { rank: number; value: string[] }[]; recommendedCNAME?: { rank: number; value: string }[] };
  let p = await v<P>(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}`);
  if (!p.verified) p = await v<P>(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}/verify`, { method: "POST" }).catch(() => p);
  const c = await v<C>(`/v6/domains/${encodeURIComponent(domain)}/config`).catch(() => ({ misconfigured: true } as C));
  const records: DnsRecord[] = [];
  if (isApex(domain)) {
    const ip = c.recommendedIPv4?.sort((a, b) => a.rank - b.rank)[0]?.value[0] ?? "76.76.21.21";
    records.push({ type: "A", name: "@", value: ip, why: "aponta o domínio para o CRM" });
  } else {
    const cname = c.recommendedCNAME?.sort((a, b) => a.rank - b.rank)[0]?.value ?? "cname.vercel-dns.com";
    records.push({ type: "CNAME", name: host(domain), value: cname.replace(/\.$/, ""), why: "aponta o subdomínio para o CRM" });
  }
  for (const r of p.verification ?? []) {
    if (r.type === "TXT") records.push({ type: "TXT", name: r.domain, value: r.value, why: "comprova que o domínio é seu" });
  }
  return { verified: p.verified !== false, configured: c.misconfigured === false, records };
}
