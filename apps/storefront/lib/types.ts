// Shapes returned by the Zaroda API's public/buyer endpoints
// (apps/api/src/online-orders). Kept by hand rather than shared - this app
// only ever sees the JSON the API chooses to expose.

export interface ShopSummary {
  slug: string;
  name: string;
  description: string | null;
  county: string | null;
  subCounty: string | null;
  productCount: number;
  coverImage: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
}

export interface ShopVariant {
  id: string;
  sku: string;
  price: number;
  quantityMode: "COUNT" | "WEIGHT";
  available: number;
}

export interface ShopProduct {
  id: string;
  name: string;
  description: string | null;
  category: { id: string; name: string } | null;
  images: string[];
  variants: ShopVariant[];
}

export interface Shop {
  slug: string;
  name: string;
  description: string | null;
  contactPhone: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  location: { branchName: string; county: string | null; subCounty: string | null } | null;
  products: ShopProduct[];
}

export type OrderStatus = "PENDING_PAYMENT" | "PAID" | "ACCEPTED" | "READY" | "COMPLETED" | "CANCELLED" | "EXPIRED";

export interface OrderLine {
  id: string;
  productName: string;
  variantSku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  shop: { name: string; slug: string };
  fulfilmentType: "PICKUP" | "DELIVERY";
  deliveryAddress: string | null;
  buyerNote: string | null;
  subtotal: number;
  amountDue: number;
  paymentPhone: string;
  paymentDeadline: string;
  mpesaReceiptNumber: string | null;
  lastPaymentError: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  lines: OrderLine[];
}

/** What the "I've paid, check now" button gets back. */
export type OrderCheck = Order & { checkResult: 'paid' | 'not-paid-yet' | 'unavailable' | 'not-needed' };

export interface Buyer {
  id: string;
  /** Set when they signed in by email. */
  email: string | null;
  /** Set when they signed in by SMS, or once they have given an M-Pesa number at checkout. */
  phone: string | null;
  name: string | null;
}

export type VehicleType = "BODA" | "TUK_TUK" | "VEHICLE";
export type RiderStatus = "PENDING" | "APPROVED" | "SUSPENDED";

/** A delivery rider's own account. SHOP = added by a business, POOL = signed up on their own. */
export interface Rider {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  vehicleType: VehicleType | null;
  plateNumber: string | null;
  area: string | null;
  status: RiderStatus;
  kind: "SHOP" | "POOL";
  profileComplete: boolean;
}
