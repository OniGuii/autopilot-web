import type { FollowUpStatus } from "@/lib/api/types";

export const FOLLOW_UP_STATUSES: FollowUpStatus[] = [
  "SUGGESTED",
  "APPROVED",
  "REJECTED",
  "SCHEDULED",
  "EXECUTING",
  "EXECUTED",
  "FAILED",
  "CANCELLED",
  "SKIPPED",
];

export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatus, string> = {
  SUGGESTED: "Sugerido",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  SCHEDULED: "Agendado",
  EXECUTING: "Executando",
  EXECUTED: "Executado",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  SKIPPED: "Ignorado",
};
