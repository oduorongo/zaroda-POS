// Rules for tender adverts, as plain functions so they are tested without a database.

import { addDays } from '../school-supplier/school-money.util';

/** The furthest ahead a closing date may be. */
export const MAX_ADVERT_DAYS = 180;
/** How many adverts one school may post in a day: enough for real use, too few to flood suppliers. */
export const MAX_ADVERTS_PER_DAY = 5;
export const MAX_ITEMS = 60;

/** The biggest tender document accepted. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** A real PDF starts with "%PDF-" (a renamed photo or document does not). */
export function looksLikePdf(body: Buffer): boolean {
  return body.length > 8 && body.subarray(0, 1024).toString('latin1').includes('%PDF-');
}

/** The name to show for an uploaded file: no folders, no odd characters, never empty, ends in .pdf. */
export function cleanFileName(raw: string | undefined): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^\w .()-]+/g, '').trim().slice(0, 100);
  const name = cleaned || 'tender-document';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

export interface AdvertItem {
  description: string;
  quantity: number | null;
  unit: string | null;
}

/** A PIN of 4-6 digits that is not the first thing anyone tries. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'The PIN must be 4 to 6 digits';
  if (/^(\d)\1+$/.test(pin) || pin === '1234' || pin === '123456' || pin === '4321')
    return 'Choose a PIN that is harder to guess';
  return null;
}

/** The closing date must be after today and no more than 180 days away. */
export function closingDateProblem(closing: string, today: string): string | null {
  if (closing <= today) return 'The closing date must be after today';
  if (closing > addDays(today, MAX_ADVERT_DAYS))
    return `The closing date cannot be more than ${MAX_ADVERT_DAYS} days away`;
  return null;
}

/** Items with nothing written are dropped; each is trimmed. */
export function cleanItems(
  items: { description?: string; quantity?: number | null; unit?: string | null }[],
): AdvertItem[] {
  return items
    .map((i) => ({
      description: (i.description ?? '').trim(),
      quantity: i.quantity !== undefined && i.quantity !== null && i.quantity > 0 ? i.quantity : null,
      unit: i.unit?.trim() || null,
    }))
    .filter((i) => i.description.length > 0)
    .slice(0, MAX_ITEMS);
}

/** An advert is open to suppliers while the school has not withdrawn it, nobody removed it, and the closing day has not passed. */
export function isOpenAdvert(a: { status: string; closingDate: string }, today: string): boolean {
  return a.status === 'OPEN' && a.closingDate >= today;
}

/** Whether an advert matches what a supplier typed in the search box (title, description, school, county, items). */
export function matchesSearch(
  a: { title: string; description: string; county: string; schoolName: string; items: AdvertItem[] },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [a.title, a.description, a.county, a.schoolName, ...a.items.map((i) => i.description)]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
