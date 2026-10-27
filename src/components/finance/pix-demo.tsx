"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, CheckCircle2, HeartHandshake, QrCode, Zap } from "lucide-react";
import { INTRO_CSS } from "@/components/intro/intro";

// Vídeo animado do Pix Nexo (mesmo estilo da abertura do CRM):
// cobrança na conversa → cliente paga em segundos → confirmação + pós-venda automático → venda no funil.

const SCENES = [
  { icon: QrCode, title: "Cobre na própria conversa", text: "Um clique e o cliente recebe o Pix Copia e Cola no WhatsApp. Sem maquininha, sem link estranho." },
  { icon: Zap, title: "O cliente paga em segundos", text: "Abre o app do banco, cola e pronto. O dinheiro cai na hora — 24 horas, inclusive fim de semana." },
  { icon: HeartHandshake, title: "Confirmação e pós-venda automáticos", text: "O CRM confirma o pagamento na conversa e já manda o seu pós-venda. Ninguém precisa conferir extrato." },
  { icon: BarChart3, title: "A venda aparece no CRM", text: "O lead vai para Ganho com o valor, e você acompanha tudo em Finanças: vendas, saldo e saque para o seu banco." },
];
const SCENE_MS = 4200, END_MS = 2600;

export function PixDemo({ open, onClose, onUnlock }: { open: boolean; onClose: () => void; onUnlock?: () => void }) {
  const [step, setStep] = useState(0); // 0..3 cenas, 4 = final
  const [run, setRun] = useState(0);
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  const play = useCallback(() => {
    clear();
    setStep(0); setRun((r) => r + 1);
    SCENES.forEach((_, i) => { if (i) timers.current.push(window.setTimeout(() => setStep(i), i * SCENE_MS)); });
    timers.current.push(window.setTimeout(() => setStep(4), SCENES.length * SCENE_MS));
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(play, 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(t); clear(); window.removeEventListener("keydown", onKey); };
  }, [open, play, onClose]);

  if (!open) return null;
  const total = SCENES.length * SCENE_MS + END_MS;
  return (
    <div className="nx-intro" style={{ cursor: "default" }} role="dialog" aria-label="Como funciona o Pix Nexo">
      <style>{INTRO_CSS + CSS}</style>
      <div className="nx-bg"><div className="nx-orb nx-orb1" /><div className="nx-orb nx-orb2" /><div className="nx-grid" /></div>

      {SCENES.map((s, i) => {
        const I = s.icon;
        return (
          <div key={s.title} className={`nx-stage nx-scene ${step === i ? "nx-on" : "nx-off"}`}>
            <div className="nx-visual" style={{ height: 340 }}>{step === i && <Art key={`${run}-${i}`} i={i} />}</div>
            <div className="nx-copy">
              <span className="nx-chip"><I className="h-4 w-4" /> {String(i + 1).padStart(2, "0")} / 04</span>
              <h2>{s.title}</h2>
              <p>{s.text}</p>
            </div>
          </div>
        );
      })}

      <div className={`nx-stage ${step === 4 ? "nx-on" : "nx-off"}`}>
        <p className="nx-hello">Pix Nexo</p>
        <h2 className="nx-big">Vendeu, recebeu, agradeceu.</h2>
        <p className="nx-org">Tudo sozinho, em segundos.</p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {onUnlock && <button className="px-cta" onClick={onUnlock}>Desbloquear o Pix</button>}
          <button className="px-ghost" onClick={play}>Ver de novo</button>
        </div>
      </div>

      <button className="nx-skip" onClick={onClose}>Fechar ✕</button>
      <div className="nx-bar"><span key={run} style={{ animationDuration: `${total}ms` }} /></div>
    </div>
  );
}

function Art({ i }: { i: number }) {
  if (i === 0) return (
    <div className="nx-phone">
      <div className="px-head"><span className="px-ava">A</span> Ana Souza <i>online</i></div>
      <div className="nx-msg nx-in" style={{ animationDelay: "200ms" }}>Fechado! Como faço para pagar? 😊</div>
      <div className="nx-msg nx-out px-pix" style={{ animationDelay: "1100ms" }}>
        <b>💠 Pix — R$ 1.290,00</b>
        <span>Copie o código abaixo e cole no app do seu banco.</span>
      </div>
      <div className="nx-msg nx-out px-code" style={{ animationDelay: "1800ms" }}>00020126580014br.gov.bcb.pix…6304A1B2</div>
      <div className="px-tap" style={{ animationDelay: "2600ms" }}>📋 Copiado</div>
    </div>
  );
  if (i === 1) return (
    <div className="px-bank">
      <p className="px-bank-t">Pix Copia e Cola</p>
      <p className="px-bank-v">R$ 1.290,00</p>
      <p className="px-bank-s">Para: Sua Loja LTDA</p>
      <div className="px-btn"><span className="px-btn-l">Pagar</span><span className="px-btn-p" /></div>
      <div className="px-ok"><CheckCircle2 className="h-10 w-10" /><b>Pix enviado</b><span>agora · 2,8 s</span></div>
      <div className="px-timer"><Zap className="h-3.5 w-3.5" /> pago em 3 segundos</div>
    </div>
  );
  if (i === 2) return (
    <div className="nx-phone">
      <div className="px-head"><span className="px-ava">A</span> Ana Souza <i>online</i></div>
      <div className="nx-msg nx-in" style={{ animationDelay: "150ms" }}>Paguei! 🙌</div>
      <div className="nx-msg nx-out px-confirm" style={{ animationDelay: "800ms" }}>✅ Pagamento de R$ 1.290,00 confirmado na hora! Obrigado.</div>
      <div className="nx-typing" style={{ animationDelay: "1500ms" }}><i /><i /><i /></div>
      <div className="nx-msg nx-out nx-ai" style={{ animationDelay: "2500ms" }}>Obrigado pela compra, Ana! 🙌 Seu pedido já está sendo separado. Qualquer dúvida é só chamar aqui.</div>
      <div className="nx-tags" style={{ animationDelay: "3100ms" }}><span>⚡ automático</span><span>💬 pós-venda</span></div>
    </div>
  );
  return (
    <div className="px-crm">
      <div className="nx-kanban" style={{ height: 210 }}>
        <div className="nx-card nx-move">Ana · R$ 1.290</div>
        {["Novo", "Negociação", "Ganho"].map((c, k) => (
          <div key={c} className="nx-col" style={{ minHeight: 200 }}><b>{c}</b>{k === 0 && <div className="nx-card" style={{ marginTop: 52 }}>Bruno · R$ 680</div>}{k === 2 && <div className="nx-card nx-won">Carla · R$ 5.400</div>}</div>
        ))}
      </div>
      <div className="px-stats">
        <div><span>Recebido hoje</span><b className="px-count">R$ 6.690</b></div>
        <div><span>Vendas Pix</span><b>2 → 3</b></div>
        <div><span>Saldo para saque</span><b>R$ 6.690</b></div>
      </div>
    </div>
  );
}

const CSS = `
.px-head{display:flex;align-items:center;gap:8px;padding-bottom:8px;margin-bottom:2px;border-bottom:1px solid rgba(148,163,184,.15);font-size:13px;font-weight:600}
.px-head i{font-style:normal;font-weight:400;font-size:11px;color:#34d399}
.px-ava{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:99px;background:linear-gradient(135deg,#f472b6,#a855f7);font-size:12px}
.px-pix{display:flex;flex-direction:column;gap:4px}
.px-pix b{font-size:15px}.px-pix span{font-size:12px;color:#d1fae5}
.px-code{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.02em;opacity:0}
.px-tap{align-self:flex-end;font-size:12px;padding:4px 10px;border-radius:99px;background:rgba(16,185,129,.18);color:#6ee7b7;opacity:0;animation:nxUp .4s ease forwards}
.px-bank{position:relative;width:min(300px,80vw);height:330px;margin:0 auto;padding:22px;border-radius:28px;background:linear-gradient(180deg,#1e1b4b,#0f172a);border:1px solid rgba(167,139,250,.3);box-shadow:0 30px 80px -30px rgba(139,92,246,.8);text-align:center;overflow:hidden}
.px-bank-t{font-size:13px;color:#c4b5fd}
.px-bank-v{margin-top:18px;font-size:34px;font-weight:700;letter-spacing:-.02em}
.px-bank-s{margin-top:4px;font-size:13px;color:#94a3b8}
.px-btn{position:relative;margin:34px auto 0;height:48px;border-radius:14px;background:#7c3aed;overflow:hidden;animation:pxPress .25s ease 1.1s 1 both}
.px-btn-l{position:relative;z-index:1;line-height:48px;font-weight:600}
.px-btn-p{position:absolute;inset:0;transform-origin:left;transform:scaleX(0);background:#a78bfa;animation:pxFill .9s ease 1.35s forwards}
@keyframes pxPress{50%{transform:scale(.94)}}
@keyframes pxFill{to{transform:scaleX(1)}}
.px-ok{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:linear-gradient(180deg,#064e3b,#022c22);color:#6ee7b7;opacity:0;transform:scale(1.1);animation:pxOk .5s cubic-bezier(.2,1.3,.3,1) 2.4s forwards}
.px-ok b{font-size:22px;color:#fff}.px-ok span{font-size:13px}
@keyframes pxOk{to{opacity:1;transform:none}}
.px-timer{position:absolute;left:50%;bottom:16px;z-index:2;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:rgba(250,204,21,.15);color:#fde047;font-size:12px;white-space:nowrap;opacity:0;animation:nxUp .5s ease 2.9s forwards}
.px-confirm{background:#065f46}
.px-crm{width:100%;display:flex;flex-direction:column;gap:12px}
.px-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;opacity:0;animation:nxUp .5s ease 1.6s forwards}
.px-stats div{padding:10px;border-radius:12px;background:rgba(15,23,42,.8);border:1px solid rgba(52,211,153,.25);text-align:left}
.px-stats span{display:block;font-size:11px;color:#94a3b8}
.px-stats b{font-size:15px;color:#6ee7b7}
.px-count{animation:pxGlow 1s ease 1.9s 2}
@keyframes pxGlow{50%{text-shadow:0 0 14px rgba(110,231,183,.9)}}
.px-cta{padding:12px 22px;border-radius:12px;font-weight:600;background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 12px 40px -10px rgba(16,185,129,.8)}
.px-cta:hover{filter:brightness(1.1)}
.px-ghost{padding:12px 22px;border-radius:12px;color:#cbd5e1;border:1px solid rgba(148,163,184,.3)}
.px-ghost:hover{color:#fff}
`;
