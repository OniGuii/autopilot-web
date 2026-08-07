"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RequireRole } from "@/components/auth/require-role";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchRecoveryDashboard,
  fetchRecoverySettings,
  updateRecoverySettings,
} from "@/features/ai/api";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";
import { useState } from "react";

function AiRecoveryContent() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["ai-recovery-settings"],
    queryFn: fetchRecoverySettings,
  });
  const dashboardQuery = useQuery({
    queryKey: ["ai-recovery-dashboard"],
    queryFn: fetchRecoveryDashboard,
    refetchInterval: 30_000,
  });

  const [cadenceText, setCadenceText] = useState<string | null>(null);
  const [hoursStart, setHoursStart] = useState<string | null>(null);
  const [hoursEnd, setHoursEnd] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: updateRecoverySettings,
    onSuccess: async (data) => {
      toast.success("Recovery atualizado");
      await queryClient.setQueryData(["ai-recovery-settings"], data);
      await queryClient.invalidateQueries({
        queryKey: ["ai-recovery-dashboard"],
      });
      setCadenceText(null);
      setHoursStart(null);
      setHoursEnd(null);
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível salvar."));
    },
  });

  if (settingsQuery.isLoading || dashboardQuery.isLoading) {
    return <LoadingBlock label="Carregando Recovery…" />;
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <ErrorPanel
        title="Não foi possível carregar Recovery"
        description={friendlyError(settingsQuery.error, "Tente novamente.")}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const settings = settingsQuery.data;
  const metrics = dashboardQuery.data?.metrics;
  const cadenceValue =
    cadenceText ?? settings.cadenceHours.join(", ");
  const startValue =
    hoursStart ??
    (settings.allowedHoursStart == null
      ? ""
      : String(settings.allowedHoursStart));
  const endValue =
    hoursEnd ??
    (settings.allowedHoursEnd == null ? "" : String(settings.allowedHoursEnd));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery"
        description="Campanhas automáticas R1/R2/R3 via FollowUp Scheduler — sem spam, com stop on reply e takeover."
        breadcrumbs={breadcrumbsForPath("/ai/recovery")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={settings.enabled ? "success" : "secondary"}>
              {settings.enabled ? "Ativo" : "Desligado"}
            </Badge>
            <Button asChild variant="outline" size="sm">
              <Link href="/ai/settings">Agente de IA</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void settingsQuery.refetch();
                void dashboardQuery.refetch();
              }}
            >
              Atualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Leads em recovery"
          value={metrics?.leadsInRecovery}
          hint="FollowUps AI_RECOVERY agendados"
        />
        <MetricCard
          label="Tentativas enviadas"
          value={metrics?.attempts}
          hint="Execuções concluídas"
        />
        <MetricCard
          label="Recuperados"
          value={metrics?.recovered}
          hint="Inbound em até 7 dias após recovery"
        />
        <MetricCard
          label="Convertidos"
          value={metrics?.converted}
          hint="Leads CONVERTED pós-recovery"
        />
        <MetricCard
          label="Conversão recovery"
          value={
            metrics?.conversionRate == null
              ? "—"
              : `${Math.round(metrics.conversionRate * 100)}%`
          }
          hint="convertidos / leads tocados"
        />
        <MetricCard
          label="Receita recovery"
          value={metrics?.revenueRecovery}
          hint="Proxy MVP: soma de score dos convertidos"
        />
      </div>

      {dashboardQuery.data ? (
        <p className="text-xs text-muted-foreground">
          Painel gerado em {formatDateTime(dashboardQuery.data.generatedAt)}
        </p>
      ) : null}

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Política de recovery</CardTitle>
          <CardDescription>
            Presets:{" "}
            {settings.presets.map((p) => p.label).join(" · ")}. Cadência em
            horas a partir do âncora (último outbound sem resposta).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-3">
            <Button
              variant={settings.enabled ? "default" : "outline"}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ enabled: !settings.enabled })}
            >
              {settings.enabled ? "Desativar recovery" : "Ativar recovery"}
            </Button>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  cadenceHours: [24, 72, 168],
                  maxAttempts: 3,
                })
              }
            >
              Aplicar R1/R2/R3
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxAttempts">Máx. tentativas (1–3)</Label>
              <Input
                id="maxAttempts"
                type="number"
                min={1}
                max={3}
                defaultValue={settings.maxAttempts}
                disabled={mutation.isPending}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (
                    Number.isInteger(n) &&
                    n >= 1 &&
                    n <= 3 &&
                    n !== settings.maxAttempts
                  ) {
                    mutation.mutate({ maxAttempts: n });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown">Cooldown (horas)</Label>
              <Input
                id="cooldown"
                type="number"
                min={1}
                max={720}
                defaultValue={settings.cooldownHours}
                disabled={mutation.isPending}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (
                    Number.isInteger(n) &&
                    n >= 1 &&
                    n !== settings.cooldownHours
                  ) {
                    mutation.mutate({ cooldownHours: n });
                  }
                }}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="cadence">Cadência (horas, ex: 24, 72, 168)</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="cadence"
                  value={cadenceValue}
                  onChange={(e) => setCadenceText(e.target.value)}
                  disabled={mutation.isPending}
                />
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => {
                    const hours = cadenceValue
                      .split(/[,\s]+/)
                      .map((s) => Number(s.trim()))
                      .filter((n) => Number.isInteger(n) && n >= 1);
                    if (hours.length === 0) {
                      toast.error("Informe ao menos um horário de cadência.");
                      return;
                    }
                    mutation.mutate({ cadenceHours: hours.slice(0, 3) });
                  }}
                >
                  Salvar cadência
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hoursStart">Horário permitido — início</Label>
              <Input
                id="hoursStart"
                type="number"
                min={0}
                max={23}
                placeholder="ex: 9"
                value={startValue}
                onChange={(e) => setHoursStart(e.target.value)}
                disabled={mutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hoursEnd">Horário permitido — fim</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="hoursEnd"
                  type="number"
                  min={1}
                  max={24}
                  placeholder="ex: 18"
                  value={endValue}
                  onChange={(e) => setHoursEnd(e.target.value)}
                  disabled={mutation.isPending}
                />
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => {
                    const start =
                      startValue.trim() === "" ? null : Number(startValue);
                    const end =
                      endValue.trim() === "" ? null : Number(endValue);
                    if (
                      (start != null && !Number.isInteger(start)) ||
                      (end != null && !Number.isInteger(end))
                    ) {
                      toast.error("Horários devem ser inteiros ou vazios.");
                      return;
                    }
                    mutation.mutate({
                      allowedHoursStart: start,
                      allowedHoursEnd: end,
                    });
                  }}
                >
                  Salvar horários
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({ stopOnReply: !settings.stopOnReply })
              }
            >
              Stop on reply: {settings.stopOnReply ? "sim" : "não"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  stopOnHumanTakeover: !settings.stopOnHumanTakeover,
                })
              }
            >
              Stop on takeover:{" "}
              {settings.stopOnHumanTakeover ? "sim" : "não"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number | undefined;
  hint: string;
}) {
  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">
          {value === undefined ? "—" : value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

export default function AiRecoveryPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <AiRecoveryContent />
    </RequireRole>
  );
}
