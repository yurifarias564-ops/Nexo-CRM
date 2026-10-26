-- Análise de crédito é da IA: o vendedor recebe o resultado pronto (WhatsApp da equipe) e só fecha a venda.
alter table public.credit_settings add column if not exists notify_phone text check (notify_phone is null or notify_phone ~ '^\d{10,15}$');
alter table public.credit_settings alter column provider set default 'directd';
update public.credit_settings set provider = 'directd' where provider = 'manual';
-- Quando o resultado final já foi avisado (cliente e vendedor), para não avisar duas vezes
alter table public.credit_checks add column if not exists notified_at timestamptz;
