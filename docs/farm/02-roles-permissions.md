# 02 — Zaroda Shamba: Roles and Permissions

Core access stays on `OrgUser.role` (OWNER, MANAGER, SUPERVISOR, CASHIER, AUDITOR). Farm work adds farm roles
(`farm_user_roles`, one person may hold several), checked server-side with `@FarmRoles()`, never only hidden in the UI.

| Farm role | Typical person | Can |
|---|---|---|
| FARM_OWNER | the farmer / director | everything, plans and billing, settings, approve write-offs |
| FARM_MANAGER | farm manager | everything except billing and plan; approve feed batches, sales on credit, deaths/culls |
| HERDSMAN | herdsman / stockman | record milk, eggs, feeding, heat, births, weights, deaths, movements in their units |
| VET | vet / animal health assistant | health events, treatments (sets withdrawal), vaccinations, pregnancy checks |
| CROPS_OFFICER | agronomist / field supervisor | crop seasons, activities, spraying, harvests |
| FEED_MILLER | feed mill operator | rations (read), mixing batches, feed stock |
| STOREKEEPER | store | receive inputs, issue feed/drugs/seed, stock counts |
| SALES | sales / cashier | sell produce and animals (POS), record deliveries, take payments |
| AUDITOR | accountant / auditor | read everything, reports, no changes |

Rules
- A herdsman or crops officer can be limited to named units (fields, pens, houses); they see and record only there.
- Treatment entries (and their withdrawal dates) are made only by VET, FARM_MANAGER or FARM_OWNER.
- Deaths, culls and write-offs over the farm's threshold need FARM_MANAGER approval.
- Every create/update/approve/delete on stock, sales, treatments and money writes to the audit log.
- Approved records (feed batches, sales, wages paid) are immutable; corrections are reversing records.
- Workers paid by the day (casuals) are not OrgUsers and never count toward the plan's user limit.
