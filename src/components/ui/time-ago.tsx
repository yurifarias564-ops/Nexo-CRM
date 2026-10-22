"use client";
import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/utils";

/**
 * Tempo relativo calculado só no navegador (fuso do usuário), evitando
 * divergência com o servidor (UTC). Atualiza a cada minuto.
 */
export function TimeAgo({ iso, fallback = "" }: { iso: string | null | undefined; fallback?: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setText(relativeTime(iso) || fallback);
    update();
    const t = setInterval(update, 60_000);
    return () => clearInterval(t);
  }, [iso, fallback]);
  return <span suppressHydrationWarning>{text ?? " "}</span>;
}
