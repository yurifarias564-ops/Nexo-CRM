"use client";
import Script from "next/script";

// Pixel do site de vendas do Nexo (conta de anúncios do Nexo). O ID do pixel é público.
export const NEXO_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || "1006214155073721";

type Fbq = (...args: unknown[]) => void;

/** Dispara um evento do pixel (sem erro se o pixel ainda não carregou ou foi bloqueado). */
export function trackPixel(event: string, params?: Record<string, unknown>, eventId?: string) {
  try {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq;
    if (fbq) fbq("track", event, params ?? {}, eventId ? { eventID: eventId } : undefined);
  } catch { /* pixel bloqueado pelo navegador */ }
}

/** Código base do Meta Pixel: registra a visita (PageView) e a página de vendas (ViewContent). */
export function MetaPixel({ viewContent }: { viewContent?: string }) {
  const id = NEXO_PIXEL_ID.replace(/\D/g, "");
  if (!id) return null;
  const vc = viewContent ? `fbq('track','ViewContent',{content_name:${JSON.stringify(viewContent)}});` : "";
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">{`
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${id}');fbq('track','PageView');${vc}
      `}</Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img height="1" width="1" style={{ display: "none" }} alt="" src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`} />
      </noscript>
    </>
  );
}
