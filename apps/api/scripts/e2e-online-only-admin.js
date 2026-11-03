// Run: node scripts/with-env-local.js node scripts/e2e-online-only-admin.js (after e2e-online-only.mjs).
// Local check of the admin side: change plan, setup fee ranges and voiding. Run from apps/api with the local env loaded.
const fs = require('fs');
const path = require('path');
const jwt = require('../../../node_modules/.pnpm/jsonwebtoken@9.0.2/node_modules/jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
const API = 'http://localhost:3001';
let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`);
};
async function call(method, p, body, token) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text();
  try {
    return { status: res.status, body: JSON.parse(t) };
  } catch {
    return { status: res.status, body: t };
  }
}

(async () => {
  const prisma = new PrismaClient();
  const admin = await prisma.platformAdmin.findFirst();
  if (!admin) throw new Error('No platform admin in the local database');
  const T = jwt.sign({ sub: admin.id, scope: 'platform-admin' }, env.PLATFORM_ADMIN_JWT_SECRET, { expiresIn: '10m' });

  const org = await prisma.organization.findFirst({ where: { name: 'Online Only E2E' }, orderBy: { createdAt: 'desc' } });
  const toBasic = await call('PATCH', `/platform-admin/organizations/${org.id}/plan`, { planTier: 'BASIC' }, T);
  check('free -> Basic starts a 14-day trial', toBasic.status === 200 && toBasic.body.plan.tier === 'BASIC' && toBasic.body.status === 'TRIAL', JSON.stringify(toBasic.body).slice(0, 200));
  const same = await call('PATCH', `/platform-admin/organizations/${org.id}/plan`, { planTier: 'BASIC' }, T);
  check('moving to the same plan is refused', same.status === 400, String(same.status));
  const back = await call('PATCH', `/platform-admin/organizations/${org.id}/plan`, { planTier: 'ONLINE_ONLY' }, T);
  check('back to free: active, paid up far ahead', back.body.status === 'ACTIVE' && new Date(back.body.currentPeriodEnd).getUTCFullYear() === 2099, JSON.stringify(back.body).slice(0, 200));
  const pay = await call('POST', `/platform-admin/organizations/${org.id}/payments`, { amount: 100, method: 'CASH' }, T);
  check('recording a payment on the free plan is refused', pay.status === 400 && /nothing to pay/.test(pay.body.message), JSON.stringify(pay.body));
  const audit = await prisma.platformAuditLog.findFirst({ where: { organizationId: org.id, action: { startsWith: 'platform_admin.changed_plan' } } });
  check('plan change is in the audit log', !!audit);

  const before = await call('GET', '/platform-admin/sales-setup-fees', undefined, T);
  check('admin sees setup fees and the total', before.status === 200 && before.body.totalKes >= 2000 && before.body.byAgent.length >= 1, JSON.stringify(before.body).slice(0, 200));
  const rates = [...before.body.rates.map((r) => ({ industryType: r.industryType, size: r.size, minKes: r.minKes, maxKes: r.maxKes })), { industryType: 'HOTEL', size: 'LARGE', minKes: 20000, maxKes: 60000 }];
  const saved = await call('PUT', '/platform-admin/sales-setup-fees/rates', { rates }, T);
  check('ranges saved, including a hotel-only range', saved.status === 200 && saved.body.some((r) => r.industryType === 'HOTEL'), JSON.stringify(saved.body).slice(0, 200));
  const badRange = await call('PUT', '/platform-admin/sales-setup-fees/rates', { rates: [{ industryType: 'ANY', size: 'SMALL', minKes: 5000, maxKes: 1000 }] }, T);
  check('a range with lowest above highest is refused', badRange.status === 400, String(badRange.status));
  await call('PUT', '/platform-admin/sales-setup-fees/rates', { rates: before.body.rates }, T);

  const fee = before.body.fees.find((f) => !f.voidedAt);
  const voided = await call('POST', `/platform-admin/sales-setup-fees/${fee.id}/void`, { reason: 'E2E test' }, T);
  check('admin voids a fee with a reason', voided.status === 200 && voided.body.voidedAt, JSON.stringify(voided.body));
  const twice = await call('POST', `/platform-admin/sales-setup-fees/${fee.id}/void`, { reason: 'again' }, T);
  check('a fee cannot be voided twice', twice.status === 400, String(twice.status));
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
