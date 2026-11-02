export type VatClaim = "KRA" | "DECLARED" | "MISSING" | "NONE";

/** Whether the VAT on a bill or expense can be claimed from KRA. */
export function VatClaimNote({ claim, vat, kes }: { claim: VatClaim; vat: number; kes: (n: number) => string }) {
  if (claim === "NONE") return null;
  const [text, tone] =
    claim === "KRA"
      ? ["checked with KRA (eTIMS)", "text-green-500"]
      : claim === "DECLARED"
        ? ["claimable - check the invoice shows on iTax", "text-secondary-500"]
        : ["not claimable: add the supplier's KRA PIN and eTIMS invoice number", "text-amber-500"];
  return (
    <span className={`text-xs ${tone}`}>
      VAT {kes(vat)} {text}
    </span>
  );
}
