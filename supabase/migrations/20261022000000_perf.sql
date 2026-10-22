-- =============================================================================
-- Ajustes de desempenho apontados pelo linter do Supabase
-- 1) Índices nas chaves estrangeiras restantes
-- 2) Políticas de escrita separadas por ação (evita 2 políticas no SELECT)
-- =============================================================================

create index if not exists activities_actor_idx on public.activities (actor_id);
create index if not exists messages_sent_by_idx on public.messages (sent_by);
create index if not exists organization_invites_invited_by_idx on public.organization_invites (invited_by);
create index if not exists organizations_created_by_idx on public.organizations (created_by);
create index if not exists profiles_current_org_idx on public.profiles (current_organization_id);
create index if not exists quick_replies_created_by_idx on public.quick_replies (created_by);
create index if not exists voice_commands_user_idx on public.voice_commands (user_id);

-- pipelines
drop policy if exists pipelines_write on public.pipelines;
create policy pipelines_insert on public.pipelines for insert to authenticated
  with check ((select private.can_manage(organization_id)));
create policy pipelines_update on public.pipelines for update to authenticated
  using ((select private.can_manage(organization_id)))
  with check ((select private.can_manage(organization_id)));
create policy pipelines_delete on public.pipelines for delete to authenticated
  using ((select private.can_manage(organization_id)));

-- stages
drop policy if exists stages_write on public.stages;
create policy stages_insert on public.stages for insert to authenticated
  with check ((select private.can_manage(organization_id)));
create policy stages_update on public.stages for update to authenticated
  using ((select private.can_manage(organization_id)))
  with check ((select private.can_manage(organization_id)));
create policy stages_delete on public.stages for delete to authenticated
  using ((select private.can_manage(organization_id)));

-- quick_replies
drop policy if exists quick_replies_write on public.quick_replies;
create policy quick_replies_insert on public.quick_replies for insert to authenticated
  with check ((select private.can_access(organization_id)));
create policy quick_replies_update on public.quick_replies for update to authenticated
  using ((select private.can_access(organization_id)))
  with check ((select private.can_access(organization_id)));
create policy quick_replies_delete on public.quick_replies for delete to authenticated
  using ((select private.can_access(organization_id)));
