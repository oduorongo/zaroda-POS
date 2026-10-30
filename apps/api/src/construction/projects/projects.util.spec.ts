import { nextCode, parseBq, parseCsv, programmeProgress, statusChecks, toNumber } from './projects.util';

const base = { permits: {}, ncaProjectRegRule: 'BLOCK' as const, wibaValid: true, bqTotal: 100, contractSum: 100, hasClient: true };

describe('project status rules', () => {
  it('only moves forward', () => {
    expect(statusChecks({ ...base, from: 'PLANNING', to: 'DLP' }).blocks[0]).toContain('cannot go from PLANNING to DLP');
    expect(statusChecks({ ...base, from: 'CLOSED', to: 'ACTIVE' }).blocks).toHaveLength(1);
  });

  it('blocks ACTIVE without the NCA project registration, or only warns when set to', () => {
    expect(statusChecks({ ...base, from: 'PLANNING', to: 'ACTIVE' }).blocks).toEqual(['The NCA project registration is not recorded as approved.']);
    const warn = statusChecks({ ...base, ncaProjectRegRule: 'WARN', from: 'PLANNING', to: 'ACTIVE' });
    expect(warn.blocks).toEqual([]);
    expect(warn.warnings[0]).toContain('NCA project registration');
  });

  it('warns about county plans, permit, NEMA, DOSHS, WIBA, client and the BQ total', () => {
    const r = statusChecks({ ...base, permits: { NCA_PROJECT_REG: 'APPROVED' }, wibaValid: false, hasClient: false, bqTotal: 90, from: 'PLANNING', to: 'ACTIVE' });
    expect(r.blocks).toEqual([]);
    expect(r.warnings).toHaveLength(7);
    expect(r.warnings.at(-1)).toContain('difference KES -10');
  });

  it('is clear when everything is in place; NEMA can be not required', () => {
    const permits = { NCA_PROJECT_REG: 'APPROVED', COUNTY_APPROVAL: 'APPROVED', BUILDING_PERMIT: 'APPROVED', NEMA_EIA: 'NOT_REQUIRED', DOSHS_REG: 'APPROVED' } as const;
    expect(statusChecks({ ...base, permits, from: 'PLANNING', to: 'ACTIVE' })).toEqual({ blocks: [], warnings: [] });
  });

  it('warns about the occupancy certificate before closing', () => {
    expect(statusChecks({ ...base, from: 'DLP', to: 'CLOSED' }).warnings).toEqual(['The occupancy certificate is not recorded.']);
    expect(statusChecks({ ...base, from: 'PLANNING', to: 'CLOSED' }).warnings).toEqual([]);
  });
});

describe('programme and codes', () => {
  it('weights progress by milestone length', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(programmeProgress([{ startDate: d('2026-01-01'), endDate: d('2026-01-10'), percentComplete: 100 }, { startDate: d('2026-01-11'), endDate: d('2026-02-09'), percentComplete: 0 }])).toBe(25);
    expect(programmeProgress([])).toBe(0);
  });

  it('numbers projects', () => {
    expect(nextCode('PRJ', [])).toBe('PRJ-001');
    expect(nextCode('PRJ', ['PRJ-001', 'PRJ-009', 'OTHER'])).toBe('PRJ-010');
  });
});

describe('BQ import', () => {
  const header = ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'];

  it('reads sections, items, lump sums and skips totals', () => {
    const r = parseBq([
      {
        name: 'Bill 1',
        rows: [
          ['URIRI DAY SECONDARY', null, null, null, null, null],
          header,
          [null, 'BILL NO. 1 - PRELIMINARIES', null, null, null, null],
          ['A', 'Site establishment', 'Item', null, null, '250,000'],
          [null, 'BILL NO. 2 - SUBSTRUCTURE', null, null, null, null],
          ['A', 'Excavate oversite', 'm²', 120, 85, 10200],
          ['B', 'Concrete class 20', 'm³', '18.5', '14,500', '268,250.00'],
          [null, 'Carried to collection', null, null, null, 528450],
        ],
      },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.sections.map((s) => [s.name, s.items.length])).toEqual([['BILL NO. 1 - PRELIMINARIES', 1], ['BILL NO. 2 - SUBSTRUCTURE', 2]]);
    expect(r.sections[0].items[0]).toMatchObject({ qty: 1, rate: 250000, amount: 250000 });
    expect(r.total).toBe(528450);
  });

  it('reports rows it cannot use, and amounts that do not match', () => {
    const r = parseBq([{ name: 'S', rows: [header, [null, 'Walling', null, null, null, null], ['A', 'Blockwork', null, 10, 5, 50], ['B', 'Plaster', 'm²', 10, null, null], ['C', 'Paint', 'm²', 10, 100, 900]] }]);
    expect(r.errors).toEqual(['row 3: "Blockwork" needs a unit.', 'row 4: "Plaster" needs a quantity and a rate.']);
    expect(r.warnings).toEqual(['row 5: the sheet says 900 but 10 x 100 = 1000; 1000 is used.']);
    expect(r.total).toBe(1000);
  });

  it('needs a header row', () => {
    expect(parseBq([{ name: 'x', rows: [['a', 'b']] }]).errors[0]).toContain('No header row');
  });

  it('uses the sheet name when items come before any heading, across sheets', () => {
    const r = parseBq([
      { name: 'Cover', rows: [['Tender for classrooms']] },
      { name: 'Roofing', rows: [['Description', 'Unit', 'Quantity', 'Rate'], ['Iron sheets', 'pcs', 40, 950]] },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.sections[0]).toMatchObject({ name: 'Roofing', items: [{ amount: 38000 }] });
  });

  it('reads numbers and CSV the way Excel writes them', () => {
    expect(toNumber('KShs 1,250.50')).toBe(1250.5);
    expect(toNumber('-')).toBeNull();
    expect(parseCsv('a,"b, c",3\r\n"say ""hi""",,4\n')).toEqual([['a', 'b, c', '3'], ['say "hi"', null, '4']]);
  });
});
