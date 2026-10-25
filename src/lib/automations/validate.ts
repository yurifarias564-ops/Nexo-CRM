import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import type { AutomationBody } from "./schema";

/** Confere que etapas, tags e vendedores usados na automação são desta empresa. */
export async function validateRefs(orgId: string, b: AutomationBody) {
  const stages = new Set<string>(), tags = new Set<string>(), users = new Set<string>();
  const t = b.trigger;
  if ((t.type === "stage_changed" || t.type === "idle") && t.stage_id) stages.add(t.stage_id);
  if (t.type === "tag_added") tags.add(t.tag_id);
  for (const s of b.steps) {
    if (s.type === "move_stage") stages.add(s.stage_id);
    if (s.type === "add_tag" || s.type === "remove_tag") tags.add(s.tag_id);
    if (s.type === "assign") s.user_ids.forEach((u) => users.add(u));
    if (s.type === "condition" && s.value) {
      if (s.field === "stage") stages.add(s.value);
      if (s.field === "tag" || s.field === "no_tag") tags.add(s.value);
      if (s.field === "assigned") users.add(s.value);
    }
  }
  const db = supabaseAdmin();
  const check = async (table: string, col: string, ids: Set<string>, label: string) => {
    if (!ids.size) return;
    const { data } = await db.from(table).select(col).eq("organization_id", orgId).in(col, [...ids]);
    if ((data ?? []).length < ids.size) throw new HttpError(422, `Escolha ${label} em todas as ações.`);
  };
  await check("stages", "id", stages, "a etapa");
  await check("tags", "id", tags, "a tag");
  await check("organization_members", "user_id", users, "os vendedores");
}
