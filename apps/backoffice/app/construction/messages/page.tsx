"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import { CON_BRAND, errorText } from "../../../lib/construction";
import { ConShell } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../components/construction/ui";

interface Item {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  to: string[];
  project: { code: string; name: string } | null;
  createdAt: string;
  read: boolean;
  readBy: number;
}
interface Thread {
  threadId: string;
  subject: string;
  project: { code: string; name: string } | null;
  messages: { id: string; from: string; mine: boolean; to: { name: string; read: boolean }[]; body: string; createdAt: string }[];
}
interface Recipients {
  people: { orgUserId: string; fullName: string; roles: string[] }[];
  projects: { id: string; code: string; name: string }[];
}

const when = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const job = (roles: string[]) => roles.map((r) => r.replace(/^CON_/, "").replace(/_/g, " ").toLowerCase()).join(", ");

/** In-app messages between staff: inbox and sent, a conversation with reply-to-all, and a new message to people, a project team or everyone. */
export default function MessagesPage() {
  const [box, setBox] = useState<"inbox" | "sent">("inbox");
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<Thread | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await apiGet<{ messages: Item[] }>(`/construction/messages?box=${box}`)).messages);
      setError(null);
    } catch (e) {
      setError(errorText(e, "Could not load messages."));
    }
  }, [box]);
  useEffect(() => {
    void load();
  }, [load]);

  async function openThread(id: string) {
    setComposing(false);
    try {
      setOpen(await apiGet<Thread>(`/construction/messages/${id}`));
      window.dispatchEvent(new Event("con-messages-read"));
      void load();
    } catch (e) {
      setError(errorText(e, "Could not open the message."));
    }
  }

  return (
    <ConShell title="Messages">
      <div className="flex flex-wrap items-center gap-2">
        {(["inbox", "sent"] as const).map((b) => (
          <button key={b} onClick={() => { setBox(b); setOpen(null); }} className="rounded-full border px-3 py-1 text-sm" style={box === b ? { background: CON_BRAND.navy, color: "white", borderColor: CON_BRAND.navy } : undefined}>
            {b === "inbox" ? "Inbox" : "Sent"}
          </button>
        ))}
        <span className="ml-auto" />
        <PrimaryButton onClick={() => { setComposing(true); setOpen(null); }}>New message</PrimaryButton>
      </div>
      <ErrorBox message={error} />
      {composing && <Compose onDone={(threadId) => { setComposing(false); setBox("sent"); void openThread(threadId); }} onCancel={() => setComposing(false)} />}
      {open && <ThreadView thread={open} onReplied={() => void openThread(open.threadId)} onClose={() => setOpen(null)} />}
      <Panel>
        {items.length === 0 ? (
          <p className="text-sm text-secondary-500">{box === "inbox" ? "No messages yet." : "You have not sent any messages."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((m) => (
              <li key={m.id}>
                <button onClick={() => void openThread(m.id)} className="flex w-full items-start gap-3 py-2.5 text-left">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: m.read ? "transparent" : CON_BRAND.orange }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${m.read ? "" : "font-bold"}`}>{box === "inbox" ? m.from : `To ${m.to.slice(0, 3).join(", ")}${m.to.length > 3 ? ` +${m.to.length - 3}` : ""}`}</span>
                      <span className="text-xs text-secondary-500">{when(m.createdAt)}</span>
                    </span>
                    <span className={`block truncate text-sm ${m.read ? "" : "font-semibold"}`} style={{ color: "var(--con-ink)" }}>
                      {m.subject}
                      {m.project && <span className="ml-2 text-xs font-normal text-secondary-500">{m.project.code}</span>}
                    </span>
                    <span className="block truncate text-xs text-secondary-500">{m.snippet}</span>
                    {box === "sent" && <span className="block text-xs text-secondary-500">Read by {m.readBy} of {m.to.length}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </ConShell>
  );
}

function ThreadView({ thread, onReplied, onClose }: { thread: Thread; onReplied: () => void; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reply() {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/construction/messages", { replyTo: thread.threadId, body });
      setBody("");
      onReplied();
    } catch (e) {
      setError(errorText(e, "Could not send the reply."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={thread.subject} action={<button onClick={onClose} className="text-sm text-secondary-500">Close</button>}>
      {thread.project && <p className="text-xs text-secondary-500">Project {thread.project.code} {thread.project.name}</p>}
      <div className="space-y-3">
        {thread.messages.map((m) => (
          <div key={m.id} className={`rounded-lg border border-border p-3 text-sm ${m.mine ? "ml-6 bg-secondary-500/10" : "mr-6"}`}>
            <p className="text-xs text-secondary-500">
              <strong className="text-foreground">{m.mine ? "You" : m.from}</strong> to {m.to.map((t) => t.name).join(", ")} · {when(m.createdAt)}
              {m.mine && ` · read by ${m.to.filter((t) => t.read).length} of ${m.to.length}`}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>
      <ErrorBox message={error} />
      <Field label="Reply to everyone in this conversation">
        <textarea className={inputClass} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
      </Field>
      <PrimaryButton disabled={busy || !body.trim()} onClick={() => void reply()}>{busy ? "Sending..." : "Send reply"}</PrimaryButton>
    </Panel>
  );
}

function Compose({ onDone, onCancel }: { onDone: (threadId: string) => void; onCancel: () => void }) {
  const [options, setOptions] = useState<Recipients | null>(null);
  const [mode, setMode] = useState<"people" | "project" | "everyone">("people");
  const [to, setTo] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Recipients>("/construction/messages/recipients").then(setOptions).catch((e) => setError(errorText(e, "Could not load the staff list.")));
  }, []);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ threadId: string; recipients: number }>("/construction/messages", {
        subject,
        body,
        ...(mode === "people" ? { to } : mode === "project" ? { projectId } : { everyone: true }),
      });
      onDone(r.threadId);
    } catch (e) {
      setError(errorText(e, "Could not send the message."));
    } finally {
      setBusy(false);
    }
  }

  const people = (options?.people ?? []).filter((p) => !search.trim() || p.fullName.toLowerCase().includes(search.trim().toLowerCase()));
  const ready = subject.trim() && body.trim() && (mode === "everyone" || (mode === "people" ? to.length > 0 : !!projectId));
  return (
    <Panel title="New message" action={<button onClick={onCancel} className="text-sm text-secondary-500">Cancel</button>}>
      <div className="flex flex-wrap gap-2 text-sm">
        {([["people", "Choose people"], ["project", "A project team"], ["everyone", "Everyone"]] as const).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="radio" checked={mode === k} onChange={() => setMode(k)} /> {l}
          </label>
        ))}
      </div>
      {mode === "people" && (
        <div className="space-y-2">
          <input className={inputClass} placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {people.map((p) => (
              <label key={p.orgUserId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={to.includes(p.orgUserId)} onChange={(e) => setTo(e.target.checked ? [...to, p.orgUserId] : to.filter((x) => x !== p.orgUserId))} />
                {p.fullName}
                {p.roles.length > 0 && <span className="text-xs text-secondary-500">{job(p.roles)}</span>}
              </label>
            ))}
            {people.length === 0 && <p className="text-xs text-secondary-500">Nobody found.</p>}
          </div>
          {to.length > 0 && <p className="text-xs text-secondary-500">{to.length} chosen</p>}
        </div>
      )}
      {mode === "project" && (
        <Field label="Everyone on this project">
          <select className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project...</option>
            {options?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </select>
        </Field>
      )}
      {mode === "everyone" && <p className="text-sm text-secondary-500">Everyone in the company gets it.</p>}
      <Field label="Subject"><input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} /></Field>
      <Field label="Message"><textarea className={inputClass} rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
      <ErrorBox message={error} />
      <PrimaryButton disabled={busy || !ready} onClick={() => void send()}>{busy ? "Sending..." : "Send"}</PrimaryButton>
    </Panel>
  );
}
