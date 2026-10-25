"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Member, Pipeline, QuickReply, Role, Stage, Tag } from "@/lib/types";
import type { Brand } from "@/lib/branding/shared";

export interface WorkspaceData {
  orgId: string;
  orgName: string;
  userId: string;
  userName: string;
  role: Role;
  orgs: { id: string; name: string; role: Role }[];
  pipelines: Pipeline[];
  stages: Stage[];
  tags: Tag[];
  members: Member[];
  quickReplies: QuickReply[];
  /** Dono da plataforma (vê o painel de parceiros). */
  isHouse?: boolean;
  /** Está dentro da conta de um cliente como suporte. */
  supportMode?: boolean;
  /** Marca da empresa (logo, nome e cores próprios). */
  brand?: Brand;
}

interface Ctx extends WorkspaceData {
  canManage: boolean;
  stageById: Map<string, Stage>;
  tagById: Map<string, Tag>;
  memberById: Map<string, Member>;
  reload: (what: ("stages" | "tags" | "quickReplies" | "members" | "pipelines")[]) => Promise<void>;
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ initial, children }: { initial: WorkspaceData; children: React.ReactNode }) {
  const [pipelines, setPipelines] = useState(initial.pipelines);
  const [stages, setStages] = useState(initial.stages);
  const [tags, setTags] = useState(initial.tags);
  const [members, setMembers] = useState(initial.members);
  const [quickReplies, setQuickReplies] = useState(initial.quickReplies);

  const reload: Ctx["reload"] = useCallback(async (what) => {
    const sb = supabaseBrowser();
    await Promise.all(what.map(async (w) => {
      if (w === "stages") { const { data } = await sb.from("stages").select("*").order("position"); if (data) setStages(data as Stage[]); }
      if (w === "pipelines") { const { data } = await sb.from("pipelines").select("*").order("position"); if (data) setPipelines(data as Pipeline[]); }
      if (w === "tags") { const { data } = await sb.from("tags").select("*").order("name"); if (data) setTags(data as Tag[]); }
      if (w === "quickReplies") { const { data } = await sb.from("quick_replies").select("*").order("shortcut"); if (data) setQuickReplies(data as QuickReply[]); }
      if (w === "members") {
        const { data } = await sb.from("organization_members").select("user_id, role, profiles(full_name, email)").eq("organization_id", initial.orgId);
        type MRow = { user_id: string; role: Role; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null };
        if (data) setMembers((data as MRow[]).map((r) => {
          const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
          return { user_id: r.user_id, role: r.role, full_name: p?.full_name ?? null, email: p?.email ?? null };
        }));
      }
    }));
  }, [initial.orgId]);

  // Comando de voz pode criar etapa/tag: recarrega as listas
  useEffect(() => {
    const r = () => void reload(["stages", "tags"]);
    window.addEventListener("crm:refresh", r);
    return () => window.removeEventListener("crm:refresh", r);
  }, [reload]);

  const value = useMemo<Ctx>(() => ({
    ...initial,
    pipelines, stages, tags, members, quickReplies,
    canManage: initial.role !== "agent",
    stageById: new Map(stages.map((s) => [s.id, s])),
    tagById: new Map(tags.map((t) => [t.id, t])),
    memberById: new Map(members.map((m) => [m.user_id, m])),
    reload,
    setTags,
  }), [initial, pipelines, stages, tags, members, quickReplies, reload]);

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error("useWorkspace fora do WorkspaceProvider");
  return c;
}
