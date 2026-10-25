/* eslint-disable @next/next/no-img-element -- logo da empresa vem do armazenamento (URL pública) */
import type { Brand } from "@/lib/branding/shared";

/** Logo do sistema: a da empresa (personalização) ou a do Nexo. */
export function Logo({ compact, brand }: { compact?: boolean; brand?: Brand | null }) {
  if (brand?.custom) {
    if (brand.logoUrl && !compact) {
      return <img src={brand.logoUrl} alt={brand.appName} className="h-9 max-w-[180px] object-contain object-left" />;
    }
    const icon = brand.iconUrl ?? brand.logoUrl;
    return (
      <div className="flex items-center gap-2.5">
        {icon
          ? <img src={icon} alt="" className="h-8 w-8 rounded-lg object-contain" />
          : <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-navy-500 text-sm font-bold text-white shadow-glow">{brand.appName[0]?.toUpperCase()}</div>}
        {!compact && <span className="max-w-[150px] truncate text-[15px] font-semibold tracking-tight text-white">{brand.appName}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-navy-500 shadow-glow">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-white" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19V5l14 14V5" />
        </svg>
      </div>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-white">
          Nexo<span className="text-brand-300">CRM</span>
        </span>
      )}
    </div>
  );
}
