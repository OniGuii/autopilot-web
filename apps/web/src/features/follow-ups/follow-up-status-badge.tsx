import { Badge } from "@/components/ui/badge";
import type { FollowUpStatus } from "@/lib/api/types";
import { FOLLOW_UP_STATUS_LABEL } from "@/features/follow-ups/constants";

const variantByStatus: Record<
  FollowUpStatus,
  "default" | "secondary" | "success" | "warning" | "muted" | "outline"
> = {
  SUGGESTED: "warning",
  APPROVED: "secondary",
  REJECTED: "muted",
  SCHEDULED: "default",
  EXECUTING: "outline",
  EXECUTED: "success",
  FAILED: "muted",
  CANCELLED: "muted",
  SKIPPED: "muted",
};

export function FollowUpStatusBadge({ status }: { status: FollowUpStatus }) {
  return (
    <Badge variant={variantByStatus[status]}>
      {FOLLOW_UP_STATUS_LABEL[status]}
    </Badge>
  );
}
