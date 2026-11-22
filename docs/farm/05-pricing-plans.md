# 05 — Zaroda Shamba: Pricing Plans

Plans are DATA (`farm_plans`, editable by the ZARODA super-admin), never hard-coded. Limits are checked server-side;
going over shows an upgrade prompt, never a silent failure. Launch figures, to be validated with pilot farms.

"Head" = individually counted livestock (cattle, goats, sheep, pigs, rabbits). "Birds" = poultry counted by flock.

## Plans (KES)
| Code | Name | Fits | Monthly | Annual (pay 10, get 12) | Head | Birds | Acres | Users |
|---|---|---|---|---|---|---|---|---|
| `FARM_KIENYEJI` | Kienyeji | A small family shamba | Free | Free | 20 | 200 | 2 | 1 |
| `FARM_MKULIMA` | Mkulima | A small commercial farm | 1,000 | 10,000 | 100 | 2,000 | 10 | 3 |
| `FARM_FARMER` | Farmer | A growing mixed farm | 2,500 | 25,000 | 500 | 10,000 | 50 | 8 |
| `FARM_COMMERCIAL` | Commercial | A large farm or ranch | 6,500 | 65,000 | 3,000 | 100,000 | 300 | 25 |
| `FARM_ESTATE` | Estate | Estates, co-ops, groups | Quote | Quote | Unlimited | Unlimited | Unlimited | Unlimited |

New farms start on a 14-day free trial of Farmer, then choose a plan (Kienyeji if they do nothing).

## Features per plan
| Feature | Kienyeji | Mkulima | Farmer | Commercial | Estate |
|---|---|---|---|---|---|
| Farm layout, enterprises | ✓ | ✓ | ✓ | ✓ | ✓ |
| Animals, groups, health, breeding, weights | ✓ | ✓ | ✓ | ✓ | ✓ |
| Milk and egg records | ✓ | ✓ | ✓ | ✓ | ✓ |
| Vaccination programmes + SMS reminders | — | ✓ | ✓ | ✓ | ✓ |
| Crops (seasons, spraying, harvests) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Feed production (rations, batches) | — | ✓ | ✓ | ✓ | ✓ |
| Selling produce through the POS, credit buyers | Cash only | ✓ | ✓ | ✓ | ✓ |
| Casual workers + M-Pesa wages | — | — | ✓ | ✓ | ✓ |
| Several farm sites (branches) | — | — | — | ✓ | ✓ |
| Full reports, profit per enterprise, PDF/Excel | Basic | Basic | ✓ | ✓ | ✓ |
| Accounts (general ledger) | — | — | ✓ | ✓ | ✓ |
| Custom roles, API, co-op member farms | — | — | — | — | ✓ |

Sales teams earn on Shamba subscriptions at the same rates as other apps (docs/sales).
