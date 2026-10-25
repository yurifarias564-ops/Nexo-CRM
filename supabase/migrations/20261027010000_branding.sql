-- Personalização (white label): cada empresa com nome, logo, ícone, cores e domínio próprio.

create table public.org_branding (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  app_name text check (app_name is null or char_length(app_name) between 1 and 40),
  logo_url text check (logo_url is null or char_length(logo_url) <= 500),
  icon_url text check (icon_url is null or char_length(icon_url) <= 500),
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),
  login_title text check (login_title is null or char_length(login_title) <= 120),
  login_subtitle text check (login_subtitle is null or char_length(login_subtitle) <= 300),
  support_whatsapp text check (support_whatsapp is null or support_whatsapp ~ '^[0-9]{10,15}$'),
  hide_powered_by boolean not null default false,
  custom_domain text unique check (custom_domain is null or custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  domain_status text check (domain_status is null or domain_status in ('pending', 'active', 'error')),
  domain_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.org_branding enable row level security;
create policy org_branding_select on public.org_branding for select to authenticated using ((select private.is_member(organization_id)));
