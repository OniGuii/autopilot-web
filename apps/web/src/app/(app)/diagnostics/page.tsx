"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDiagnostics } from "@/features/ops/api";
import type { DiagnosticCheck, DiagnosticCheckStatus } from "@/lib/api/types";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CHECK_LABELS: Record<string, string> = {
  postgres: "Banco de dados",
  redis: "Cache",
  openai: "Inteligência artificial",
  whatsapp: "WhatsApp",
  workers: "Processamento em segundo plano",
};

const STATUS_LABEL: Record<DiagnosticCheckStatus, string> = {
  ok: "Saudável",
  degraded: "Atenção",
  error: "Com falha",
  skipped: "Ignorado",
};

const SCOPE_LABEL: Record<string, string> = {
  full: "completa",
  limited: "limitada",
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
            title={STATUS_LABEL[check.status]}
          />
        </div>
        <CardDescription>{STATUS_LABEL[check.status]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        {check.latencyMs != null ? <p>Latência: {check.latencyMs} ms</p> : null}
        {check.detail ? (
          <p className="break-words text-xs">{check.detail}</p>
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
    return <LoadingBlock rows={4} label="Carregando diagnósticos…" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Diagnósticos"
          breadcrumbs={breadcrumbsForPath("/diagnostics")}
        />
        <ErrorPanel
          title="Não foi possível carregar os diagnósticos"
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const data = query.data;
  const checks = data.checks;
  const overallStatus =
    STATUS_LABEL[data.status as DiagnosticCheckStatus] ?? data.status;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnósticos"
        description={`Saúde dos componentes · ${formatDateTime(data.timestamp)} · ${data.generatedInMs} ms`}
        breadcrumbs={breadcrumbsForPath("/diagnostics")}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              Escopo {SCOPE_LABEL[data.scope] ?? data.scope}
            </Badge>
            <Badge variant={data.status === "ok" ? "success" : "warning"}>
              {overallStatus}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Atualizar
            </Button>
          </div>
        }
      />

      {data.scope === "limited" ? (
        <p className="text-sm text-muted-foreground">
          Você está vendo uma visão limitada. Alguns componentes só aparecem
          para administradores.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CheckCard name="postgres" check={checks.postgres} />
        <CheckCard name="redis" check={checks.redis} />
        <CheckCard name="openai" check={checks.openai} />
        <CheckCard name="whatsapp" check={checks.whatsapp} />
        <CheckCard name="workers" check={checks.workers} />
      </div>

      {data.aiAgent ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Agente de IA</CardTitle>
            <CardDescription>
              Modo operacional e saúde da Knowledge Base (Fase 11B)
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <p className="text-muted-foreground">Modo</p>
              <p className="font-medium">{data.aiAgent.mode}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Entradas KB ativas</p>
              <p className="font-medium">{data.aiAgent.kbEntriesTotal}</p>
            </div>
            <div>
              <p className="text-muted-foreground">KB hit rate</p>
              <p className="font-medium">
                {data.aiAgent.kbHitRate == null
                  ? "—"
                  : `${Math.round(data.aiAgent.kbHitRate * 100)}%`}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Escalation rate</p>
              <p className="font-medium">
                {data.aiAgent.escalationRate == null
                  ? "—"
                  : `${Math.round(data.aiAgent.escalationRate * 100)}%`}
              </p>
            </div>
            <div className="sm:col-span-2 lg:col-span-4 text-xs text-muted-foreground">
              Auto-send:{" "}
              {data.aiAgent.autoSendEnabled ? "ligado" : "desligado (humano no loop)"}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
