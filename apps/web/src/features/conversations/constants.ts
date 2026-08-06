import type { ConversationStatus } from "@/lib/api/types";

export const CONVERSATION_STATUSES: ConversationStatus[] = [
  "OPEN",
  "IDLE",
  "CLOSED",
  "ARCHIVED",
];

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  IDLE: "Inativa",
  CLOSED: "Fechada",
  ARCHIVED: "Arquivada",
};
