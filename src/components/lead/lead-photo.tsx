"use client";
import { useState } from "react";
import { Camera, FileSpreadsheet, Globe, MessageCircle, Mic, Tag, ThumbsUp, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export interface PhotoLead { name: string; avatar_url?: string | null; source?: string | null; last_message_at?: string | null }

/** De onde o lead veio: bolinha colorida no canto da foto. */
function sourceBadge(l: PhotoLead): { label: string; bg: string; Icon: typeof MessageCircle; img?: string } | null {
  const s = (l.source ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (s.includes("whats") || (!s && l.last_message_at)) return { label: "WhatsApp", bg: "bg-white", Icon: MessageCircle, img: "/channels/whatsapp.png" };
  if (s.includes("insta")) return { label: "Instagram", bg: "bg-white", Icon: Camera, img: "/channels/instagram.png" };
  if (s.includes("face") || s.includes("meta")) return { label: "Facebook", bg: "bg-[#1877F2]", Icon: ThumbsUp };
  if (s.includes("voz")) return { label: "Comando de voz", bg: "bg-brand-500", Icon: Mic };
  if (s.includes("import") || s.includes("planilha")) return { label: "Planilha importada", bg: "bg-slate-500", Icon: FileSpreadsheet };
  if (s.includes("site") || s.includes("form")) return { label: "Site", bg: "bg-sky-600", Icon: Globe };
  if (s.includes("manual")) return { label: "Cadastro manual", bg: "bg-slate-600", Icon: UserPlus };
  return s ? { label: l.source!, bg: "bg-slate-600", Icon: Tag } : null;
}

/** Foto do lead (WhatsApp) com o ícone do canal de origem no canto. */
export function LeadPhoto({ lead, size = "sm" }: { lead: PhotoLead; size?: "sm" | "md" }) {
  const [broken, setBroken] = useState(false);
  const badge = sourceBadge(lead);
  const dim = size === "md" ? "h-10 w-10" : "h-8 w-8";
  return (
    <span className="relative shrink-0">
      {lead.avatar_url && !broken
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={lead.avatar_url} alt="" loading="lazy" onError={() => setBroken(true)} className={cn(dim, "rounded-full object-cover ring-1 ring-line")} />
        : <Avatar name={lead.name} className={cn(dim, size === "sm" && "text-[11px]")} />}
      {badge && (
        badge.img ? (
          <span title={`Origem: ${badge.label}`} aria-label={`Origem: ${badge.label}`}
            className={cn("absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center overflow-hidden rounded-full ring-2 ring-ink-800", "bg-white p-[2px]")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={badge.img} alt="" className={cn("h-full w-full object-contain", badge.label === "Instagram" && "rounded-[4px]")} />
          </span>
        ) : (
          <span title={`Origem: ${badge.label}`} aria-label={`Origem: ${badge.label}`}
            className={cn("absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-white ring-2 ring-ink-800", badge.bg)}>
            <badge.Icon className="h-2 w-2" strokeWidth={3} />
          </span>
        )
      )}
    </span>
  );
}

