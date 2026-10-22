// A pretend KRA eTIMS (OSCU) server for local testing, following KRA's "OSCU Requirements & Communication Protocols" v2.0.
// It answers the calls the integration makes with the same shapes and result codes the spec lists, so the whole thing can be tested
// without KRA. It is NOT KRA: it checks what it can from the spec, nothing more.
//
//   node scripts/mock-kra.js            (listens on port 4020; set ETIMS_SANDBOX_URL=http://localhost:4020/etims-api/ in .env.local)
//
// Test controls (all under /_test): fail-next, delay, reset, bump-codes, many-classes, counts, requests.
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.MOCK_KRA_PORT || 4020);
const PIN = /^[AP]\d{9}[A-Z]$/;

const kraNow = () =>
  new Date(Date.now() + 3 * 3600_000)
    .toISOString()
    .slice(0, 19)
    .replace(/[-T:]/g, '');

// ── what is "installed" ──
const installed = new Map(); // `${tin}|${bhfId}` -> { serial, cmcKey }
let log = [];
let failNext = { n: 0, mode: '894' };
let delayMs = 0;
let manyAdded = false;

// ── the lists KRA would hold, each row with the moment it last changed ──
const T0 = '20250101000000';
const codeClasses = [
  {
    cdCls: '04',
    cdClsNm: 'Taxation Type',
    rows: [
      ['A', 'A-Exempt', 0],
      ['B', 'B-16.00%', 16],
      ['C', 'C-0%', 0],
      ['D', 'D-Non-VAT', 0],
      ['E', 'E-8%', 8],
    ],
  },
  {
    cdCls: '10',
    cdClsNm: 'Unit of Quantity',
    rows: [
      ['U', 'Pieces/item [Number]'],
      ['KG', 'Kilo-Gramme'],
      ['L', 'Litre'],
      ['BX', 'box'],
      ['PA', 'packet'],
      ['SET', 'set'],
    ],
  },
  {
    cdCls: '17',
    cdClsNm: 'Packaging Unit',
    rows: [
      ['NT', 'Net'],
      ['BG', 'Bag'],
      ['CA', 'Can'],
      ['CT', 'Carton'],
      ['BX', 'Box'],
      ['JR', 'Jar'],
    ],
  },
  {
    cdCls: '07',
    cdClsNm: 'Payment Method',
    rows: [
      ['01', 'CASH'],
      ['02', 'CREDIT'],
      ['03', 'CASH/CREDIT'],
      ['04', 'BANK CHECK'],
      ['05', 'DEBIT&CREDIT CARD'],
      ['06', 'MOBILE MONEY'],
      ['07', 'OTHER'],
    ],
  },
  {
    cdCls: '14',
    cdClsNm: 'Transaction Type',
    rows: [
      ['C', 'Copy'],
      ['N', 'Normal'],
      ['P', 'Proforma'],
      ['T', 'Training'],
    ],
  },
  {
    cdCls: '37',
    cdClsNm: 'Sales Receipt Type',
    rows: [
      ['S', 'Sale'],
      ['R', 'Credit Note after Sale'],
    ],
  },
  {
    cdCls: '12',
    cdClsNm: 'Stock Movement Type',
    rows: [
      ['01', 'Import'],
      ['02', 'Purchase'],
      ['06', 'Adjustment'],
      ['11', 'Sale'],
      ['15', 'Discarding'],
      ['16', 'Adjustment'],
    ],
  },
  {
    cdCls: '24',
    cdClsNm: 'Product Type',
    rows: [
      ['1', 'Raw Material'],
      ['2', 'Finished Product'],
      ['3', 'Service'],
    ],
  },
  {
    cdCls: '32',
    cdClsNm: 'Credit Note Reason',
    rows: [
      ['01', 'Missing Quantity'],
      ['02', 'Missing data'],
      ['03', 'Damaged'],
      ['04', 'Wasted'],
      ['05', 'Raw Material Shortage'],
      ['06', 'Refund'],
    ],
  },
  {
    cdCls: '05',
    cdClsNm: 'Nation',
    rows: [
      ['KE', 'KENYA'],
      ['UG', 'UGANDA'],
      ['TZ', 'TANZANIA'],
    ],
  },
];
let codeRows = codeClasses.flatMap((c) =>
  c.rows.map((r, i) => ({
    cdCls: c.cdCls,
    cdClsNm: c.cdClsNm,
    cd: r[0],
    cdNm: r[1],
    cdDesc: r[1],
    useYn: 'Y',
    srtOrd: i + 1,
    userDfnCd1: r[2] === undefined ? null : String(r[2]),
    changed: T0,
  })),
);
const baseClasses = [
  ['5059690800', 'Wheat flour', 4, 'B'],
  ['5022110801', 'Milled maize products', 4, 'A'],
  ['5020140100', 'Beverages', 4, 'B'],
  ['4318180100', 'Mobile phones', 4, 'B'],
  ['9010000000', 'Accommodation services', 4, 'B'],
  ['8012000000', 'Medical services', 4, 'A'],
  ['1110160600', 'Cooking oil', 4, 'B'],
  ['1110170400', 'Soft drinks', 4, 'B'],
];
let itemClasses = baseClasses.map((c) => ({
  itemClsCd: c[0],
  itemClsNm: c[1],
  itemClsLvl: c[2],
  taxTyCd: c[3],
  mjrTgYn: 'N',
  useYn: 'Y',
  changed: T0,
}));

function reply(res, body) {
  const out = JSON.stringify(body);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(out);
}
const answer = (code, msg, data = null) => ({
  resultCd: code,
  resultMsg: msg,
  resultDt: kraNow(),
  data,
});

function checkDevice(b) {
  if (!b.tin || !b.bhfId || !b.cmcKey)
    return answer('900', 'There is no Header information');
  const d = installed.get(`${b.tin}|${b.bhfId}`);
  if (!d || d.cmcKey !== b.cmcKey)
    return answer('901', 'It is not valid device');
  return null;
}

const handlers = {
  selectInitOsdcInfo(b) {
    if (!b.tin || !b.bhfId || !b.dvcSrlNo)
      return answer('910', 'Request parameter error');
    if (!PIN.test(b.tin) || !/^\d{2}$/.test(b.bhfId))
      return answer('910', 'Request parameter error');
    if (b.tin === 'A000000000Z' || b.dvcSrlNo.startsWith('UNKNOWN'))
      return answer('901', 'It is not valid device');
    if (b.dvcSrlNo.startsWith('VSCU'))
      return answer('903', 'Only OSCU device can be verified');
    const k = `${b.tin}|${b.bhfId}`;
    if (b.dvcSrlNo.startsWith('OTHERPIN'))
      return answer('000', 'It is succeeded', {
        info: {
          tin: 'P999999999Z',
          taxprNm: 'Someone else',
          bhfId: b.bhfId,
          cmcKey: 'x'.repeat(32),
        },
      });
    if (installed.has(k) || b.dvcSrlNo.startsWith('USED'))
      return answer('902', 'This device is installed');
    const cmcKey = crypto
      .createHash('sha256')
      .update(`${k}|${b.dvcSrlNo}|${Math.random()}`)
      .digest('hex')
      .slice(0, 32);
    installed.set(k, { serial: b.dvcSrlNo, cmcKey });
    const wrongPin = b.dvcSrlNo.startsWith('OTHERPIN') ? 'P999999999Z' : b.tin;
    return answer('000', 'It is succeeded', {
      info: {
        tin: wrongPin,
        taxprNm: `Test Taxpayer ${b.tin.slice(1, 5)}`,
        bsnsActv: 'business',
        bhfId: b.bhfId,
        bhfNm: b.bhfId === '00' ? 'Headquarter' : `Branch ${b.bhfId}`,
        bhfOpenDt: '20200226',
        prvncNm: 'NAIROBI CITY',
        dstrtNm: 'WESTLANDS',
        sctrNm: 'WON',
        locDesc: 'Westlands Towers',
        hqYn: b.bhfId === '00' ? 'Y' : 'N',
        mgrNm: 'Manager',
        mgrTelNo: '0789001130',
        mgrEmail: 'manager@test.com',
        dvcId: `99999${b.bhfId}000001`,
        sdicId: 'KRACU0130000',
        sdcId: 'KRACU013000001',
        mrcNo: 'WIS01000150',
        cmcKey,
      },
    });
  },
  selectCodeList(b) {
    const bad = checkDevice(b);
    if (bad) return bad;
    if (!/^\d{14}$/.test(b.lastReqDt || ''))
      return answer('910', 'Request parameter error');
    const changed = codeRows.filter((r) => r.changed > b.lastReqDt);
    if (changed.length === 0) return answer('001', 'There is no search result');
    const byCls = new Map();
    for (const r of changed) {
      const c = byCls.get(r.cdCls) ?? {
        cdCls: r.cdCls,
        cdClsNm: r.cdClsNm,
        cdClsDesc: null,
        useYn: 'Y',
        userDfnNm1: null,
        userDfnNm2: null,
        userDfnNm3: null,
        dtlList: [],
      };
      c.dtlList.push({
        cd: r.cd,
        cdNm: r.cdNm,
        cdDesc: r.cdDesc,
        useYn: r.useYn,
        srtOrd: r.srtOrd,
        userDfnCd1: r.userDfnCd1,
        userDfnCd2: null,
        userDfnCd3: null,
      });
      byCls.set(r.cdCls, c);
    }
    return answer('000', 'It is succeeded', { clsList: [...byCls.values()] });
  },
  selectItemClsList(b) {
    const bad = checkDevice(b);
    if (bad) return bad;
    if (!/^\d{14}$/.test(b.lastReqDt || ''))
      return answer('910', 'Request parameter error');
    const changed = itemClasses.filter((r) => r.changed > b.lastReqDt);
    if (changed.length === 0) return answer('001', 'There is no search result');
    return answer('000', 'It is succeeded', {
      itemClsList: changed.map(({ changed: _c, ...r }) => r),
    });
  },
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    // test controls
    if (url.pathname.startsWith('/_test/')) {
      const what = url.pathname.slice(7);
      if (what === 'fail-next') {
        failNext = {
          n: Number(url.searchParams.get('n') || 1),
          mode: url.searchParams.get('mode') || '894',
        };
        return reply(res, { ok: true, failNext });
      }
      if (what === 'delay') {
        delayMs = Number(url.searchParams.get('ms') || 0);
        return reply(res, { ok: true, delayMs });
      }
      if (what === 'reset') {
        installed.clear();
        log = [];
        failNext = { n: 0, mode: '894' };
        delayMs = 0;
        return reply(res, { ok: true });
      }
      if (what === 'bump-codes') {
        // KRA changes a code and adds a classification: only these should come down on the next request
        const stamp = kraNow();
        const unit = codeRows.find((r) => r.cdCls === '10' && r.cd === 'KG');
        unit.cdNm = `Kilo-Gramme ${stamp.slice(-4)}`;
        unit.changed = stamp;
        codeRows.push({
          cdCls: '10',
          cdClsNm: 'Unit of Quantity',
          cd: `X${stamp.slice(-4)}`,
          cdNm: 'New unit',
          cdDesc: 'New unit',
          useYn: 'Y',
          srtOrd: 99,
          userDfnCd1: null,
          changed: stamp,
        });
        itemClasses.push({
          itemClsCd: `99${stamp.slice(-8)}`,
          itemClsNm: 'Newly added classification',
          itemClsLvl: 5,
          taxTyCd: 'B',
          mjrTgYn: 'N',
          useYn: 'Y',
          changed: stamp,
        });
        return reply(res, { ok: true, stamp });
      }
      if (what === 'many-classes') {
        const n = manyAdded ? 0 : Number(url.searchParams.get('n') || 5000);
        manyAdded = true;
        for (let i = 0; i < n; i++)
          itemClasses.push({
            itemClsCd: String(7000000000 + i),
            itemClsNm: `Generated classification ${i}`,
            itemClsLvl: 5,
            taxTyCd: 'B',
            mjrTgYn: 'N',
            useYn: 'Y',
            changed: T0,
          });
        return reply(res, { ok: true, total: itemClasses.length });
      }
      if (what === 'counts')
        return reply(res, {
          codes: codeRows.length,
          itemClasses: itemClasses.length,
        });
      if (what === 'requests') return reply(res, log);
      res.writeHead(404);
      return res.end();
    }

    const method = url.pathname.replace(/^\/etims-api\//, '');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return reply(res, answer('911', 'There is no request full text'));
    }
    log.push({ method, body, at: new Date().toISOString() });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (failNext.n > 0) {
      failNext.n -= 1;
      if (failNext.mode === 'http500') {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        return res.end('<html>Internal Server Error</html>');
      }
      if (failNext.mode === 'drop') return req.socket.destroy();
      return reply(res, answer(failNext.mode, 'Injected failure'));
    }
    const handler = handlers[method];
    if (!handler)
      return reply(res, answer('912', 'There is a request Method error'));
    return reply(res, handler(body));
  });
});

server.listen(PORT, () =>
  console.log(
    `Pretend KRA eTIMS listening on http://localhost:${PORT}/etims-api/`,
  ),
);
