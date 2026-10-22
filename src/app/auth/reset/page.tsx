"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { Logo } from "@/components/logo";

export default function ResetPage() {
  const router = useRouter();
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pass.length < 8) return toast.error("A senha precisa ter pelo menos 8 caracteres");
    setLoading(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: pass });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Senha atualizada!");
    router.replace("/");
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-5 p-6">
        <Logo />
        <h1 className="text-xl font-semibold text-white">Definir nova senha</h1>
        <Field label="Nova senha"><input className="field" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" required /></Field>
        <Button type="submit" className="w-full" loading={loading}>Salvar senha</Button>
      </form>
    </main>
  );
}
