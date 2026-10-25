import { brandForHost } from "@/lib/branding/server";

export const dynamic = "force-dynamic";

/** App instalável no celular com o nome e o ícone da marca do domínio acessado. */
export async function GET() {
  const { brand } = await brandForHost();
  const icons = brand.iconUrl ? [{ src: brand.iconUrl, sizes: "512x512", type: "image/png", purpose: "any" }] : [];
  return Response.json({
    name: brand.appName, short_name: brand.appName.slice(0, 12), start_url: "/pipeline", display: "standalone",
    background_color: "#03050a", theme_color: brand.primaryColor, icons,
  }, { headers: { "cache-control": "public, max-age=300", "content-type": "application/manifest+json" } });
}
