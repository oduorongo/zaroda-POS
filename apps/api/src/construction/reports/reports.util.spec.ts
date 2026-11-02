import { Workbook } from 'exceljs';
import { REPORTS, REPORT_ROLES, cashflowRows, costRow, elapsedPct, ltifr, monthKey, ncaRow, reportXlsx, scheduleState, totalsOf } from './reports.util';

describe('construction reports maths', () => {
  it('cost to date against budget and certified value', () => {
    expect(costRow({ budget: 1_000_000, materials: 300_000, labour: 150_000, plant: 40_000, subcontracts: 10_000, certified: 600_000 })).toEqual({ cost: 500_000, budgetUsed: 50, remaining: 500_000, margin: 100_000, marginPct: 16.67 });
    expect(costRow({ budget: 0, materials: 0, labour: 0, plant: 0, subcontracts: 0, certified: 0 })).toMatchObject({ budgetUsed: null, marginPct: null });
  });

  it('cash flow per month with a running balance', () => {
    const rows = cashflowRows([
      { month: '2026-10', kind: 'IPC', amount: 1000 },
      { month: '2026-09', kind: 'WAGES', amount: 300 },
      { month: '2026-09', kind: 'MATERIALS', amount: 200.5 },
      { month: '2026-10', kind: 'PLANT', amount: 100 },
      { month: '2026-10', kind: 'SUBCONTRACTS', amount: 50 },
    ]);
    expect(rows.map((r) => r.month)).toEqual(['2026-09', '2026-10']);
    expect(rows[0]).toMatchObject({ inflow: 0, wages: 300, materials: 200.5, outflow: 500.5, net: -500.5, running: -500.5 });
    expect(rows[1]).toMatchObject({ inflow: 1000, plant: 100, subcontracts: 50, outflow: 150, net: 850, running: 349.5 });
  });

  it('months are Nairobi months', () => {
    expect(monthKey(new Date('2026-10-31T22:00:00Z'))).toBe('2026-11');
    expect(monthKey(new Date('2026-10-31T20:59:00Z'))).toBe('2026-10');
  });

  it('LTIFR per million hours', () => {
    expect(ltifr(1, 200_000)).toBe(5);
    expect(ltifr(0, 0)).toBeNull();
  });

  it('NCA utilisation: biggest contract and tender against the cap', () => {
    expect(ncaRow({ cap: 100_000_000, values: [40_000_000, 10_713_000], tenders: [120_000_000] })).toEqual({ projects: 2, activeValue: 50_713_000, largest: 40_000_000, used: 40, openTenders: 1, largestTender: 120_000_000, headroom: -20_000_000 });
    expect(ncaRow({ cap: null, values: [], tenders: [] })).toMatchObject({ used: null, headroom: null, largest: 0 });
  });

  it('time elapsed and schedule state', () => {
    expect(elapsedPct('2026-01-01', '2026-12-31', '2026-07-02')).toBe(50);
    expect(elapsedPct('2026-01-01', '2026-12-31', '2025-01-01')).toBe(0);
    expect(elapsedPct('2026-01-01', '2026-12-31', '2027-06-01')).toBe(100);
    expect(elapsedPct(null, '2026-12-31', '2026-06-01')).toBeNull();
    expect(scheduleState(30, 50)).toBe('BEHIND');
    expect(scheduleState(42, 50)).toBe('ON_TRACK');
    expect(scheduleState(10, null)).toBe('UNKNOWN');
  });

  it('totals only add numbers', () => {
    expect(totalsOf([{ a: 1.005, b: 'x' }, { a: 2, b: 3 }], ['a', 'b'], { code: 'Total' })).toEqual({ code: 'Total', a: 3.01, b: 3 });
  });

  it('report roles: payroll-sensitive reports never reach site-only roles', () => {
    for (const k of ['cost', 'cashflow', 'ipc', 'labour'] as const) {
      expect(REPORTS[k].roles).not.toEqual(expect.arrayContaining(['CON_STOREKEEPER']));
      expect(REPORTS[k].roles).not.toContain('CON_TIMEKEEPER');
      expect(REPORTS[k].roles).not.toContain('CON_SITE_SUPERVISOR');
    }
    expect(REPORT_ROLES).not.toContain('CON_STOREKEEPER');
  });

  it('exports a spreadsheet with header, rows and totals', async () => {
    const buf = await reportXlsx({ key: 'cost', title: 'Project cost vs BQ budget', subtitle: 'test', columns: [{ key: 'code', label: 'Code' }, { key: 'cost', label: 'Cost', type: 'money' }], rows: [{ code: 'PRJ-001', cost: 1234.5 }], totals: { code: 'Total', cost: 1234.5 }, notes: ['note'] }, 'Uriri Builders Ltd');
    const wb = new Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('Uriri Builders Ltd');
    expect(ws.getRow(5).values).toEqual([undefined, 'Code', 'Cost']);
    expect(ws.getCell('B6').value).toBe(1234.5);
    expect(ws.getCell('A7').value).toBe('Total');
  });
});
