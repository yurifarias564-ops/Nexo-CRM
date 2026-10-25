"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CreditCard, KanbanSquare, MessageCircle, Palette, Tags, Users, Zap } from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import { WhatsAppTab } from "./whatsapp-tab";
import { QuickRepliesTab } from "./quick-replies-tab";
import { PipelineTab } from "./pipeline-tab";
import { TagsTab } from "./tags-tab";
import { TeamTab } from "./team-tab";
import { IntegrationsTab } from "./integrations-tab";
import { cn } from "@/lib/utils";
import { Section } from "./section";
import { BrandingEditor } from "@/components/branding/branding-editor";

const TABS = [
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "integrations", label: "Integrações", icon: CalendarDays },
  { id: "quick", label: "Mensagens rápidas", icon: Zap },
  { id: "pipeline", label: "Funil", icon: KanbanSquare },
  { id: "tags", label: "Tags", icon: Tags },
  { id: "team", label: "Equipe", icon: Users },
  { id: "brand", label: "Marca", icon: Palette },
  { id: "billing", label: "Assinatura", icon: CreditCard },
];

export function Settings({ initialTab, subscription, googleStatus, googleMsg }: { initialTab: string; subscription: { status: string; periodEnd: string | null }; googleStatus?: string; googleMsg?: string }) {
  const router = useRouter();
  const ws = useWorkspace();
  const [tab, setTab] = useState(TABS.some((t) => t.id === initialTab) ? initialTab : "whatsapp");
  const go = (id: string) => { setTab(id); router.replace(`/settings?tab=${id}`, { scroll: false }); };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-3 md:w-56 md:flex-col md:border-b-0 md:border-r">
        {TABS.map(({ id, label, icon: I }) => (
          <button key={id} onClick={() => go(id)}
            className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition", tab === id ? "bg-ink-800 text-white" : "text-slate-400 hover:bg-ink-800/60 hover:text-slate-200")}>
            <I className={cn("h-4 w-4", tab === id ? "text-brand-300" : "")} /> {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto p-4 md:p-8", tab === "brand" ? "max-w-5xl" : "max-w-3xl")}>
          {tab === "whatsapp" && <WhatsAppTab />}
          {tab === "integrations" && <IntegrationsTab googleStatus={googleStatus} googleMsg={googleMsg} />}
          {tab === "quick" && <QuickRepliesTab />}
          {tab === "pipeline" && <PipelineTab />}
          {tab === "tags" && <TagsTab />}
          {tab === "team" && <TeamTab />}
          {tab === "brand" && (ws.canManage || ws.isHouse
            ? <Section title="Marca" text="Logo, nome, cores e tela de login próprios — o sistema com a cara da sua empresa."><BrandingEditor /></Section>
            : <Section title="Marca" text="Apenas administradores podem personalizar."><span /></Section>)}
          {tab === "billing" && (
            <Section title="Assinatura" text="Situação do plano da sua empresa.">
              <div className="card flex items-center justify-between p-5">
                <div>
                  <p className="font-medium text-white">{ws.orgName}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {subscription.status === "active" ? "Ativa" : "Inativa"}
                    {subscription.periodEnd && ` · válida até ${new Date(subscription.periodEnd).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                <span className={cn("rounded-full px-3 py-1 text-xs font-medium", subscription.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>
                  {subscription.status === "active" ? "Em dia" : "Pendente"}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">A renovação é automática pelo Asaas. Faturas e forma de pagamento ficam no e-mail cadastrado.</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
