-- Z-API como opção de conexão por QR Code (serviço pago gerenciado)
alter type public.wa_provider add value if not exists 'zapi';
