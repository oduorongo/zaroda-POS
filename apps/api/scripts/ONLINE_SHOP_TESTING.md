# Testing the Online Shop on your own computer

Everything here runs locally against a **throwaway database**. It never touches
the live system, and nobody is charged: Tuma is replaced by a pretend one.

## What's involved

| Piece | What it is | How it runs |
|---|---|---|
| Test database | A second Postgres, in its own folder `C:\Users\<you>\zaroda-testdb`, port **5433** | `pg_ctl` from your PostgreSQL install |
| `apps/api/.env.local` | Test-only settings (database address, random secrets). Git ignores it | created once, see below |
| Pretend Tuma | `scripts/mock-tuma.js`, port **4010** | `node scripts/mock-tuma.js` |
| The API | The normal API, pointed at the test database | `pnpm --filter api start:test` |
| The test | `scripts/e2e-online-shop.js` plays shop owner, two shoppers, an attacker and the platform admin | `node scripts/e2e-online-shop.js` |

`start:test` layers `.env.local` on top of `.env`, and **refuses to start** if
`.env.local` points anywhere but this computer.

## Start everything (after a reboot)

```
"C:\Program Files\PostgreSQL\18\bin\pg_ctl" -D C:/Users/<you>/zaroda-testdb -l C:/Users/<you>/zaroda-testdb/server.log -o "-p 5433 -c listen_addresses=localhost" start
node scripts/mock-tuma.js
pnpm --filter api start:test
```

Then, in another terminal: `node scripts/e2e-online-shop.js <path to the API's log file>`
(the test reads the shopper's SMS login code from the API's log, because no SMS
is sent in testing).

## Stop everything

Ctrl+C in the API and pretend-Tuma terminals, and:

```
"C:\Program Files\PostgreSQL\18\bin\pg_ctl" -D C:/Users/<you>/zaroda-testdb stop
```

To throw the test database away completely, stop it, then delete the
`zaroda-testdb` folder and `apps/api/.env.local`.

## What this does not prove

- The **real Tuma**: the pretend one follows the shapes in the school system's
  Tuma client, so a first real KES 1 payment is still needed.
- **Email** (Resend), **SMS**, and **photo storage** are switched off in testing.
- The websites (back office, storefront) are not driven by this script.
