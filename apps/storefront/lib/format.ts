export const kes = (amount: number) =>
  `KES ${amount.toLocaleString("en-KE", { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

export function formatQty(q: number) {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** 254712345678 -> 0712 345 678 */
export function displayPhone(phone: string) {
  const local = phone.startsWith("254") ? `0${phone.slice(3)}` : phone;
  return local.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");
}

export function locationLabel(subCounty: string | null, county: string | null) {
  return [subCounty, county].filter(Boolean).join(", ");
}

export const HOUSE_TYPES: [string, string][] = [
  ["BEDSITTER", "Bedsitter"],
  ["SINGLE_ROOM", "Single room"],
  ["ONE_BEDROOM", "1 bedroom"],
  ["TWO_BEDROOM", "2 bedroom"],
  ["THREE_BEDROOM", "3 bedroom"],
  ["SHOP", "Shop"],
  ["OFFICE", "Office"],
  ["OTHER", "Other"],
];

export const houseTypeLabel = (type: string) => HOUSE_TYPES.find(([value]) => value === type)?.[1] ?? type;

/** 0712 345 678 / +254712345678 -> 254712345678 (the form tel: and wa.me links need). */
export function intlPhone(phone: string) {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  return `254${digits}`;
}

/** "Bread - Large loaf 800g", or just the product name when the option has no name of its own. */
export function variantTitle(productName: string, variantName: string | null | undefined) {
  const option = variantName?.trim();
  if (!option) return productName;
  return option.toLowerCase().startsWith(productName.toLowerCase()) ? option : `${productName} - ${option}`;
}
