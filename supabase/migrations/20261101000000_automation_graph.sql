-- Automações em canvas (estilo n8n): o fluxo é um grafo de blocos ligados por conexões.
alter table public.automations add column if not exists graph jsonb;
-- Em que bloco a execução está, e (no bloco "esperar resposta") para onde vai se o cliente responder
alter table public.automation_runs add column if not exists node_id text;
alter table public.automation_runs add column if not exists reply_node text;
alter table public.automation_runs add column if not exists waiting_for text check (waiting_for is null or waiting_for = 'reply');
create index if not exists automation_runs_reply_idx on public.automation_runs (lead_id) where status = 'waiting' and waiting_for = 'reply';
