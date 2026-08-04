import type { LeadStatus } from "@/lib/api/types";

export const LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "RESPONDED",
  "QUALIFIED",
  "CONVERTED",
  "LOST",
];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "Novo",
  CONTACTED: "Contatado",
  RESPONDED: "Respondeu",
  QUALIFIED: "Qualificado",
  CONVERTED: "Convertido",
  LOST: "Perdido",
};
