import {
  bookingNightFigures,
  csvCell,
  daysInRange,
  nightsInPeriod,
  periodMetrics,
  toCsv,
} from './report.util';

describe('periodMetrics', () => {
  it('occupancy, ADR and RevPAR for a simple week', () => {
    // 10 rooms, 7 days = 70 room nights available; 35 sold for KES 175,000
    const m = periodMetrics({
      rooms: 10,
      days: 7,
      roomNightsSold: 35,
      roomRevenue: 175_000,
    });
    expect(m).toEqual({
      availableRoomNights: 70,
      occupancyPercent: 50,
      adr: 5000,
      revpar: 2500,
    });
  });
  it('ADR is per room night sold, RevPAR per room night available', () => {
    const m = periodMetrics({
      rooms: 8,
      days: 30,
      roomNightsSold: 100,
      roomRevenue: 333_333.33,
    });
    expect(m.adr).toBe(3333.33);
    expect(m.revpar).toBeCloseTo((m.adr * m.occupancyPercent) / 100, -1);
  });
  it('an empty hotel or an empty period gives zeros, not NaN', () => {
    expect(
      periodMetrics({ rooms: 0, days: 7, roomNightsSold: 0, roomRevenue: 0 }),
    ).toEqual({
      availableRoomNights: 0,
      occupancyPercent: 0,
      adr: 0,
      revpar: 0,
    });
    expect(
      periodMetrics({ rooms: 5, days: 7, roomNightsSold: 0, roomRevenue: 0 }),
    ).toMatchObject({ occupancyPercent: 0, adr: 0, revpar: 0 });
  });
  it('occupancy never goes above 100% even when the data over-sold', () => {
    expect(
      periodMetrics({ rooms: 2, days: 1, roomNightsSold: 3, roomRevenue: 3000 })
        .occupancyPercent,
    ).toBe(100);
  });
});

describe('daysInRange / nightsInPeriod', () => {
  it('lists both ends', () => {
    expect(daysInRange('2026-11-01', '2026-11-03')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(daysInRange('2026-11-03', '2026-11-01')).toEqual([]);
  });
  it('counts only the nights inside the period', () => {
    expect(
      nightsInPeriod('2026-10-30', '2026-11-03', '2026-11-01', '2026-11-30'),
    ).toBe(2);
    expect(
      nightsInPeriod('2026-11-28', '2026-12-03', '2026-11-01', '2026-11-30'),
    ).toBe(3);
    expect(
      nightsInPeriod('2026-11-05', '2026-11-06', '2026-11-01', '2026-11-30'),
    ).toBe(1);
  });
  it('a stay that leaves on the first day of the period, or lies outside it, has no night in it', () => {
    expect(
      nightsInPeriod('2026-10-30', '2026-11-01', '2026-11-01', '2026-11-30'),
    ).toBe(0);
    expect(
      nightsInPeriod('2026-12-01', '2026-12-03', '2026-11-01', '2026-11-30'),
    ).toBe(0);
  });
});

describe('csv with formula protection', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
  it('defuses anything a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(
      `"'=HYPERLINK(""http://evil"")"`,
    );
    expect(csvCell('+254700000000')).toBe("'+254700000000");
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
  });
  it('real negative numbers stay numbers', () => {
    expect(csvCell(-250.5)).toBe('-250.5');
    expect(csvCell(0)).toBe('0');
  });
  it('null and undefined are empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('builds rows with a header', () => {
    expect(
      toCsv(
        ['Name', 'Amount'],
        [
          ['Ann', 100],
          ['=cmd', -5],
        ],
      ),
    ).toBe("Name,Amount\r\nAnn,100\r\n'=cmd,-5\r\n");
  });
});

describe('bookingNightFigures', () => {
  const stay = {
    checkIn: '2026-11-05',
    checkOut: '2026-11-08',
    rooms: 2,
    pricePerNight: 5000,
  };
  it('an old booking earns its price per room per night', () => {
    expect(bookingNightFigures(stay, '2026-11-01', '2026-11-30')).toEqual([
      { date: '2026-11-05', rooms: 2, revenue: 10000 },
      { date: '2026-11-06', rooms: 2, revenue: 10000 },
      { date: '2026-11-07', rooms: 2, revenue: 10000 },
    ]);
  });
  it('uses each night as it was priced when the booking has that', () => {
    const r = bookingNightFigures(
      {
        ...stay,
        nights: [
          { date: '2026-11-05', total: 9000 },
          { date: '2026-11-06', total: 12000 },
          { date: '2026-11-07', total: 12000 },
        ],
      },
      '2026-11-01',
      '2026-11-30',
    );
    expect(r.map((n) => n.revenue)).toEqual([9000, 12000, 12000]);
  });
  it('only the nights inside the period, and the check-out day is not a night', () => {
    expect(
      bookingNightFigures(stay, '2026-11-06', '2026-11-06').map((n) => n.date),
    ).toEqual(['2026-11-06']);
    expect(bookingNightFigures(stay, '2026-11-08', '2026-11-20')).toEqual([]);
    expect(
      bookingNightFigures(stay, '2026-11-01', '2026-11-05').map((n) => n.date),
    ).toEqual(['2026-11-05']);
  });
  it('feeds the occupancy maths end to end', () => {
    const nights = bookingNightFigures(stay, '2026-11-05', '2026-11-11');
    const sold = nights.reduce((s, n) => s + n.rooms, 0);
    const revenue = nights.reduce((s, n) => s + n.revenue, 0);
    expect(
      periodMetrics({
        rooms: 4,
        days: 7,
        roomNightsSold: sold,
        roomRevenue: revenue,
      }),
    ).toEqual({
      availableRoomNights: 28,
      occupancyPercent: 21.43,
      adr: 5000,
      revpar: 1071.43,
    });
  });
});
