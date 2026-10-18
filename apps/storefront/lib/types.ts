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

export type DeliveryStatus = "OPEN" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "CANCELLED" | "EXPIRED";

export interface DeliveryQuote {
  id: string;
  name: string | null;
  vehicleType: VehicleType | null;
  plateNumber: string | null;
  fee: number;
  etaMinutes: number | null;
  note: string | null;
}

/** What a shopper sees of the delivery of their own order. The code is only present while a rider is on the way. */
export interface BuyerDelivery {
  id: string;
  status: DeliveryStatus;
  quoteDeadline: string;
  agreedFee: number | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  quotes: DeliveryQuote[];
  rider: { riderId: string; name: string | null; vehicleType: VehicleType | null; plateNumber: string | null; phone: string | null } | null;
  deliveryCode: string | null;
}

/** A job a rider can bid on. No buyer details - only the area. */
export interface OpenJob {
  id: string;
  orderNumber: string;
  shopName: string;
  pickupArea: string;
  dropoffSummary: string;
  itemCount: number;
  quoteDeadline: string;
  myQuote: { id: string; fee: number; etaMinutes: number | null; note: string | null; status: string } | null;
}

/** A job the rider won: now with the buyer's contact details. */
export interface MyJob extends OpenJob {
  status: DeliveryStatus;
  agreedFee: number | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cashCollected: number | null;
  codeLocked: boolean;
  buyerName: string | null;
  buyerPhone: string | null;
  deliveryAddress: string | null;
}

/** One "House to let" in the public list. */
export interface HouseSummary {
  id: string;
  title: string;
  unitType: string;
  area: string;
  monthlyRent: number;
  depositAmount: number;
  postedAt: string;
  coverImage: string | null;
  photoCount: number;
}

/** A "House to let" in full, with the landlord's contact number. */
export interface HouseDetail {
  id: string;
  title: string;
  unitType: string;
  area: string;
  monthlyRent: number;
  depositAmount: number;
  description: string | null;
  contactName: string | null;
  contactPhone: string;
  postedAt: string;
  images: string[];
}
