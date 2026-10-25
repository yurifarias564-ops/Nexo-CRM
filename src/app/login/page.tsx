import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { brandForHost } from "@/lib/branding/server";

export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  // Domínio próprio do cliente: tela de login com a marca dele
  const { brand } = await brandForHost();
  return (
    <Suspense>
      <LoginForm brand={brand} />
    </Suspense>
  );
}
