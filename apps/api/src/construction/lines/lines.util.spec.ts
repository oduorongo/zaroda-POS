import { epraCheck, EPRA_CLASSES } from '../compliance/compliance.util';
import { clientBalances, moveProblem, sectionProgress } from './lines.util';

describe('power-line work', () => {
  const classes = EPRA_CLASSES.map((c) => ({ code: c.code, anyVoltage: c.anyVoltage, maxVoltageKv: null as number | null }));

  it('EPRA: a valid A1 licence covers any line; none, an expired one, or a class with no limit set does not', () => {
    expect(epraCheck(33, [{ epraClass: 'A1', expiresAt: '2027-12-31' }], classes, '2026-11-02').ok).toBe(true);
    expect(epraCheck(11, [], classes, '2026-11-02')).toMatchObject({ ok: false });
    expect(epraCheck(11, [{ epraClass: 'A1', expiresAt: '2026-11-01' }], classes, '2026-11-02').ok).toBe(false);
    expect(epraCheck(0.415, [{ epraClass: 'B', expiresAt: null }], classes, '2026-11-02').reason).toMatch(/class B/);
    const set = classes.map((c) => (c.code === 'B' ? { ...c, maxVoltageKv: 11 } : c));
    expect(epraCheck(11, [{ epraClass: 'B', expiresAt: null }], set, '2026-11-02').ok).toBe(true);
    expect(epraCheck(33, [{ epraClass: 'B', expiresAt: null }], set, '2026-11-02').ok).toBe(false);
  });

  it('client materials: received less issued, returned and damaged is on hand; you cannot issue more than that', () => {
    const b = clientBalances([
      { itemId: 'pole', kind: 'RECEIVED', quantity: 100 },
      { itemId: 'pole', kind: 'ISSUED', quantity: 60 },
      { itemId: 'pole', kind: 'RETURNED', quantity: 5 },
      { itemId: 'pole', kind: 'DAMAGED', quantity: 2 },
      { itemId: 'acsr', kind: 'RECEIVED', quantity: 12.5 },
      { itemId: 'acsr', kind: 'ISSUED', quantity: 4.3 },
    ]);
    expect(b.get('pole')).toEqual({ received: 100, issued: 60, returned: 5, damaged: 2, onHand: 33 });
    expect(b.get('acsr')?.onHand).toBe(8.2);
    expect(moveProblem('ISSUED', 34, 33)).toMatch(/Only 33 on hand/);
    expect(moveProblem('ISSUED', 33, 33)).toBeNull();
    expect(moveProblem('RECEIVED', 1000, 0)).toBeNull();
  });

  it('section progress: done against target per measure, overall the average of measures with a target', () => {
    const p = sectionProgress({ targetPoles: 100, targetConductorKm: 5, targetStays: 0 }, [{ poles: 30, conductorKm: 1.5 }, { poles: 20, conductorKm: 1 }]);
    expect(p.measures.find((m) => m.measure === 'poles')).toMatchObject({ done: 50, target: 100, percent: 50 });
    expect(p.measures.find((m) => m.measure === 'conductorKm')).toMatchObject({ done: 2.5, percent: 50 });
    expect(p.measures.find((m) => m.measure === 'stays')?.percent).toBeNull();
    expect(p.percent).toBe(50);
    expect(sectionProgress({ targetPoles: 10 }, [{ poles: 15 }]).percent).toBe(100);
  });
});
