import { ConDocType, ConWorksClass } from '@prisma/client';

export type ExpiryState = 'OK' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';
export const ALERT_DAYS = [60, 30, 7] as const;
export const REQUIRED_DOCS: ConDocType[] = ['NCA_CERT', 'NCA_LICENCE', 'KRA_TCC', 'BUSINESS_PERMIT', 'WIBA'];

export const DOC_LABELS: Record<ConDocType, string> = {
  NCA_CERT: 'NCA registration certificate',
  NCA_LICENCE: 'NCA practising licence',
  KRA_TCC: 'KRA tax compliance certificate',
  BUSINESS_PERMIT: 'County business permit',
  AGPO: 'AGPO certificate',
  INSURANCE_CAR: "Contractor's all risks insurance",
  INSURANCE_PL: 'Public liability insurance',
  WIBA: 'WIBA insurance',
  EPRA_LICENCE: 'EPRA electrical contractor licence',
  OTHER: 'Other document',
};

export const WORKS_CLASS_LABELS: Record<ConWorksClass, string> = {
  BUILDING: 'Building works',
  ROADS_CIVIL: 'Roads & civil works',
  ELEC_MECH: 'Electrical & mechanical',
};

const DAY = 86_400_000;
const at = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** Whole days from today to the expiry date (negative once expired). Both are YYYY-MM-DD. */
export const daysLeft = (expires: string, today: string) => Math.round((at(expires) - at(today)) / DAY);

/** Green when more than 60 days are left, amber within 60, red once expired (the expiry day itself still counts as valid). */
export function expiryState(expires: string | null, today: string): ExpiryState {
  if (!expires) return 'NO_EXPIRY';
  const left = daysLeft(expires, today);
  if (left < 0) return 'EXPIRED';
  return left <= ALERT_DAYS[0] ? 'EXPIRING' : 'OK';
}

/** Which alert is due: 60, 30 or 7 days before, or 0 once expired. null = none yet. */
export function alertStage(expires: string | null, today: string): number | null {
  if (!expires) return null;
  const left = daysLeft(expires, today);
  if (left < 0) return 0;
  for (const d of [...ALERT_DAYS].reverse()) if (left <= d) return d;
  return null;
}

export const alertKey = (kind: string, id: string, expires: string, stage: number) => `${kind}:${id}:${expires}:${stage}`;

export function alertText(name: string, expires: string, stage: number): { title: string; body: string } {
  if (stage === 0) return { title: `${name} has expired`, body: `${name} expired on ${expires}. Renew it and upload the new copy.` };
  return { title: `${name} expires in ${stage} days`, body: `${name} expires on ${expires}. Start the renewal now.` };
}

export type Health = 'GOOD' | 'ATTENTION' | 'CRITICAL';

export function complianceHealth(states: ExpiryState[], missing: number): Health {
  if (states.includes('EXPIRED')) return 'CRITICAL';
  if (missing > 0 || states.includes('EXPIRING')) return 'ATTENTION';
  return 'GOOD';
}

/** Blocks work above the firm's NCA category cap for that works class. cap null = unlimited. */
export function capCheck(value: number, cap: number | null, category: number | null, worksClass: ConWorksClass): { ok: boolean; reason?: string } {
  const label = WORKS_CLASS_LABELS[worksClass];
  if (category === null) return { ok: false, reason: `You have no NCA registration for ${label}. Add it in the compliance vault first.` };
  if (cap === null || value <= cap) return { ok: true };
  return {
    ok: false,
    reason: `KES ${value.toLocaleString('en-KE')} is above the NCA${category} cap for ${label} (KES ${cap.toLocaleString('en-KE')}). Only a Director can override this, with a reason.`,
  };
}

export const todayKey = (now: Date = new Date()) => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

/** EPRA electrical contractor licence classes. What each allows on a line is a company setting (con_epra_classes), seeded here: A1 any voltage, the rest unset until confirmed with EPRA. */
export const EPRA_CLASSES: { code: string; label: string; anyVoltage: boolean }[] = [
  { code: 'A1', label: 'Class A1 (high voltage installations)', anyVoltage: true },
  { code: 'A2', label: 'Class A2', anyVoltage: false },
  { code: 'B', label: 'Class B', anyVoltage: false },
  { code: 'C1', label: 'Class C1', anyVoltage: false },
  { code: 'C2', label: 'Class C2', anyVoltage: false },
];

/** Whether the company's valid EPRA licences cover a line of this voltage (docs/construction/07 s1). */
export function epraCheck(voltageKv: number, licences: { epraClass: string | null; expiresAt: string | null }[], classes: { code: string; anyVoltage: boolean; maxVoltageKv: number | null }[], today: string): { ok: boolean; reason?: string } {
  const valid = licences.filter((l) => l.epraClass && (!l.expiresAt || l.expiresAt >= today));
  if (valid.length === 0) return { ok: false, reason: `A ${voltageKv} kV line needs a valid EPRA electrical contractor licence. Add it in the compliance vault first.` };
  const covers = valid.some((l) => {
    const c = classes.find((x) => x.code === l.epraClass);
    return !!c && (c.anyVoltage || (c.maxVoltageKv !== null && c.maxVoltageKv >= voltageKv));
  });
  if (covers) return { ok: true };
  const held = [...new Set(valid.map((l) => l.epraClass))].join(', ');
  return { ok: false, reason: `Your EPRA licence (class ${held}) does not cover a ${voltageKv} kV line. Check the class limits under Compliance, EPRA classes.` };
}
