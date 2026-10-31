import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { fail } from "@/lib/http";
import { signState } from "@/lib/instagram";
import { olxAuthorizeUrl } from "@/lib/portals";

export const runtime = "nodejs";

/** Abre o login da OLX para a loja autorizar o CRM a receber e responder os chats. */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    return NextResponse.redirect(olxAuthorizeUrl(signState(ctx.org.id, ctx.userId)));
  } catch (e) {
    return fail(e);
  }
}
