# Nexo CRM

CRM multiempresa com WhatsApp (API oficial **e** QR Code), funil kanban em tempo real, mensagens rápidas, comandos por voz, painel de métricas, importação/exportação Excel e cobrança recorrente via Asaas — o acesso só é liberado com a assinatura paga.

## Funcionalidades

- **Painel**: leads novos, valor em andamento, vendas ganhas, conversão, mensagens por dia, funil, origem, tags e ranking por responsável (7/30/90 dias ou mês).
- **Funil (kanban)**: arrastar e soltar, tempo real entre a equipe, filtros, vários funis.
- **Conversas**: estilo WhatsApp Web, texto + **foto, vídeo, áudio e documento** (anexar, arrastar ou colar), mensagens rápidas com `/`, status de entrega/leitura.
- **Janela de 24h (API oficial)**: o chat avisa quando a janela fecha e oferece **modelos aprovados** da Meta com variáveis e prévia.
- **Voz**: mover etapa, adicionar/remover tags, criar lead, valor, responsável, anotação, **editar nome/telefone/e-mail** e **enviar mensagem no WhatsApp falando** — sempre com confirmação.
- **Google Agenda**: cada vendedor conecta a própria conta. Agendar por voz (“agendamento com o Yuri amanhã às 10 horas” → move para a etapa **Agendamento** e cria o evento), arrastando o lead para a coluna Agendamento ou pelo botão Agendar no lead; cancelar remove o evento do Google.
- **Mensagens agendadas**: escolha dia, hora e texto (ou modelo aprovado) e o sistema envia sozinho no WhatsApp do lead — pelo chat, pelo lead, pela tela **Agendadas** ou por voz (“entrar em contato com o Yuri dia 31 de outubro: e aí, meu patrão, tudo certo?”). Falha temporária tenta de novo (até 3 vezes); falha que exige ação aparece com o motivo e botão de reenviar.
- **Leads**: tabela com busca, ações em massa, importação/exportação Excel.
- **Limite de uso por usuário** em todas as rotas sensíveis (voz, envio, importação, convites).

> "Nexo CRM" é um nome provisório. Para trocar, edite `src/components/logo.tsx` e o `title` em `src/app/layout.tsx`.

## Stack

| Camada | Tecnologia |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript estrito, Tailwind |
| Banco, login, tempo real | Supabase (Postgres + RLS + Auth + Realtime) |
| Cobrança | Asaas (assinatura mensal, Pix/boleto/cartão) |
| WhatsApp oficial | Meta Cloud API (com coexistência para histórico) |
| WhatsApp QR Code | Evolution API v2 (self-hosted) |
| Voz | OpenAI (transcrição) + Claude (interpretação do comando) |

## Segurança (como foi pensada)

- **Isolamento por empresa no próprio banco**: toda tabela tem Row Level Security. Um usuário só lê/escreve dados das empresas das quais é membro. Mesmo com um bug no front-end, o banco recusa.
- **Bloqueio por falta de pagamento também no banco**: sem assinatura ativa e dentro da vigência, as consultas a leads, conversas etc. retornam vazio. A tela de cobrança continua acessível.
- **Ninguém se auto-ativa**: só o webhook do Asaas (com token secreto) altera a assinatura.
- **Segredos isolados**: tokens da Meta ficam numa tabela sem nenhuma política de leitura — só o servidor acessa. Nunca chegam ao navegador.
- **Webhooks autenticados**: Meta por assinatura HMAC-SHA256, Asaas por token, Evolution por segredo único por número. Todos com comparação em tempo constante e idempotência (reenvios não duplicam nada).
- **Permissões por função**: Proprietário, Administrador e Atendente. Atendente não exclui leads nem altera configurações.
- **Anti-adulteração**: gatilhos impedem vincular lead a etapa/tag/responsável de outra empresa.
- **Cabeçalhos HTTP de segurança** (HSTS, X-Frame-Options, nosniff, Permissions-Policy).

## Testes incluídos

```bash
npm test          # roda tudo
npm run test:unit # 17 testes: webhooks, modelos, mídia, fuso horário/agenda, mensagens agendadas, telefone, CPF/CNPJ, dinheiro, voz
npm run test:db   # 69 testes: migrations reais num Postgres embutido — isolamento, bloqueio, permissões, deduplicação, 9º dígito, limites, painel, agendamentos, mensagens agendadas (sem envio duplicado)
npm run typecheck
npm run build
```

---

## Passo a passo para colocar no ar

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (região **São Paulo**).
2. Em **SQL Editor**, rode, na ordem do nome, todos os arquivos de `supabase/migrations/`
   (ou use a CLI: `supabase link` e `supabase db push`).
   > O projeto **nexo-crm** já está criado e com todas as migrations aplicadas.
3. Em **Authentication → URL Configuration**:
   - *Site URL*: `https://seu-dominio.com.br`
   - *Redirect URLs*: `https://seu-dominio.com.br/auth/callback`
4. Em **Authentication → Emails**, personalize os textos em português (confirmação, convite, redefinição de senha) e configure um SMTP próprio (Resend, SES…) — o SMTP padrão do Supabase tem limite baixo.
5. Copie de **Project Settings → API**: URL, `anon key` e `service_role key`.

### 2. Variáveis de ambiente

Copie `.env.example` para `.env.local` (ou cadastre na Vercel) e preencha. **Nunca** coloque a `SUPABASE_SERVICE_ROLE_KEY` em variável `NEXT_PUBLIC_*`.

### 3. Asaas (cobrança)

1. Crie a chave de API em **Integrações → Chave de API**. Comece pelo sandbox (`ASAAS_API_URL=https://api-sandbox.asaas.com/v3`).
2. Em **Integrações → Webhooks**, crie um webhook:
   - URL: `https://seu-dominio.com.br/api/webhooks/asaas`
   - Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
   - Eventos: **todos de Cobrança** e **todos de Assinatura**
3. Defina `PLAN_PRICE_CENTS` (ex.: `19700` = R$ 197,00) e `PLAN_NAME`.

Fluxo: cadastro → cria empresa → tela de assinatura → paga a fatura → o Asaas avisa o webhook → acesso liberado sozinho (a tela verifica a cada 8s). Vencida sem pagamento → acesso pausado; pagou → volta tudo, sem perder dados.

### 4. WhatsApp — API oficial (Meta)

1. No [Meta for Developers](https://developers.facebook.com), crie um app do tipo *Business* com o produto **WhatsApp**.
2. Em **WhatsApp → Configuração → Webhook**:
   - URL de callback: `https://seu-dominio.com.br/api/webhooks/meta`
   - Token de verificação: o valor de `META_WEBHOOK_VERIFY_TOKEN`
   - Assine os campos: `messages`, `history`, `smb_message_echoes`
3. `META_APP_SECRET` = **Configurações do app → Básico → Chave secreta do app**.
4. No sistema, em **Configurações → WhatsApp → API oficial**, informe *Phone Number ID*, *WABA ID* e um **token permanente** de usuário do sistema.

**Histórico na API oficial**: só existe via *coexistência* (número que já usa o app WhatsApp Business, conectado pelo Embedded Signup). A Meta envia até ~6 meses de conversas, e a solicitação precisa ser feita em até 24h após conectar — o sistema já pede isso automaticamente ao cadastrar o número.

### 5. WhatsApp — QR Code (Evolution API v2)

1. Suba a Evolution API v2 num servidor seu (Docker; Railway, VPS etc.) com Postgres/Redis conforme a documentação dela.
2. Preencha `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` (a *global API key*).
3. No sistema, **Configurações → WhatsApp → QR Code** gera a instância, configura o webhook sozinho e mostra o QR. Ao conectar, o histórico completo é sincronizado automaticamente; o botão **Importar histórico** faz uma varredura completa e pode ser repetido sem duplicar nada.

> Conexão por QR Code é não oficial (protocolo do WhatsApp Web). Existe risco de bloqueio do número pela Meta, principalmente com disparos em massa. Para operação crítica, prefira a API oficial.

### 6. Comandos por voz

- `OPENAI_API_KEY` — transcrição do áudio (`gpt-4o-mini-transcribe`, barato e bom em PT-BR).
- `ANTHROPIC_API_KEY` — interpreta a frase e transforma em ações.

Clique em **Comando de voz** (ou `Ctrl+Shift+M`), fale, por exemplo: *"mova o lead Yuri para Negociação e coloque a tag Anúncio"*. O sistema mostra o que entendeu e **só executa depois da sua confirmação**; se houver dois "Yuri", ele pergunta qual. Também dá para digitar o comando (ícone de teclado).

Ações suportadas: mover de etapa, adicionar/remover tags (cria a tag se não existir), criar lead, definir valor, definir responsável, adicionar anotação — várias na mesma frase.

### 7. Google Agenda

1. Em [Google Cloud Console](https://console.cloud.google.com): crie um projeto e ative a **Google Calendar API**.
2. **Tela de consentimento OAuth**: tipo *Externo*, adicione o escopo `.../auth/calendar.events`. Enquanto o app estiver em *Teste*, só os e-mails cadastrados como testadores conseguem conectar; para todos os clientes, envie para verificação do Google.
3. **Credenciais → Criar ID do cliente OAuth** (Aplicativo da Web) com o URI de redirecionamento `https://seu-dominio.com.br/api/google/callback`.
4. Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
5. No sistema: **Configurações → Integrações → Conectar Google Agenda** (cada pessoa da equipe conecta a sua).

Empresas criadas a partir de agora já nascem com a etapa **Agendamento** no funil. Em empresas antigas, crie uma etapa com "Agendamento" no nome (Configurações → Funil).

### 8. Mensagens agendadas (disparador)

O disparador já está criado no Supabase (pg_cron, a cada minuto, só chama o app quando há mensagem vencida). Depois do deploy, ative-o uma vez:

1. Gere um segredo: `openssl rand -hex 32` e coloque em `CRON_SECRET` (Vercel/`.env.local`).
2. No **SQL Editor** do Supabase, rode (com os seus valores):
   ```sql
   select vault.create_secret('https://seu-dominio.com.br', 'app_url');
   select vault.create_secret('<o mesmo CRON_SECRET>', 'cron_secret');
   ```
3. Pronto. Para conferir: **Integrations → Cron** no painel do Supabase mostra as execuções do job `nexo-scheduled-messages`.

Regra da Meta: na **API oficial**, texto livre só é entregue se o cliente falou nas 24h anteriores; para retomar contato, agende um **modelo aprovado** (o sistema avisa e oferece). Pelo **QR Code** não há essa restrição.

### 9. Deploy (Vercel)

1. Suba o código para um repositório GitHub e importe na [Vercel](https://vercel.com).
2. Cadastre as variáveis de ambiente.
3. Plano **Pro** recomendado: a importação de histórico e os webhooks usam até 300s por execução.
4. Aponte o domínio e atualize `NEXT_PUBLIC_APP_URL` e as URLs no Supabase, Asaas e Meta.

---

## Escala (muitos usuários simultâneos)

- **Banco**: índices em todas as chaves de busca e de empresa; políticas RLS no padrão recomendado pelo Supabase (`(select auth.uid())`, funções `security definer` estáveis) para não recalcular por linha. Comece no plano **Pro** do Supabase e suba o *compute* conforme o volume.
- **Kanban**: carrega 50 leads por coluna com "carregar mais" e contagem real — funciona com dezenas de milhares de leads.
- **Conversas e mensagens**: paginadas (rolagem infinita); mídia baixada sob demanda pelo servidor, sem lotar o armazenamento.
- **Tempo real**: assinaturas filtradas por empresa e por conversa.
- **Webhooks**: idempotentes e atômicos (uma função no banco grava conversa + mensagem + lead + contadores de uma vez); reenvios do provedor não duplicam.
- **Importação de histórico**: em etapas com cursor, sem estourar tempo limite, retomável.
- **Planilhas**: até 20.000 linhas por importação, em lotes de 500; atualiza pelo telefone em vez de duplicar.

## Estrutura

```
supabase/migrations/      schema, RLS, gatilhos e funções
src/proxy.ts              protege rotas (sessão Supabase)
src/lib/                  auth, Asaas, WhatsApp (meta/evolution), voz, planilhas
src/app/api/              rotas: cobrança, canais, mensagens, mídia, voz, leads, equipe, webhooks
src/app/(app)/            telas: funil, conversas, leads, configurações
src/components/           kanban, inbox, painel do lead, voz, configurações, UI
tests/                    testes unitários e de banco
```

## Próximos passos sugeridos

1. Cadastro pelo **Embedded Signup** da Meta (conexão do número oficial em 1 clique, com coexistência) — exige o app aprovado como Tech Provider.
2. Gravação de áudio direto no chat (nota de voz).
3. Monitoramento de erros (Sentry) e alertas de webhook.
