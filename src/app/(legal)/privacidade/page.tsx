import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Política de privacidade" };

export default function Privacidade() {
  const { product, contact, updated } = LEGAL;
  return (
    <>
      <h1>Política de privacidade</h1>
      <p className="text-xs text-slate-500">Atualizada em {updated}</p>
      <p>Esta política explica como o {product} trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD).</p>

      <h2>1. Papéis</h2>
      <p>O {product} é um sistema de gestão comercial (CRM) usado por empresas clientes. Para os dados dos <b>usuários do sistema</b> (nome, e-mail, login), o {product} é o controlador. Para os dados dos <b>contatos e leads</b> que cada empresa cadastra ou recebe pelo WhatsApp, a empresa cliente é a controladora e o {product} atua como operador, tratando os dados apenas conforme as instruções dela.</p>

      <h2>2. Dados tratados</h2>
      <ul>
        <li>Cadastro de usuários: nome, e-mail, senha (armazenada de forma criptografada) e empresa.</li>
        <li>Dados comerciais: leads, contatos, telefones, negociações, tarefas, agendamentos, metas e relatórios.</li>
        <li>WhatsApp: mensagens, mídias, status de entrega e, quando ativado pela empresa, ligações e suas gravações, recebidas pela API oficial do WhatsApp Business (Meta) ou por conexão via QR Code.</li>
        <li>Integrações autorizadas pela empresa, como Google Agenda.</li>
        <li>Dados técnicos: registros de acesso, endereço IP e informações do navegador, para segurança e funcionamento.</li>
      </ul>

      <h2>3. Finalidades</h2>
      <ul>
        <li>Prestar o serviço de CRM: organizar o funil, conversas, ligações, agenda e relatórios da empresa.</li>
        <li>Enviar e receber mensagens no WhatsApp em nome da empresa cliente.</li>
        <li>Gerar relatórios e resumos, inclusive com auxílio de inteligência artificial.</li>
        <li>Cobrança da assinatura, suporte, segurança e cumprimento de obrigações legais.</li>
      </ul>

      <h2>4. Compartilhamento</h2>
      <p>Não vendemos dados. Compartilhamos apenas com fornecedores necessários ao serviço: hospedagem e banco de dados (Vercel, Supabase), Meta Platforms (WhatsApp Business), Google (quando a agenda é conectada), processador de pagamentos (Asaas) e provedores de inteligência artificial usados para transcrever áudios e redigir relatórios. Esses fornecedores tratam os dados sob contrato e apenas para essas finalidades.</p>

      <h2>5. Dados recebidos da Meta</h2>
      <p>Os dados obtidos pelas APIs da Meta (WhatsApp Business) são usados exclusivamente para exibir e gerenciar as conversas e ligações da própria empresa cliente dentro do {product}. Não são usados para publicidade, não são vendidos e não são compartilhados com terceiros fora das finalidades acima.</p>

      <h2>6. Segurança e retenção</h2>
      <p>Os dados ficam em servidores com criptografia em trânsito e em repouso, com isolamento entre empresas e controle de acesso por função. Mantemos os dados enquanto a conta da empresa estiver ativa ou conforme exigido por lei. Ao encerrar a conta, os dados são excluídos em até 90 dias, salvo obrigação legal de guarda.</p>

      <h2>7. Seus direitos</h2>
      <p>Você pode solicitar confirmação, acesso, correção, portabilidade, anonimização ou exclusão dos seus dados, além de informações sobre compartilhamento. Se você é contato de uma empresa cliente, dirija o pedido a ela; nós a apoiaremos no atendimento. Veja também a página de <a href="/exclusao-de-dados">exclusão de dados</a>.</p>

      <h2>8. Contato</h2>
      <p>Encarregado de dados: <a href={`mailto:${contact}`}>{contact}</a>.</p>
    </>
  );
}
