import { r2 } from '../commercial/valuation.util';

/** Statutory rates as read from con_tax_settings (percent rates; monthly amounts). A setting that is switched off is simply absent. */
export interface PayrollRates {
  nssf?: { rate: number; ceiling: number | null };
  shif?: { rate: number; minimum: number | null };
  housingLevy?: { rate: number };
  payeBands: { rate: number; upTo: number | null }[];
  personalRelief: number;
}

export interface CasualDeductions {
  nssf: number;
  shif: number;
  housingLevy: number;
  paye: number;
  deductions: number;
  net: number;
}

const PAYE_KEYS = ['PAYE_BAND_1', 'PAYE_BAND_2', 'PAYE_BAND_3', 'PAYE_BAND_4', 'PAYE_BAND_5'];
export const PAYROLL_KEYS = ['NSSF', 'SHIF', 'HOUSING_LEVY', 'PERSONAL_RELIEF', ...PAYE_KEYS];

/** Builds the rates from the settings in force: key -> { rate, threshold }. */
export function payrollRates(settings: Map<string, { rate: number; threshold: number | null }>): PayrollRates {
  const nssf = settings.get('NSSF');
  const shif = settings.get('SHIF');
  const housing = settings.get('HOUSING_LEVY');
  const bands = PAYE_KEYS.map((k) => settings.get(k)).filter((b): b is { rate: number; threshold: number | null } => !!b).map((b) => ({ rate: b.rate, upTo: b.threshold }));
  return {
    nssf: nssf && { rate: nssf.rate, ceiling: nssf.threshold },
    shif: shif && { rate: shif.rate, minimum: shif.threshold },
    housingLevy: housing && { rate: housing.rate },
    payeBands: bands.sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity)),
    personalRelief: settings.get('PERSONAL_RELIEF')?.threshold ?? 0,
  };
}

export const periodDays = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Deductions on a casual's pay for one pay period. The settings hold monthly amounts (NSSF ceiling, SHIF minimum, PAYE bands,
 * personal relief), so they are scaled to the period (days / 30). NSSF, SHIF and the Housing Levy come off before PAYE.
 * Deductions never exceed the pay.
 */
export function casualDeductions(gross: number, days: number, r: PayrollRates): CasualDeductions {
  const f = days / 30;
  const nssf = r.nssf ? r2((Math.min(gross, r.nssf.ceiling === null ? gross : r.nssf.ceiling * f) * r.nssf.rate) / 100) : 0;
  const shif = r.shif ? r2(Math.max((gross * r.shif.rate) / 100, (r.shif.minimum ?? 0) * f)) : 0;
  const housingLevy = r.housingLevy ? r2((gross * r.housingLevy.rate) / 100) : 0;
  let taxable = Math.max(0, gross - nssf - shif - housingLevy);
  let tax = 0;
  let lower = 0;
  for (const band of r.payeBands) {
    const top = band.upTo === null ? Infinity : band.upTo * f;
    const slice = Math.min(taxable, top - lower);
    if (slice <= 0) break;
    tax += (slice * band.rate) / 100;
    taxable -= slice;
    lower = top;
  }
  const paye = r2(Math.max(0, tax - r.personalRelief * f));
  const deductions = r2(Math.min(gross, nssf + shif + housingLevy + paye));
  return { nssf, shif, housingLevy, paye, deductions, net: r2(gross - deductions) };
}

/** M-Pesa wants 2547XXXXXXXX / 2541XXXXXXXX. */
export function mpesaPhone(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  const m = /^(?:254|0)?([17]\d{8})$/.exec(d);
  return m ? `254${m[1]}` : null;
}

export function payslipText(i: { company: string; worker: string; from: string; to: string; days: number; rate: number; gross: number; d: CasualDeductions; method: string; reference: string | null }) {
  const parts = [i.d.nssf && `NSSF ${i.d.nssf}`, i.d.shif && `SHIF ${i.d.shif}`, i.d.housingLevy && `Housing ${i.d.housingLevy}`, i.d.paye && `PAYE ${i.d.paye}`].filter(Boolean).join(', ');
  return `${i.company}: pay for ${i.worker}, ${i.from} to ${i.to}. ${i.days} days x ${i.rate} = KES ${i.gross}.${parts ? ` Less ${parts}.` : ''} Net KES ${i.d.net} paid by ${i.method}${i.reference ? ` (${i.reference})` : ''}.`;
}
