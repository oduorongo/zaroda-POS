export type RoomStatus = "VACANT_CLEAN" | "VACANT_DIRTY" | "OCCUPIED" | "OUT_OF_ORDER";

export interface Room {
  id: string;
  number: string;
  floor: string | null;
  status: RoomStatus;
  notes: string | null;
  isActive: boolean;
  roomTypeId: string;
  roomTypeName: string;
  guest: { bookingId: string; bookingNumber: string; name: string; checkOut: string } | null;
}

export interface DeskBooking {
  id: string;
  bookingNumber: string;
  status: string;
  source: "MARKETPLACE" | "FRONT_DESK" | "PHONE";
  guestName: string;
  guestPhone: string;
  idNumber: string | null;
  nationality: string | null;
  guests: number;
  adults: number;
  children: number;
  mealPlan: MealPlan;
  guestId: string | null;
  rooms: number;
  roomTypeId: string;
  roomTypeName: string;
  roomNumbers: string[];
  checkIn: string;
  checkOut: string;
  nights: number;
  pricePerNight: number;
  total: number;
  notes: string | null;
  balance: number | null;
  paid: number;
}

export interface Board {
  date: string;
  arrivals: DeskBooking[];
  inHouse: DeskBooking[];
  departures: DeskBooking[];
  rooms: Room[];
  roomCounts: Record<RoomStatus, number>;
}

export interface RoomType {
  id: string;
  name: string;
  pricePerNight: number;
  maxGuests: number;
  quantity: number;
  isActive: boolean;
}

export type MealPlan = "ROOM_ONLY" | "BED_BREAKFAST" | "HALF_BOARD" | "FULL_BOARD";
export const MEAL_LABEL: Record<MealPlan, string> = { ROOM_ONLY: "Room only", BED_BREAKFAST: "Bed & breakfast", HALF_BOARD: "Half board", FULL_BOARD: "Full board" };

/** What a stay would cost: each night, then the taxes on top (POST /hotel/bookings/quote). */
export interface StayQuote {
  nights: { date: string; rate: number; source: string; seasonName: string | null; extraCharge: number; mealCharge: number; total: number; tax: number }[];
  subtotal: number;
  roomTotal: number;
  extraTotal: number;
  mealTotal: number;
  taxes: { name: string; percent: number; amount: number }[];
  tax: number;
  total: number;
  averageRate: number;
}

export interface GuestSummary {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  idNumber: string | null;
  nationality: string | null;
  vehicleReg: string | null;
  smsOptOut: boolean;
  stays?: number;
}

export interface FolioEntry {
  id: string;
  type: "ROOM_NIGHT" | "CHARGE" | "PAYMENT" | "REFUND" | "ADJUSTMENT";
  amount: number;
  taxAmount: number;
  description: string;
  taxBreakdown?: Record<string, number> | null;
  nightDate: string | null;
  method: string | null;
  reference: string | null;
  createdAt: string;
}

export interface Folio {
  booking: { id: string; bookingNumber: string; status: string; guestName: string; guestPhone: string; roomTypeName: string; checkIn: string; checkOut: string; nights: number; rooms: number; pricePerNight: number; roomNumbers: string[] };
  entries: FolioEntry[];
  totals: { roomNights: number; roomTax: number; charges: number; adjustments: number; payments: number; refunds: number; balance: number };
  business: { name: string; kraPin: string | null; address: string | null; phone: string | null; email: string | null; invoiceFooter: string | null } | null;
  printedOn: string;
}

export const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const METHOD_LABEL: Record<string, string> = { CASH: "Cash", MPESA_RECEIPT: "M-Pesa", CARD: "Card", MPESA: "M-Pesa", ROOM_CHARGE: "Room account" };
export const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
export const primaryBtn = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
export const ghostBtn = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
