/** Zaroda Shamba (farm management, industryType FARM) - shared labels and types for the /shamba screens. docs/farm. */

export const SHAMBA_BRAND = { navy: "#0f1f45", gold: "#d4af37", orange: "#f5820a" };

export interface FarmPlan {
  code: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number | null;
  quoteOnly: boolean;
  limits: { head: number | null; birds: number | null; acres: number | null; users: number | null };
  features: string[];
  sortOrder: number;
}

export interface FarmOverview {
  settings: { farmName: string; county: string | null; subCounty: string | null; ward: string | null } | null;
  plan: FarmPlan;
  status: "TRIAL" | "ACTIVE" | "GRACE" | "SUSPENDED" | "CANCELLED";
  currentPeriodEnd: string | null;
  usage: { head: number; birds: number; acres: number; users: number };
  counts: { units: number; enterprises: number };
  me: { isOwner: boolean; roles: string[]; unitIds: string[] | null };
}

export interface FarmUnit {
  id: string;
  kind: string;
  name: string;
  code: string | null;
  parentId: string | null;
  acres: string | null;
  capacity: number | null;
  notes: string | null;
  active: boolean;
}

export interface FarmEnterprise {
  id: string;
  kind: string;
  name: string;
  unitIds: string[];
  active: boolean;
}

export interface FarmStaff {
  orgUserId: string;
  name: string;
  email: string;
  staffRole: string;
  farmRoles: string[];
  unitIds: string[];
}

export const UNIT_KINDS: Record<string, string> = {
  BLOCK: "Block",
  FIELD: "Field",
  PADDOCK: "Paddock",
  PEN: "Pen / shed",
  POULTRY_HOUSE: "Poultry house",
  POND: "Fish pond",
  APIARY: "Apiary (bees)",
  STORE: "Store",
  FEED_MILL: "Feed mill",
  OTHER: "Other",
};

export const ENTERPRISE_KINDS: Record<string, string> = {
  DAIRY: "Dairy",
  BEEF: "Beef",
  LAYERS: "Layers (eggs)",
  BROILERS: "Broilers",
  KIENYEJI: "Kienyeji chicken",
  PIGS: "Pigs",
  GOATS: "Goats",
  SHEEP: "Sheep",
  RABBITS: "Rabbits",
  FISH: "Fish",
  BEES: "Bees (honey)",
  CROP: "Crop",
  FODDER: "Fodder / pasture",
  FEED: "Animal feed production",
  OTHER: "Other",
};

export const FARM_ROLES: Record<string, string> = {
  FARM_OWNER: "Farm owner",
  FARM_MANAGER: "Farm manager",
  HERDSMAN: "Herdsman",
  VET: "Vet / animal health",
  CROPS_OFFICER: "Crops officer",
  FEED_MILLER: "Feed miller",
  STOREKEEPER: "Storekeeper",
  SALES: "Sales",
  AUDITOR: "Auditor",
};

export const STATUS_LABEL: Record<FarmOverview["status"], string> = {
  TRIAL: "Free trial",
  ACTIVE: "Active",
  GRACE: "Payment due",
  SUSPENDED: "Read-only (plan lapsed)",
  CANCELLED: "Cancelled",
};

export const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
export const limitText = (n: number | null) => (n === null ? "Unlimited" : n.toLocaleString("en-KE"));

/** Land counted toward the plan: fields and paddocks (blocks only group them). */
export const LAND_KINDS = ["FIELD", "PADDOCK"];

export const inputClass = "mt-1 w-full rounded-lg border border-secondary-300 bg-white p-2.5 text-sm text-secondary-900";
