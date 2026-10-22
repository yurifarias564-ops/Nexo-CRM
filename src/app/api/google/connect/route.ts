import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { authUrl, newState, OAUTH_STATE_COOKIE } from "@/lib/google";
import { appUrl } from "@/lib/env";

export const runtime = "nodejs";

/** Inicia a conexão com o Google Agenda (navegação, não fetch). */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.redirect(`${appUrl()}/login`);
  if (!ctx.active) return NextResponse.redirect(`${appUrl()}/billing`);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(`${appUrl()}/settings?tab=integrations&google=config`);
  }
  const state = newState();
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google", maxAge: 600 });
  return res;
}
