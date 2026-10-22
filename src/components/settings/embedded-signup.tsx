"use client";
import { useState } from "react";
import { PhoneCall, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

// Conexão do WhatsApp oficial em 1 clique (Cadastro Incorporado da Meta).

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
const CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID ?? "";
const GRAPH = process.env.NEXT_PUBLIC_META_GRAPH_VERSION ?? "v23.0";

interface FBLoginResponse { authResponse?: { code?: string } | null; status?: string }
interface FBSdk {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: FBLoginResponse) => void, o: Record<string, unknown>) => void;
}
declare global { interface Window { FB?: FBSdk; fbAsyncInit?: () => void } }

let sdkPromise: Promise<FBSdk> | null = null;
function loadSdk(): Promise<FBSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: GRAPH });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/pt_BR/sdk.js";
    s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    s.onerror = () => { sdkPromise = null; reject(new Error("Não foi possível abrir a janela da Meta. Verifique bloqueadores de anúncio.")); };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

export const embeddedSignupReady = Boolean(APP_ID && CONFIG_ID);

/** Botão "Conectar WhatsApp oficial": o cliente entra com o Facebook e escolhe o número. */
export function EmbeddedSignup({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"new" | "app">("new");
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!embeddedSignupReady) return toast.error("A conexão em 1 clique ainda não foi configurada no servidor (NEXT_PUBLIC_META_APP_ID e NEXT_PUBLIC_META_ES_CONFIG_ID).");
    setBusy(true);
    let FB: FBSdk;
    try { FB = await loadSdk(); } catch (e) { setBusy(false); return toast.error((e as Error).message); }

    const session: { waba?: string; phone?: string; event?: string; error?: string } = {};
    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.origin !== "string" || !/(^|\.)facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      try {
        const data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        session.event = data.event;
        if (String(data.event).startsWith("FINISH")) {
          session.waba = data.data?.waba_id ?? data.data?.waba_ids?.[0];
          session.phone = data.data?.phone_number_id;
        } else if (data.event === "CANCEL" || data.event === "ERROR") {
          session.error = data.data?.error_message ?? (data.data?.current_step ? "Conexão interrompida antes do fim." : undefined);
        }
      } catch { /* mensagens que não são do cadastro */ }
    };
    window.addEventListener("message", onMessage);

    // O callback do SDK não pode ser assíncrono
    FB.login((resp) => {
      void (async () => {
        try {
          const code = resp.authResponse?.code;
          if (!code) throw new Error(session.error ?? "Conexão cancelada.");
          // A janela manda os dados da conta logo antes/depois do código
          for (let i = 0; i < 25 && !session.waba; i++) await new Promise((r) => setTimeout(r, 200));
          if (!session.waba) throw new Error("A Meta não informou qual conta foi conectada. Tente de novo e vá até a última tela.");
          const res = await fetch("/api/channels/embedded", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, wabaId: session.waba, phoneNumberId: session.phone ?? null, coexistence: mode === "app" || session.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? "Não foi possível concluir a conexão.");
          toast.success(`WhatsApp conectado${body.phone ? ` (${body.phone})` : ""}!${body.calling ? " Ligações já ativadas." : ""}`);
          if (body.warning) toast.warning(body.warning);
          onDone();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          window.removeEventListener("message", onMessage);
          setBusy(false);
        }
      })();
    }, {
      config_id: CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, ...(mode === "app" ? { featureType: "whatsapp_business_app_onboarding" } : {}) },
    });
  }

  const opts = [
    { v: "new" as const, icon: PhoneCall, t: "Número só para o CRM (recomendado)", d: "Mensagens e ligações pelo CRM, com gravação. O número deixa de funcionar no app do WhatsApp do celular." },
    { v: "app" as const, icon: Smartphone, t: "Mesmo número do app do celular", d: "Continua usando o WhatsApp Business no celular e no CRM ao mesmo tempo, com o histórico. Sem ligações pelo CRM (limite da Meta)." },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Conectar WhatsApp oficial" wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => void start()} loading={busy}><ShieldCheck className="h-4 w-4" /> Continuar com o Facebook</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-300">Abre uma janela da Meta: entre com o Facebook da empresa, escolha (ou crie) a conta e confirme o número por SMS. Leva uns 2 minutos e não precisa copiar nada.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {opts.map(({ v, icon: I, t, d }) => (
            <button key={v} type="button" onClick={() => setMode(v)}
              className={cn("rounded-xl border p-4 text-left transition", mode === v ? "border-brand-400/70 bg-brand-500/10" : "border-line hover:border-slate-500")}>
              <I className={cn("h-5 w-5", mode === v ? "text-brand-300" : "text-slate-400")} />
              <p className="mt-2 font-medium text-white">{t}</p>
              <p className="mt-1 text-xs text-slate-400">{d}</p>
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">Depois de conectar, a empresa adiciona a forma de pagamento da Meta no Gerenciador do WhatsApp (as conversas da API oficial são cobradas pela Meta).</p>
      </div>
    </Modal>
  );
}
