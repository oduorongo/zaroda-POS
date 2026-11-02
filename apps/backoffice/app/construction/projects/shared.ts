export type ProjectStatus = "PLANNING" | "ACTIVE" | "PRACTICAL_COMPLETION" | "DLP" | "CLOSED";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  PRACTICAL_COMPLETION: "Practical completion",
  DLP: "Defects period",
  CLOSED: "Closed",
};

export const STATUS_COLOUR: Record<ProjectStatus, string> = {
  PLANNING: "#f5820a",
  ACTIVE: "#16a34a",
  PRACTICAL_COMPLETION: "#2563eb",
  DLP: "#7c3aed",
  CLOSED: "#6b7280",
};

export const NEXT_STATUS: Record<ProjectStatus, ProjectStatus[]> = {
  PLANNING: ["ACTIVE", "CLOSED"],
  ACTIVE: ["PRACTICAL_COMPLETION"],
  PRACTICAL_COMPLETION: ["DLP"],
  DLP: ["CLOSED"],
  CLOSED: [],
};
