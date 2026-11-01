import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConRoleCode } from '@prisma/client';
import { CommercialController } from '../commercial/commercial.controller';
import { ConBillingCallbackController, ConPublicController, ConstructionController } from '../construction.controller';
import { ConApiKeyGuard } from '../enterprise/api-key.guard';
import { ConstructionApiController, EnterpriseController } from '../enterprise/enterprise.controller';
import { MaterialsController } from '../materials/materials.controller';
import { MessagesController } from '../messages/messages.controller';
import { PayrollCallbackController, PayrollController } from '../payroll/payroll.controller';
import { ConPortalGuard } from '../portal/portal-access';
import { PortalAuthController, PortalController, PortalUsersController } from '../portal/portal.controller';
import { ProjectsController, TendersController } from '../projects/projects.controller';
import { ReportsController } from '../reports/reports.controller';
import { SiteController } from '../site/site.controller';
import { conRoutes } from './con-routes';
import { conMethods, conSourceFiles } from './con-source';

const CONTROLLERS = [ConstructionController, ConBillingCallbackController, ConPublicController, TendersController, ProjectsController, SiteController, MaterialsController, CommercialController, PayrollController, PayrollCallbackController, PortalAuthController, PortalController, PortalUsersController, ReportsController, EnterpriseController, ConstructionApiController, MessagesController];
const routes = conRoutes(CONTROLLERS);
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

const R = {
  CM: 'CON_CONTRACTS_MGR', PM: 'CON_PROJECT_MGR', QS: 'CON_QS', ACC: 'CON_ACCOUNTANT', PROC: 'CON_PROCUREMENT', COMP: 'CON_COMPLIANCE', SHE: 'CON_SHE_OFFICER',
  ENG: 'CON_SITE_ENGINEER', SUP: 'CON_SITE_SUPERVISOR', STORE: 'CON_STOREKEEPER', TIME: 'CON_TIMEKEEPER',
} as const satisfies Record<string, ConRoleCode>;
type Ab = keyof typeof R;
const ALL_INTERNAL = Object.keys(R) as Ab[];

/**
 * docs/construction/02 permission matrix, per area: who may view (V) and who may change (C/A/F). The Director always may.
 * Routes are matched to an area by the first pattern that fits.
 */
const AREAS: { name: string; match: RegExp; view: Ab[]; write: Ab[]; feature?: string }[] = [
  { name: 'users & roles', match: /^\/construction\/(staff|roles\/:code|settings\/rules)/, view: ALL_INTERNAL, write: [] },
  { name: 'enterprise settings', match: /^\/construction\/(offices|custom-roles|api-keys)/, view: [], write: [] },
  { name: 'compliance', match: /^\/construction\/compliance\/(?!cap-check)/, view: ['CM', 'PM', 'QS', 'ACC', 'PROC', 'COMP', 'SHE'], write: ['COMP'], feature: 'compliance' },
  { name: 'tenders', match: /^\/construction\/tenders/, view: ['CM', 'PM', 'QS', 'ACC', 'PROC', 'COMP'], write: ['CM', 'QS', 'COMP'], feature: 'tenders' },
  { name: 'reports', match: /^\/construction\/(reports|dashboard\/director|projects\/:projectId\/dashboard)/, view: ['CM', 'PM', 'QS', 'ACC', 'PROC', 'COMP', 'SHE', 'ENG'], write: [] },
  { name: 'bq', match: /\/bq/, view: ['CM', 'PM', 'QS', 'ACC', 'PROC', 'ENG', 'SUP'], write: ['CM', 'QS'] },
  { name: 'site diary & photos', match: /\/(diaries|photos|instructions)/, view: ['CM', 'PM', 'QS', 'SHE', 'ENG', 'SUP'], write: ['PM', 'ENG', 'SUP'], feature: 'projects' },
  { name: 'labour & muster', match: /^\/construction\/(workers|projects\/:projectId\/muster)/, view: ['CM', 'PM', 'ACC', 'COMP', 'SHE', 'ENG', 'SUP', 'TIME'], write: ['PM', 'SUP', 'TIME'], feature: 'labour' },
  { name: 'safety', match: /\/(safety|toolbox-talks|ppe|work-permits|incidents)/, view: ['CM', 'PM', 'COMP', 'SHE', 'ENG', 'SUP'], write: ['SHE', 'ENG', 'SUP'], feature: 'safety' },
  { name: 'requisitions', match: /\/requisitions/, view: ['CM', 'PM', 'QS', 'ACC', 'PROC', 'ENG', 'SUP', 'STORE'], write: ['CM', 'PM', 'ENG', 'SUP', 'STORE'], feature: 'procurement' },
  { name: 'LPOs', match: /\/lpos/, view: ['CM', 'PM', 'QS', 'ACC', 'PROC'], write: ['CM', 'PM', 'PROC'], feature: 'procurement' },
  { name: 'GRN / site stock', match: /\/(stock|issues|material-budgets|reconciliation)$/, view: ['CM', 'PM', 'QS', 'ACC', 'PROC', 'SUP', 'STORE'], write: ['STORE'], feature: 'procurement' },
  { name: 'plant & fuel', match: /^\/construction\/(plant|projects\/:projectId\/plant-)/, view: ['CM', 'PM', 'ACC', 'PROC', 'SHE', 'ENG', 'SUP', 'STORE'], write: ['PM', 'PROC', 'SUP', 'STORE'], feature: 'plant' },
  { name: 'subcontracts', match: /\/subcontracts/, view: ['CM', 'PM', 'QS', 'ACC'], write: ['CM', 'QS', 'ACC'], feature: 'subcontracts' },
  { name: 'IPC invoices', match: /\/valuations\/:id\/(invoice|receipts)$/, view: ['CM', 'PM', 'QS', 'ACC'], write: ['QS', 'ACC'] },
  { name: 'valuations', match: /\/(valuations|retention)/, view: ['CM', 'PM', 'QS', 'ACC', 'ENG'], write: ['CM', 'QS'], feature: 'commercial' },
  { name: 'variations', match: /\/variations/, view: ['CM', 'PM', 'QS', 'ACC', 'ENG'], write: ['CM', 'PM', 'QS', 'ENG'], feature: 'commercial' },
  { name: 'payroll', match: /\/(payroll-runs|payroll\/settings)/, view: ['CM', 'PM', 'ACC'], write: ['ACC'], feature: 'payroll' },
  { name: 'portal users', match: /^\/construction\/portal-users/, view: ['CM', 'PM'], write: ['CM', 'PM'], feature: 'portal' },
  { name: 'projects & contracts', match: /^\/construction\/(projects|parties)/, view: ['CM', 'PM', 'QS', 'ACC', 'PROC', 'COMP', 'SHE', 'ENG', 'SUP'], write: ['CM', 'PM', 'QS'] },
  { name: 'general', match: /^\/construction\/(me|dashboard|alerts|messages|people|roles|settings\/tax|compliance\/cap-check|plan)/, view: ALL_INTERNAL, write: ALL_INTERNAL },
];

/** Deliberate differences from the matrix, with the reason. Anything else that differs fails. */
const EXCEPTIONS: Record<string, { roles: Ab[]; why: string }> = {
  'GET /construction/staff': { roles: ['COMP'], why: 'Compliance records staff NCA accreditation cards' },
  'PUT /construction/staff/:orgUserId/accreditation': { roles: ['COMP'], why: 'Compliance records staff NCA accreditation cards' },
  'GET /construction/projects': { roles: ['STORE', 'TIME'], why: 'site screens list their projects; contract money and client are hidden from them' },
  'GET /construction/projects/:projectId': { roles: ['STORE', 'TIME'], why: 'site screens open their project; contract money and client are hidden from them' },
  'PUT /construction/projects/:projectId/permits/:type': { roles: ['COMP'], why: 'permits are compliance documents' },
  'POST /construction/projects/:projectId/permits/:type/file': { roles: ['COMP'], why: 'permits are compliance documents' },
  'POST /construction/parties': { roles: ['PROC', 'COMP'], why: 'procurement and compliance add consultants and subcontractors' },
  'PUT /construction/parties/:id': { roles: ['PROC', 'COMP'], why: 'procurement and compliance add consultants and subcontractors' },
  'POST /construction/projects/:projectId/instructions': { roles: ['QS'], why: 'the QS records instructions that become variations' },
  'PATCH /construction/projects/:projectId/instructions/:id': { roles: ['QS'], why: 'the QS records instructions that become variations' },
  'POST /construction/projects/:projectId/incidents/:id/doshs': { roles: ['PM'], why: 'the Project Manager may report an incident to DOSHS' },
  'GET /construction/projects/:projectId/lpos': { roles: ['STORE'], why: 'the storekeeper receives deliveries against LPOs' },
  'GET /construction/projects/:projectId/lpos/:id': { roles: ['STORE'], why: 'the storekeeper receives deliveries against LPOs' },
  'POST /construction/projects/:projectId/lpos/:id/receive': { roles: ['STORE'], why: 'a delivery is a GRN (storekeeper C)' },
  'GET /construction/projects/:projectId/stock': { roles: ['ENG'], why: 'engineers check stock before requesting materials' },
  'GET /construction/projects/:projectId/issues': { roles: ['ENG'], why: 'engineers check what was issued to their works' },
  'POST /construction/projects/:projectId/issues': { roles: ['PM'], why: 'on small sites without a storekeeper the PM issues materials' },
  'PUT /construction/projects/:projectId/material-budgets': { roles: ['QS', 'CM'], why: 'material allowances come from the BQ (QS/CM)' },
  'POST /construction/plant': { roles: ['CM'], why: 'the Contracts Manager may register company plant' },
  'PUT /construction/plant/:id': { roles: ['CM'], why: 'the Contracts Manager may register company plant' },
  'GET /construction/projects/:projectId/plant-cost': { roles: ['QS'], why: 'plant cost feeds the QS cost reports' },
  'GET /construction/projects/:projectId/dashboard': { roles: ['SUP', 'STORE', 'TIME'], why: 'site staff see their project today (money is hidden from them)' },
};
/** Routes any internal construction user may call (no @ConRoles). */
const OPEN = ['GET /construction/me', 'GET /construction/dashboard', 'GET /construction/plan', 'GET /construction/plan/quote', 'GET /construction/plan/addons'];

const ab = (roles: ConRoleCode[]) => roles.filter((r) => r !== 'CON_DIRECTOR').map((r) => (Object.keys(R) as Ab[]).find((k) => R[k] === r) ?? r);
const isWrite = (m: string) => m !== 'GET';

describe('construction hardening', () => {
  const internal = routes.filter((r) => r.construction);
  const external = routes.filter((r) => !r.construction);

  it('finds every construction route', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(new Set(routes.map(key)).size).toBe(routes.length);
  });

  it('every staff route needs a construction role (except the few open to all staff)', () => {
    const missing = internal.filter((r) => !r.roles?.length && !OPEN.includes(key(r))).map(key);
    expect(missing).toEqual([]);
  });

  it('every route with a project in its path checks project membership', () => {
    expect(internal.filter((r) => r.path.includes(':projectId') && !r.project).map(key)).toEqual([]);
  });

  it('routes outside the staff guard are only portal (own guard), the API (key guard), sign-in, callbacks or the public price list', () => {
    for (const r of external) {
      expect(r.isPublic).toBe(true);
      if (r.path.startsWith('/construction-portal/') && !r.path.startsWith('/construction-portal/auth/')) {
        const guards: unknown[] = [...(Reflect.getMetadata(GUARDS_METADATA, PortalController) ?? [])];
        expect(guards).toContain(ConPortalGuard);
      } else if (r.path.startsWith('/construction-api/')) {
        expect(r.method).toBe('GET');
        expect(Reflect.getMetadata(GUARDS_METADATA, ConstructionApiController)).toContain(ConApiKeyGuard);
      } else {
        expect(r.path).toMatch(/^\/(construction-portal\/auth\/|public\/)/);
      }
    }
  });

  it('every staff route belongs to an area of the permission matrix and allows no role the matrix (or a listed exception) does not', () => {
    const problems: string[] = [];
    for (const r of internal) {
      if (OPEN.includes(key(r))) continue;
      const area = AREAS.find((a) => a.match.test(r.path));
      if (!area) {
        problems.push(`${key(r)}: no area`);
        continue;
      }
      const allowed = new Set<string>([...(isWrite(r.method) ? area.write : [...area.view, ...area.write]), ...(EXCEPTIONS[key(r)]?.roles ?? [])]);
      const extra = ab(r.roles ?? []).filter((x) => !allowed.has(x));
      if (extra.length) problems.push(`${key(r)} (${area.name}): ${extra.join(', ')} not allowed by 02`);
    }
    expect(problems).toEqual([]);
  });

  it('exceptions only name real routes', () => {
    const all = new Set(routes.map(key));
    expect(Object.keys(EXCEPTIONS).filter((k) => !all.has(k))).toEqual([]);
  });

  it('users and roles are the Director\'s alone', () => {
    for (const k of ['POST /construction/staff', 'PUT /construction/staff/:orgUserId/roles', 'PATCH /construction/roles/:code', 'PATCH /construction/settings/rules']) {
      expect(routes.find((r) => key(r) === k)?.roles).toEqual(['CON_DIRECTOR']);
    }
  });

  it('payroll money moves only with Accounts (the Director approves): no site role can create, approve or pay', () => {
    const pay = internal.filter((r) => /payroll/.test(r.path) && isWrite(r.method));
    expect(pay.length).toBeGreaterThan(4);
    for (const r of pay) expect(ab(r.roles ?? [])).toEqual(['ACC']);
  });

  it('every route in a plan-gated area carries that plan feature (docs/construction/05)', () => {
    const problems: string[] = [];
    for (const r of internal) {
      const area = AREAS.find((a) => a.match.test(r.path));
      if (area?.feature && r.feature !== area.feature && !(area.name === 'IPC invoices')) problems.push(`${key(r)}: ${r.feature ?? 'none'} instead of ${area.feature}`);
    }
    expect(problems).toEqual([]);
    expect(routes.find((r) => key(r) === 'POST /construction/projects/:projectId/valuations/:id/invoice')?.feature).toBe('etims');
  });

  it('every create/update/approve/delete on construction records writes the audit log (or is a listed system write)', () => {
    const SYSTEM: Record<string, string> = {
      'compliance/compliance-alerts.service.ts runForOrganization': 'in-app alerts are notifications, not records',
      'compliance/compliance-alerts.service.ts markRead': 'read flags on alerts',
      'messages/messages.service.ts thread': 'read flags on messages (sending is audited)',
      'payroll/payroll.service.ts settleRun': 'run status follows its lines, each audited',
      'payroll/payroll.service.ts sendPayslips': 'SMS sent time',
      'enterprise/api-key.guard.ts canActivate': 'last-used time and request count on the key',
      'plans/con-addons.service.ts saveBundle': 'platform admin: PlatformAuditLogService',
      'plans/con-addons.service.ts saveBands': 'platform admin: PlatformAuditLogService',
      'plans/con-usage.service.ts takeSms': 'SMS credit spent, and the "credit ran out" notification',
      'plans/con-usage.service.ts returnSms': 'SMS credit given back for a text that failed',
      'plans/con-usage.service.ts chargePayout': 'fee line for a payout whose payment is audited',
      'plans/con-usage.service.ts closeMonths': 'groups fee lines into the month\'s invoice',
      'plans/con-plans.service.ts fail': 'a failed M-Pesa prompt',
      'plans/con-plans.service.ts updatePlan': 'platform admin: PlatformAuditLogService',
      'plans/con-plans.service.ts saveCoupon': 'platform admin: PlatformAuditLogService',
      'plans/con-plans.service.ts recordPayment': 'platform admin: PlatformAuditLogService, then settle() audits',
      'portal/portal-auth.service.ts requestCode': 'one-time sign-in codes',
      'portal/portal-auth.service.ts verifyCode': 'one-time sign-in codes and last sign-in time',
      'projects/projects.service.ts permitRow': 'helper; its callers audit',
      'site/site.service.ts ensureDiary': 'helper; its callers audit',
    };
    const WRITE = /\b(?:tx|this\.prisma)\.(con\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
    const unaudited = conMethods()
      .filter((m) => WRITE.test(m.body) && !/audit\.(logInTx|log)\(|auditLog\.create\(/.test(m.body))
      .map((m) => `${m.file} ${m.name}`)
      .filter((k) => !SYSTEM[k]);
    expect(unaudited).toEqual([]);
  });

  it('tenant isolation: construction code only uses the unscoped client for global tables, guards and jobs that set the tenant', () => {
    const ALLOWED = /this\.prisma\.(conPlan|conCoupon|conPortalOtp|conSmsBundle|conPayoutFeeBand)\b|this\.prisma\.conFeeInvoice\.findMany\(\{ where: \{ status|this\.prisma\.\$transaction\(|this\.prisma\.(organization|conSubscription|conSubscriptionPayment)\.findMany\(\{ where: \{ (industryType|organizationId: \{ in)/;
    const bad: string[] = [];
    for (const f of conSourceFiles()) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/this\.prisma\.\w/.test(line) && !ALLOWED.test(line) && !/asOrg\(this\.prisma/.test(line)) bad.push(`${f.split(/[\\/]construction[\\/]/)[1]}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('every request body and query field is validated', () => {
    const dir = join(__dirname, '..', 'dto');
    const bad: string[] = [];
    for (const f of conSourceFiles(dir)) {
      const lines = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
      lines.forEach((line, i) => {
        if (!/^ {2}\w+[!?]?: /.test(line)) return;
        let j = i - 1;
        while (j >= 0 && /^\s*(\/\/|\/\*\*|\*)/.test(lines[j])) j--;
        if (!/^ {2}@/.test(lines[j] ?? '')) bad.push(`${f.split(/[\\/]dto[\\/]/)[1]}:${i + 1} ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('no controller reads a raw, unvalidated query value', () => {
    const raw: string[] = [];
    for (const f of conSourceFiles().filter((x) => x.endsWith('.controller.ts'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/@Query\((?:'(\w+)')?\)\s*\w+\??:\s*([^,)]+)/g)) if (m[1] || /^\{/.test(m[2].trim())) raw.push(`${f.split(/[\\/]construction[\\/]/)[1].replace(/\\/g, '/')}: ${m[0]}`);
    }
    expect(raw).toEqual(['projects/projects.controller.ts: @Query(\'save\') save: string | undefined', 'site/site.controller.ts: @Query(\'cancel\') cancel?: string']);
  });
});
