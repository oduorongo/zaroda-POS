/** All money is rounded to the cent. Amounts are KES excluding VAT unless named otherwise. */
export const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BqLineInput { qtyToDate: number; rate: number; qty: number }
export interface VariationLineInput { amountToDate: number; approvedAmount: number }

export interface ValuationInput {
  bq: BqLineInput[];
  variations: VariationLineInput[];
  materialsOnSite: number;
  retentionRate: number;
  retentionLimitPercent: number;
  contractSum: number;
  retentionReleasedToDate: number;
  advanceRecoveryToDate: number;
  previousCertified: number;
}

export interface ValuationResult {
  workToDate: number;
  variationsToDate: number;
  materialsOnSite: number;
  grossToDate: number;
  retentionCap: number;
  retentionDeducted: number;
  retentionReleased: number;
  retentionHeld: number;
  advanceRecovery: number;
  netCumulative: number;
  previousCertified: number;
  netDue: number;
  warnings: string[];
}

/**
 * A cumulative interim valuation (JBC / FIDIC practice):
 *  gross   = BQ work to date (qty x rate) + approved variations done to date + materials on site
 *  retention deducted = gross x rate, capped at limit% of the contract sum; held = deducted - released so far
 *  net cumulative = gross - retention held - advance recovered to date
 *  net due on this certificate = net cumulative - everything certified before
 */
export function valuation(i: ValuationInput): ValuationResult {
  const warnings: string[] = [];
  let workToDate = 0;
  i.bq.forEach((l, n) => {
    if (l.qtyToDate < 0) throw new Error(`BQ line ${n + 1}: quantity to date cannot be negative.`);
    if (l.qtyToDate > l.qty) warnings.push(`BQ line ${n + 1}: measured ${l.qtyToDate} is more than the BQ quantity ${l.qty}.`);
    workToDate += l.qtyToDate * l.rate;
  });
  let variationsToDate = 0;
  i.variations.forEach((v, n) => {
    if (Math.abs(v.amountToDate) > Math.abs(v.approvedAmount) + 0.005) throw new Error(`Variation ${n + 1}: ${v.amountToDate} is more than its approved amount ${v.approvedAmount}.`);
    variationsToDate += v.amountToDate;
  });
  if (i.materialsOnSite < 0) throw new Error('Materials on site cannot be negative.');
  if (i.advanceRecoveryToDate < 0) throw new Error('Advance recovery cannot be negative.');
  workToDate = r2(workToDate);
  variationsToDate = r2(variationsToDate);
  const grossToDate = r2(workToDate + variationsToDate + i.materialsOnSite);
  const retentionCap = r2((i.contractSum * i.retentionLimitPercent) / 100);
  const retentionDeducted = r2(Math.min((grossToDate * i.retentionRate) / 100, retentionCap));
  const retentionReleased = r2(Math.min(i.retentionReleasedToDate, retentionDeducted));
  const retentionHeld = r2(retentionDeducted - retentionReleased);
  const netCumulative = r2(grossToDate - retentionHeld - i.advanceRecoveryToDate);
  const netDue = r2(netCumulative - i.previousCertified);
  if (netDue < 0) warnings.push('This valuation is less than what was certified before (a negative certificate).');
  return { workToDate, variationsToDate, materialsOnSite: r2(i.materialsOnSite), grossToDate, retentionCap, retentionDeducted, retentionReleased, retentionHeld, advanceRecovery: r2(i.advanceRecoveryToDate), netCumulative, previousCertified: r2(i.previousCertified), netDue, warnings };
}

/** What has been certified before: the net due of every certified (or paid) certificate, reversals included as negatives. */
export const previousCertified = (certified: { netDue: number }[]) => r2(certified.reduce((a, c) => a + c.netDue, 0));

/** Revised contract sum: the original plus every approved variation (omissions are negative). */
export const revisedSum = (contractSum: number, approved: number[]) => r2(contractSum + approved.reduce((a, b) => a + b, 0));

/** Retention release: a percentage of what is held now (e.g. 50% at practical completion, 100% after the defects period). */
export function retentionRelease(held: number, percent: number): number {
  if (percent <= 0 || percent > 100) throw new Error('Release between 1% and 100% of what is held.');
  return r2((held * percent) / 100);
}

/** The defects liability period ends this many months after practical completion. */
export function dlpEnds(practicalCompletion: Date, months: number): Date {
  const d = new Date(practicalCompletion);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export interface Receipts { payment: number; wht: number; whtVat: number }

/**
 * The client pays the invoice less any withholding tax (on the amount before VAT) and withholding VAT they keep and remit to KRA.
 * Settled when money plus certificates cover the invoice.
 */
export function ipcBalance(invoiceTotal: number, received: Receipts) {
  const covered = r2(received.payment + received.wht + received.whtVat);
  const outstanding = r2(invoiceTotal - covered);
  return { covered, outstanding, settled: outstanding <= 0.005 };
}

export function expectedWithholding(netExVat: number, whtRate: number, whtVatRate: number) {
  return { wht: r2((netExVat * whtRate) / 100), whtVat: r2((netExVat * whtVatRate) / 100) };
}

/** A subcontractor's valuation: their own retention rate and cap, less what they were paid before. */
export function subValuation(i: { grossToDate: number; retentionRate: number; retentionLimitPercent: number; subcontractSum: number; previousPaid: number }) {
  if (i.grossToDate < 0) throw new Error('Work to date cannot be negative.');
  if (i.grossToDate > i.subcontractSum * 1.5) throw new Error('Work to date is far above the subcontract sum - check the figure.');
  const retention = r2(Math.min((i.grossToDate * i.retentionRate) / 100, (i.subcontractSum * i.retentionLimitPercent) / 100));
  const netDue = r2(i.grossToDate - retention - i.previousPaid);
  return { retention, netDue };
}
