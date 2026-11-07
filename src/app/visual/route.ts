import { NextResponse } from "next/server";

/** /visual?modo=novo liga o visual novo neste navegador; /visual?modo=antigo volta ao atual. */
export function GET(req: Request) {
  const url = new URL(req.url);
  const res = NextResponse.redirect(new URL("/dashboard", url.origin));
  if (url.searchParams.get("modo") === "antigo") res.cookies.delete("nx_ui");
  else res.cookies.set("nx_ui", "v2", { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  return res;
}
