"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPipeline } from "@/features/pipeline/api";
import { LEAD_STATUS_LABEL } from "@/features/leads/constants";
import type { LeadStatus } from "@/lib/api/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

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
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Falha ao carregar pipeline</CardTitle>
          <CardDescription>GET /api/pipeline</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
        </CardContent>
      </Card>
    );
  }

  const data = query.data;
  const stages = Object.entries(data.leadsByStage) as Array<
    [LeadStatus, number]
  >;
  const max = Math.max(1, ...stages.map(([, n]) => n));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Pipeline</h1>
        <p className="text-muted-foreground">
          Funil por status · {formatDateTime(data.generatedAt)}
        </p>
      </div>

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
                  Conversão p/ convertido:{" "}
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
