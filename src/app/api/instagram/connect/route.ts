import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { fail } from "@/lib/http";
import { authorizeUrl, signState } from "@/lib/instagram";

export const runtime = "nodejs";

/** Abre o login do Instagram para conectar a conta profissional da loja. */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    return NextResponse.redirect(authorizeUrl(signState(ctx.org.id, ctx.userId)));
  } catch (e) {
    return fail(e);
  }
}
