import { ConIncidentSeverity, ConMusterStatus } from '@prisma/client';

/** "12345678" -> "****5678". Personal data (Data Protection Act 2019): lists never show the whole number. */
export function maskId(idNo: string | null): string | null {
  if (!idNo) return null;
  const s = idNo.replace(/\s+/g, '');
  return s.length <= 4 ? '*'.repeat(s.length) : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}

/** "0712345678" -> "0712***678". */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const s = phone.replace(/\s+/g, '');
  return s.length < 7 ? '*'.repeat(s.length) : `${s.slice(0, 4)}${'*'.repeat(s.length - 7)}${s.slice(-3)}`;
}

const HOUR = 3_600_000;

/** OSHA 2007 s.21: a fatal accident is reported to DOSHS within 24 hours, one that keeps a worker off work within 7 days. */
export function doshsDueAt(severity: ConIncidentSeverity, occurredAt: Date): Date | null {
  if (severity === 'FATAL') return new Date(occurredAt.getTime() + 24 * HOUR);
  if (severity === 'LOST_TIME') return new Date(occurredAt.getTime() + 7 * 24 * HOUR);
  return null;
}

export const needsDoshs = (severity: ConIncidentSeverity) => severity === 'FATAL' || severity === 'LOST_TIME';

export const dayValue = (status: ConMusterStatus) => (status === 'PRESENT' ? 1 : status === 'HALF' ? 0.5 : 0);

export function musterTotals(statuses: ConMusterStatus[]) {
  return {
    present: statuses.filter((s) => s === 'PRESENT').length,
    half: statuses.filter((s) => s === 'HALF').length,
    absent: statuses.filter((s) => s === 'ABSENT').length,
    days: statuses.reduce((a, s) => a + dayValue(s), 0),
  };
}

/** Kenyan national ID (7-8 digits) or passport (letters and digits). */
export const validIdNo = (s: string) => /^(\d{6,9}|[A-Z]{1,2}\d{6,8})$/i.test(s.replace(/\s+/g, ''));

export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
