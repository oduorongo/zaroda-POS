import { doshsDueAt, maskId, maskPhone, musterTotals, needsDoshs, validIdNo } from './site.util';

describe('site and labour rules', () => {
  it('masks ID numbers and phones', () => {
    expect(maskId('12345678')).toBe('****5678');
    expect(maskId('123')).toBe('***');
    expect(maskId(null)).toBeNull();
    expect(maskPhone('0712 345 678')).toBe('0712***678');
    expect(maskPhone('+254712345678')).toBe('+254******678');
  });

  it('sets the DOSHS reporting deadline', () => {
    const at = new Date('2026-10-30T08:00:00Z');
    expect(doshsDueAt('FATAL', at)?.toISOString()).toBe('2026-10-31T08:00:00.000Z');
    expect(doshsDueAt('LOST_TIME', at)?.toISOString()).toBe('2026-11-06T08:00:00.000Z');
    expect(doshsDueAt('MINOR', at)).toBeNull();
    expect(needsDoshs('NEAR_MISS')).toBe(false);
  });

  it('counts muster days, half days as half', () => {
    expect(musterTotals(['PRESENT', 'HALF', 'ABSENT', 'PRESENT'])).toEqual({ present: 2, half: 1, absent: 1, days: 2.5 });
  });

  it('accepts national IDs and passports', () => {
    expect(validIdNo('23456789')).toBe(true);
    expect(validIdNo('AK1234567')).toBe(true);
    expect(validIdNo('12')).toBe(false);
    expect(validIdNo('hello')).toBe(false);
  });
});
