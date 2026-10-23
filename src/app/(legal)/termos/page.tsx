import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Termos de uso" };

export default function Termos() {
  const { product, contact, updated } = LEGAL;
  return (
    <>
      <h1>Termos de uso</h1>
      <p className="text-xs text-slate-500">Atualizados em {updated}</p>
      <p>Ao usar o {product}, a empresa cliente e seus usuários concordam com estes termos.</p>
      <h2>1. Serviço</h2>
      <p>O {product} é um CRM por assinatura para gestão de leads, conversas de WhatsApp, ligações, agenda, metas e relatórios.</p>
      <h2>2. Responsabilidades da empresa cliente</h2>
      <ul>
        <li>Manter as credenciais de acesso em sigilo e responder pelos usuários que convidar.</li>
        <li>Ter base legal para tratar os dados dos seus contatos e obter o consentimento exigido para mensagens e gravação de ligações.</li>
        <li>Cumprir as políticas do WhatsApp Business e da Meta, incluindo as regras de mensagens comerciais.</li>
      </ul>
      <h2>3. Assinatura</h2>
      <p>O acesso depende da assinatura ativa. Custos cobrados pela Meta pelas conversas da API oficial são pagos pela empresa diretamente à Meta.</p>
      <h2>4. Disponibilidade</h2>
      <p>Buscamos manter o serviço disponível continuamente, mas podem ocorrer interrupções para manutenção ou por falhas de fornecedores.</p>
      <h2>5. Encerramento</h2>
      <p>A empresa pode cancelar a qualquer momento. Os dados são tratados conforme a <a href="/privacidade">política de privacidade</a>.</p>
      <h2>6. Contato</h2>
      <p><a href={`mailto:${contact}`}>{contact}</a></p>
    </>
  );
}
