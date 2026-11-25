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
  counts: { units: number; enterprises: number; animals: number; groups: number };
  livestock: { overdue: number; dueWeek: number; birthsSoon: number; inWithdrawal: number };
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

// ── F2 livestock ──────────────────────────────────────────────────────────

export const SPECIES: Record<string, string> = {
  CATTLE: "Cattle",
  GOAT: "Goats",
  SHEEP: "Sheep",
  PIG: "Pigs",
  RABBIT: "Rabbits",
  CHICKEN: "Chicken",
  DUCK: "Ducks",
  TURKEY: "Turkeys",
  FISH: "Fish",
  BEE: "Bees",
  OTHER: "Other",
};

/** Suggestions only: any breed can be typed. */
export const BREEDS: Record<string, string[]> = {
  CATTLE: ["Friesian", "Ayrshire", "Jersey", "Guernsey", "Sahiwal", "Boran", "Zebu", "Friesian x Ayrshire"],
  GOAT: ["Toggenburg", "Saanen", "Alpine", "Galla", "Boer", "Small East African"],
  SHEEP: ["Dorper", "Red Maasai", "Merino", "Hampshire Down"],
  PIG: ["Large White", "Landrace", "Duroc", "Hampshire"],
  RABBIT: ["New Zealand White", "California White", "Flemish Giant", "Chinchilla"],
  CHICKEN: ["Isa Brown", "Hy-Line Brown", "Cobb 500", "Ross 308", "Kuroiler", "Kenbro", "Rainbow Rooster", "Improved Kienyeji"],
  DUCK: ["Muscovy", "Pekin"],
  TURKEY: ["Broad Breasted White", "Bronze"],
  FISH: ["Tilapia", "Catfish"],
};

export const HEALTH_KINDS: Record<string, string> = {
  SICK: "Sick (seen)",
  TREATED: "Treated",
  VACCINATED: "Vaccinated",
  DEWORMED: "Dewormed",
  DIPPED: "Dipped / sprayed",
  CHECKED: "Checked",
};

export const BREEDING_KINDS: Record<string, string> = {
  HEAT: "On heat",
  SERVED: "Served (bull/buck)",
  AI: "AI",
  PD_POSITIVE: "Pregnant (PD +)",
  PD_NEGATIVE: "Not pregnant (PD -)",
  DRIED_OFF: "Dried off",
  BIRTH: "Gave birth",
  ABORTION: "Aborted",
};

export const COUNT_REASONS: Record<string, string> = {
  BORN: "Hatched / born",
  BOUGHT: "Bought",
  DIED: "Died",
  SOLD: "Sold",
  SLAUGHTERED: "Slaughtered",
  CULLED: "Culled",
  MOVED_OUT: "Moved out",
  ADJUSTED: "Count correction (+/-)",
  PLACED: "Placed",
};

export const EXIT_KINDS: Record<string, string> = { SOLD: "Sold", DIED: "Died", SLAUGHTERED: "Slaughtered", CULLED: "Culled", LOST: "Lost / stolen" };

export const TASK_KINDS: Record<string, string> = { VACCINATED: "Vaccination", DEWORMED: "Deworming", DIPPED: "Dipping", EXPECTED_BIRTH: "Birth due", DRY_OFF: "Dry off" };

export interface Withdrawal {
  milkUntil: string | null;
  meatUntil: string | null;
  eggUntil: string | null;
}

export interface FarmAnimal {
  id: string;
  tag: string;
  name: string | null;
  species: string;
  breed: string | null;
  sex: "FEMALE" | "MALE";
  birthDate: string | null;
  status: string;
  statusDate: string | null;
  unitId: string | null;
  enterpriseId: string | null;
  source: string;
  sireCode: string | null;
  withdrawal: Withdrawal;
}

export interface FarmGroup {
  id: string;
  species: string;
  name: string;
  breed: string | null;
  purpose: string | null;
  placedOn: string;
  headCount: number;
  unitId: string | null;
  active: boolean;
  withdrawal: Withdrawal;
}

export interface HealthEvent {
  id: string;
  date: string;
  kind: string;
  diagnosis: string | null;
  drugName: string | null;
  dose: string | null;
  vetName: string | null;
  cost: string | null;
  notes: string | null;
  milkWithdrawalUntil: string | null;
  meatWithdrawalUntil: string | null;
  eggWithdrawalUntil: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface DueTask {
  id: string;
  kind: string;
  title: string;
  animalId: string | null;
  groupId: string | null;
  programmeId: string | null;
  dueOn: string;
  overdue?: boolean;
}

export interface FarmDrug {
  id: string;
  name: string;
  milkWithdrawalDays: number;
  meatWithdrawalDays: number;
  eggWithdrawalDays: number;
  prescriptionOnly: boolean;
  notes: string | null;
}

export interface FarmProgramme {
  id: string;
  species: string;
  name: string;
  kind: string;
  drugId: string | null;
  firstAgeDays: number | null;
  intervalDays: number;
}

export const day = (d: string | null | undefined) => (d ? d.slice(0, 10) : "");
export const todayKey = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

export function ageText(born: string | null): string {
  if (!born) return "";
  const b = day(born);
  const t = todayKey();
  const [by, bm, bd] = b.split("-").map(Number);
  const [ty, tm, td] = t.split("-").map(Number);
  const months = Math.max(0, (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0));
  if (months < 1) return `${Math.round((Date.parse(t) - Date.parse(b)) / 86_400_000)} days`;
  return [Math.floor(months / 12) ? `${Math.floor(months / 12)} yr` : "", months % 12 ? `${months % 12} mo` : ""].filter(Boolean).join(" ");
}

/** "Milk not for sale until after 29 Nov" lines; empty when nothing is withheld. */
export function withdrawalLines(w: Withdrawal): string[] {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });
  return [
    w.milkUntil && `Milk not for sale until after ${f(w.milkUntil)}`,
    w.meatUntil && `Meat not for sale until after ${f(w.meatUntil)}`,
    w.eggUntil && `Eggs not for sale until after ${f(w.eggUntil)}`,
  ].filter((x): x is string => !!x);
}

export const CROP_STATUS: Record<string, string> = { PLANNED: "Planned", GROWING: "Growing", HARVESTING: "Harvesting", CLOSED: "Closed" };
export const CROP_ACTIVITIES: Record<string, string> = {
  LAND_PREP: "Land preparation",
  PLANTING: "Planting",
  WEEDING: "Weeding",
  TOP_DRESSING: "Top dressing",
  SPRAYING: "Spraying",
  IRRIGATION: "Irrigation",
  SCOUTING: "Scouting",
  OTHER: "Other work",
};
export const HARVEST_UNITS = ["kg", "bag (90 kg)", "bag (50 kg)", "tonne", "crate", "bunch", "piece"];
