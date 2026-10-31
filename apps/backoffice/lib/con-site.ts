"use client";

import { ApiError } from "./api";
import { getSession } from "./auth";
import { shrinkPhoto } from "./resize-image";

export type MusterStatus = "PRESENT" | "HALF" | "ABSENT";
export interface QueuedMark { projectId: string; date: string; workerId: string; status: MusterStatus; clientRef: string }

const QUEUE_KEY = "con-muster-queue";
const SHEET_KEY = (projectId: string, date: string) => `con-muster-sheet:${projectId}:${date}`;

/** East Africa Time date, YYYY-MM-DD. */
export const todayEat = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the marks still go out while online */
  }
};

export const queuedMarks = (): QueuedMark[] => read<QueuedMark[]>(QUEUE_KEY, []);

/** Keeps the latest mark per worker per day; older ones for the same worker and day are replaced. */
export function queueMarks(marks: QueuedMark[]) {
  const keep = queuedMarks().filter((q) => !marks.some((m) => m.projectId === q.projectId && m.date === q.date && m.workerId === q.workerId));
  write(QUEUE_KEY, [...keep, ...marks]);
}

export const cacheSheet = (projectId: string, date: string, sheet: unknown) => write(SHEET_KEY(projectId, date), sheet);
export const cachedSheet = <T>(projectId: string, date: string): T | null => read<T | null>(SHEET_KEY(projectId, date), null);

async function authed(path: string, init: RequestInit = {}) {
  const s = getSession();
  if (!s) throw new ApiError("Not logged in", 401);
  return fetch(`${s.apiBaseUrl.replace(/\/+$/, "")}${path}`, { ...init, headers: { Authorization: `Bearer ${s.accessToken}`, ...init.headers } });
}

/**
 * Sends every waiting mark, one request per project and day. A mark the server refuses (4xx) is dropped with its message;
 * no signal or a server hiccup keeps it waiting for the next try. Returns what is still waiting.
 */
export async function flushMarks(): Promise<{ waiting: number; refused: string[] }> {
  const all = queuedMarks();
  const groups = new Map<string, QueuedMark[]>();
  for (const m of all) groups.set(`${m.projectId}|${m.date}`, [...(groups.get(`${m.projectId}|${m.date}`) ?? []), m]);
  const refused: string[] = [];
  let left = [...all];
  for (const [key, marks] of Array.from(groups.entries())) {
    const [projectId, date] = key.split("|");
    try {
      const res = await authed(`/construction/projects/${projectId}/muster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, entries: marks.map(({ workerId, status, clientRef }) => ({ workerId, status, clientRef })) }),
      });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429)) {
        if (!res.ok) refused.push(String(((await res.json().catch(() => ({}))) as { message?: string }).message ?? `Refused (${res.status})`));
        left = left.filter((q) => !marks.includes(q));
      }
    } catch {
      /* offline - try again later */
    }
  }
  write(QUEUE_KEY, left);
  return { waiting: left.length, refused };
}

/** Shrinks the photo, adds where it was taken (if the phone allows), and uploads it. */
export async function uploadSitePhoto(projectId: string, file: File, caption: string): Promise<void> {
  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 });
  });
  const photo = await shrinkPhoto(file);
  const q = new URLSearchParams({ takenAt: new Date(file.lastModified || Date.now()).toISOString(), ...(caption.trim() ? { caption: caption.trim() } : {}) });
  if (position) {
    q.set("lat", position.coords.latitude.toFixed(6));
    q.set("lng", position.coords.longitude.toFixed(6));
  }
  const res = await authed(`/construction/projects/${projectId}/photos?${q}`, { method: "POST", headers: { "Content-Type": photo.type || "image/jpeg" }, body: photo });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(json.message ?? `Upload failed (${res.status})`, res.status);
  }
}

/** Private photos come through the API with the sign-in token; returns an object URL for an <img>. */
export async function photoUrl(projectId: string, photoId: string): Promise<string> {
  const res = await authed(`/construction/projects/${projectId}/photos/${photoId}/file`);
  if (!res.ok) throw new ApiError("Could not load the photo", res.status);
  return URL.createObjectURL(await res.blob());
}
