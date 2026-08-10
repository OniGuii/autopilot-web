"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  createOutboundSuppress,
  fetchOutboundProtectionDashboard,
  fetchOutboundProtectionSettings,
  listOutboundSuppress,
  removeOutboundSuppress,
  updateOutboundProtectionSettings,
} from "@/features/outbound/api";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number | undefined;
  hint?: string;
}) {
  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {value ?? "—"}
        </CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function OutboundProtectionContent() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["outbound-protection-settings"],
    queryFn: fetchOutboundProtectionSettings,
  });
  const dashboardQuery = useQuery({
    queryKey: ["outbound-protection-dashboard"],
    queryFn: fetchOutboundProtectionDashboard,
    refetchInterval: 30_000,
  });
  const suppressQuery = useQuery({
    queryKey: ["outbound-suppress"],
    queryFn: () => listOutboundSuppress({ activeOnly: true, pageSize: 20 }),
  });

  const [keywordsText, setKeywordsText] = useState<string | null>(null);
  const [hoursStart, setHoursStart] = useState<string | null>(null);
  const [hoursEnd, setHoursEnd] = useState<string | null>(null);
  const [suppressPhone, setSuppressPhone] = useState("");
  const [suppressReason, setSuppressReason] = useState("");

  const mutation = useMutation({
    mutationFn: updateOutboundProtectionSettings,
    onSuccess: async (data) => {
      toast.success("Proteção outbound atualizada");
      await queryClient.setQueryData(["outbound-protection-settings"], data);
      await queryClient.invalidateQueries({
        queryKey: ["outbound-protection-dashboard"],
      });
      setKeywordsText(null);
      setHoursStart(null);
      setHoursEnd(null);
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível salvar."));
    },
  });

  const addSuppress = useMutation({
    mutationFn: createOutboundSuppress,
    onSuccess: async () => {
      toast.success("Telefone adicionado à suppress list");
      setSuppressPhone("");
      setSuppressReason("");
      await queryClient.invalidateQueries({ queryKey: ["outbound-suppress"] });
      await queryClient.invalidateQueries({
        queryKey: ["outbound-protection-dashboard"],
      });
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Falha ao adicionar suppress."));
    },
  });

  const delSuppress = useMutation({
    mutationFn: removeOutboundSuppress,
    onSuccess: async () => {
      toast.success("Suppress desativado");
      await queryClient.invalidateQueries({ queryKey: ["outbound-suppress"] });
      await queryClient.invalidateQueries({
        queryKey: ["outbound-protection-dashboard"],
      });
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Falha ao remover suppress."));
    },
  });

  if (settingsQuery.isLoading || dashboardQuery.isLoading) {
    return <LoadingBlock label="Carregando Outbound Protection…" />;
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <ErrorPanel
        title="Não foi possível carregar proteção outbound"
        description={friendlyError(settingsQuery.error, "Tente novamente.")}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const settings = settingsQuery.data;
  const metrics = dashboardQuery.data?.metrics;
  const keywordsValue =
    keywordsText ?? settings.suppressOnKeywords.join(", ");
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
        title="Outbound Protection"
        description="Caps, cooldown, opt-out e suppress list para prospecção ativa — sem blast."
        breadcrumbs={breadcrumbsForPath("/outbound/protection")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={settings.enabled ? "success" : "secondary"}>
              {settings.enabled ? "Caps ativos" : "Caps desligados"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void settingsQuery.refetch();
                void dashboardQuery.refetch();
                void suppressQuery.refetch();
              }}
            >
              Atualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Enviados hoje (proativo)"
          value={metrics?.proactiveSentToday}
          hint="ai_recovery / first-touch / nurture"
        />
        <MetricCard
          label="Restante no dia"
          value={metrics?.remainingDaily}
          hint={`Cap diário ${settings.dailyProactiveCap}`}
        />
        <MetricCard
          label="Restante na hora"
          value={metrics?.remainingHourly}
          hint={`Cap horário ${settings.hourlyProactiveCap}`}
        />
        <MetricCard
          label="Suppress ativos"
          value={metrics?.suppressActive}
          hint="Bloqueiam outbound proativo"
        />
        <MetricCard
          label="Opt-outs (7d)"
          value={metrics?.optOutsWeek}
          hint="Keywords de saída"
        />
        <MetricCard
          label="Bloqueios hoje"
          value={metrics?.blocksToday}
          hint="Auditorias OUTBOUND_PROACTIVE_BLOCKED"
        />
      </div>

      {dashboardQuery.data ? (
        <p className="text-xs text-muted-foreground">
          Painel gerado em {formatDateTime(dashboardQuery.data.generatedAt)}
        </p>
      ) : null}

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Política de proteção</CardTitle>
          <CardDescription>
            Suppress sempre vale. Caps, cooldown, spacing e janela horária só
            quando a proteção está ligada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-3">
            <Button
              variant={settings.enabled ? "default" : "outline"}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ enabled: !settings.enabled })}
            >
              {settings.enabled ? "Desativar caps" : "Ativar caps"}
            </Button>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  autoSuppressOnLost: !settings.autoSuppressOnLost,
                })
              }
            >
              Auto-suppress LOST:{" "}
              {settings.autoSuppressOnLost ? "ON" : "OFF"}
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dailyCap">Cap diário</Label>
              <Input
                id="dailyCap"
                type="number"
                min={1}
                defaultValue={settings.dailyProactiveCap}
                disabled={mutation.isPending}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (
                    Number.isInteger(n) &&
                    n >= 1 &&
                    n !== settings.dailyProactiveCap
                  ) {
                    mutation.mutate({ dailyProactiveCap: n });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hourlyCap">Cap horário</Label>
              <Input
                id="hourlyCap"
                type="number"
                min={1}
                defaultValue={settings.hourlyProactiveCap}
                disabled={mutation.isPending}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (
                    Number.isInteger(n) &&
                    n >= 1 &&
                    n !== settings.hourlyProactiveCap
                  ) {
                    mutation.mutate({ hourlyProactiveCap: n });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown">Cooldown por lead (min)</Label>
              <Input
                id="cooldown"
                type="number"
                min={1}
                defaultValue={settings.leadCooldownMinutes}
                disabled={mutation.isPending}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (
                    Number.isInteger(n) &&
                    n >= 1 &&
                    n !== settings.leadCooldownMinutes
                  ) {
                    mutation.mutate({ leadCooldownMinutes: n });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spacing">Spacing mínimo (seg)</Label>
              <Input
                id="spacing"
                type="number"
                min={0}
                defaultValue={settings.minSpacingSeconds}
                disabled={mutation.isPending}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (
                    Number.isInteger(n) &&
                    n >= 0 &&
                    n !== settings.minSpacingSeconds
                  ) {
                    mutation.mutate({ minSpacingSeconds: n });
                  }
                }}
              />
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
                    mutation.mutate({
                      allowedHoursStart: start,
                      allowedHoursEnd: end,
                    });
                  }}
                >
                  Salvar janela
                </Button>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="keywords">Keywords de opt-out</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="keywords"
                  value={keywordsValue}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  disabled={mutation.isPending}
                />
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => {
                    const keywords = keywordsValue
                      .split(/[,\s]+/)
                      .map((s) => s.trim().toLowerCase())
                      .filter(Boolean);
                    mutation.mutate({ suppressOnKeywords: keywords });
                  }}
                >
                  Salvar keywords
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Suppress list</CardTitle>
          <CardDescription>
            Telefones bloqueados para outbound proativo (manual ou opt-out).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              placeholder="Telefone"
              value={suppressPhone}
              onChange={(e) => setSuppressPhone(e.target.value)}
            />
            <Input
              placeholder="Motivo (opcional)"
              value={suppressReason}
              onChange={(e) => setSuppressReason(e.target.value)}
            />
            <Button
              disabled={addSuppress.isPending || !suppressPhone.trim()}
              onClick={() =>
                addSuppress.mutate({
                  phone: suppressPhone.trim(),
                  reason: suppressReason.trim() || undefined,
                })
              }
            >
              Adicionar
            </Button>
          </div>

          {suppressQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : suppressQuery.data?.items.length ? (
            <ul className="divide-y rounded-md border">
              {suppressQuery.data.items.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium tabular-nums">{row.phone}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.source}
                      {row.reason ? ` · ${row.reason}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={delSuppress.isPending}
                    onClick={() => delSuppress.mutate(row.id)}
                  >
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum telefone na suppress list.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function OutboundProtectionPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <OutboundProtectionContent />
    </RequireRole>
  );
}
