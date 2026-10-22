-- =============================================================================
-- Conexão do WhatsApp oficial em 1 clique (Cadastro Incorporado da Meta).
--  - meta_coexistence: número que continua também no app WhatsApp Business do
--    celular (a Meta não oferece ligações pela API nesses números).
--  - meta_pin: PIN de verificação em duas etapas criado ao registrar o número
--    (guardado com os outros segredos; só o servidor lê).
-- =============================================================================
alter table public.whatsapp_channels add column meta_coexistence boolean not null default false;
alter table public.whatsapp_channel_secrets add column meta_pin text check (meta_pin is null or meta_pin ~ '^[0-9]{6}$');
