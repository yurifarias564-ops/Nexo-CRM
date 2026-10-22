import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { completeConnection, OAUTH_STATE_COOKIE } from "@/lib/google";
import { appUrl } from "@/lib/env";
import { HttpError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const back = (status: string, msg?: string) => {
    const u = new URL(`${appUrl()}/settings`);
    u.searchParams.set("tab", "integrations");
    u.searchParams.set("google", status);
    if (msg) u.searchParams.set("msg", msg.slice(0, 200));
    const res = NextResponse.redirect(u);
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/google" });
    return res;
  };

  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.redirect(`${appUrl()}/login`);

  const url = req.nextUrl;
  if (url.searchParams.get("error")) return back("cancelado");
  const state = url.searchParams.get("state") ?? "";
  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  // Proteção contra CSRF: o state precisa bater com o cookie desta sessão
  if (!state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    return back("erro", "Sessão de conexão expirada. Tente de novo.");
  }
  const code = url.searchParams.get("code");
  if (!code) return back("erro");
  try {
    await completeConnection(ctx.userId, code);
    return back("ok");
  } catch (e) {
    console.error("[google callback]", e);
    return back("erro", e instanceof HttpError ? e.message : undefined);
  }
}
