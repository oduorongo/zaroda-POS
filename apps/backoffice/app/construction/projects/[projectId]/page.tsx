"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { CON_BRAND, errorText } from "../../../../lib/construction";
import { ConShell } from "../../../../components/construction/con-shell";
import { ErrorBox } from "../../../../components/construction/ui";
import { STATUS_COLOUR, STATUS_LABEL } from "../shared";
import { BqTab } from "./bq";
import { OverviewTab } from "./overview";
import { PermitsTab } from "./permits";
import { ProgrammeTab } from "./programme";
import { TeamTab } from "./team";
import type { ProjectDetail } from "./types";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "team", label: "Team & parties" },
  { key: "permits", label: "Permits" },
  { key: "bq", label: "BQ" },
  { key: "programme", label: "Programme" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    try {
      setProject(await apiGet<ProjectDetail>(`/construction/projects/${projectId}`));
      setError(null);
    } catch (e) {
      setError(errorText(e, "Could not load the project."));
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ConShell title={project ? `${project.code} · ${project.name}` : "Project"}>
      <ErrorBox message={error} />
      {project && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: STATUS_COLOUR[project.status] }}>{STATUS_LABEL[project.status]}</span>
            <span className="text-secondary-600">{project.client?.name ?? "No client"} · {project.progress}% of programme done</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-b border-border text-sm">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="whitespace-nowrap px-3 py-2"
                style={tab === t.key ? { borderBottom: `3px solid ${CON_BRAND.gold}`, fontWeight: 600, color: "var(--con-ink)" } : undefined}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {tab === "overview" && <OverviewTab project={project} reload={load} />}
          {tab === "team" && <TeamTab project={project} reload={load} />}
          {tab === "permits" && <PermitsTab project={project} reload={load} />}
          {tab === "bq" && <BqTab project={project} reload={load} />}
          {tab === "programme" && <ProgrammeTab project={project} reload={load} />}
        </>
      )}
    </ConShell>
  );
}
