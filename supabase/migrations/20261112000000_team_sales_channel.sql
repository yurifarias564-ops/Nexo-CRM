-- Canal de cada venda registrada no checklist (WhatsApp, Instagram, loja, indicação...)
alter table public.team_sales add column channel text check (channel is null or char_length(channel) between 1 and 40);
