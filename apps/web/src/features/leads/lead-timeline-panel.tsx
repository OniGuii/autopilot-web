"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchLeadTimeline } from "@/features/leads/timeline-api";
import { timelineTypeLabel } from "@/features/leads/workspace-constants";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LeadTimelinePanel({ leadId }: { leadId: string }) {
  const query = useQuery({
    queryKey: ["leads", leadId, "timeline"],
    queryFn: () => fetchLeadTimeline(leadId, { limit: 50 }),
  });

  return (
    <Card className="bg-white/90">
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>
          Histórico unificado de eventos deste lead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingBlock rows={3} label="Carregando timeline…" />
        ) : query.isError ? (
          <ErrorPanel
            title="Não foi possível carregar a timeline"
            onRetry={() => void query.refetch()}
          />
        ) : !query.data?.items.length ? (
          <EmptyState
            title="Sem eventos ainda"
            description="Notas, atividades, conversas e mudanças de status aparecem aqui."
          />
        ) : (
          <ol className="relative space-y-0 border-l border-border/80 pl-4">
            {[...query.data.items].reverse().map((item) => (
              <li key={item.id} className="relative pb-5 last:pb-0">
                <span className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{timelineTypeLabel(item.itemType)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(item.occurredAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm">{item.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
