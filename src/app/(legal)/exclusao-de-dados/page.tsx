import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Exclusão de dados" };

export default function ExclusaoDeDados() {
  const { product, contact } = LEGAL;
  return (
    <>
      <h1>Como solicitar a exclusão dos seus dados</h1>
      <p><b>Empresas e usuários do {product}:</b> o administrador pode remover números de WhatsApp em Configurações → WhatsApp (as conversas desse número são apagadas) e solicitar o encerramento da conta. Para excluir todos os dados da empresa, envie um e-mail para <a href={`mailto:${contact}`}>{contact}</a> com o assunto “Exclusão de dados” e o nome da empresa. Confirmamos o pedido e concluímos a exclusão em até 30 dias.</p>
      <p><b>Contatos de empresas clientes</b> (pessoas que conversaram com uma empresa pelo WhatsApp): peça a exclusão diretamente à empresa com quem você conversou. Se preferir, escreva para <a href={`mailto:${contact}`}>{contact}</a> informando seu número de telefone e o nome da empresa, e encaminharemos o pedido.</p>
      <p><b>Conexão com Facebook/Meta:</b> para remover o acesso do {product} à sua conta do WhatsApp Business, acesse as configurações de integrações comerciais da sua conta Meta e remova o app “NEXO CRM”. Os dados já recebidos podem ser excluídos pelo e-mail acima.</p>
    </>
  );
}
