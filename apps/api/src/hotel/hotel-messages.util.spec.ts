import { hotelMessage, tomorrowOf } from './hotel-messages.util';

const facts = {
  guestName: 'Wanjiru Kamau',
  hotelName: 'Sea View Hotel',
  bookingNumber: 'ZB-ABC123',
  roomTypeName: 'Deluxe',
  rooms: 1,
  checkIn: '2026-11-05',
  checkOut: '2026-11-07',
  total: 10000,
  paid: 2000,
};

describe('hotelMessage', () => {
  it('a confirmation names the booking, the stay, what was paid and what is left', () => {
    const t = hotelMessage('CONFIRMATION', facts);
    expect(t).toContain('Hi Wanjiru,');
    expect(t).toContain('ZB-ABC123');
    expect(t).toContain('Sea View Hotel');
    expect(t).toContain('Deluxe, 2026-11-05 to 2026-11-07');
    expect(t).toContain('Paid KES 2,000');
    expect(t).toContain('Balance KES 8,000');
  });
  it('a fully paid booking has no balance line; nothing paid has no paid line', () => {
    expect(
      hotelMessage('CONFIRMATION', { ...facts, paid: 10000 }),
    ).not.toContain('Balance');
    expect(hotelMessage('CONFIRMATION', { ...facts, paid: 0 })).not.toContain(
      'Paid',
    );
  });
  it('several rooms are mentioned', () => {
    expect(hotelMessage('CONFIRMATION', { ...facts, rooms: 3 })).toContain(
      '3 x Deluxe',
    );
  });
  it('a reminder says the guest arrives tomorrow', () => {
    expect(hotelMessage('REMINDER', facts)).toMatch(
      /arrive tomorrow \(2026-11-05\)/,
    );
  });
  it('a thank-you is short and warm', () => {
    const t = hotelMessage('THANK_YOU', facts);
    expect(t).toContain('thank you');
    expect(t.length).toBeLessThan(160);
  });
  it('a cancellation says what the hotel keeps and what goes back, and omits what is zero', () => {
    const both = hotelMessage('CANCELLATION', {
      ...facts,
      feeKept: 1000,
      refundDue: 1000,
    });
    expect(both).toContain('keeps KES 1,000');
    expect(both).toContain('KES 1,000 will be refunded');
    const free = hotelMessage('CANCELLATION', {
      ...facts,
      feeKept: 0,
      refundDue: 2000,
    });
    expect(free).not.toContain('keeps');
    expect(free).toContain('KES 2,000 will be refunded');
    const nothing = hotelMessage('CANCELLATION', {
      ...facts,
      feeKept: 0,
      refundDue: 0,
    });
    expect(nothing).not.toContain('refunded');
  });
  it('a single-word or odd name still makes a greeting', () => {
    expect(hotelMessage('THANK_YOU', { ...facts, guestName: 'Ng' })).toContain(
      'Hi Ng,',
    );
    expect(hotelMessage('THANK_YOU', { ...facts, guestName: '   ' })).toContain(
      'Hi Guest,',
    );
  });
});

describe('tomorrowOf', () => {
  it('is the next calendar day', () => {
    expect(tomorrowOf('2026-11-05')).toBe('2026-11-06');
    expect(tomorrowOf('2026-12-31')).toBe('2027-01-01');
  });
});
