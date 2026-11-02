"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { conSend, errorText, hasConRole } from "../../../../lib/construction";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, ExpiryBadge, Field, Panel, PrimaryButton, inputClass } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

interface Party { id: string; kind: string; name: string }
interface Person { orgUserId: string; fullName: string; coreRole: string; ncaCardExpiresAt: string | null }

const PARTY_ROLES: Record<string, string> = { ARCHITECT: "Architect / PM", QS: "Quantity surveyor", ENGINEER: "Engineer", SUBCONTRACTOR: "Subcontractor", OTHER: "Other" };
const PROJECT_ROLES: Record<string, string> = {
  CON_PROJECT_MGR: "Project Manager",
  CON_SITE_ENGINEER: "Site Engineer",
  CON_SITE_SUPERVISOR: "Site Supervisor / Foreman",
  CON_STOREKEEPER: "Storekeeper",
  CON_TIMEKEEPER: "Timekeeper",
};

export function TeamTab({ project: p, reload }: TabProps) {
  const me = useConMe();
  const isPm = !!me?.projectRoles.some((r) => r.projectId === p.id && r.role === "CON_PROJECT_MGR");
  const canTeam = hasConRole(me, "CON_CONTRACTS_MGR") || isPm;
  const canParties = hasConRole(me, "CON_CONTRACTS_MGR", "CON_QS") || isPm;
  const [parties, setParties] = useState<Party[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [link, setLink] = useState({ role: "ARCHITECT", partyId: "", newName: "", phone: "" });
  const [member, setMember] = useState({ orgUserId: "", role: "CON_SITE_ENGINEER" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<Party[]>("/construction/parties").then(setParties).catch(() => undefined);
    apiGet<Person[]>("/construction/people").then(setPeople).catch(() => undefined);
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = (await fn()) as { warning?: string | null } | undefined;
      if (r?.warning) setNotice(r.warning);
      await reload();
      return true;
    } catch (e) {
      setError(errorText(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const addParty = () =>
    run(async () => {
      let partyId = link.partyId;
      if (!partyId) {
        const created = await conSend<Party>("POST", "/construction/parties", { kind: link.role, name: link.newName.trim(), phone: link.phone || undefined });
        setParties((x) => [...x, created]);
        partyId = created.id;
      }
      return conSend("POST", `/construction/projects/${p.id}/parties`, { partyId, role: link.role });
    }).then((ok) => ok && setLink({ ...link, partyId: "", newName: "", phone: "" }));

  const choices = parties.filter((x) => x.kind === link.role);

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}

      <Panel title="Client and consultants">
        <p className="text-sm"><span className="text-secondary-500">Client:</span> {p.client?.name ?? "not set"}</p>
        <ul className="mt-2 divide-y divide-border text-sm">
          {p.parties.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-medium">{l.party.name}</p>
                <p className="text-xs text-secondary-500">{PARTY_ROLES[l.role] ?? l.role}{l.party.contactPerson ? ` · ${l.party.contactPerson}` : ""}{l.party.phone ? ` · ${l.party.phone}` : ""}</p>
              </div>
              {canParties && <button type="button" className="text-xs text-red-700" onClick={() => run(() => conSend("DELETE", `/construction/projects/${p.id}/parties/${l.id}`))}>Remove</button>}
            </li>
          ))}
        </ul>
        {canParties && (
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <Field label="As">
              <select className={inputClass} value={link.role} onChange={(e) => setLink({ ...link, role: e.target.value, partyId: "" })}>
                {Object.entries(PARTY_ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Who">
              <select className={inputClass} value={link.partyId} onChange={(e) => setLink({ ...link, partyId: e.target.value })}>
                <option value="">New - type the name</option>
                {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {!link.partyId && <Field label="Name"><input className={inputClass} value={link.newName} onChange={(e) => setLink({ ...link, newName: e.target.value })} /></Field>}
            <div className="flex items-end">
              <PrimaryButton disabled={busy || (!link.partyId && link.newName.trim().length < 2)} onClick={addParty}>Add</PrimaryButton>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Our team on this project">
        {p.members.length === 0 && <p className="text-sm text-secondary-500">Nobody yet. Site staff only see projects they are on.</p>}
        <ul className="divide-y divide-border text-sm">
          {p.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-medium">{m.fullName}</p>
                <p className="text-xs text-secondary-500">{PROJECT_ROLES[m.role] ?? m.role}{m.ncaCard ? ` · NCA card ${m.ncaCard.cardNo}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                {m.role === "CON_SITE_SUPERVISOR" && m.ncaCard && <ExpiryBadge state={m.ncaCard.state} daysLeft={m.ncaCard.daysLeft} />}
                {canTeam && <button type="button" className="text-xs text-red-700" onClick={() => run(() => conSend("DELETE", `/construction/projects/${p.id}/members/${m.id}`))}>Remove</button>}
              </div>
            </li>
          ))}
        </ul>
        {canTeam && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Field label="Person">
              <select className={inputClass} value={member.orgUserId} onChange={(e) => setMember({ ...member, orgUserId: e.target.value })}>
                <option value="">Choose...</option>
                {people.map((x) => <option key={x.orgUserId} value={x.orgUserId}>{x.fullName}</option>)}
              </select>
            </Field>
            <Field label="Role">
              <select className={inputClass} value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value })}>
                {Object.entries(PROJECT_ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <div className="flex items-end">
              <PrimaryButton disabled={busy || !member.orgUserId} onClick={() => run(() => conSend("POST", `/construction/projects/${p.id}/members`, member))}>Add to team</PrimaryButton>
            </div>
          </div>
        )}
        {canTeam && <p className="mt-2 text-xs text-secondary-500">A Site Supervisor needs a valid NCA accreditation card, recorded under Staff & roles.</p>}
      </Panel>
    </div>
  );
}
