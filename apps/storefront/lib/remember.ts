// What this device remembers for a shopper, so checkout is short next time. localStorage can throw (private windows,
// blocked site data): then nothing is remembered and everything still works.

export interface GuestOrderRef {
  id: string;
  key: string;
  orderNumber: string;
  shopName: string;
  createdAt: string;
}

export interface CheckoutDetails {
  name?: string;
  phone?: string;
  fulfilment?: "PICKUP" | "DELIVERY";
  county?: string;
  address?: string;
}

const GUEST_ORDERS_KEY = "zaroda_guest_orders";
const DETAILS_KEY = "zaroda_checkout_details";
const MAX_GUEST_ORDERS = 30;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not remembered on this device */
  }
}

export const guestOrders = (): GuestOrderRef[] => {
  const list = read<GuestOrderRef[]>(GUEST_ORDERS_KEY, []);
  return Array.isArray(list) ? list.filter((o) => o && o.id && o.key) : [];
};

export function rememberGuestOrder(ref: GuestOrderRef) {
  write(GUEST_ORDERS_KEY, [ref, ...guestOrders().filter((o) => o.id !== ref.id)].slice(0, MAX_GUEST_ORDERS));
}

export const guestKeyFor = (orderId: string) => guestOrders().find((o) => o.id === orderId)?.key ?? null;

export const checkoutDetails = (): CheckoutDetails => read<CheckoutDetails>(DETAILS_KEY, {});

export const rememberCheckoutDetails = (details: CheckoutDetails) => write(DETAILS_KEY, { ...checkoutDetails(), ...details });

/** The private link to a guest's order: the key travels in the address, so the link works on any device it is opened on. */
export const guestOrderPath = (orderId: string, key: string) => `/orders/${orderId}?k=${encodeURIComponent(key)}`;
