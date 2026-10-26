import { certificateStatus, withheldTotals } from './school-withholding.util';

describe('certificateStatus', () => {
  it('has come once a number is recorded', () => {
    expect(certificateStatus('WHT-123', '2026-01-01', '2026-12-01')).toBe(
      'RECEIVED',
    );
    expect(certificateStatus('  ', '2026-10-01', '2026-10-05')).toBe('WAITING');
  });
  it('is expected for 30 days, then it is missing', () => {
    expect(certificateStatus(null, '2026-10-01', '2026-10-31')).toBe('WAITING');
    expect(certificateStatus(null, '2026-10-01', '2026-11-01')).toBe('MISSING');
  });
});

describe('withheldTotals', () => {
  it('adds up what was withheld, what has its certificate and what has not, by school', () => {
    const t = withheldTotals([
      { schoolId: 'a', schoolName: 'A', amount: 300.5, hasCertificate: true },
      { schoolId: 'a', schoolName: 'A', amount: 100.25, hasCertificate: false },
      { schoolId: 'b', schoolName: 'B', amount: 900, hasCertificate: false },
    ]);
    expect(t.withheld).toBe(1300.75);
    expect(t.withCertificate).toBe(300.5);
    expect(t.withoutCertificate).toBe(1000.25);
    expect(t.bySchool.map((s) => s.schoolId)).toEqual(['b', 'a']);
    expect(t.bySchool[1]).toMatchObject({
      withheld: 400.75,
      withoutCertificate: 100.25,
    });
  });
  it('is zero with nothing', () => {
    expect(withheldTotals([])).toMatchObject({
      withheld: 0,
      withoutCertificate: 0,
      bySchool: [],
    });
  });
});
