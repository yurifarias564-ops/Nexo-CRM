export function Section({ title, text, action, children }: { title: string; text?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="animate-fadeIn">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
          {text && <p className="mt-1 text-sm text-slate-400">{text}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
