import type { AiAgentMode, KnowledgeBaseKind } from "@/lib/api/types";

export const AI_MODE_LABEL: Record<AiAgentMode, string> = {
  OFF: "Desligado",
  ASSIST: "Assistido (recomendado)",
  AUTO: "Automático (opt-in)",
};

export const KB_KIND_LABEL: Record<KnowledgeBaseKind, string> = {
  FAQ: "FAQ",
  PRODUCT: "Produto",
  PRICE: "Preço",
  PAYMENT: "Pagamento",
  DELIVERY: "Entrega",
  HOURS: "Horários",
  ADDRESS: "Endereço",
};

export const KB_KINDS: KnowledgeBaseKind[] = [
  "FAQ",
  "PRODUCT",
  "PRICE",
  "PAYMENT",
  "DELIVERY",
  "HOURS",
  "ADDRESS",
];
