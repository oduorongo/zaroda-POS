import { ConRoleCode, ConRoleScope, ConWorksClass } from '@prisma/client';

// Seed data copied into each construction business on first use (docs/construction/02 and 04).
// Every figure is editable per business; verify with NCA/KRA before go-live.

export const CON_ROLES: { code: ConRoleCode; name: string; scope: ConRoleScope }[] = [
  { code: 'CON_DIRECTOR', name: 'Director / Owner', scope: 'COMPANY' },
  { code: 'CON_CONTRACTS_MGR', name: 'Contracts Manager', scope: 'COMPANY' },
  { code: 'CON_QS', name: 'Quantity Surveyor', scope: 'COMPANY' },
  { code: 'CON_ACCOUNTANT', name: 'Accountant / Finance', scope: 'COMPANY' },
  { code: 'CON_PROCUREMENT', name: 'Procurement Officer', scope: 'COMPANY' },
  { code: 'CON_COMPLIANCE', name: 'Compliance / Admin Officer', scope: 'COMPANY' },
  { code: 'CON_SHE_OFFICER', name: 'Safety, Health & Environment Officer', scope: 'COMPANY' },
  { code: 'CON_PROJECT_MGR', name: 'Project Manager', scope: 'PROJECT' },
  { code: 'CON_SITE_ENGINEER', name: 'Site Engineer', scope: 'PROJECT' },
  { code: 'CON_SITE_SUPERVISOR', name: 'Site Supervisor / Foreman', scope: 'PROJECT' },
  { code: 'CON_STOREKEEPER', name: 'Site Storekeeper', scope: 'PROJECT' },
  { code: 'CON_TIMEKEEPER', name: 'Timekeeper', scope: 'PROJECT' },
  { code: 'CON_CLIENT', name: 'Client / Developer', scope: 'EXTERNAL' },
  { code: 'CON_CONSULTANT_ARCH', name: "Client's Architect / PM", scope: 'EXTERNAL' },
  { code: 'CON_CONSULTANT_QS', name: "Client's QS", scope: 'EXTERNAL' },
  { code: 'CON_CONSULTANT_ENG', name: "Client's Engineer", scope: 'EXTERNAL' },
  { code: 'CON_SUBCONTRACTOR', name: 'Subcontractor', scope: 'EXTERNAL' },
];

/** Starting approval limits (KES). Director has none (unlimited). */
export const CON_APPROVAL_LIMITS: Partial<Record<ConRoleCode, number>> = {
  CON_CONTRACTS_MGR: 5_000_000,
  CON_PROJECT_MGR: 500_000,
};

const M = 1_000_000;
/** NCA caps (KES) per category 1-8: Building, Elec/Mech, Roads & Civil. null = unlimited. */
export const NCA_CAPS: Record<ConWorksClass, (number | null)[]> = {
  BUILDING: [null, 500 * M, 300 * M, 200 * M, 100 * M, 50 * M, 20 * M, 10 * M],
  ELEC_MECH: [null, 250 * M, 150 * M, 100 * M, 50 * M, 20 * M, 10 * M, 5 * M],
  ROADS_CIVIL: [null, 750 * M, 500 * M, 300 * M, 200 * M, 100 * M, 50 * M, 20 * M],
};

export const TAX_KEYS = ['VAT', 'WHT_CONTRACTOR', 'WHT_VAT', 'NCA_LEVY', 'RETENTION_DEFAULT', 'RETENTION_LIMIT', 'SHIF', 'HOUSING_LEVY', 'NSSF'] as const;
export type TaxKey = (typeof TAX_KEYS)[number];

/** rate is a percent. NCA levy is off by default (it has been suspended and reinstated before). */
export const TAX_DEFAULTS: { key: TaxKey; rate: number; threshold?: number; active?: boolean; notes: string }[] = [
  { key: 'VAT', rate: 16, notes: 'VAT on certified works' },
  { key: 'WHT_CONTRACTOR', rate: 3, notes: 'Withholding tax on contractual payments' },
  { key: 'WHT_VAT', rate: 2, notes: 'Withholding VAT by designated agents' },
  { key: 'NCA_LEVY', rate: 0.5, threshold: 5_000_000, active: false, notes: 'NCA construction levy on contracts above the threshold' },
  { key: 'RETENTION_DEFAULT', rate: 10, notes: 'Retention deducted from each IPC' },
  { key: 'RETENTION_LIMIT', rate: 5, notes: 'Retention cap as a percent of the contract sum' },
  { key: 'SHIF', rate: 2.75, notes: 'Social Health Insurance Fund, employee' },
  { key: 'HOUSING_LEVY', rate: 1.5, notes: 'Affordable Housing Levy, employee' },
  { key: 'NSSF', rate: 6, notes: 'NSSF, employee (tiers apply)' },
];

export const TAX_EFFECTIVE_FROM = new Date('2025-01-01T00:00:00Z');

export const TRIAL_PLAN = 'CON_CONTRACTOR';
export const TRIAL_DAYS = 14;
