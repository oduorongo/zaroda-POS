import Dexie, { type Table } from "dexie";

/**
 * The terminal's local IndexedDB store (DESIGN.md §6). Everything a
 * cashier needs to keep selling with no connectivity lives here: the
 * device's own identity, a cached catalog snapshot, the active PIN
 * session, and an outbox of sales that haven't reached the server yet.
 * `sync.ts` is the only thing that ever drains the outbox.
 */

export interface DeviceConfig {
  /** Singleton row - always "device". */
  id: "device";
  apiBaseUrl: string;
  branchId: string;
  terminalId: string;
  branchName: string;
  terminalLabel: string;
  orgUsersCachedAt: string | null;
  catalogCachedAt: string | null;
}

export interface CachedOrgUser {
  id: string; // orgUserId - what pin-login needs
  role: string;
  fullName: string;
}

export interface CachedVariant {
  id: string; // variantId
  productId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  price: number;
  /** Decimal fraction (0.16 = 16%), 0 if untaxed/exempt/no tax class set. */
  taxRate: number;
}

export interface CashierSession {
  /** Singleton row - always "session". Absent = nobody is PIN'd in right now. */
  id: "session";
  cashierSessionId: string;
  orgUserId: string;
  cashierName: string;
  accessToken: string;
  startedAt: string;
}

export interface CartLine {
  variantId: string;
  quantity: number;
}

export type OutboxStatus = "pending" | "syncing" | "synced" | "failed";

export interface OutboxSale {
  /** The client-generated idempotency key (DESIGN.md §6) - also the Dexie primary key. */
  clientId: string;
  branchId: string;
  terminalId: string;
  cashierSessionId: string;
  lineItems: CartLine[];
  paymentAmount: number;
  createdAt: string;
  status: OutboxStatus;
  lastError: string | null;
  /** Set once the server has confirmed it - lets the UI show "sale #..." instead of just the local clientId. */
  serverSaleId: string | null;
}

class TerminalDatabase extends Dexie {
  deviceConfig!: Table<DeviceConfig, string>;
  orgUsers!: Table<CachedOrgUser, string>;
  variants!: Table<CachedVariant, string>;
  session!: Table<CashierSession, string>;
  outbox!: Table<OutboxSale, string>;

  constructor() {
    super("zaroda-terminal");
    this.version(1).stores({
      deviceConfig: "id",
      orgUsers: "id",
      variants: "id, sku, barcode",
      session: "id",
      outbox: "clientId, status",
    });
  }
}

export const db = new TerminalDatabase();

export async function getDeviceConfig(): Promise<DeviceConfig | undefined> {
  return db.deviceConfig.get("device");
}

export async function getActiveSession(): Promise<CashierSession | undefined> {
  return db.session.get("session");
}

export async function clearSession(): Promise<void> {
  await db.session.delete("session");
}
