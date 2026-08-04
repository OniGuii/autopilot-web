import { Badge } from "@/components/ui/badge";
import type { LeadStatus } from "@/lib/api/types";
import { LEAD_STATUS_LABEL } from "@/features/leads/constants";

const variantByStatus: Record<
  LeadStatus,
  "default" | "secondary" | "success" | "warning" | "muted" | "outline"
> = {
  NEW: "default",
  CONTACTED: "secondary",
  RESPONDED: "warning",
  QUALIFIED: "outline",
  CONVERTED: "success",
  LOST: "muted",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant={variantByStatus[status]}>{LEAD_STATUS_LABEL[status]}</Badge>
  );
}
