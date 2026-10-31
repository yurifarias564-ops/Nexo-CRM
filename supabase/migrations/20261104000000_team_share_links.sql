-- Link do checklist para o cliente: abre só o checklist do time daquela empresa, sem login.
create table public.team_share_links (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  token text not null unique check (char_length(token) >= 32),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.team_share_links enable row level security;
create policy team_share_links_select on public.team_share_links for select to authenticated
  using ((select private.can_manage(organization_id)));
