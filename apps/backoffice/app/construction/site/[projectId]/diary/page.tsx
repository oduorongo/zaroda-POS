"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { apiGet } from "../../../../../lib/api";
import { CON_BRAND, conSend, errorText, isDirector } from "../../../../../lib/construction";
import { addDays, photoUrl, todayEat, uploadSitePhoto } from "../../../../../lib/con-site";
import { ConShell, useConMe } from "../../../../../components/construction/con-shell";
import { ErrorBox, Field, inputClass } from "../../../../../components/construction/ui";

interface Photo { id: string; caption: string | null; takenAt: string; lat: number | null; lng: number | null }
interface Diary { id: string | null; date: string; weather: string | null; worksDone: string | null; delays: string | null; visitors: string | null; plantOnSite: string | null; labourCount: number | null; labourFromMuster: number; status: "DRAFT" | "SUBMITTED" | "APPROVED"; photos: Photo[] }

const WEATHER = ["Sunny", "Cloudy", "Light rain", "Heavy rain", "Windy"];

export default function DiaryPage() {
  return (
    <ConShell title="Site diary">
      <DiaryScreen />
    </ConShell>
  );
}

function DiaryScreen() {
  const { projectId } = useParams<{ projectId: string }>();
  const me = useConMe();
  const role = (r: string) => isDirector(me) || !!me?.projectRoles.some((x) => x.projectId === projectId && x.role === r);
  const canWrite = role("CON_PROJECT_MGR") || role("CON_SITE_ENGINEER") || role("CON_SITE_SUPERVISOR");
  const canApprove = role("CON_PROJECT_MGR");
  const [date, setDate] = useState(todayEat());
  const [diary, setDiary] = useState<Diary | null>(null);
  const [f, setF] = useState({ weather: "", worksDone: "", delays: "", visitors: "", plantOnSite: "", labourCount: "" });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<Diary>(`/construction/projects/${projectId}/diaries/${date}`);
      setDiary(d);
      setF({ weather: d.weather ?? "", worksDone: d.worksDone ?? "", delays: d.delays ?? "", visitors: d.visitors ?? "", plantOnSite: d.plantOnSite ?? "", labourCount: d.labourCount === null ? "" : String(d.labourCount) });
      setError(null);
    } catch (e) {
      setError(errorText(e, "Could not load the diary."));
    }
  }, [projectId, date]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    for (const p of diary?.photos ?? []) {
      if (urls[p.id]) continue;
      photoUrl(projectId, p.id).then((u) => !cancelled && setUrls((x) => ({ ...x, [p.id]: u }))).catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [diary, projectId, urls]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(errorText(e, "That did not work - check your signal and try again."));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(
      () => conSend("PUT", `/construction/projects/${projectId}/diaries/${date}`, { weather: f.weather || undefined, worksDone: f.worksDone || undefined, delays: f.delays || undefined, visitors: f.visitors || undefined, plantOnSite: f.plantOnSite || undefined, labourCount: f.labourCount === "" ? undefined : Number(f.labourCount) }),
      "Diary saved.",
    );

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    void run(() => uploadSitePhoto(projectId, file, caption), "Photo added.").then(() => setCaption(""));
  };

  const locked = diary?.status === "APPROVED";
  const editable = canWrite && !locked;
  const isToday = date === todayEat();

  return (
    <div className="space-y-3">
      <Link href="/construction/site" className="text-sm" style={{ color: CON_BRAND.orange }}>← Site</Link>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="rounded-xl border border-border px-4 py-3 text-lg" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
        <div className="text-center">
          <p className="text-lg font-bold">{isToday ? "Today" : date}</p>
          <p className="text-xs font-semibold" style={{ color: locked ? "#16a34a" : diary?.status === "SUBMITTED" ? "#2563eb" : CON_BRAND.orange }}>{diary?.status === "APPROVED" ? "Approved - locked" : diary?.status === "SUBMITTED" ? "Submitted" : "Draft"}</p>
        </div>
        <button type="button" className="rounded-xl border border-border px-4 py-3 text-lg disabled:opacity-30" disabled={isToday} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
      </div>
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {editable && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (onPhoto(e.target.files?.[0]), (e.target.value = ""))} />
          <input className={inputClass} value={caption} placeholder="What does the photo show? (optional)" onChange={(e) => setCaption(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => camera.current?.click()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold text-white disabled:opacity-50" style={{ background: CON_BRAND.orange }}>
            <Camera size={22} /> {busy ? "Uploading..." : "Take a photo"}
          </button>
          <p className="mt-1 text-center text-[11px] text-secondary-500">The photo is tagged with where you are, if location is allowed.</p>
        </div>
      )}

      {diary && diary.photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {diary.photos.map((p) => (
            <figure key={p.id} className="relative overflow-hidden rounded-lg bg-background">
              {urls[p.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[p.id]} alt={p.caption ?? "Site photo"} className="aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square w-full animate-pulse" />
              )}
              <figcaption className="truncate px-1 py-0.5 text-[10px] text-secondary-600">
                {new Date(p.takenAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}{p.lat !== null ? " · 📍" : ""} {p.caption ?? ""}
              </figcaption>
              {editable && <button type="button" className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white" onClick={() => window.confirm("Remove this photo?") && run(() => conSend("DELETE", `/construction/projects/${projectId}/photos/${p.id}`), "Photo removed.")}>x</button>}
            </figure>
          ))}
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
        <div>
          <span className="mb-1 block text-sm font-medium text-secondary-600">Weather</span>
          <div className="flex flex-wrap gap-2">
            {WEATHER.map((w) => (
              <button key={w} type="button" disabled={!editable} onClick={() => setF({ ...f, weather: w })} className="rounded-full border px-4 py-2 text-sm" style={f.weather === w ? { background: CON_BRAND.navy, color: "white", borderColor: CON_BRAND.navy } : undefined}>
                {w}
              </button>
            ))}
          </div>
        </div>
        <Field label="Works done today"><textarea className={`${inputClass} min-h-[110px] text-base`} disabled={!editable} value={f.worksDone} onChange={(e) => setF({ ...f, worksDone: e.target.value })} /></Field>
        <Field label="Delays (rain, materials, labour...)"><textarea className={`${inputClass} min-h-[60px] text-base`} disabled={!editable} value={f.delays} onChange={(e) => setF({ ...f, delays: e.target.value })} /></Field>
        <Field label="Visitors"><input className={`${inputClass} text-base`} disabled={!editable} value={f.visitors} onChange={(e) => setF({ ...f, visitors: e.target.value })} /></Field>
        <Field label="Plant on site"><input className={`${inputClass} text-base`} disabled={!editable} value={f.plantOnSite} onChange={(e) => setF({ ...f, plantOnSite: e.target.value })} /></Field>
        <Field label={`Labour on site (muster says ${diary?.labourFromMuster ?? 0})`}><input className={`${inputClass} text-base`} inputMode="numeric" disabled={!editable} value={f.labourCount} onChange={(e) => setF({ ...f, labourCount: e.target.value.replace(/\D/g, "") })} /></Field>
        {editable && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={save} className="rounded-xl py-3 text-base font-bold text-white disabled:opacity-50" style={{ background: CON_BRAND.navy }}>Save</button>
            {diary?.status === "DRAFT" && <button type="button" disabled={busy || !diary.id} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/diaries/${date}/submit`), "Submitted to the Project Manager.")} className="rounded-xl border-2 py-3 text-base font-bold disabled:opacity-50" style={{ borderColor: CON_BRAND.navy, color: "var(--con-ink)" }}>Submit</button>}
          </div>
        )}
        {canApprove && !locked && diary?.id && (
          <button type="button" disabled={busy} onClick={() => window.confirm("Approve and lock this diary?") && run(() => conSend("POST", `/construction/projects/${projectId}/diaries/${date}/approve`), "Diary approved.")} className="w-full rounded-xl py-3 text-base font-bold text-white disabled:opacity-50" style={{ background: "#16a34a" }}>
            Approve and lock
          </button>
        )}
      </div>
    </div>
  );
}
