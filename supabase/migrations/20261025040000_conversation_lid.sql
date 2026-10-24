-- Z-API: identificador @lid do contato (o WhatsApp às vezes manda só ele, sem o número)
alter table public.conversations add column wa_lid text check (wa_lid is null or wa_lid ~ '^[0-9]{6,32}$');
create index conversations_lid_idx on public.conversations (channel_id, wa_lid) where wa_lid is not null;
