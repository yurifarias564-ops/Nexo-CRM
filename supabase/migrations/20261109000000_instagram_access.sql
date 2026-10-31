-- Pedido de liberação do Instagram: enquanto o app não tem acesso avançado da Meta,
-- a conta da loja precisa ser adicionada como testadora. A loja informa o @ e a plataforma convida.
create table public.instagram_access_requests (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9._]{1,30}$'),
  status text not null default 'pending' check (status in ('pending', 'invited', 'connected')),
  requested_at timestamptz not null default now(),
  invited_at timestamptz
);
alter table public.instagram_access_requests enable row level security;
create policy instagram_access_requests_select on public.instagram_access_requests for select to authenticated
  using ((select private.can_manage(organization_id)));
