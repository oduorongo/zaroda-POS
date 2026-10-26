// Tax withheld by schools: whether its certificate has come, and what was withheld in all. Plain functions, tested without a database.

import { daysBetween, fromCents, toCents } from './school-money.util';

/** How long a school gets to send the certificate before it is chased. */
export const CERTIFICATE_GRACE_DAYS = 30;

export type CertificateState = 'RECEIVED' | 'WAITING' | 'MISSING';

/** The certificate has come, is still expected, or is overdue (more than 30 days after the tax was withheld). */
export function certificateStatus(
  certificateNumber: string | null,
  withheldOn: string,
  today: string,
): CertificateState {
  if (certificateNumber && certificateNumber.trim()) return 'RECEIVED';
  return daysBetween(withheldOn, today) > CERTIFICATE_GRACE_DAYS
    ? 'MISSING'
    : 'WAITING';
}

export interface WithheldRow {
  schoolId: string;
  schoolName: string;
  amount: number;
  hasCertificate: boolean;
}

/** What was withheld in all, how much of it has its certificate, and the same by school (the most first). */
export function withheldTotals(rows: WithheldRow[]) {
  let total = 0;
  let covered = 0;
  const bySchool = new Map<
    string,
    {
      schoolId: string;
      schoolName: string;
      withheld: number;
      withoutCertificate: number;
    }
  >();
  for (const r of rows) {
    const cents = toCents(r.amount);
    total += cents;
    if (r.hasCertificate) covered += cents;
    const s = bySchool.get(r.schoolId) ?? {
      schoolId: r.schoolId,
      schoolName: r.schoolName,
      withheld: 0,
      withoutCertificate: 0,
    };
    s.withheld += cents;
    if (!r.hasCertificate) s.withoutCertificate += cents;
    bySchool.set(r.schoolId, s);
  }
  return {
    withheld: fromCents(total),
    withCertificate: fromCents(covered),
    withoutCertificate: fromCents(total - covered),
    bySchool: [...bySchool.values()]
      .map((s) => ({
        schoolId: s.schoolId,
        schoolName: s.schoolName,
        withheld: fromCents(s.withheld),
        withoutCertificate: fromCents(s.withoutCertificate),
      }))
      .sort((a, b) => b.withheld - a.withheld),
  };
}
