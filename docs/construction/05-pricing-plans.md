# 05 — Construction Pricing Plans

Plans are DATA (`con_plans` table, editable by ZARODA super-admin), never hard-coded.
Prices are launch figures to be validated with pilot contractors.

## Plans (KES)
| Code | Name | Fits | Monthly | Annual (pay 10, get 12) | Active projects | Workers | Internal users |
|---|---|---|---|---|---|---|---|
| `CON_FUNDI` | Fundi | NCA 7–8 | 3,500 | 35,000 | 2 | 30 | 5 |
| `CON_CONTRACTOR` | Contractor | NCA 5–6 | 9,500 | 95,000 | 6 | 150 | 15 |
| `CON_PRO` | Pro | NCA 3–4 | 25,000 | 250,000 | 20 | Unlimited | 50 |
| `CON_ENTERPRISE` | Enterprise | NCA 1–2 | Quote (from 60,000) | Quote | Unlimited | Unlimited | Unlimited |

External portal users (client, consultants, subcontractors) are FREE on every plan and never count toward limits.

## Features per plan
| Feature | Fundi | Contractor | Pro | Enterprise |
|---|---|---|---|---|
| Compliance vault + expiry alerts | ✓ | ✓ | ✓ | ✓ |
| Projects, BQ, site diary, photos | ✓ | ✓ | ✓ | ✓ |
| Muster roll, workers, safety registers | ✓ | ✓ | ✓ | ✓ |
| Tenders register + NCA cap check | ✓ | ✓ | ✓ | ✓ |
| Requisitions, LPO, GRN, site stock | Basic (no approval limits) | ✓ | ✓ | ✓ |
| Valuations, IPCs, variations, retention | ✓ | ✓ | ✓ | ✓ |
| eTIMS invoicing of IPCs | ✓ | ✓ | ✓ | ✓ |
| Labour payroll + M-Pesa B2C | — | ✓ | ✓ | ✓ |
| Client / consultant portal | — | ✓ | ✓ | ✓ |
| Subcontract accounts | — | — | ✓ | ✓ |
| Plant & fuel management | — | ✓ | ✓ | ✓ |
| Full reports + Excel/PDF export | Basic | ✓ | ✓ | ✓ |
| Multi-branch / custom roles / API | — | — | — | ✓ |

## Add-ons
| Code | Add-on | Price |
|---|---|---|
| `SETUP_FEE` | Onboarding: import workers, BQ, compliance docs, training | KES 10,000–30,000 one-time (by plan) |
| `EXTRA_PROJECT` | Extra active project above limit | KES 1,500 / project / month |
| `PAYOUT_FEE` | M-Pesa payroll payout | Daraja cost + KES 10 per payout |
| `SMS_BUNDLE` | SMS bundles (payslips, alerts) | Per bundle, tenant settings |

## Trial & pilot
- 14-day free trial on Contractor plan (no card/M-Pesa needed).
- Pilot coupon: 50% off for 2 months (`con_coupons`).

## Rules the software enforces
- Tables: `con_plans` (code, name, monthly, annual, limits jsonb, features jsonb, isActive),
  `con_subscriptions` (tenantId, planCode, cycle MONTHLY|ANNUAL, status TRIAL|ACTIVE|GRACE|SUSPENDED|CANCELLED,
  currentPeriodEnd, addons jsonb), `con_coupons`. Reuse existing POS billing/subscription tables if present (check in C0).
- `@ConFeature('payroll')` guard returns 402 with an "Upgrade plan" message when the feature is not in the plan; UI shows an upgrade card, not a hidden menu.
- Creating a project beyond the active-project limit: offer `EXTRA_PROJECT` add-on or upgrade.
  Closed projects do not count. Adding workers/users beyond limit: blocked with upgrade prompt.
- Payment through existing M-Pesa Paybill / TUMA flow; on success extend `currentPeriodEnd`.
- Expiry: 7-day GRACE (full access + banner) → SUSPENDED (read-only; data never deleted; exports still allowed).
- Downgrade allowed only when current usage fits the lower plan's limits.
- Sales commission: agentId on subscription; commission = % of first-year revenue (setting, default 15%),
  payable only after the tenant's second successful payment.
- Super-admin screen: edit plans, apply coupons, extend trials, view MRR and active tenants per plan.
