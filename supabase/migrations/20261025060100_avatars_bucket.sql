-- @supabase-only
-- Fotos de perfil dos leads (cópia própria: o link do WhatsApp expira)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
