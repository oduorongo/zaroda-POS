// The "ring" for in-app alerts. Made with the Web Audio API so there is no sound file to download or lose, and it works
// offline. Browsers only let a page make sound after the person has touched it once, so the first tap or key press anywhere
// unlocks it (see ActivityAlerts); until then alerts still pop up (and the phone vibrates where it can), just silently.

type AudioCtor = typeof AudioContext;

let context: AudioContext | null = null;

function create(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/** Call from a tap or key press. Returns true once sound is allowed. */
export function unlockAudio(): boolean {
  const ctx = create();
  if (!ctx) return false;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx.state === "running";
}

export function audioUnlocked(): boolean {
  return context?.state === "running";
}

/** A two-note doorbell, three times, then a short buzz on phones that can. Quietly does nothing if sound is not allowed yet. */
export function ring(): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([200, 100, 200, 100, 200]);
  } catch {
    /* some browsers refuse; the sound and the pop-up still happen */
  }
  const ctx = create();
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime + 0.02;
  for (let pulse = 0; pulse < 3; pulse++) {
    [880, 1174.66].forEach((frequency, note) => {
      const at = start + pulse * 1.0 + note * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.55);
    });
  }
}
