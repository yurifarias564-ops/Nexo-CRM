-- Para onde vai o aviso de novo lead da página de vendas (/conheca): número que recebe no WhatsApp.
alter table public.platform_settings add column if not exists sales_notify_phone text check (sales_notify_phone is null or sales_notify_phone ~ '^\d{12,13}$');
