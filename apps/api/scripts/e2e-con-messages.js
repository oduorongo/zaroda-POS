// End-to-end test of construction in-app messages against a LOCAL test setup (the Uriri Builders demo seed): a message to a person,
// the unread count, opening marks it read, reply-to-all, a project team, everyone, privacy between conversations, and validation.
// Needs the API on the test settings (port 3001) and the construction seed.   node scripts/e2e-con-messages.js
const API = process.env.API || 'http://localhost:3001';
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 500) : ''}`);
  }
};
async function call(method, p, token, body) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const login = async (email) => (await call('POST', '/auth/login', undefined, { email, password: 'password123' })).json.accessToken;
const tag = Date.now().toString(36);

(async () => {
  const director = await login('director@uriri.demo');
  const pm = await login('pm@uriri.demo');
  const site = await login('site@uriri.demo');
  const store = await login('store@uriri.demo');
  check('four staff sign in', [director, pm, site, store].every(Boolean));
  const as = (t) => ({ get: (p) => call('GET', `/construction/messages${p}`, t), send: (b) => call('POST', '/construction/messages', t, b) });
  const D = as(director), P = as(pm), S = as(site), T = as(store);

  const rec = await D.get('/recipients');
  check('the recipient list has the staff (not yourself) and the projects', rec.status === 200 && rec.json.people.length >= 5 && rec.json.projects.length >= 1, rec.json);
  const person = (name) => rec.json.people.find((p) => p.fullName === name)?.orgUserId;
  const pmId = person('Evans Omondi');
  const before = (await P.get('/unread')).json.unread;

  check('a message needs someone to send it to', (await D.send({ subject: 'x', body: 'y' })).status === 400);
  check('a new message needs a subject', (await D.send({ to: [pmId], body: 'y' })).status === 400);
  check('an empty message is refused', (await D.send({ to: [pmId], subject: 'x', body: '   ' })).status === 400);
  check('someone outside the company cannot be messaged', (await D.send({ to: ['00000000-0000-4000-8000-000000000000'], subject: 'x', body: 'y' })).status === 400);
  const sent = await D.send({ to: [pmId], subject: `Site visit ${tag}`, body: 'Meet me on site at 10am tomorrow.' });
  check('the director messages the project manager', sent.status === 201 && sent.json.recipients === 1, sent.json);
  check("the PM's bell shows one more unread", (await P.get('/unread')).json.unread === before + 1);
  const inbox = (await P.get('?box=inbox')).json.messages;
  const mine = inbox.find((m) => m.subject === `Site visit ${tag}`);
  check('it is in the PM\'s inbox, unread, from the director', mine && !mine.read && mine.from === 'Achieng Odhiambo', mine);
  check('the store keeper cannot open a conversation they are not in', (await T.get(`/${sent.json.id}`)).status === 404);
  check('nor reply to it', (await T.send({ replyTo: sent.json.id, body: 'hi' })).status === 404);
  const thread = await P.get(`/${sent.json.id}`);
  check('opening it shows the conversation', thread.status === 200 && thread.json.messages.length === 1 && thread.json.messages[0].body.includes('10am'), thread.json);
  check('and marks it read', (await P.get('/unread')).json.unread === before);
  const reply = await P.send({ replyTo: sent.json.id, body: 'Confirmed, see you there.' });
  check('the PM replies to everyone in the conversation', reply.status === 201 && reply.json.threadId === sent.json.id && reply.json.recipients === 1, reply.json);
  const dThread = (await D.get(`/${sent.json.id}`)).json;
  check('the reply joins the conversation, with "Re:" kept off the first message', dThread.messages.length === 2 && dThread.subject === `Site visit ${tag}` && dThread.messages[1].from === 'Evans Omondi', dThread);
  const sentBox = (await D.get('?box=sent')).json.messages.find((m) => m.id === sent.json.id);
  check('the sent box shows it was read', sentBox && sentBox.readBy === 1, sentBox);

  const project = rec.json.projects[0];
  const team = await S.send({ projectId: project.id, subject: `Concrete pour ${tag}`, body: 'Pour moved to Thursday.' });
  check('the site supervisor messages their project team', team.status === 201 && team.json.recipients >= 1, team.json);
  check('the PM on that project gets it', (await P.get('?box=inbox')).json.messages.some((m) => m.subject === `Concrete pour ${tag}` && m.project?.code === project.code));
  const all = await D.send({ everyone: true, subject: `Public holiday ${tag}`, body: 'Sites are closed on Friday.' });
  check('the director messages everyone', all.status === 201 && all.json.recipients >= 5, all.json);
  check('the store keeper gets the everyone message', (await T.get('?box=inbox')).json.messages.some((m) => m.subject === `Public holiday ${tag}`));
  check('signed out, nothing is readable', (await call('GET', '/construction/messages/unread')).status === 401);

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
