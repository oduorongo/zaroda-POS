// An amount written out for printed documents, the way Kenyan commercial paperwork has it:
// "Four Hundred and Seventeen Thousand Six Hundred Kenya Shillings Only".

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

/** 0 to 999. The last group of a bigger number gets an "and" when it has no hundreds ("One Thousand and Fifty"). */
function underThousand(n: number, and: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const tens = rest < 20 ? ONES[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ""}`;
  if (hundreds) return `${ONES[hundreds]} Hundred${tens ? ` and ${tens}` : ""}`;
  return and && tens ? `and ${tens}` : tens;
}

export function numberToWords(n: number): string {
  if (n === 0) return "Zero";
  const groups: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  return groups
    .map((g, i) => (g ? `${underThousand(g, i === 0 && groups.length > 1 && g < 100)}${SCALES[i] ? ` ${SCALES[i]}` : ""}` : ""))
    .reverse()
    .filter(Boolean)
    .join(" ")
    .replace(/ +/g, " ");
}

/** "One Thousand Two Hundred and Thirty-Four Kenya Shillings and Fifty Cents Only" */
export function amountInWords(amount: number, currency = "Kenya Shillings"): string {
  const [whole, cents = "0"] = Math.abs(amount).toFixed(2).split(".");
  const c = Number(cents);
  return `${numberToWords(Number(whole))} ${currency}${c ? ` and ${numberToWords(c)} Cents` : ""} Only`;
}
