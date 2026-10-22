import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Converte qualquer erro em resposta JSON segura (sem vazar detalhes internos). */
export function fail(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof ZodError) {
    return NextResponse.json({ error: err.issues[0]?.message ?? "Dados inválidos" }, { status: 422 });
  }
  console.error("[api]", err);
  return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 });
}

export async function readJson(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "Requisição muito grande");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Requisição muito grande");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}
