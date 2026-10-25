-- Regras (filtros) do agente: objetivo, informações, condições, preço, desconto, proibições,
-- perguntas obrigatórias, gatilhos de transferência, perguntas frequentes, horário e limites.
alter table public.ai_agents add column rules jsonb not null default '{}'::jsonb;

-- Aviso de fora do horário: manda no máximo um por período em cada conversa
alter table public.conversations add column ai_offhours_sent_at timestamptz;
