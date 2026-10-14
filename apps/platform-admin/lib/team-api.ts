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
  leaderOverrideRate: number;
  onboardingBonusKes: number;
}

export interface AgentProfile {
  id: string;
  role: "LEADER" | "MEMBER";
  fullName: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED";
  mustChangePassword: boolean;
}

export interface TeamMe {
  agent: AgentProfile;
  team: TeamTerms;
}

export const teamApiBase = defaultBase;

export const teamLogin = (email: string, password: string) =>
  request<{ accessToken: string } & TeamMe>("/sales-agent/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false);

export const teamMe = () => request<TeamMe>("/sales-agent/me", { method: "GET" });

export const teamChangePassword = (currentPassword: string, newPassword: string) =>
  request<{ message: string }>("/sales-agent/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
