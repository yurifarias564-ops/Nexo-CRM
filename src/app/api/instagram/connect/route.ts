import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { fail } from "@/lib/http";
import { authorizeUrl, signState } from "@/lib/instagram";

export const runtime = "nodejs";

/** Abre o login do Instagram para conectar a conta profissional da loja. */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    // ?full=1 pede também as permissões de automação (publicar e ler comentários)
    const full = new URL(req.url).searchParams.get("full") === "1";
    return NextResponse.redirect(authorizeUrl(signState(ctx.org.id, ctx.userId, full), full));
  } catch (e) {
    return fail(e);
  }
}
