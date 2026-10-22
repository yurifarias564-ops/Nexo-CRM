import "server-only";

/** Lê variável de ambiente obrigatória no servidor, com erro claro se faltar. */
export function env(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v.trim();
}

export function envOptional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function appUrl(): string {
  return env("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");
}
