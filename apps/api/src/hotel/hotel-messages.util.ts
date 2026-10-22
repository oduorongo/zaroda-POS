// The texts a hotel sends its guests. Kept plain and short (one SMS), and built from the booking so they can be checked.

export type MessageKind =
  'CONFIRMATION' | 'REMINDER' | 'THANK_YOU' | 'CANCELLATION';

export interface MessageFacts {
  guestName: string;
  hotelName: string;
  bookingNumber: string;
  roomTypeName: string;
  rooms: number;
  checkIn: string;
  checkOut: string;
  total: number;
  paid: number;
  /** Cancellation only. */
  refundDue?: number;
  feeKept?: number;
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] || 'Guest';
const kes = (n: number) =>
  `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const stay = (f: MessageFacts) =>
  `${f.rooms > 1 ? `${f.rooms} x ` : ''}${f.roomTypeName}, ${f.checkIn} to ${f.checkOut}`;

export function hotelMessage(kind: MessageKind, f: MessageFacts): string {
  const hi = `Hi ${firstName(f.guestName)},`;
  switch (kind) {
    case 'CONFIRMATION': {
      const owing = Math.max(0, Math.round((f.total - f.paid) * 100) / 100);
      return `${hi} your booking ${f.bookingNumber} at ${f.hotelName} is confirmed: ${stay(f)}. ${f.paid > 0 ? `Paid ${kes(f.paid)}. ` : ''}${owing > 0 ? `Balance ${kes(owing)} at check-in. ` : ''}We look forward to seeing you.`;
    }
    case 'REMINDER':
      return `${hi} a reminder that you arrive tomorrow (${f.checkIn}) at ${f.hotelName}: ${stay(f)}, booking ${f.bookingNumber}. Safe travels!`;
    case 'THANK_YOU':
      return `${hi} thank you for staying at ${f.hotelName}. We hope you enjoyed it and would love to host you again.`;
    case 'CANCELLATION': {
      const kept = f.feeKept ?? 0;
      const back = f.refundDue ?? 0;
      return `${hi} your booking ${f.bookingNumber} at ${f.hotelName} (${stay(f)}) is cancelled.${kept > 0 ? ` The hotel keeps ${kes(kept)} under its cancellation policy.` : ''}${back > 0 ? ` ${kes(back)} will be refunded to you.` : ''}`;
    }
  }
}

/** The booking nights a "tomorrow" reminder is for, given today's date in Kenya: the day after. */
export function tomorrowOf(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}
