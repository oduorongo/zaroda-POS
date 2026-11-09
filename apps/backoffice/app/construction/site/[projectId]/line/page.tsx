"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../../lib/api";
import { errorText, isUpgrade } from "../../../../../lib/construction";
import { ConShell, useConMe } from "../../../../../components/construction/con-shell";
import { ErrorBox, Panel, UpgradeCard } from "../../../../../components/construction/ui";
import { AssetForm, ClientItemsTable, ClientMoveForm, MAT_EDIT, ProgressForm, SITE_EDIT, canOn, type ClientMaterials } from "../../../projects/[projectId]/power-line";

type Tab = "progress" | "asset" | "materials";

/** Site → Line work (phone, docs/construction/07): today's progress per section, an asset with the phone's GPS, client materials. */
export default function LineWorkPage() {
  return (
    <ConShell title="Line work">
      <LineWork />
    </ConShell>
  );
}

function LineWork() {
  const { projectId } = useParams<{ projectId: string }>();
  const me = useConMe();
  const siteEdit = canOn(me, projectId, SITE_EDIT);
  const matEdit = canOn(me, projectId, MAT_EDIT);
  const [tab, setTab] = useState<Tab | null>(null);
  const [data, setData] = useState<ClientMaterials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<ClientMaterials>(`/construction/projects/${projectId}/client-materials`));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load the line work."));
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (me && tab === null) setTab(siteEdit ? "progress" : "materials");
  }, [me, siteEdit, tab]);

  const tabs: [Tab, string, boolean][] = [["progress", "Progress", siteEdit], ["asset", "Pole / asset", siteEdit], ["materials", "Client materials", true]];
  return (
    <div className="space-y-4">
      <Link href={`/construction/site/${projectId}`} className="text-sm underline">Site screens</Link>
      {upgrade && <UpgradeCard message={upgrade} />}
      <ErrorBox message={error} />
      <div className="flex gap-2">
        {tabs.filter(([, , show]) => show).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg border px-2 py-3 text-sm font-semibold ${tab === k ? "border-transparent text-white" : "border-border"}`} style={tab === k ? { background: "#0f1f45" } : undefined}>
            {label}
          </button>
        ))}
      </div>
      {data && tab === "progress" && (
        <Panel title="Today's progress">
          {data.sections.length ? <ProgressForm projectId={projectId} sections={data.sections} onSaved={() => void load()} /> : <p className="text-sm text-secondary-500">The project manager adds the line&apos;s sections first (project, Power line tab).</p>}
        </Panel>
      )}
      {data && tab === "asset" && (
        <Panel title="Record a pole, stay or transformer">
          <p className="mb-2 text-xs text-secondary-500">Stand at it and tap &quot;Use my position&quot; for its GPS.</p>
          <AssetForm projectId={projectId} sections={data.sections} onSaved={() => void load()} />
        </Panel>
      )}
      {data && tab === "materials" && (
        <Panel title="Client-supplied materials">
          <ClientItemsTable data={data} />
          {matEdit && <div className="mt-3"><ClientMoveForm projectId={projectId} data={data} onSaved={() => void load()} /></div>}
        </Panel>
      )}
    </div>
  );
}
