import type { ProjectStatus } from "../shared";
import type { ExpiryState } from "../../../../components/construction/ui";

export interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  client: { id: string; name: string } | null;
  tenderId: string | null;
  worksClass: string;
  contractSum: number;
  revisedSum: number | null;
  formOfContract: string;
  startDate: string | null;
  completionDate: string | null;
  dlpMonths: number;
  retentionRate: number;
  retentionLimit: number;
  county: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  capOverrideReason: string | null;
  bqTotal: number;
  progress: number;
  parties: { id: string; role: string; party: { id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null } }[];
  members: { id: string; role: string; orgUserId: string; fullName: string; email: string; ncaCard: { cardNo: string; expiresAt: string; state: ExpiryState; daysLeft: number } | null }[];
  permits: { id: string | null; type: string; label: string; status: "PENDING" | "APPLIED" | "APPROVED" | "NOT_REQUIRED"; refNo: string | null; issuedAt: string | null; expiresAt: string | null; expiryState: ExpiryState; notes: string | null; hasFile: boolean }[];
  milestones: { id: string; name: string; startDate: string; endDate: string; percentComplete: number; sortOrder: number }[];
}

export interface TabProps {
  project: ProjectDetail;
  reload: () => Promise<void>;
}
