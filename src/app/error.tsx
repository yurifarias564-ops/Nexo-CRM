"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-medium text-white">Algo deu errado</p>
      <p className="max-w-sm text-sm text-slate-400">Tente novamente. Se persistir, recarregue a página.</p>
      <Button onClick={reset}>Tentar de novo</Button>
    </main>
  );
}
