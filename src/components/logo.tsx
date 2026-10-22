export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-navy-500 shadow-glow">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 h-[18px] w-[18px] text-white" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
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
