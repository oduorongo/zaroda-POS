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

export interface Buyer {
  id: string;
  phone: string;
  name: string | null;
}
