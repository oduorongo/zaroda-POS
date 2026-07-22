/**
 * Kenya-only statutory payroll deductions, hardcoded the same way
 * SalesService's loyalty earn/redeem rates are - a real per-country config
 * screen is a natural follow-up once there's a back-office place to put
 * it, not needed for a single-country pilot (Organization.country
 * defaults to "KE") to be useful. Rates below are the 2024 Finance Act /
 * NSSF Act figures in effect as of this writing:
 *
 * - NSSF: Tier I is 6% of pensionable pay up to the lower earnings limit
 *   (KES 8,000/month); Tier II is 6% of pay between the lower and upper
 *   earnings limit (KES 72,000/month). Both capped - together, at most
 *   KES 4,320/month.
 * - SHIF (Social Health Insurance Fund, replaced NHIF in Oct 2024): 2.75%
 *   of gross pay, minimum KES 300/month.
 * - Affordable Housing Levy: 1.5% of gross pay (the employee's share -
 *   the employer's matching 1.5% is a cost to the business, not a
 *   deduction from the employee, so it isn't computed here).
 * - PAYE: banded, computed on pay after NSSF/SHIF/Housing Levy are
 *   deducted (all three are allowable pre-tax deductions under current
 *   KRA guidance), less the flat personal relief of KES 2,400/month.
 */

interface PayeBand {
  upTo: number; // exclusive upper bound of this band, Infinity for the top band
  rate: number;
}

const PAYE_BANDS: PayeBand[] = [
  { upTo: 24_000, rate: 0.1 },
  { upTo: 32_333, rate: 0.25 },
  { upTo: 500_000, rate: 0.3 },
  { upTo: 800_000, rate: 0.325 },
  { upTo: Infinity, rate: 0.35 },
];

const PERSONAL_RELIEF = 2_400;

const NSSF_TIER_I_LIMIT = 8_000;
const NSSF_TIER_II_LIMIT = 72_000;
const NSSF_RATE = 0.06;

const SHIF_RATE = 0.0275;
const SHIF_MINIMUM = 300;

const HOUSING_LEVY_RATE = 0.015;

function calculateNssf(grossPay: number): number {
  const tierI = Math.min(grossPay, NSSF_TIER_I_LIMIT) * NSSF_RATE;
  const tierIIBase = Math.max(
    0,
    Math.min(grossPay, NSSF_TIER_II_LIMIT) - NSSF_TIER_I_LIMIT,
  );
  const tierII = tierIIBase * NSSF_RATE;
  return round2(tierI + tierII);
}

function calculatePaye(taxablePay: number): number {
  let remaining = Math.max(0, taxablePay);
  let tax = 0;
  let lowerBound = 0;
  for (const band of PAYE_BANDS) {
    const bandWidth = band.upTo - lowerBound;
    const taxableInBand = Math.min(remaining, bandWidth);
    if (taxableInBand <= 0) break;
    tax += taxableInBand * band.rate;
    remaining -= taxableInBand;
    lowerBound = band.upTo;
  }
  return round2(Math.max(0, tax - PERSONAL_RELIEF));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface StatutoryDeductions {
  nssfDeduction: number;
  shifDeduction: number;
  housingLevy: number;
  payeTax: number;
  totalDeductions: number;
  netPay: number;
}

export function calculateStatutoryDeductions(grossPay: number): StatutoryDeductions {
  const nssfDeduction = calculateNssf(grossPay);
  const shifDeduction = round2(Math.max(grossPay * SHIF_RATE, SHIF_MINIMUM));
  const housingLevy = round2(grossPay * HOUSING_LEVY_RATE);
  const taxablePay = grossPay - nssfDeduction - shifDeduction - housingLevy;
  const payeTax = calculatePaye(taxablePay);
  const totalDeductions = round2(
    nssfDeduction + shifDeduction + housingLevy + payeTax,
  );
  return {
    nssfDeduction,
    shifDeduction,
    housingLevy,
    payeTax,
    totalDeductions,
    netPay: round2(grossPay - totalDeductions),
  };
}
