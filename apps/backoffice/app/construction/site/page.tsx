"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardCheck, BookOpen, HardHat, MessageSquareWarning } from "lucide-react";
import { apiGet } from "../../../lib/api";
import { CON_BRAND, errorText } from "../../../lib/construction";
import { ConShell } from "../../../components/construction/con-shell";
import { ErrorBox } from "../../../components/construction/ui";

interface Project { id: string; code: string; name: string; status: string }
const LAST = "con-site-project";

/** The phone home for site staff: pick the project, then one big button per job. */
export default function SitePage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Project[]>("/construction/projects")
      .then((rows) => {
        const open = rows.filter((p) => p.status !== "CLOSED");
        setProjects(open);
        let last = "";
        try {
          last = window.localStorage.getItem(LAST) ?? "";
        } catch {
          /* ignore */
        }
        setProjectId(open.find((p) => p.id === last)?.id ?? open[0]?.id ?? "");
      })
      .catch((e) => setError(errorText(e, "Could not load your projects.")));
  }, []);

  const pick = (id: string) => {
    setProjectId(id);
    try {
      window.localStorage.setItem(LAST, id);
    } catch {
      /* ignore */
    }
  };

  const tiles = [
    { href: "muster", label: "Muster roll", note: "Who is on site today", icon: ClipboardCheck },
    { href: "diary", label: "Diary & photos", note: "Today's works, weather, photos", icon: BookOpen },
    { href: "safety", label: "Safety", note: "Toolbox talk, PPE, permits, incidents", icon: HardHat },
    { href: "instructions", label: "Instructions", note: "From the architect / engineer", icon: MessageSquareWarning },
  ];

  return (
    <ConShell title="Site">
      <ErrorBox message={error} />
      {projects && projects.length === 0 && <p className="text-sm text-secondary-500">You are not on any open project yet. Ask your Project Manager to add you to the team.</p>}
      {projects && projects.length > 1 && (
        <select className="w-full rounded-xl border border-border bg-surface p-4 text-base" value={projectId} onChange={(e) => pick(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
      )}
      {projects?.length === 1 && <p className="text-base font-semibold">{projects[0].code} · {projects[0].name}</p>}
      {projectId && (
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((t) => (
            <Link key={t.href} href={`/construction/site/${projectId}/${t.href}`} className="flex min-h-[132px] flex-col justify-between rounded-2xl p-4 text-white no-underline shadow active:scale-[0.98]" style={{ background: CON_BRAND.navy }}>
              <t.icon size={30} color={CON_BRAND.gold} />
              <span>
                <span className="block text-lg font-bold">{t.label}</span>
                <span className="block text-xs text-white/75">{t.note}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </ConShell>
  );
}
