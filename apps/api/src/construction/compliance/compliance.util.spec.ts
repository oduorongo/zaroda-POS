import { alertKey, alertStage, alertText, capCheck, complianceHealth, daysLeft, expiryState } from './compliance.util';

describe('construction compliance rules', () => {
  const today = '2026-10-30';

  it('counts days to expiry', () => {
    expect(daysLeft('2026-11-29', today)).toBe(30);
    expect(daysLeft('2026-10-29', today)).toBe(-1);
  });

  it('colours documents green, amber within 60 days, red once expired', () => {
    expect(expiryState('2027-01-30', today)).toBe('OK');
    expect(expiryState('2026-12-29', today)).toBe('EXPIRING');
    expect(expiryState('2026-10-30', today)).toBe('EXPIRING');
    expect(expiryState('2026-10-29', today)).toBe('EXPIRED');
    expect(expiryState(null, today)).toBe('NO_EXPIRY');
  });

  it('raises the 60, 30 and 7 day alerts and the expired one', () => {
    expect(alertStage('2027-01-30', today)).toBeNull();
    expect(alertStage('2026-12-29', today)).toBe(60);
    expect(alertStage('2026-11-29', today)).toBe(30);
    expect(alertStage('2026-11-06', today)).toBe(7);
    expect(alertStage('2026-10-30', today)).toBe(7);
    expect(alertStage('2026-10-01', today)).toBe(0);
    expect(alertStage(null, today)).toBeNull();
  });

  it('keys an alert by document, expiry and stage so renewing starts afresh', () => {
    expect(alertKey('doc', 'a', '2026-12-01', 30)).not.toBe(alertKey('doc', 'a', '2027-12-01', 30));
    expect(alertText('WIBA', '2026-11-06', 7).title).toBe('WIBA expires in 7 days');
    expect(alertText('WIBA', '2026-10-01', 0).title).toBe('WIBA has expired');
  });

  it('rates compliance health', () => {
    expect(complianceHealth(['OK', 'NO_EXPIRY'], 0)).toBe('GOOD');
    expect(complianceHealth(['OK', 'EXPIRING'], 0)).toBe('ATTENTION');
    expect(complianceHealth(['OK'], 1)).toBe('ATTENTION');
    expect(complianceHealth(['EXPIRED', 'OK'], 0)).toBe('CRITICAL');
  });

  it('blocks work above the NCA cap', () => {
    expect(capCheck(90_000_000, 100_000_000, 5, 'BUILDING').ok).toBe(true);
    const over = capCheck(120_000_000, 100_000_000, 5, 'BUILDING');
    expect(over.ok).toBe(false);
    expect(over.reason).toContain('NCA5');
    expect(capCheck(5_000_000_000, null, 1, 'ROADS_CIVIL').ok).toBe(true);
    expect(capCheck(1, 10, null, 'ELEC_MECH').ok).toBe(false);
  });
});
