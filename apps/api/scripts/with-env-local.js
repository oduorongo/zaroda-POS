// Runs a command with the settings in a git-ignored env file layered ON TOP of
// the process environment (and so on top of .env, which the API's config
// loader never overrides an already-set variable with).
//
//   pnpm --filter api start:test
//
// This is how the API is pointed at a throwaway database without touching .env
// (which holds the live database address).
//
// By default it reads apps/api/.env.local and REFUSES to start unless the
// database in it is on this computer. For a rehearsal against a COPY of the live
// database (a Neon branch) there are two explicit switches:
//
//   ENV_FILE=.env.rehearsal ALLOW_DB_HOST=<the copy's exact host> node scripts/with-env-local.js ...
//
// Even then it refuses if the host is the LIVE database's host from .env.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const read = (file) => {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
};

const file = path.join(__dirname, '..', process.env.ENV_FILE || '.env.local');
if (!fs.existsSync(file)) {
  console.error(`${path.basename(file)} not found - nothing to layer on top of .env`);
  process.exit(1);
}
const overrides = read(file);

const liveFile = path.join(__dirname, '..', '.env');
const liveHosts = new Set();
if (fs.existsSync(liveFile)) {
  const live = read(liveFile);
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    try {
      if (live[key]) liveHosts.add(new URL(live[key]).hostname.replace(/-pooler/, ''));
    } catch {
      /* unreadable - ignore */
    }
  }
}

// A guard against the mistake this script exists to avoid: running tests
// against the live database.
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (!overrides[key]) continue;
  const host = new URL(overrides[key]).hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const comparable = host.replace(/-pooler/, '');
  if (liveHosts.has(comparable)) {
    console.error(`REFUSING to start: ${key} in ${path.basename(file)} points at the LIVE database (${host}).`);
    process.exit(1);
  }
  const allowed = process.env.ALLOW_DB_HOST ? process.env.ALLOW_DB_HOST.replace(/-pooler/, '') : null;
  if (!isLocal && comparable !== allowed) {
    console.error(`REFUSING to start: ${key} in ${path.basename(file)} points at ${host}, not this computer (and it is not the copy named in ALLOW_DB_HOST).`);
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
