import { Badge } from "@/components/ui/badge";
import type { WhatsAppConnectionStatus } from "@/lib/api/types";

const label: Record<WhatsAppConnectionStatus, string> = {
  QR_PENDING: "QR pendente",
  CONNECTING: "Conectando",
  CONNECTED: "Conectado",
  DISCONNECTED: "Desconectado",
  ERROR: "Erro",
};

const variant: Record<
  WhatsAppConnectionStatus,
  "default" | "secondary" | "success" | "warning" | "muted" | "outline"
> = {
  QR_PENDING: "warning",
  CONNECTING: "outline",
  CONNECTED: "success",
  DISCONNECTED: "muted",
  ERROR: "muted",
};

export function WhatsAppStatusBadge({
  status,
}: {
  status: WhatsAppConnectionStatus;
}) {
  return <Badge variant={variant[status]}>{label[status]}</Badge>;
}
