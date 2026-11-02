import { buildIcal, calendarUrlProblem, monthShare, overlaps, ownerLine, parseIcal, stayMessage, stayPrice } from './stays.util';

describe('short stays rules', () => {
  it('prices Friday and Saturday nights at the weekend rate', () => {
    // 2026-11-05 is a Thursday: Thu, Fri, Sat nights.
    expect(stayPrice('2026-11-05', '2026-11-08', 500000, 700000)).toEqual({ nights: 3, accommodationCents: 1900000 });
    expect(stayPrice('2026-11-05', '2026-11-08', 500000, null)).toEqual({ nights: 3, accommodationCents: 1500000 });
  });

  it('never clashes a check-out day with an arrival', () => {
    expect(overlaps('2026-11-05', '2026-11-08', '2026-11-08', '2026-11-10')).toBe(false);
    expect(overlaps('2026-11-05', '2026-11-08', '2026-11-07', '2026-11-10')).toBe(true);
    expect(overlaps('2026-11-05', '2026-11-08', '2026-11-01', '2026-11-20')).toBe(true);
  });

  it('reads Airbnb and Booking.com calendars, folded lines included, and skips past events', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261110',
      'DTEND;VALUE=DATE:20261113',
      'UID:abc@airbnb.com',
      'SUMMARY:Reserved',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20261120T140000Z',
      'UID:long-uid-',
      ' continued',
      'SUMMARY:Airbnb (Not available)',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261001',
      'DTEND;VALUE=DATE:20261003',
      'UID:old',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcal(ics, '2026-11-02')).toEqual([
      { uid: 'abc@airbnb.com', start: '2026-11-10', end: '2026-11-13', summary: 'Reserved' },
      { uid: 'long-uid-continued', start: '2026-11-20', end: '2026-11-21', summary: 'Airbnb (Not available)' },
    ]);
  });

  it('writes a calendar the booking sites can read back', () => {
    const ics = buildIcal('A4, Kilimani', [{ uid: 'x@zaroda', start: '2026-11-10', end: '2026-11-12', summary: 'Booked' }], new Date('2026-11-02T08:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261110');
    expect(ics).toContain('X-WR-CALNAME:A4\\, Kilimani');
    expect(parseIcal(ics, '2026-11-02')).toEqual([{ uid: 'x@zaroda', start: '2026-11-10', end: '2026-11-12', summary: 'Booked' }]);
  });

  it('only fetches calendars from booking sites over https', () => {
    expect(calendarUrlProblem('https://www.airbnb.com/calendar/ical/123.ics?s=abc')).toBeNull();
    expect(calendarUrlProblem('https://ical.booking.com/v1/export?t=1')).toBeNull();
    expect(calendarUrlProblem('http://www.airbnb.com/x.ics')).toMatch(/https/);
    expect(calendarUrlProblem('https://169.254.169.254/latest')).toMatch(/only/);
    expect(calendarUrlProblem('https://airbnb.com.evil.io/x.ics')).toMatch(/only/);
    expect(calendarUrlProblem('not a url')).toMatch(/not a web address/);
  });

  it('shares a stay across months per night and the months add up', () => {
    const s = { checkIn: '2026-10-30', checkOut: '2026-11-02', accommodationCents: 1000000, cleaningCents: 100000, channelCents: 30001 };
    const oct = monthShare(s, '2026-10-01', '2026-11-01');
    const nov = monthShare(s, '2026-11-01', '2026-12-01');
    expect(oct.nights + nov.nights).toBe(3);
    expect(oct.accommodationCents + nov.accommodationCents).toBe(1000000);
    expect(oct.channelCents + nov.channelCents).toBe(30001);
    expect(nov.nights).toBe(1);
  });

  it("works out what is payable to a unit's owner", () => {
    const line = ownerLine([{ checkIn: '2026-11-05', checkOut: '2026-11-08', accommodationCents: 1500000, cleaningCents: 150000, channelCents: 50000 }], 200000, 20, '2026-11-01', '2026-12-01');
    expect(line).toMatchObject({ nights: 3, grossCents: 1650000, netCents: 1600000, commissionCents: 320000, expensesCents: 200000, payableCents: 1080000, occupancyPercent: 10 });
  });

  it('puts the door code only in the arrival message', () => {
    const f = { business: 'Kilimani Stays', guestName: 'Achieng Otieno', unit: 'A4', code: 'ST-0001', checkIn: '2026-11-05', checkOut: '2026-11-08', checkInTime: '14:00', checkOutTime: '10:00', balanceCents: 0, directions: 'Gate 2', doorCode: '4821' };
    expect(stayMessage('CONFIRMATION', f)).not.toContain('4821');
    expect(stayMessage('ARRIVAL', f)).toContain('Door code: 4821');
    expect(stayMessage('ARRIVAL', f)).toContain('Hi Achieng');
  });
});
