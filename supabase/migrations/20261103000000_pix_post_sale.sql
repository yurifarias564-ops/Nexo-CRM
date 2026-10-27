-- Pix Nexo: pós-venda automático depois do pagamento e lead vai para "Ganho". Adicional passa a R$ 9,99/mês.
alter table public.org_payment_accounts add column if not exists post_sale_enabled boolean not null default true;
alter table public.org_payment_accounts add column if not exists post_sale_message text not null default 'Obrigado pela compra, {nome}! 🙌 Qualquer dúvida é só chamar aqui. Foi um prazer te atender!' check (char_length(post_sale_message) between 1 and 1000);
alter table public.org_payment_accounts add column if not exists move_to_won boolean not null default true;
alter table public.platform_settings alter column pix_addon_cents set default 999;
update public.platform_settings set pix_addon_cents = 999 where pix_addon_cents = 4990;
