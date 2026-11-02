// Small rules for the eTIMS functions beyond selling (PIN lookup, imported items, customers sent to KRA). Plain functions, tested
// without a database.

/** A KRA PIN in capitals with spaces taken out, or null when it is not one (a letter, nine digits, a letter). */
export function normalizeCustPin(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[AP]\d{9}[A-Z]$/.test(v) ? v : null;
}

/** What KRA was last told about a customer; when the name or PIN changes, it is sent again. */
export const customerKey = (name: string, pin: string): string =>
  `${pin.trim().toUpperCase()}|${name.trim().slice(0, 60)}`;

/**
 * What stops an imported item being approved or cancelled: it was already decided, or (to approve) it is not matched to a product
 * KRA already has, because KRA needs the item code and classification it will be sold under.
 */
export function importDecisionProblem(m: {
  decision: 'APPROVE' | 'CANCEL';
  currentStatus: string;
  hasVariant: boolean;
  item: { status: string; itemCd: string | null; itemClsCd: string | null } | null;
}): string | null {
  if (m.currentStatus === '3' || m.currentStatus === '4')
    return 'This imported item has already been dealt with.';
  if (m.decision === 'CANCEL') return null;
  if (!m.hasVariant) return 'Choose the product this imported item is.';
  if (!m.item || m.item.status !== 'REGISTERED' || !m.item.itemCd || !m.item.itemClsCd)
    return 'That product is not registered with KRA yet. Register it under eTIMS items first.';
  return null;
}

/**
 * The "last request" stamp to keep after a download: one second before KRA's answer time. KRA sends what changed after the stamp, so
 * something posted in the same second as the answer would otherwise be missed; coming down twice is harmless (it is matched and
 * updated, never added twice).
 */
export function stampBefore(resultDt: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(resultDt);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 1000;
  return new Date(t).toISOString().slice(0, 19).replace(/[-T:]/g, '');
}

export interface Component {
  itemCd: string;
  qty: number;
}

/** What KRA was last told about a recipe; the order the ingredients were added in does not matter. */
export const compositionKey = (components: Component[]): string =>
  components
    .map((c) => `${c.itemCd}:${Number(c.qty.toFixed(3))}`)
    .sort()
    .join('|');

/**
 * The /saveItemComposition bodies for one recipe: one per ingredient, each saying how much of it goes into one of the finished item.
 * The field names are those of KRA's OSCU code (cpstItemCd, cpstQty); KRA's written spec has none, so confirm them in the sandbox.
 */
export function compositionBodies(
  creds: { tin: string; bhfId: string; cmcKey: string },
  itemCd: string,
  components: Component[],
  registrant: { id: string; name: string },
): Record<string, unknown>[] {
  return components.map((c) => ({
    tin: creds.tin,
    bhfId: creds.bhfId,
    cmcKey: creds.cmcKey,
    itemCd,
    cpstItemCd: c.itemCd,
    cpstQty: Number(c.qty.toFixed(3)),
    regrId: registrant.id.slice(0, 20),
    regrNm: registrant.name.slice(0, 60),
  }));
}

/** Why a recipe cannot go to KRA yet, or null: the finished item and every ingredient must be registered with KRA. */
export function compositionProblem(
  parent: { status: string; itemCd: string | null },
  ingredients: { name: string; itemCd: string | null; status: string | null }[],
): string | null {
  if (parent.status !== 'REGISTERED' || !parent.itemCd) return 'The item itself is not registered with KRA yet.';
  if (ingredients.length === 0) return 'The recipe has no ingredients.';
  const missing = ingredients.filter((i) => i.status !== 'REGISTERED' || !i.itemCd).map((i) => i.name);
  return missing.length
    ? `Ingredients not registered with KRA yet: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`
    : null;
}
