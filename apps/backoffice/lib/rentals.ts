/** ZARODA RENTALS branding: the Zaroda navy and gold, with a green of its own. */
export const RENTALS_BRAND = { navy: "#1a2e5a", gold: "#d4af37", green: "#14866d", name: "ZARODA RENTALS" };

export interface RentalPlan {
  code: string;
  name: string;
  unitLimit: number | null;
  caretakerLimit: number;
  monthlyPrice: number;
  annualPrice: number | null;
  feePercent: number;
  features: string[];
}

export const RENTAL_FEATURE_LABELS: Record<string, string> = {
  portal: "Tenant portal (tenants see and pay their rent)",
  receipts: "Receipts for every payment",
  statements: "Tenant statements",
  reminders: "Rent reminders by SMS and email",
  caretaker: "Caretaker logins",
  collect: "Rent collected and matched for you",
};
