import {
  auditClosable,
  autoAuditDate,
  dayAfter,
  dayBefore,
  isNoShow,
  kenyaClock,
  overstayNights,
} from './night-audit.util';

// Kenya is UTC+3: 2026-11-05T21:30Z is already 00:30 on the 6th there.
const at = (iso: string) => new Date(iso);

describe('kenyaClock', () => {
  it('reads the date and hour in Kenya', () => {
    expect(kenyaClock(at('2026-11-05T09:00:00Z'))).toEqual({
      date: '2026-11-05',
      hour: 12,
    });
    expect(kenyaClock(at('2026-11-05T21:30:00Z'))).toEqual({
      date: '2026-11-06',
      hour: 0,
    });
  });
});

describe('dayBefore / dayAfter', () => {
  it('cross month and year ends', () => {
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
  });
});

describe('auditClosable', () => {
  it('a day that is over can always be closed', () => {
    expect(auditClosable('2026-11-04', at('2026-11-05T05:00:00Z'), 18).ok).toBe(
      true,
    );
  });
  it('today only after the cut-off hour', () => {
    const early = auditClosable('2026-11-05', at('2026-11-05T09:00:00Z'), 18); // 12:00 in Kenya
    expect(early.ok).toBe(false);
    expect(auditClosable('2026-11-05', at('2026-11-05T15:30:00Z'), 18).ok).toBe(
      true,
    ); // 18:30
  });
  it('never the future', () => {
    expect(auditClosable('2026-11-06', at('2026-11-05T20:00:00Z'), 0)).toEqual({
      ok: false,
      reason: 'That day has not happened yet',
    });
  });
});

describe('autoAuditDate', () => {
  it('is null before the audit hour and yesterday after it', () => {
    expect(autoAuditDate(at('2026-11-04T22:30:00Z'), 3)).toBeNull(); // 01:30 on the 5th in Kenya
    expect(autoAuditDate(at('2026-11-05T00:30:00Z'), 3)).toBe('2026-11-04'); // 03:30 on the 5th in Kenya
    expect(autoAuditDate(at('2026-11-05T12:00:00Z'), 3)).toBe('2026-11-04');
  });
});

describe('overstayNights', () => {
  it('charges each night from the booked check-out day up to the audited day', () => {
    expect(overstayNights('2026-11-05', '2026-11-05')).toEqual(['2026-11-05']);
    expect(overstayNights('2026-11-05', '2026-11-07')).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
  });
  it('a guest not past their date has none', () => {
    expect(overstayNights('2026-11-06', '2026-11-05')).toEqual([]);
  });
});

describe('isNoShow', () => {
  it('only an unpaid confirmed booking whose arrival has passed', () => {
    expect(
      isNoShow(
        { status: 'CONFIRMED', checkIn: '2026-11-05', paid: 0 },
        '2026-11-05',
      ),
    ).toBe(true);
    expect(
      isNoShow(
        { status: 'CONFIRMED', checkIn: '2026-11-04', paid: 0 },
        '2026-11-05',
      ),
    ).toBe(true);
    expect(
      isNoShow(
        { status: 'CONFIRMED', checkIn: '2026-11-06', paid: 0 },
        '2026-11-05',
      ),
    ).toBe(false);
    expect(
      isNoShow(
        { status: 'CONFIRMED', checkIn: '2026-11-05', paid: 500 },
        '2026-11-05',
      ),
    ).toBe(false);
    expect(
      isNoShow(
        { status: 'CHECKED_IN', checkIn: '2026-11-05', paid: 0 },
        '2026-11-05',
      ),
    ).toBe(false);
  });
});
