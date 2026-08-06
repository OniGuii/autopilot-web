"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchLeadTimeline } from "@/features/leads/timeline-api";
import { LEAD_STATUS_LABEL } from "@/features/leads/constants";
import { isStatusHistoryItem } from "@/features/leads/workspace-constants";
import type { LeadStatus } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function statusFromPayload(payload: Record<string, unknown>): LeadStatus | null {
  const after = payload.after;
  if (after && typeof after === "object" && after !== null && "status" in after) {
    const status = (after as { status?: string }).status;
    if (status && status in LEAD_STATUS_LABEL) return status as LeadStatus;
  }
  if (typeof payload.status === "string" && payload.status in LEAD_STATUS_LABEL) {
    return payload.status as LeadStatus;
  }
  return null;
}

export function LeadStatusHistory({ leadId }: { leadId: string }) {
  const query = useQuery({
    queryKey: ["leads", leadId, "timeline"],
    queryFn: () => fetchLeadTimeline(leadId, { limit: 50 }),
  });

  const items =
    query.data?.items
      .filter((i) => isStatusHistoryItem(i.itemType))
      .slice()
      .reverse() ?? [];

  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Histórico de status</CardTitle>
        <CardDescription>Mudanças de etapa do funil.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingBlock rows={2} label="Carregando histórico…" />
        ) : items.length === 0 ? (
          <EmptyState
            title="Sem mudanças registradas"
            description="Quando o status for alterado, o histórico aparece aqui."
            className="py-8"
          />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const status = statusFromPayload(item.payload);
              return (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <div>
                    {status ? (
                      <Badge variant="secondary">{LEAD_STATUS_LABEL[status]}</Badge>
                    ) : (
                      <span className="font-medium">{item.summary}</span>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.summary}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(item.occurredAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
