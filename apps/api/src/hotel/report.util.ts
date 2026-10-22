// The numbers on the hotel reports, as plain functions so they can be checked. Money in whole cents.

const cents = (n: number) => Math.round(n * 100);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PeriodFigures {
  /** How many rooms the hotel has (active physical rooms, else the room types' quantities added up). */
  rooms: number;
  /** Days in the report, from the first to the last day, both included. */
  days: number;
  /** Room nights sold in the period (a booked room for one night = 1). */
  roomNightsSold: number;
  /** Room revenue in the period, WITHOUT tax. */
  roomRevenue: number;
}

export interface PeriodMetrics {
  availableRoomNights: number;
  occupancyPercent: number;
  /** Average daily rate: room revenue per room night SOLD. */
  adr: number;
  /** Revenue per available room: room revenue per room night AVAILABLE. */
  revpar: number;
}

export function periodMetrics(f: PeriodFigures): PeriodMetrics {
  const available = Math.max(0, f.rooms) * Math.max(0, f.days);
  const sold = Math.min(Math.max(0, f.roomNightsSold), available);
  return {
    availableRoomNights: available,
    occupancyPercent: available === 0 ? 0 : round2((sold / available) * 100),
    adr:
      f.roomNightsSold <= 0
        ? 0
        : round2(cents(f.roomRevenue) / 100 / f.roomNightsSold),
    revpar:
      available === 0 ? 0 : round2(cents(f.roomRevenue) / 100 / available),
  };
}

/** The days of a report, first to last, both included. */
export function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** How many nights of a stay fall inside a report period (the check-out day is not a night). */
export function nightsInPeriod(
  checkIn: string,
  checkOut: string,
  from: string,
  to: string,
): number {
  const start = checkIn > from ? checkIn : from;
  const lastNight = new Date(Date.parse(`${checkOut}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const end = lastNight < to ? lastNight : to;
  return start > end ? 0 : daysInRange(start, end).length;
}

// ── CSV ──────────────────────────────────────────────────────────────────

/** One CSV cell. Text a spreadsheet would run as a formula (starts with = + - @ tab or return) gets a leading apostrophe. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (
    /^[=+\-@\t\r]/.test(s) &&
    !(typeof value === 'number' && Number.isFinite(value))
  )
    s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return (
    [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  );
}

// ── Per-night figures of a booking ───────────────────────────────────────

export interface BookingForReport {
  checkIn: string;
  checkOut: string;
  rooms: number;
  pricePerNight: number;
  /** The nights as priced when the booking was made or last changed (each night's price for all its rooms, before tax). */
  nights?: { date: string; total: number }[] | null;
}

/** For every night of a booking inside the period: the rooms it has and what those rooms earn, before tax. */
export function bookingNightFigures(
  b: BookingForReport,
  from: string,
  to: string,
): { date: string; rooms: number; revenue: number }[] {
  const priced = new Map((b.nights ?? []).map((n) => [n.date, n.total]));
  const out: { date: string; rooms: number; revenue: number }[] = [];
  const first = b.checkIn > from ? b.checkIn : from;
  for (const date of daysInRange(first, to)) {
    if (date >= b.checkOut) break;
    out.push({
      date,
      rooms: b.rooms,
      revenue:
        priced.get(date) ?? Math.round(b.pricePerNight * b.rooms * 100) / 100,
    });
  }
  return out;
}
