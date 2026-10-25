-- @supabase-only
-- Logos e ícones das empresas: públicos (aparecem na tela de login antes de entrar). Upload só pelo servidor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
