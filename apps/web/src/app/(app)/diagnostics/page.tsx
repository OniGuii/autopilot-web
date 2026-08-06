"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDiagnostics } from "@/features/ops/api";
import type { DiagnosticCheck, DiagnosticCheckStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHECK_LABELS: Record<string, string> = {
  postgres: "Postgres",
  redis: "Redis",
  openai: "OpenAI",
  whatsapp: "WhatsApp",
  workers: "Workers",
};

function statusTone(status: DiagnosticCheckStatus) {
  switch (status) {
    case "ok":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "skipped":
      return "bg-slate-400";
    default:
      return "bg-red-500";
  }
}

function CheckCard({
  name,
  check,
}: {
  name: string;
  check: DiagnosticCheck | undefined;
}) {
  if (!check) {
    return (
      <Card className="bg-white/90 opacity-60">
        <CardHeader>
          <CardTitle className="text-lg">{CHECK_LABELS[name] ?? name}</CardTitle>
          <CardDescription>Não disponível neste escopo</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">
            {CHECK_LABELS[name] ?? name}
          </CardTitle>
          <span
            className={cn(
              "inline-block h-3 w-3 rounded-full",
              statusTone(check.status),
            )}
            title={check.status}
          />
        </div>
        <CardDescription className="capitalize">{check.status}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        {check.latencyMs != null ? <p>Latência: {check.latencyMs} ms</p> : null}
        {check.detail ? (
          <p className="break-all font-mono text-xs">{check.detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function DiagnosticsPage() {
  const query = useQuery({
    queryKey: ["diagnostics"],
    queryFn: fetchDiagnostics,
    refetchInterval: 30_000,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Falha ao carregar diagnostics</CardTitle>
          <CardDescription>GET /api/ops/diagnostics</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
        </CardContent>
      </Card>
    );
  }

  const data = query.data;
  const checks = data.checks;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Diagnostics</h1>
          <p className="text-muted-foreground">
            Saúde dos componentes · {formatDateTime(data.timestamp)} ·{" "}
            {data.generatedInMs} ms
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">scope: {data.scope}</Badge>
          <Badge
            variant={data.status === "ok" ? "success" : "warning"}
            className="capitalize"
          >
            {data.status}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Atualizar
          </Button>
        </div>
      </div>

      {data.scope === "limited" ? (
        <p className="text-sm text-muted-foreground">
          AGENT recebe escopo limitado (sem OpenAI/Workers).
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CheckCard name="postgres" check={checks.postgres} />
        <CheckCard name="redis" check={checks.redis} />
        <CheckCard name="openai" check={checks.openai} />
        <CheckCard name="whatsapp" check={checks.whatsapp} />
        <CheckCard name="workers" check={checks.workers} />
      </div>
    </div>
  );
}
