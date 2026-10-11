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
