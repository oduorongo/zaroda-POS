# ZARODA POS — Construction Module: Claude Code Handoff Pack

This pack adds a **Construction** business type to ZARODA POS so Kenyan contractors can run
projects, sites, labour, materials, valuations and compliance (NCA, OSHA, NEMA, KRA) on one platform.

## What is inside

| File | Purpose |
|---|---|
| `CLAUDE-construction.md` | Paste at the END of your existing `CLAUDE.md` (rules Claude Code must always follow for this module) |
| `docs/construction/01-domain-spec.md` | What the module does, in plain business terms |
| `docs/construction/02-roles-permissions.md` | Construction-industry user roles + permission matrix |
| `docs/construction/03-data-model.md` | Entities/tables Claude Code will create |
| `docs/construction/04-compliance-kenya.md` | Kenyan regulatory rules the software must enforce |
| `docs/construction/05-pricing-plans.md` | Subscription plans, limits, add-ons, trial and billing rules |
| `docs/construction/06-domain-routing.md` | Construction served at build.zarodasolutions.app from the same app |
| `prompts/construction/C0 … C7` | One prompt per phase. Feed ONE at a time. |

## How to use it (Windows / PowerShell)

1. Unzip this pack.
2. Copy the `docs` and `prompts` folders into the ROOT of your ZARODA POS repo
   (the same folder that has your existing `CLAUDE.md`).
3. Open `CLAUDE-construction.md`, copy everything, and paste it at the bottom of your `CLAUDE.md`. Save.
4. Create a safe branch first, in PowerShell inside the repo folder:
   ```
   git checkout -b feature/construction
   ```
5. Start Claude Code:
   ```
   claude
   ```
6. Paste the contents of `prompts/construction/C0-discovery.md`. **C0 writes no code** — it only
   studies how your existing business types work and writes a plan. Read the plan.
7. When happy, run `C1`, test it in the browser, commit:
   ```
   git add .
   git commit -m "Construction C1 done"
   ```
8. Repeat for C2 → C7. Never paste two phases at once.

## Domain setup (do this yourself, before testing C1 live)
1. Vercel → your POS project → Settings → Domains → add `build.zarodasolutions.app`.
2. At the company where you bought `zarodasolutions.app`, add the CNAME record Vercel shows you (name: `build`).
3. In Vercel and Railway env vars, set `POS_DOMAIN=zarodashop.com` and `CONSTRUCTION_DOMAIN=build.zarodasolutions.app`.

## Golden rules
- One phase per Claude Code session. Type `/clear` between phases.
- After every phase: run the app, click through it, then commit. If a phase breaks things:
  `git checkout .` throws away uncommitted changes.
- If Claude Code asks a question you are unsure about, answer: "Follow docs/construction and choose the simplest option."
- Tax rates, levies and retention % are SETTINGS, not hard-coded — law changes; you update a setting, not code.
