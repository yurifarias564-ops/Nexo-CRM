-- Chaves Pix da empresa (para enviar "Pix Copia e Cola" no chat)
create table public.pix_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key_type text not null check (key_type in ('cpf', 'cnpj', 'phone', 'email', 'random')),
  key text not null check (char_length(key) between 3 and 77),
  holder_name text not null check (char_length(holder_name) between 1 and 60),
  city text not null check (char_length(city) between 1 and 40),
  label text check (label is null or char_length(label) <= 40),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, key)
);
create index pix_keys_org_idx on public.pix_keys (organization_id, created_at);
alter table public.pix_keys enable row level security;
create policy pix_keys_select on public.pix_keys for select to authenticated using ((select private.can_access(organization_id)));
-- Cadastro e exclusão passam pelo servidor (valida a chave); só dono/administrador
create policy pix_keys_delete on public.pix_keys for delete to authenticated using ((select private.can_manage(organization_id)));
