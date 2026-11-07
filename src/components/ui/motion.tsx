"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const isV2 = () => typeof document !== "undefined" && document.documentElement.dataset.ui === "v2";

/** Número que "conta" até o valor final (só no visual novo). Mantém o formato do texto (R$, %, mil…). */
export function CountUp({ text, ms = 900 }: { text: string; ms?: number }) {
  const m = useMemo(() => /(\d[\d.]*(?:,\d+)?)/.exec(text), [text]);
  const target = m ? Number(m[1]!.replace(/\./g, "").replace(",", ".")) : NaN;
  const decimals = m && m[1]!.includes(",") ? m[1]!.split(",")[1]!.length : 0;
  const [v, setV] = useState<number | null>(null);
  const raf = useRef(0);
  useEffect(() => {
    if (!m || !Number.isFinite(target) || !isV2()) return;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [m, target, ms]);
  if (!m || v === null) return <>{text}</>;
  const shown = v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <>{text.slice(0, m.index)}{shown}{text.slice(m.index + m[1]!.length)}</>;
}

export const PALETTE = ["#4f7cff", "#f5a524", "#22c3a6", "#f2665b", "#a78bfa", "#9bd34e", "#38bdf8", "#f472b6"];

/** Anel de rosca com fatias separadas por um respiro, animando ao aparecer. */
export function Donut({ rows, center, sub }: { rows: { label: string; value: number; color?: string }[]; center: string; sub?: string }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const R = 70, C = 2 * Math.PI * R, gap = rows.length > 1 ? 6 : 0;
  let acc = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
          <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="16" />
          {total > 0 && rows.map((r, i) => {
            const len = (r.value / total) * C;
            const seg = Math.max(0, len - gap);
            const off = acc; acc += len;
            return (
              <circle key={r.label} cx="90" cy="90" r={R} fill="none" stroke={r.color ?? PALETTE[i % PALETTE.length]} strokeWidth="16" strokeLinecap="round"
                strokeDasharray={`${seg} ${C - seg}`} strokeDashoffset={-off} className="nx-ring" style={{ animationDelay: `${i * 90}ms` }} />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-2xl font-semibold text-white"><CountUp text={center} /></span>
          {sub && <span className="text-[11px] text-slate-500">{sub}</span>}
        </div>
      </div>
      <ul className="grid w-full grid-cols-1 gap-y-2.5 text-sm">
        {rows.map((r, i) => (
          <li key={r.label} className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color ?? PALETTE[i % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate text-slate-300">{r.label}</span>
            <span className="num text-slate-400">{total ? Math.round((r.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Gráfico de área suave (série principal) com uma linha tracejada de comparação. */
export function AreaChart({ points, compare, labels, mainLabel, compareLabel }: {
  points: number[]; compare?: number[]; labels: string[]; mainLabel: string; compareLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 220, P = 8;
  const max = Math.max(1, ...points, ...(compare ?? []));
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P - 10);
  const path = (vals: number[]) => vals.map((v, i) => {
    if (i === 0) return `M${x(0)},${y(v)}`;
    const cx = (x(i - 1) + x(i)) / 2;
    return `C${cx},${y(vals[i - 1]!)} ${cx},${y(v)} ${x(i)},${y(v)}`;
  }).join(" ");
  const line = path(points);
  const area = `${line} L${x(points.length - 1)},${H - P} L${x(0)},${H - P} Z`;
  const every = Math.ceil(labels.length / 7);
  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[220px] w-full" preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, i)));
          }}>
          <defs>
            <linearGradient id="nx-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#4f7cff" stopOpacity=".45" />
              <stop offset="100%" stopColor="#4f7cff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={P} x2={W - P} y1={P + f * (H - 2 * P)} y2={P + f * (H - 2 * P)} stroke="rgba(255,255,255,.05)" />)}
          {compare && <path d={path(compare)} fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />}
          <path d={area} fill="url(#nx-area)" className="nx-fade" />
          <path d={line} fill="none" stroke="#4f7cff" strokeWidth="2.5" vectorEffect="non-scaling-stroke" className="nx-draw" pathLength={1} />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P} y2={H - P} stroke="rgba(255,255,255,.18)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-1 rounded-xl border border-line bg-ink-800 px-3 py-2 text-xs shadow-2xl"
            style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 70px), calc(100% - 140px))` }}>
            <p className="text-slate-400">{labels[hover]}</p>
            <p className="num font-semibold text-white">{points[hover]!.toLocaleString("pt-BR")} <span className="font-normal text-slate-400">{mainLabel.toLowerCase()}</span></p>
            {compare && <p className="num text-slate-400">{compare[hover]!.toLocaleString("pt-BR")} {compareLabel?.toLowerCase()}</p>}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between px-1 text-[11px] text-slate-500">
        {labels.map((l, i) => (i % every === 0 || i === labels.length - 1 ? <span key={i}>{l}</span> : null))}
      </div>
      <div className="mt-3 flex items-center gap-5 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-[#4f7cff]" />{mainLabel}</span>
        {compare && <span className="inline-flex items-center gap-2"><span className="w-4 border-t border-dashed border-slate-400" />{compareLabel}</span>}
      </div>
    </div>
  );
}
