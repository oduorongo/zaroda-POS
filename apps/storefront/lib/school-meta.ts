import type { Metadata } from "next";
import { API_URL } from "./api";

/** The link preview (WhatsApp, SMS, email) for a supplier's school pages: about ordering school supplies, never the marketplace. */
export async function schoolPageMeta(slug: string, page: "join" | "signin"): Promise<Metadata> {
  const supplier = await fetch(`${API_URL}/school-auth/portal/${encodeURIComponent(slug)}`, { next: { revalidate: 300 } })
    .then((r) => (r.ok ? r.json() : null))
    .then((p: { displayName?: string } | null) => p?.displayName ?? null)
    .catch(() => null);
  const name = supplier ?? "Your school supplier";
  const title = page === "join" ? `Join ${name}: order school supplies on account` : `${name}: school ordering`;
  const description =
    page === "join"
      ? `${name} invites your school to order supplies on account. Fill in your school's details and choose a PIN; ${name} approves your school, then you order, track deliveries and see invoices online.`
      : `Sign in to order school supplies from ${name}, follow deliveries and see your invoices and statement.`;
  return {
    title: { absolute: title },
    description,
    robots: { index: false },
    openGraph: { title, description, siteName: "Zaroda school ordering", type: "website" },
    twitter: { card: "summary", title, description },
  };
}
