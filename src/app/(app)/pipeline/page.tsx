import { requireAppContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { KanbanBoard } from "@/components/kanban/board";
import type { Lead } from "@/lib/types";
import { KANBAN_PAGE_SIZE as PAGE_SIZE } from "@/lib/constants";

export const metadata = { title: "Funil" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireAppContext();
  const { p } = await searchParams;
  const sb = await supabaseServer();
  const { data: pipelines } = await sb.from("pipelines").select("id").order("position");
  const pipelineId = pipelines?.find((x) => x.id === p)?.id ?? pipelines?.[0]?.id ?? null;
  if (!pipelineId) return <KanbanBoard pipelineId={null} initialLeads={[]} initialCounts={{}} initialTags={[]} />;

  const { data: stages } = await sb.from("stages").select("id").eq("pipeline_id", pipelineId).order("position");
  const perStage = await Promise.all(
    (stages ?? []).map(async (s) => {
      const [{ data }, { count }] = await Promise.all([
        sb.from("leads").select("*").eq("stage_id", s.id).order("position").range(0, PAGE_SIZE - 1),
        sb.from("leads").select("id", { count: "exact", head: true }).eq("stage_id", s.id),
      ]);
      return { stageId: s.id, leads: (data ?? []) as Lead[], count: count ?? 0 };
    }),
  );
  const leads = perStage.flatMap((x) => x.leads);
  const counts = Object.fromEntries(perStage.map((x) => [x.stageId, x.count]));
  const ids = leads.map((l) => l.id);
  const tagRows: { lead_id: string; tag_id: string }[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from("lead_tags").select("lead_id, tag_id").in("lead_id", ids.slice(i, i + 300));
    tagRows.push(...(data ?? []));
  }
  return <KanbanBoard key={pipelineId} pipelineId={pipelineId} initialLeads={leads} initialCounts={counts} initialTags={tagRows} />;
}
