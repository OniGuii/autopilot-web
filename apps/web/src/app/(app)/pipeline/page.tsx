"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPipeline } from "@/features/pipeline/api";
import { LEAD_STATUS_LABEL } from "@/features/leads/constants";
import type { LeadStatus } from "@/lib/api/types";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  const hours = ms / (1000 * 60 * 60);
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

export default function PipelinePage() {
  const query = useQuery({
    queryKey: ["pipeline"],
    queryFn: () => fetchPipeline(),
  });

  if (query.isLoading) {
    return <LoadingBlock rows={4} label="Carregando funil…" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Funil"
          breadcrumbs={breadcrumbsForPath("/pipeline")}
        />
        <ErrorPanel
          title="Não foi possível carregar o funil"
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const data = query.data;
  const stages = Object.entries(data.leadsByStage) as Array<
    [LeadStatus, number]
  >;
  const max = Math.max(1, ...stages.map(([, n]) => n));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funil"
        description={`Leads por estágio · atualizado em ${formatDateTime(data.generatedAt)}`}
        breadcrumbs={breadcrumbsForPath("/pipeline")}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-white/90">
          <CardHeader className="pb-2">
            <CardDescription>Sem contato</CardDescription>
            <CardTitle className="font-display text-3xl">
              {data.leadsWithoutContact}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-white/90">
          <CardHeader className="pb-2">
            <CardDescription>Sem responsável</CardDescription>
            <CardTitle className="font-display text-3xl">
              {data.leadsUnassigned}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {stages.map(([status, count]) => {
          const conv = data.conversionByStage?.[status];
          const avg = data.avgTimeInStageMs?.[status];
          return (
            <Card key={status} className="bg-white/90">
              <CardHeader className="pb-2">
                <CardDescription>{LEAD_STATUS_LABEL[status]}</CardDescription>
                <CardTitle className="font-display text-3xl">{count}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Conversão para convertido:{" "}
                  {conv == null ? "—" : `${(conv * 100).toFixed(1)}%`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Tempo médio no estágio: {formatMs(avg)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
