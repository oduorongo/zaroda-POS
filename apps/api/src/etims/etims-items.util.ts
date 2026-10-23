import { createHash } from 'crypto';

// How a product option becomes an eTIMS item (spec 3.3.3.2, /saveItem), as plain functions. Tested without a network.

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface TaxCode {
  cd: string;
  /** The percentage KRA lists for this tax type (userDfnCd1 in the code list), e.g. "16". */
  rate: string | null;
}

/**
 * The KRA tax type for a product: A = exempt, C = 0%, D = non-VAT, and for a rate above zero the type KRA lists with that exact
 * percentage (B 16%, E 8%...). The rates come from KRA's downloaded list, not from numbers kept here, because KRA's own samples
 * disagree about rate B. A product with no tax class is treated as non-VAT (D); the owner can override any of these per item.
 */
export function mapTaxType(
  taxClass: { rate: number; isExempt: boolean } | null,
  codes: TaxCode[],
): { code: string | null; problem: string | null } {
  if (codes.length === 0)
    return {
      code: null,
      problem: "Download KRA's lists first (Settings > eTIMS connection)",
    };
  if (!taxClass) return { code: 'D', problem: null };
  if (taxClass.isExempt) return { code: 'A', problem: null };
  const percent = Math.round(taxClass.rate * 10000) / 100;
  if (percent === 0) return { code: 'C', problem: null };
  const match = codes.find(
    (c) =>
      !['A', 'C', 'D'].includes(c.cd) &&
      c.rate !== null &&
      Math.abs(Number(c.rate) - percent) < 0.001,
  );
  return match
    ? { code: match.cd, problem: null }
    : {
        code: null,
        problem: `KRA has no tax type at ${percent}%. Choose one by hand, or change the product's tax class.`,
      };
}

/** KRA's item code: country, product type, packaging unit, quantity unit, then a 7-digit counter (spec 4.19). At most 20 characters. */
export function buildItemCode(
  seq: number,
  typeCd: string,
  pkgUnitCd: string,
  qtyUnitCd: string,
  country = 'KE',
): string {
  const code = `${country}${typeCd}${pkgUnitCd}${qtyUnitCd}${String(seq).padStart(7, '0')}`;
  if (code.length > 20)
    throw new Error(`Item code ${code} is longer than KRA's 20 characters`);
  return code;
}

/** The price KRA is told: with the tax in it, as KRA's own examples show (our prices are before tax). */
export const inclusivePrice = (price: number, taxRate: number): number =>
  round2(price * (1 + taxRate));

export const itemName = (
  productName: string,
  variantName: string | null,
): string =>
  variantName?.trim()
    ? `${productName.trim()} - ${variantName.trim()}`
    : productName.trim();

export interface ItemFields {
  itemCd: string;
  itemClsCd: string;
  itemTyCd: string;
  itemNm: string;
  bcd: string | null;
  pkgUnitCd: string;
  qtyUnitCd: string;
  taxTyCd: string;
  dftPrc: number;
  useYn: 'Y' | 'N';
}

/** What changes when KRA needs to be told again. The item code is fixed once made, so it is not part of it. */
export function itemFingerprint(f: Omit<ItemFields, 'itemCd'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        f.itemClsCd,
        f.itemTyCd,
        f.itemNm,
        f.bcd,
        f.pkgUnitCd,
        f.qtyUnitCd,
        f.taxTyCd,
        f.dftPrc,
        f.useYn,
      ]),
    )
    .digest('hex')
    .slice(0, 32);
}

/** The /saveItem request body (every field the spec lists; text cut to KRA's lengths). */
export function buildSaveItemBody(
  creds: { tin: string; bhfId: string; cmcKey: string },
  f: ItemFields,
  registrant: { id: string; name: string },
): Record<string, unknown> {
  return {
    tin: creds.tin,
    bhfId: creds.bhfId,
    cmcKey: creds.cmcKey,
    itemCd: f.itemCd,
    itemClsCd: f.itemClsCd,
    itemTyCd: f.itemTyCd,
    itemNm: f.itemNm.slice(0, 200),
    itemStdNm: null,
    orgnNatCd: 'KE',
    pkgUnitCd: f.pkgUnitCd,
    qtyUnitCd: f.qtyUnitCd,
    taxTyCd: f.taxTyCd,
    btchNo: null,
    bcd: f.bcd ? f.bcd.slice(0, 20) : null,
    dftPrc: f.dftPrc,
    grpPrcL1: null,
    grpPrcL2: null,
    grpPrcL3: null,
    grpPrcL4: null,
    grpPrcL5: null,
    addInfo: null,
    sftyQty: null,
    isrcAplcbYn: 'N',
    useYn: f.useYn,
    regrId: registrant.id.slice(0, 20),
    regrNm: registrant.name.slice(0, 60),
    modrId: registrant.id.slice(0, 20),
    modrNm: registrant.name.slice(0, 60),
  };
}

export type ItemState =
  'NEEDS_SETUP' | 'READY' | 'REGISTERED' | 'NEEDS_UPDATE' | 'REJECTED';

/** Where an item stands, from what is known about it. */
export function itemState(input: {
  itemClsCd: string | null;
  taxProblem: string | null;
  status: 'NOT_SENT' | 'REGISTERED' | 'REJECTED';
  sentHash: string | null;
  currentHash: string | null;
}): ItemState {
  if (!input.itemClsCd || input.taxProblem) return 'NEEDS_SETUP';
  if (input.status === 'REGISTERED')
    return input.sentHash === input.currentHash ? 'REGISTERED' : 'NEEDS_UPDATE';
  if (input.status === 'REJECTED') return 'REJECTED';
  return 'READY';
}

/** Why an item cannot be sent yet, in words for the screen. */
export function setupProblems(input: {
  itemClsCd: string | null;
  taxProblem: string | null;
  name: string;
  price: number;
}): string[] {
  const out: string[] = [];
  if (!input.itemClsCd) out.push("Choose KRA's product classification");
  if (input.taxProblem) out.push(input.taxProblem);
  if (!input.name.trim()) out.push('The product has no name');
  if (!(input.price >= 0)) out.push('The product has no price');
  return out;
}
