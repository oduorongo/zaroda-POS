// Runs a command with the settings in apps/api/.env.local layered ON TOP of
// the process environment (and so on top of .env, which the API's config
// loader never overrides an already-set variable with).
//
//   pnpm --filter api start:test
//
// This is how the API is pointed at a throwaway local test database without
// touching .env (which holds the live database address). .env.local is
// ignored by git; see the setup notes in the online-shop test docs.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const file = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(file)) {
  console.error('apps/api/.env.local not found - nothing to layer on top of .env');
  process.exit(1);
}

const overrides = {};
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) overrides[m[1]] = m[2].replace(/^"|"$/g, '');
}

// A guard against the mistake this script exists to avoid: running tests
// against the live database.
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (!overrides[key]) continue;
  const host = new URL(overrides[key]).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    console.error(`REFUSING to start: ${key} in .env.local points at ${host}, not this computer.`);
    process.exit(1);
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-env-local.js <command> [args...]');
  process.exit(1);
}
const child = spawn(command, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...overrides } });
child.on('exit', (code) => process.exit(code ?? 0));
