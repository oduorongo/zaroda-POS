// Where a shop delivers. Food and goods cannot travel from Nairobi to Migori, so a delivery order is only taken when
// the shopper's county is one the shop serves. A shop serves its own branch's county unless it lists others.
// (Pickup, hotel rooms, table orders and rentals are not limited by distance.)

/** The 47 counties, spelled the way people write them. */
export const KENYA_COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi',
  'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos', 'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', "Murang'a",
  'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri', 'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia',
  'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot',
] as const;

/** "Nairobi County", "nairobi", "MURANGA" -> a key that ignores case, spaces, hyphens, apostrophes and the word County. */
const keyOf = (text: string) => text.toLowerCase().replace(/county/g, '').replace(/[^a-z]/g, '');

const BY_KEY = new Map<string, string>(KENYA_COUNTIES.map((c) => [keyOf(c), c]));

/** The proper spelling of a county however it was typed, or null when it is not one of the 47. */
export function normalizeCounty(text: string | null | undefined): string | null {
  if (!text) return null;
  return BY_KEY.get(keyOf(text)) ?? null;
}

/** A list of typed counties made proper, duplicates removed. Throws the first one that is not a county. */
export function normalizeCounties(texts: string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    const county = normalizeCounty(text);
    if (!county) throw new Error(`"${text}" is not a county of Kenya`);
    out.add(county);
  }
  return Array.from(out);
}

/**
 * The counties a shop delivers to: the ones it listed, else its branch's own county. null means we cannot tell (it
 * listed none and its branch county is blank or unrecognised) - an older shop that has not set this up yet - and
 * delivery is then not limited until it does.
 */
export function servedCounties(listed: string[], branchCounty: string | null | undefined): string[] | null {
  const proper = listed.map((c) => normalizeCounty(c)).filter((c): c is string => c !== null);
  if (proper.length > 0) return Array.from(new Set(proper));
  const own = normalizeCounty(branchCounty);
  return own ? [own] : null;
}

/** ok: true means the order can go ahead (county is the proper spelling, or null when the shop is not limited); otherwise message says why not. */
export interface DeliveryCheck {
  ok: boolean;
  county: string | null;
  message: string;
}

/** Can this shop deliver to the shopper's county? */
export function checkDeliveryCounty(served: string[] | null, shopperCounty: string | null | undefined, shopName: string): DeliveryCheck {
  const chosen = normalizeCounty(shopperCounty);
  if (served === null) return { ok: true, county: chosen, message: '' };
  if (!chosen) return { ok: false, county: null, message: 'Choose the county we are delivering to' };
  if (served.includes(chosen)) return { ok: true, county: chosen, message: '' };
  const where = served.length === 1 ? served[0] : `${served.slice(0, -1).join(', ')} and ${served[served.length - 1]}`;
  return {
    ok: false,
    county: null,
    message: `${shopName} only delivers in ${where}, so it cannot deliver to ${chosen}. You can choose pickup, or order from a shop in ${chosen}.`,
  };
}
