import { nightDates } from '../../hotel/pricing.util';

// Short stays: pure rules (prices, clashes, calendar files, owner statements). Money in whole cents; dates "YYYY-MM-DD".

export const STAY_SOURCES = ['DIRECT', 'AIRBNB', 'BOOKING_COM', 'OTHER'] as const;
export type StaySource = (typeof STAY_SOURCES)[number];
export const SOURCE_LABEL: Record<StaySource | 'MANUAL', string> = {
  DIRECT: 'Direct',
  AIRBNB: 'Airbnb',
  BOOKING_COM: 'Booking.com',
  OTHER: 'Other site',
  MANUAL: 'Blocked',
};
export const STAY_PAYMENT_METHODS = ['CASH', 'MPESA', 'BANK', 'CARD', 'CHANNEL', 'OTHER'] as const;

const DAY_MS = 86_400_000;
export const ymd = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (date: string, n: number): string => ymd(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS));
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Friday and Saturday nights take the weekend rate when there is one. */
export function stayPrice(checkIn: string, checkOut: string, nightlyCents: number, weekendCents: number | null) {
  const nights = nightDates(checkIn, checkOut);
  const accommodationCents = nights.reduce((sum, d) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return sum + (weekendCents !== null && (dow === 5 || dow === 6) ? weekendCents : nightlyCents);
  }, 0);
  return { nights: nights.length, accommodationCents };
}

/** Two date ranges [start, end) share at least one night. A check-out day never clashes with an arrival. */
export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => aStart < bEnd && bStart < aEnd;

export interface CalendarEvent {
  uid: string;
  start: string;
  end: string;
  summary: string | null;
}

const icalDate = (v: string): string | null => {
  const m = v.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/**
 * The events in an iCal file (Airbnb, Booking.com, Vrbo, Google). Only dates matter: times are dropped, an event with no end
 * is one night, and events already over (or more than two years ahead) are skipped.
 */
export function parseIcal(text: string, today: string): CalendarEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events: CalendarEvent[] = [];
  const horizon = addDays(today, 730);
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      const start = cur.DTSTART ? icalDate(cur.DTSTART) : null;
      let end = cur.DTEND ? icalDate(cur.DTEND) : null;
      if (start) {
        if (!end || end <= start) end = addDays(start, 1);
        if (end > today && start < horizon) {
          events.push({ uid: (cur.UID || `${start}-${end}`).slice(0, 250), start, end, summary: cur.SUMMARY?.replace(/\\([,;\\])/g, '$1').slice(0, 200) || null });
        }
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i > 0) cur[line.slice(0, i).split(';')[0].toUpperCase()] = line.slice(i + 1).trim();
    }
  }
  return events;
}

const icalText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** An iCal file of busy dates for Airbnb / Booking.com to read. No guest names: just "Booked" or "Blocked". */
export function buildIcal(name: string, events: { uid: string; start: string; end: string; summary: string }[], now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ZARODA RENTALS//Short stays//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icalText(name)}`];
  for (const e of events) {
    out.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${e.start.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.end.replace(/-/g, '')}`, `SUMMARY:${icalText(e.summary)}`, 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

// Calendar addresses we will fetch: the booking sites hosts actually use. Anything else could point the server at itself.
const CALENDAR_HOSTS = [/(^|\.)airbnb\.[a-z.]{2,8}$/, /(^|\.)booking\.com$/, /(^|\.)vrbo\.com$/, /(^|\.)homeaway\.com$/, /(^|\.)expedia\.com$/, /(^|\.)google\.com$/, /(^|\.)tripadvisor\.com$/, /(^|\.)agoda\.com$/];

/** Why a calendar address cannot be used, or null when it can. */
export function calendarUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'That is not a web address. Copy the calendar link (it ends in .ics) from Airbnb or Booking.com.';
  }
  if (url.protocol !== 'https:') return 'The calendar link must start with https://';
  if (url.username || url.password || url.port) return 'That calendar link cannot be used';
  if (!CALENDAR_HOSTS.some((r) => r.test(url.hostname.toLowerCase()))) return 'Calendar links from Airbnb, Booking.com, Vrbo, Expedia, Agoda, Tripadvisor or Google Calendar only';
  return null;
}

export interface StayForMonth {
  checkIn: string;
  checkOut: string;
  accommodationCents: number;
  cleaningCents: number;
  channelCents: number;
}

/**
 * The part of a stay that belongs to a month: its nights in the month, and accommodation, cleaning and channel fees shared out
 * per night (the last night takes any odd cents, so the months always add up to the stay).
 */
export function monthShare(s: StayForMonth, monthFirst: string, nextMonthFirst: string) {
  const all = nightDates(s.checkIn, s.checkOut);
  const n = all.length;
  const idx = all.map((d, i) => (d >= monthFirst && d < nextMonthFirst ? i : -1)).filter((i) => i >= 0);
  const share = (cents: number) => idx.reduce((sum, i) => sum + (i === n - 1 ? cents - Math.floor(cents / n) * (n - 1) : Math.floor(cents / n)), 0);
  return { nights: idx.length, accommodationCents: share(s.accommodationCents), cleaningCents: share(s.cleaningCents), channelCents: share(s.channelCents) };
}

/** Owner's statement line for one unit and month. Commission is on the income after the channel's fee. */
export function ownerLine(stays: StayForMonth[], expensesCents: number, commissionPercent: number, monthFirst: string, nextMonthFirst: string) {
  const t = stays.map((s) => monthShare(s, monthFirst, nextMonthFirst)).reduce(
    (a, b) => ({ nights: a.nights + b.nights, accommodationCents: a.accommodationCents + b.accommodationCents, cleaningCents: a.cleaningCents + b.cleaningCents, channelCents: a.channelCents + b.channelCents }),
    { nights: 0, accommodationCents: 0, cleaningCents: 0, channelCents: 0 },
  );
  const grossCents = t.accommodationCents + t.cleaningCents;
  const netCents = grossCents - t.channelCents;
  const commissionCents = Math.round((netCents * commissionPercent) / 100);
  const daysInMonth = daysBetween(monthFirst, nextMonthFirst);
  return {
    ...t,
    occupancyPercent: Math.round((t.nights / daysInMonth) * 1000) / 10,
    grossCents,
    netCents,
    commissionCents,
    expensesCents,
    payableCents: netCents - commissionCents - expensesCents,
  };
}

export const money = (cents: number): string => `KES ${(cents / 100).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const nice = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export interface StayMessageFacts {
  business: string;
  guestName: string;
  unit: string;
  code: string;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  balanceCents: number;
  directions: string | null;
  doorCode: string | null;
  nextArrival?: string | null;
}

export type StayMessageKind = 'CONFIRMATION' | 'ARRIVAL' | 'THANK_YOU' | 'CLEANER';

/** The text of each message. Short enough for one or two SMS; email uses the same words. */
export function stayMessage(kind: StayMessageKind, f: StayMessageFacts): string {
  const first = f.guestName.split(' ')[0];
  if (kind === 'CONFIRMATION')
    return `${f.business}: Hi ${first}, your stay at ${f.unit} is booked, ${nice(f.checkIn)} to ${nice(f.checkOut)} (ref ${f.code}). Check-in from ${f.checkInTime}.${f.balanceCents > 0 ? ` Balance ${money(f.balanceCents)}.` : ''} We will send directions the day before.`;
  if (kind === 'ARRIVAL')
    return `${f.business}: Hi ${first}, see you tomorrow at ${f.unit}. Check-in from ${f.checkInTime}, check-out by ${f.checkOutTime} on ${nice(f.checkOut)}.${f.directions ? ` Directions: ${f.directions}.` : ''}${f.doorCode ? ` Door code: ${f.doorCode}.` : ''}${f.balanceCents > 0 ? ` Balance due ${money(f.balanceCents)}.` : ''}`;
  if (kind === 'THANK_YOU') return `${f.business}: Thank you for staying at ${f.unit}, ${first}. We hope to host you again - book direct next time.`;
  return `${f.business}: ${f.unit} has checked out (${f.code}). Please clean it today.${f.nextArrival ? ` Next guest arrives ${nice(f.nextArrival)}.` : ''}`;
}
