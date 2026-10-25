-- Tom de voz do agente de IA: executivo (formal e refinado), consultivo (profissional e caloroso) ou próximo (descontraído)
alter table public.ai_agents
  add column tone text not null default 'executivo' check (tone in ('executivo', 'consultivo', 'proximo'));
