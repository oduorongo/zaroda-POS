/** Platform-wide commission on online sales (product total, excluding delivery) unless a tenant has a negotiated OnlineStore.commissionRate. */
export const DEFAULT_COMMISSION_RATE = 0.03;

// Lowercase letters, digits and single hyphens, 3-40 chars, no leading or
// trailing hyphen - safe to drop straight into a URL path (/s/<slug>).
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

// Words a business could otherwise claim that would collide with the
// storefront's own routes or impersonate the platform.
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'cart',
  'checkout',
  'help',
  'login',
  'orders',
  'register',
  'search',
  'settings',
  'shop',
  'shops',
  'support',
  'zaroda',
]);

/** Normalizes a requested shop link name, or returns null if it isn't usable. */
export function normalizeSlug(input: string): string | null {
  const slug = input.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug)) return null;
  return slug;
}
