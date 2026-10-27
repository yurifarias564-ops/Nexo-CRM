"use client";
/* eslint-disable @next/next/no-img-element -- logo da empresa (personalização) */
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Bot, KanbanSquare, MessageCircle } from "lucide-react";
import { useWorkspace } from "@/components/workspace";

// Abertura animada depois do login: logo + "Bem-vindo… Vamos vender mais hoje." (~4,5s, sempre dá para pular).
// A apresentação completa (com as funções) fica no botão "Ver apresentação".

const FLAG = "nexo:intro";

/** Chamado no login: a próxima tela do sistema toca a abertura. */
export function queueIntro() {
  try { sessionStorage.setItem(FLAG, "1"); } catch { /* sem armazenamento: sem abertura */ }
}
/** Botão "Ver apresentação". */
export function replayIntro() {
  window.dispatchEvent(new CustomEvent("nexo:intro", { detail: "full" }));
}

const SCENES = [
  { icon: MessageCircle, title: "Todo o WhatsApp da empresa", text: "Conversas, áudios, Pix e localização num só lugar — com histórico e cada lead no funil." },
  { icon: KanbanSquare, title: "Funil em tempo real", text: "Arraste, filtre e veja quem está parado. Comandos de voz movem e atualizam por você." },
  { icon: Bot, title: "Agente de IA 24 horas", text: "Atende, qualifica, coloca tags, guarda a memória e passa para o vendedor na hora certa." },
  { icon: BarChart3, title: "Campanhas que viram venda", text: "Cada anúncio com leads, vendas e ROAS — e cada venda volta para o pixel do Meta." },
];
const LOGO_MS = 2600, SCENE_MS = 1900, END_MS = 1900;

export function Intro() {
  const ws = useWorkspace();
  const [mode, setMode] = useState<"full" | "short" | null>(null);
  const [step, setStep] = useState(0); // 0 = logo, 1..4 = funções, 5 = boas-vindas
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);

  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  const finish = useCallback(() => {
    clear();
    setLeaving(true);
    timers.current.push(window.setTimeout(() => { setMode(null); setLeaving(false); setStep(0); }, 650));
  }, []);

  const play = useCallback((m: "full" | "short") => {
    clear();
    setLeaving(false); setStep(0); setMode(m);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setStep(5); timers.current.push(window.setTimeout(finish, 1400)); return; }
    if (m === "short") {
      timers.current.push(window.setTimeout(() => setStep(5), LOGO_MS));
      timers.current.push(window.setTimeout(finish, LOGO_MS + END_MS + 300));
      return;
    }
    let t = LOGO_MS;
    SCENES.forEach((_, i) => { timers.current.push(window.setTimeout(() => setStep(i + 1), t)); t += SCENE_MS; });
    timers.current.push(window.setTimeout(() => setStep(5), t));
    timers.current.push(window.setTimeout(finish, t + END_MS));
  }, [finish]);

  useEffect(() => {
    let queued = false;
    try { queued = sessionStorage.getItem(FLAG) === "1"; if (queued) sessionStorage.removeItem(FLAG); } catch { /* ok */ }
    const t = queued ? window.setTimeout(() => play("short"), 0) : undefined;
    const onReplay = () => play("full");
    window.addEventListener("nexo:intro", onReplay);
    return () => { if (t) window.clearTimeout(t); window.removeEventListener("nexo:intro", onReplay); clear(); };
  }, [play]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, finish]);

  if (!mode) return null;
  const brand = ws.brand;
  const custom = Boolean(brand?.custom);
  const name = custom ? brand!.appName : "Nexo CRM";
  const first = ws.userName.split(" ")[0] || "";
  const total = mode === "full" ? LOGO_MS + SCENES.length * SCENE_MS + END_MS : LOGO_MS + END_MS + 300;

  return (
    <div className={`nx-intro ${leaving ? "nx-leave" : ""}`} role="dialog" aria-label={`Apresentação do ${name}`} onClick={finish}>
      <style>{INTRO_CSS}</style>
      <div className="nx-bg"><div className="nx-orb nx-orb1" /><div className="nx-orb nx-orb2" /><div className="nx-grid" /></div>

      {/* Abertura: logo */}
      <div className={`nx-stage ${step === 0 ? "nx-on" : "nx-off"}`}>
        <div className="nx-mark">
          <span className="nx-ring" /><span className="nx-ring nx-ring2" />
          {custom && (brand!.iconUrl || brand!.logoUrl) ? (
            <img src={(brand!.iconUrl ?? brand!.logoUrl)!} alt="" className="nx-img" />
          ) : custom ? (
            <span className="nx-letter">{name[0]?.toUpperCase()}</span>
          ) : (
            <svg viewBox="0 0 24 24" className="nx-n" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 19V5l14 14V5" /></svg>
          )}
        </div>
        <h1 className="nx-word">
          {name.split("").map((ch, i) => <span key={i} style={{ animationDelay: `${900 + i * 55}ms` }}>{ch === " " ? " " : ch}</span>)}
        </h1>
        <p className="nx-tag">{custom ? (brand!.loginSubtitle || "Atendimento e vendas em um só lugar.") : "Seu comercial inteiro em uma tela."}</p>
      </div>

      {/* Funções */}
      {SCENES.map((s, i) => {
        const I = s.icon;
        return (
          <div key={s.title} className={`nx-stage nx-scene ${step === i + 1 ? "nx-on" : "nx-off"}`}>
            <div className="nx-visual">{step === i + 1 && <SceneArt i={i} />}</div>
            <div className="nx-copy">
              <span className="nx-chip"><I className="h-4 w-4" /> {String(i + 1).padStart(2, "0")} / 04</span>
              <h2>{s.title}</h2>
              <p>{s.text}</p>
            </div>
          </div>
        );
      })}

      {/* Boas-vindas */}
      <div className={`nx-stage ${step === 5 ? "nx-on" : "nx-off"}`}>
        <p className="nx-hello">{first ? `Bem-vindo, ${first}` : "Bem-vindo"}</p>
        <h2 className="nx-big">Vamos vender mais hoje.</h2>
        <p className="nx-org">{ws.orgName}</p>
      </div>

      <button className="nx-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>Pular ⏎</button>
      <div className="nx-bar"><span style={{ animationDuration: `${total}ms` }} /></div>
    </div>
  );
}

/** Mini-telas animadas de cada função. */
function SceneArt({ i }: { i: number }) {
  if (i === 0) return (
    <div className="nx-phone">
      <div className="nx-msg nx-in" style={{ animationDelay: "100ms" }}>Oi! Vocês têm a MT-03 azul? 🏍️</div>
      <div className="nx-msg nx-out" style={{ animationDelay: "550ms" }}>Temos sim! Quer agendar um test drive?</div>
      <div className="nx-msg nx-in" style={{ animationDelay: "1000ms" }}>Quero, amanhã às 10h 👍</div>
    </div>
  );
  if (i === 1) return (
    <div className="nx-kanban"><div className="nx-card nx-move">Yuri · R$ 3.000</div>
      {["Novo", "Negociação", "Ganho"].map((c, k) => (
        <div key={c} className="nx-col"><b>{c}</b>{k === 1 && <div className="nx-card">Ana · R$ 1.800</div>}{k === 2 && <div className="nx-card nx-won">Carla · R$ 5.400</div>}</div>
      ))}
    </div>
  );
  if (i === 2) return (
    <div className="nx-phone">
      <div className="nx-msg nx-in" style={{ animationDelay: "100ms" }}>Quanto fica financiada?</div>
      <div className="nx-typing" style={{ animationDelay: "450ms" }}><i /><i /><i /></div>
      <div className="nx-msg nx-out nx-ai" style={{ animationDelay: "1050ms" }}>Nosso especialista monta a melhor condição para você. Prefere manhã ou tarde?</div>
      <div className="nx-tags" style={{ animationDelay: "1350ms" }}><span>🏷️ MT-03</span><span>🧠 quer financiar</span></div>
    </div>
  );
  return (
    <div className="nx-chart">
      {[38, 62, 48, 80, 70, 96].map((h, k) => <span key={k} style={{ height: `${h}%`, animationDelay: `${k * 90}ms` }} />)}
      <div className="nx-roas">ROAS <b>4,8x</b></div>
    </div>
  );
}

export const INTRO_CSS = `
.nx-intro{position:fixed;inset:0;z-index:100;overflow:hidden;background:#03050a;color:#fff;cursor:pointer;animation:nxIn .45s ease-out both}
.nx-leave{animation:nxOut .6s ease-in forwards}
@keyframes nxIn{from{opacity:0}to{opacity:1}}
@keyframes nxOut{to{opacity:0;transform:scale(1.04);filter:blur(6px)}}
.nx-bg{position:absolute;inset:0;pointer-events:none}
.nx-orb{position:absolute;border-radius:9999px;opacity:.9}
.nx-orb1{width:60vmax;height:60vmax;left:-15vmax;top:-20vmax;background:radial-gradient(circle,rgb(var(--brand-500)/.5),transparent 65%);animation:nxFloat 9s ease-in-out infinite alternate}
.nx-orb2{width:50vmax;height:50vmax;right:-18vmax;bottom:-22vmax;background:radial-gradient(circle,rgb(var(--navy-500)/.75),transparent 65%);animation:nxFloat 11s ease-in-out infinite alternate-reverse}
@keyframes nxFloat{to{transform:translate(6vmax,4vmax) scale(1.1)}}
.nx-grid{position:absolute;inset:-50%;background-image:linear-gradient(rgb(var(--brand-300)/.07) 1px,transparent 1px),linear-gradient(90deg,rgb(var(--brand-300)/.07) 1px,transparent 1px);background-size:56px 56px;transform:perspective(700px) rotateX(58deg) translateY(-8%);animation:nxGrid 14s linear infinite;mask-image:radial-gradient(circle at 50% 40%,#000 0,transparent 60%)}
@keyframes nxGrid{to{background-position:0 560px}}
.nx-stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;transition:opacity .55s ease,transform .7s cubic-bezier(.2,.8,.2,1),filter .55s ease}
.nx-off{opacity:0;transform:translateY(18px) scale(.98);filter:blur(6px);pointer-events:none}
.nx-on{opacity:1;transform:none;filter:none}
.nx-mark{position:relative;display:flex;align-items:center;justify-content:center;width:112px;height:112px;border-radius:28px;background:linear-gradient(135deg,rgb(var(--brand-400)),rgb(var(--navy-500)));box-shadow:0 0 0 1px rgb(var(--brand-300)/.35),0 20px 80px -10px rgb(var(--brand-500)/.8);animation:nxPop .9s cubic-bezier(.2,1.4,.3,1) both}
@keyframes nxPop{from{transform:scale(.4) rotate(-12deg);opacity:0}to{transform:none;opacity:1}}
.nx-ring{position:absolute;inset:-14px;border-radius:36px;border:1px solid rgb(var(--brand-300)/.5);animation:nxRing 2.2s ease-out .4s infinite}
.nx-ring2{animation-delay:1.1s}
@keyframes nxRing{from{transform:scale(.9);opacity:.9}to{transform:scale(1.6);opacity:0}}
.nx-n{width:56px;height:56px;color:#fff;stroke-dasharray:60;stroke-dashoffset:60;animation:nxDraw 1.1s ease .35s forwards;filter:drop-shadow(0 0 10px rgba(255,255,255,.6))}
@keyframes nxDraw{to{stroke-dashoffset:0}}
.nx-img{width:76px;height:76px;object-fit:contain;animation:nxIn .8s ease .3s both}
.nx-letter{font-size:56px;font-weight:700;animation:nxIn .8s ease .3s both}
.nx-word{display:flex;font-size:clamp(40px,7vw,76px);font-weight:700;letter-spacing:-.03em;line-height:1}
.nx-word span{display:inline-block;opacity:0;transform:translateY(24px);animation:nxUp .6s cubic-bezier(.2,.8,.2,1) forwards;background:linear-gradient(180deg,#fff,rgb(var(--brand-200)));-webkit-background-clip:text;background-clip:text;color:transparent}
@keyframes nxUp{to{opacity:1;transform:none}}
.nx-tag{font-size:clamp(15px,2vw,20px);color:rgb(203 213 225);opacity:0;animation:nxUp .7s ease 1.6s forwards}
.nx-scene{flex-direction:row;gap:56px;text-align:left}
@media (max-width:800px){.nx-scene{flex-direction:column;gap:28px;text-align:center}}
.nx-copy{max-width:420px}
.nx-copy h2{font-size:clamp(28px,4vw,46px);font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:12px 0 10px}
.nx-copy p{font-size:clamp(15px,1.8vw,19px);color:rgb(203 213 225);line-height:1.5}
.nx-chip{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:6px 12px;font-size:12px;letter-spacing:.08em;background:rgb(var(--brand-500)/.18);color:rgb(var(--brand-200));border:1px solid rgb(var(--brand-400)/.35)}
.nx-visual{width:min(380px,82vw);height:280px;display:flex;align-items:center;justify-content:center}
.nx-phone{width:100%;display:flex;flex-direction:column;gap:10px;padding:18px;border-radius:24px;background:rgba(15,23,42,.75);border:1px solid rgb(var(--brand-300)/.2);box-shadow:0 30px 80px -30px rgb(var(--brand-500)/.7)}
.nx-msg{max-width:80%;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.35;opacity:0;transform:translateY(10px) scale(.96);animation:nxUp .45s cubic-bezier(.2,1.2,.3,1) forwards}
.nx-in{align-self:flex-start;background:#202c33;border-bottom-left-radius:4px}
.nx-out{align-self:flex-end;background:#005c4b;border-bottom-right-radius:4px}
.nx-ai{background:linear-gradient(135deg,rgb(var(--brand-600)),rgb(var(--navy-500)))}
.nx-typing{align-self:flex-end;display:flex;gap:4px;padding:12px 14px;border-radius:16px;background:#1e293b;opacity:0;animation:nxUp .3s ease forwards,nxOut .2s ease 1s forwards}
.nx-typing i{width:6px;height:6px;border-radius:9px;background:#94a3b8;animation:nxDot 1s infinite}
.nx-typing i:nth-child(2){animation-delay:.15s}.nx-typing i:nth-child(3){animation-delay:.3s}
@keyframes nxDot{50%{transform:translateY(-4px);opacity:.5}}
.nx-tags{display:flex;gap:6px;justify-content:flex-end;opacity:0;animation:nxUp .4s ease forwards}
.nx-tags span{font-size:12px;padding:4px 10px;border-radius:999px;background:rgb(var(--brand-500)/.2);color:rgb(var(--brand-200))}
.nx-kanban{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%}
.nx-col{position:relative;min-height:220px;padding:10px;border-radius:16px;background:rgba(15,23,42,.75);border:1px solid rgb(var(--brand-300)/.18);font-size:12px;text-align:left}
.nx-col b{display:block;margin-bottom:10px;color:rgb(148 163 184);font-weight:600}
.nx-card{padding:10px;border-radius:10px;background:#0f172a;border:1px solid rgb(var(--brand-300)/.25);font-size:12px;box-shadow:0 8px 20px -10px #000}
.nx-kanban{position:relative}
.nx-move{position:absolute;z-index:2;left:10px;top:38px;width:calc((100% - 20px) / 3 - 20px);animation:nxMove 1.4s cubic-bezier(.6,0,.2,1) .25s forwards}
@keyframes nxMove{40%{transform:translateY(-8px) rotate(-3deg);box-shadow:0 20px 40px -10px rgb(var(--brand-500)/.9)}100%{left:calc((100% - 20px) / 3 * 2 + 30px);top:96px;transform:none;border-color:#34d399}}
.nx-won{border-color:#34d399;animation:nxGlow 1.6s ease infinite}
@keyframes nxGlow{50%{box-shadow:0 0 24px -2px rgba(52,211,153,.6)}}
.nx-chart{position:relative;display:flex;align-items:flex-end;gap:14px;width:100%;height:220px;padding:52px 20px 20px;border-radius:20px;background:rgba(15,23,42,.75);border:1px solid rgb(var(--brand-300)/.2)}
.nx-chart span{flex:1;border-radius:8px 8px 3px 3px;background:linear-gradient(180deg,rgb(var(--brand-300)),rgb(var(--brand-600)));transform-origin:bottom;transform:scaleY(0);animation:nxGrow .7s cubic-bezier(.2,1.2,.3,1) forwards}
@keyframes nxGrow{to{transform:scaleY(1)}}
.nx-roas{position:absolute;top:14px;right:16px;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,.15);color:#6ee7b7;font-size:13px;opacity:0;animation:nxUp .5s ease .8s forwards}
.nx-roas b{font-size:18px;margin-left:4px}
.nx-hello{font-size:clamp(16px,2vw,20px);color:rgb(var(--brand-200));letter-spacing:.04em}
.nx-big{font-size:clamp(34px,6vw,64px);font-weight:700;letter-spacing:-.03em;background:linear-gradient(180deg,#fff,rgb(var(--brand-200)));-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-org{color:rgb(148 163 184);font-size:14px}
.nx-skip{position:absolute;right:24px;bottom:28px;padding:8px 14px;border-radius:999px;font-size:13px;color:#cbd5e1;background:rgba(15,23,42,.6);border:1px solid rgba(148,163,184,.25);backdrop-filter:blur(6px)}
.nx-skip:hover{color:#fff;border-color:rgb(var(--brand-300)/.6)}
.nx-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(148,163,184,.12)}
.nx-bar span{display:block;height:100%;width:100%;transform-origin:left;transform:scaleX(0);background:linear-gradient(90deg,rgb(var(--brand-400)),rgb(var(--brand-200)));animation-name:nxBar;animation-timing-function:linear;animation-fill-mode:forwards}
@keyframes nxBar{to{transform:scaleX(1)}}
`;
