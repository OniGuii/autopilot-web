import type { LeadActivityType, TimelineItemType } from "@/lib/api/types";

export const ACTIVITY_TYPE_LABEL: Record<LeadActivityType, string> = {
  CALL: "Ligação",
  MEETING: "Reunião",
  EMAIL: "E-mail",
  VISIT: "Visita",
  OTHER: "Outro",
};

export const ACTIVITY_STATUS_LABEL = {
  PLANNED: "Planejada",
  DONE: "Concluída",
  CANCELLED: "Cancelada",
} as const;

export function timelineTypeLabel(itemType: TimelineItemType): string {
  if (itemType === "LEAD_CREATED") return "Lead criado";
  if (itemType === "CONVERSATION_OPENED") return "Conversa aberta";
  if (itemType === "CONVERSATION_CLOSED") return "Conversa fechada";
  if (itemType === "MESSAGE_INBOUND") return "Mensagem recebida";
  if (itemType === "MESSAGE_OUTBOUND") return "Mensagem enviada";
  if (itemType === "FOLLOW_UP") return "Follow-up";
  if (itemType === "AI_SUGGESTION") return "Sugestão de IA";
  if (itemType === "NOTE") return "Nota";
  if (itemType === "ACTIVITY") return "Atividade";
  if (itemType === "AUDIT_LEAD_STATUS_CHANGE") return "Mudança de status";
  if (itemType === "AUDIT_LEAD_ASSIGN") return "Responsável";
  if (itemType.startsWith("AUDIT_")) return "Registro";
  return "Evento";
}

export function isStatusHistoryItem(itemType: string) {
  return (
    itemType === "AUDIT_LEAD_STATUS_CHANGE" || itemType === "LEAD_CREATED"
  );
}
