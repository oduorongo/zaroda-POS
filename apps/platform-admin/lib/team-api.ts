import { ApiError } from "./api";
import { getTeamSession } from "./team-auth";

const defaultBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

async function request<T>(path: string, options: RequestInit, withSession = true): Promise<T> {
  const session = withSession ? getTeamSession() : null;
  const apiBase = (session?.apiBaseUrl ?? defaultBase).replace(/\/+$/, "");
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...options.headers },
  });
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "message" in json && typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

export interface TeamTerms {
  id: string;
  name: string;
  region: string | null;
  status: "ACTIVE" | "PAUSED";
  memberShareRate: number;
  subscriptionShareRate: number;
  earningMonths: number;
  leaderOverrideRate: number;
  onboardingBonusKes: number;
  payoutCapRate: number;
}

export interface AgentProfile {
  id: string;
  role: "LEADER" | "MEMBER";
  fullName: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED";
  mustChangePassword: boolean;
  payoutGateway: "MPESA_B2C" | "TUMA" | null;
  payoutAccount: string | null;
}

export interface TeamMe {
  agent: AgentProfile;
  team: TeamTerms;
}

export interface TeamShop {
  id: string;
  name: string;
  industryType: string;
  county: string | null;
  subCounty: string | null;
  isActive: boolean;
  createdAt: string;
  onboardedBy: { id: string; fullName: string } | null;
  subscription: { planName: string; status: "TRIAL" | "ACTIVE" | "GRACE" | "SUSPENDED"; currentPeriodEnd: string; isTrial: boolean } | null;
  onlineShop: { addonActive: boolean; isPublished: boolean };
  saleCount: number;
  lastSaleAt: string | null;
}

export interface TeamRider {
  id: string;
  fullName: string | null;
  email: string;
  phone: string | null;
  vehicleType: "BODA" | "TUK_TUK" | "VEHICLE" | null;
  area: string | null;
  status: "PENDING" | "APPROVED" | "SUSPENDED";
  createdAt: string;
  onboardedBy: { id: string; fullName: string } | null;
}

export interface TeamOverview {
  shops: { total: number; onTrial: number; paying: number; lapsed: number; sellingOnline: number };
  riders: { total: number; waitingForApproval: number; approved: number };
  members: { id: string; fullName: string; status: "ACTIVE" | "SUSPENDED"; shops: number; riders: number }[] | null;
}

export interface TeamMember extends AgentProfile {
  teamId: string;
  lastLoginAt: string | null;
  shopCount: number;
  riderCount: number;
}

export const teamApiBase = defaultBase;

export const teamLogin = (email: string, password: string) =>
  request<{ accessToken: string } & TeamMe>("/sales-agent/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false);

export const teamMe = () => request<TeamMe>("/sales-agent/me", { method: "GET" });

export const teamChangePassword = (currentPassword: string, newPassword: string) =>
  request<{ message: string }>("/sales-agent/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });

export const teamGet = <T>(path: string) => request<T>(`/sales-agent${path}`, { method: "GET" });
export const teamPost = <T>(path: string, body: unknown) => request<T>(`/sales-agent${path}`, { method: "POST", body: JSON.stringify(body) });
export const teamPatch = <T>(path: string, body: unknown) => request<T>(`/sales-agent${path}`, { method: "PATCH", body: JSON.stringify(body) });

export interface EarningLine {
  id: string;
  kind: "COMMISSION_SHARE" | "SUBSCRIPTION_SHARE" | "LEADER_OVERRIDE" | "ONBOARDING_BONUS" | "ADJUSTMENT";
  shop: string;
  baseKes: number;
  rate: number | null;
  amountKes: number;
  capped: boolean;
  earnedAt: string;
  status: "PENDING" | "PAYABLE" | "PAID" | "ACCRUED" | "VOID";
}

export interface EarningsStatement {
  month: string;
  thisMonth: { commissionShare: number; subscriptionShare: number; leaderOverride: number; onboardingBonus: number; adjustments: number; total: number };
  byShop: { shop: string; pending: number; payable: number; paid: number; total: number }[];
  allTime: { pending: number; payable: number; paid: number };
  payoutTerms: { minimumKes: number; payoutDay: number; holdDays: number; withholdingTaxRate: number };
  payoutDetails: { gateway: "MPESA_B2C" | "TUMA" | null; account: string | null };
  lines: EarningLine[];
  payouts: {
    id: string;
    amountKes: number;
    taxWithheldKes: number;
    netKes: number;
    throughMonth: string;
    gateway: string;
    reference: string | null;
    status: "QUEUED" | "PAID" | "FAILED";
    paidAt: string | null;
    failureReason: string | null;
  }[];
  team: { agentId: string; fullName: string; role: "LEADER" | "MEMBER"; earnedThisMonth: number; pending: number; payable: number; paid: number }[] | null;
}
