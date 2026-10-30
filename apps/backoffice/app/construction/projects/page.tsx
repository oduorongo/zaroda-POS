"use client";

import Link from "next/link";
import { KENYA_COUNTIES } from "@zaroda/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isDirector, isUpgrade, kes, withChecks } from "../../../lib/construction";
import { ConShell, useConMe } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../components/construction/ui";
import { STATUS_COLOUR, STATUS_LABEL, type ProjectStatus } from "./shared";

interface Project { id: string; code: string; name: string; status: ProjectStatus; client: { id: string; name: string } | null; contractSum: number; bqTotal: number; progress: number; county: string | null; completionDate: string | null }
interface Party { id: string; kind: string; name: string }

const WORKS = [
  { value: "BUILDING", label: "Building works" },
  { value: "ROADS_CIVIL", label: "Roads & civil works" },
  { value: "ELEC_MECH", label: "Electrical & mechanical" },
];
const FORMS = [
  { value: "JBC", label: "JBC" },
  { value: "FIDIC", label: "FIDIC" },
  { value: "PPADA", label: "Government (PPADA)" },
  { value: "SIMPLE", label: "Simple agreement" },
];
const blank = { name: "", clientId: "", newClient: "", worksClass: "BUILDING", contractSum: "", formOfContract: "JBC", startDate: "", completionDate: "", county: "", location: "" };

export default function ProjectsPage() {
  return (
    <ConShell title="Projects">
      <Projects />
    </ConShell>
  );
}

function Projects() {
  const me = useConMe();
  const router = useRouter();
  const canCreate = hasConRole(me, "CON_CONTRACTS_MGR", "CON_QS");
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Party[]>([]);
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await apiGet<Project[]>("/construction/projects"));
      setClients((await apiGet<Party[]>("/construction/parties").catch(() => [])).filter((p) => p.kind === "CLIENT"));
    } catch (e) {
      setError(errorText(e, "Could not load projects."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      let clientId = form.clientId || undefined;
      if (!clientId && form.newClient.trim()) clientId = (await conSend<{ id: string }>("POST", "/construction/parties", { kind: "CLIENT", name: form.newClient.trim() })).id;
      const p = await withChecks(
        (extra) =>
          conSend<{ id: string }>("POST", "/construction/projects", {
            name: form.name.trim(), clientId, worksClass: form.worksClass, contractSum: Number(form.contractSum), formOfContract: form.formOfContract,
            startDate: form.startDate || undefined, completionDate: form.completionDate || undefined, county: form.county || undefined, location: form.location || undefined, ...extra,
          }),
        isDirector(me),
      );
      if (p) router.push(`/construction/projects/${p.id}`);
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not create the project."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {upgrade && <UpgradeCard message={upgrade} />}
      {canCreate && !open && <PrimaryButton onClick={() => setOpen(true)}>New project</PrimaryButton>}

      {open && (
        <Panel title="New project">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Client">
              <select className={inputClass} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">{clients.length ? "Choose, or type a new one below" : "Type the client below"}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {!form.clientId && <Field label="New client name"><input className={inputClass} value={form.newClient} onChange={(e) => setForm({ ...form, newClient: e.target.value })} /></Field>}
            <Field label="Works class">
              <select className={inputClass} value={form.worksClass} onChange={(e) => setForm({ ...form, worksClass: e.target.value })}>
                {WORKS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
            <Field label="Contract sum (KES)"><input className={inputClass} inputMode="decimal" value={form.contractSum} onChange={(e) => setForm({ ...form, contractSum: e.target.value })} /></Field>
            <Field label="Form of contract">
              <select className={inputClass} value={form.formOfContract} onChange={(e) => setForm({ ...form, formOfContract: e.target.value })}>
                {FORMS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Start"><input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Completion"><input type="date" className={inputClass} value={form.completionDate} onChange={(e) => setForm({ ...form, completionDate: e.target.value })} /></Field>
            <Field label="County">
              <select className={inputClass} value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })}>
                <option value="">Choose...</option>
                {KENYA_COUNTIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Site location"><input className={inputClass} value={form.location} placeholder="e.g. Uriri, off Migori-Kisii road" onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex gap-2">
            <PrimaryButton disabled={busy || form.name.trim().length < 2 || !form.contractSum} onClick={create}>{busy ? "Creating..." : "Create project"}</PrimaryButton>
            <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => (setOpen(false), setForm(blank))}>Cancel</button>
          </div>
        </Panel>
      )}

      {projects.length === 0 && <p className="text-sm text-secondary-500">No projects yet. Create one, or mark a tender as won.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <Link key={p.id} href={`/construction/projects/${p.id}`} className="block rounded-xl border border-border bg-surface p-4 no-underline shadow-sm hover:shadow">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-secondary-500">{p.code}</p>
                <p className="font-semibold" style={{ color: "var(--con-ink)" }}>{p.name}</p>
                <p className="text-xs text-secondary-500">{p.client?.name ?? "No client yet"}{p.county ? ` · ${p.county}` : ""}</p>
              </div>
              <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: STATUS_COLOUR[p.status] }}>{STATUS_LABEL[p.status]}</span>
            </div>
            <p className="mt-2 text-sm text-foreground">{kes(p.contractSum)}</p>
            <div className="mt-2 h-2 rounded-full bg-background">
              <div className="h-2 rounded-full" style={{ width: `${p.progress}%`, background: CON_BRAND.gold }} />
            </div>
            <p className="mt-1 text-xs text-secondary-500">{p.progress}% of the programme done{p.completionDate ? ` · due ${p.completionDate}` : ""}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
