"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Answer {
  id?: string;
  question?: string | null;
  answer: string;
  createdAt: string;
}
interface Overview {
  available: boolean;
  problem: string | null;
  weekly: Answer | null;
  nextWeeklyAt: string | null;
  questions: Answer[];
  questionsLeft: number;
  questionsPerDay: number;
}

const EXAMPLES = ["What should I reorder this week?", "Which products are not worth stocking?", "When should I have more staff on?"];

/** Shows Claude's text: paragraphs, "- " bullets and **bold**, nothing else. */
function Written({ text }: { text: string }) {
  const bold = (line: string) =>
    line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part.replace(/^#+\s*/, "")}</Fragment>));
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split("\n").filter((l) => l.trim()).map((line, i) =>
        /^\s*[-*•]\s+/.test(line) ? (
          <p key={i} className="pl-4 -indent-3">• {bold(line.replace(/^\s*[-*•]\s+/, ""))}</p>
        ) : (
          <p key={i}>{bold(line)}</p>
        ),
      )}
    </div>
  );
}

/** The AI Business Analyser: this week's written summary and an "ask about my business" box. */
export default function InsightsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<"weekly" | "ask" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Overview>("/ai"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this.");
    }
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function run(kind: "weekly" | "ask", fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (kind === "ask") setQuestion("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!session) return null;
  const canUse = session.role === "OWNER" || session.role === "MANAGER";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <h1 className="text-xl font-bold">AI Business Analyser</h1>
        <p className="text-sm text-secondary-500">
          Reads your own sales, stock and spending and tells you, in plain words, what is going well and what to do next. Only totals and product names are used, never your customers&apos; details.
        </p>

        {!canUse && <p className="rounded-md border border-border p-3 text-sm">Only the owner or a manager can use the analyser.</p>}
        {data?.problem && <p className="rounded-md border border-accent-500/50 bg-accent-500/10 p-3 text-sm">{data.problem}</p>}
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        {data && canUse && (
          <>
            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">This week&apos;s summary</h2>
                {data.available && !data.nextWeeklyAt && (
                  <button disabled={busy !== null} onClick={() => void run("weekly", () => apiPost("/ai/weekly", {}))} className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                    {busy === "weekly" ? "Writing… (up to a minute)" : data.weekly ? "Write this week's summary" : "Write my first summary"}
                  </button>
                )}
              </div>
              {data.weekly ? (
                <>
                  <p className="text-xs text-secondary-500">
                    Written {new Date(data.weekly.createdAt).toLocaleString()}
                    {data.nextWeeklyAt && ` · next one from ${new Date(data.nextWeeklyAt).toLocaleDateString()}`}
                  </p>
                  <Written text={data.weekly.answer} />
                </>
              ) : (
                <p className="text-sm text-secondary-500">No summary yet.</p>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Ask about your business</h2>
                <span className="text-xs text-secondary-500">{data.questionsLeft} of {data.questionsPerDay} questions left today</span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (question.trim().length >= 3) void run("ask", () => apiPost("/ai/ask", { question }));
                }}
                className="space-y-2"
              >
                <textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} rows={2} placeholder="e.g. Which branch did best this week?" className="w-full rounded-md border border-border bg-background p-2 text-sm" />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="submit" disabled={!data.available || busy !== null || data.questionsLeft === 0 || question.trim().length < 3} className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                    {busy === "ask" ? "Thinking…" : "Ask"}
                  </button>
                  {EXAMPLES.map((q) => (
                    <button key={q} type="button" onClick={() => setQuestion(q)} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-secondary-500/10">
                      {q}
                    </button>
                  ))}
                </div>
              </form>
              <ul className="space-y-3">
                {data.questions.map((q) => (
                  <li key={q.id} className="space-y-1 border-t border-border pt-3">
                    <p className="text-sm font-semibold">{q.question}</p>
                    <Written text={q.answer} />
                    <p className="text-xs text-secondary-500">{new Date(q.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
