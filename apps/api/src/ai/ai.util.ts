// The AI Business Analyser's rules: who may use it, how much, and what Claude is told. Plain functions, tested without a database.
import { effectiveStatus } from '../platform-admin/subscriptions.util';

export const QUESTIONS_PER_DAY = 10;
export const WEEKLY_EVERY_DAYS = 7;
export const QUESTION_MAX = 500;

/** Why a business cannot use the analyser, or null. Only paying businesses (not on trial, not suspended) get it. */
export function accessProblem(
  sub: { currentPeriodEnd: Date; graceDays: number; isTrial: boolean; manuallySuspended: boolean; plan?: { billingCycle: string; priceKes?: unknown } | null } | null,
  now = new Date(),
): string | null {
  if (!sub || (sub.plan?.priceKes != null && Number(sub.plan.priceKes) === 0)) return 'The AI Business Analyser comes with a paid Zaroda plan.';
  const s = effectiveStatus(sub, now);
  if (s === 'TRIAL') return 'The AI Business Analyser comes with a paid plan. Pay for your plan to switch it on.';
  if (s !== 'ACTIVE' && s !== 'GRACE') return 'Your plan needs paying before the AI Business Analyser can be used.';
  return null;
}

/** When the next weekly summary may be made, or null if one may be made now. */
export function nextWeeklyAt(lastWeekly: Date | null, now = new Date()): Date | null {
  if (!lastWeekly) return null;
  const next = new Date(lastWeekly.getTime() + WEEKLY_EVERY_DAYS * 86400000);
  return next > now ? next : null;
}

export const SYSTEM_PROMPT = `You are the business analyst inside Zaroda POS, a point-of-sale system used by shops, restaurants, hotels, pharmacies and other businesses in Kenya. You read a summary of one business's own figures and help its owner run it better.

How to answer:
- Use only the figures in the business summary. If something is not in it, say you cannot see it rather than guessing.
- Money is Kenyan shillings: write "KES 12,500".
- Write for a busy owner reading on a phone: short paragraphs or short bullet points, plain English, no jargon, no tables.
- Be specific: name the products, days, hours and branches, and give the numbers.
- End with what to do: two to four concrete actions (reorder X, run a discount on Y, put more staff on at Z).
- Never invent customers, staff or suppliers that are not in the summary.`;

export const WEEKLY_INSTRUCTION = `Write this week's business summary. Cover, in this order and only where the figures show something worth saying: how sales went this week against last week (and which days were strong or weak); the best sellers and anything that is earning little; stock that is not selling and how much money is tied up in it; items running low; the busiest hours; spending; then the actions to take this week. Keep it under 350 words. Start with a one-line headline.`;

/** The figures block sent to Claude: stable key order so the same day's questions reuse the cached prompt. */
export const snapshotText = (snapshot: unknown): string =>
  `<business_summary>\n${JSON.stringify(snapshot, null, 1)}\n</business_summary>`;

export function cleanQuestion(raw: unknown): string | null {
  const q = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return q.length >= 3 ? q.slice(0, QUESTION_MAX) : null;
}
