"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { conSend, errorText, isUpgrade } from "../../../../lib/construction";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

interface PortalUser { id: string; name: string; email: string; phone: string | null; role: string; isActive: boolean; party: { name: string } | null; lastLoginAt: string | null; projectIds: string[] }
interface Party { id: string; kind: string; name: string }

export const PORTAL_ROLE_LABEL: Record<string, string> = {
  CON_CLIENT: "Client - sees progress, photos, IPCs",
  CON_CONSULTANT_QS: "Client's QS - certifies valuations",
  CON_CONSULTANT_ARCH: "Client's architect - instructions, approves variations",
  CON_CONSULTANT_ENG: "Client's engineer - instructions",
  CON_SUBCONTRACTOR: "Subcontractor - own valuations and payments",
};
const PARTY_FOR: Record<string, string> = { CON_CLIENT: "CLIENT", CON_CONSULTANT_QS: "QS", CON_CONSULTANT_ARCH: "ARCHITECT", CON_CONSULTANT_ENG: "ENGINEER", CON_SUBCONTRACTOR: "SUBCONTRACTOR" };

export function PortalTab({ project: p }: TabProps) {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "CON_CLIENT", partyId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers((await apiGet<PortalUser[]>("/construction/portal-users")).filter((u) => u.projectIds.includes(p.id)));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load portal access."));
    }
  }, [p.id]);
  useEffect(() => {
    void load();
    apiGet<Party[]>("/construction/parties").then(setParties).catch(() => undefined);
  }, [load]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(errorText(e, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  if (upgrade) return <UpgradeCard message={upgrade} />;
  const choices = parties.filter((x) => x.kind === PARTY_FOR[form.role]);

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      <Panel title="Who can follow this project on the portal">
        <p className="mb-2 text-xs text-secondary-500">They sign in at /portal with their email and a code we email them. Free - they do not count as users on your plan. They never see workers, materials, payroll or your costs.</p>
        {users.length === 0 ? (
          <p className="text-sm text-secondary-500">Nobody yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={u.isActive ? "" : "line-through opacity-60"}>
                  <strong>{u.name}</strong> · {u.email}{u.party ? ` · ${u.party.name}` : ""}
                  <span className="block text-xs text-secondary-500">{PORTAL_ROLE_LABEL[u.role]}{u.lastLoginAt ? ` · last in ${u.lastLoginAt.slice(0, 10)}` : " · not signed in yet"}</span>
                </span>
                <button type="button" disabled={busy} className="rounded-lg border px-3 py-1 text-xs" onClick={() => act(() => conSend("PUT", `/construction/portal-users/${u.id}`, { isActive: !u.isActive }), u.isActive ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.`)}>
                  {u.isActive ? "Remove access" : "Give access back"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Invite someone">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role">
            <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, partyId: "" })}>
              {Object.entries(PORTAL_ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Firm">
            <select className={inputClass} value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })}>
              <option value="">{form.role === "CON_SUBCONTRACTOR" ? "Pick the subcontractor" : "-"}</option>
              {choices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Phone (optional)"><input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        </div>
        <div className="mt-3">
          <PrimaryButton
            disabled={busy || form.name.trim().length < 2 || !form.email.includes("@")}
            onClick={() => act(async () => {
              await conSend("POST", "/construction/portal-users", { name: form.name, email: form.email, phone: form.phone || undefined, role: form.role, partyId: form.partyId || undefined, projectIds: [p.id] });
              setForm({ name: "", email: "", phone: "", role: form.role, partyId: "" });
            }, "Invited - we emailed them a link to the portal.")}
          >
            Invite
          </PrimaryButton>
        </div>
      </Panel>
    </div>
  );
}
