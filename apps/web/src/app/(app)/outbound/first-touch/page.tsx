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
  approveFirstTouch,
  fetchFirstTouchDashboard,
  fetchFirstTouchSettings,
  generateFirstTouch,
  listFirstTouchFollowUps,
  rejectFirstTouch,
  updateFirstTouchSettings,
} from "@/features/outbound/api";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { executeFollowUp } from "@/features/follow-ups/api";

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

function FirstTouchContent() {
  const queryClient = useQueryClient();
  const [importBatchId, setImportBatchId] = useState("");
  const [limit, setLimit] = useState("20");

  const settingsQuery = useQuery({
    queryKey: ["outbound-first-touch-settings"],
    queryFn: fetchFirstTouchSettings,
  });
  const dashboardQuery = useQuery({
    queryKey: ["outbound-first-touch-dashboard"],
    queryFn: fetchFirstTouchDashboard,
    refetchInterval: 30_000,
  });
  const listQuery = useQuery({
    queryKey: ["outbound-first-touch-list"],
    queryFn: () => listFirstTouchFollowUps({ pageSize: 50 }),
    refetchInterval: 20_000,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["outbound-first-touch-settings"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["outbound-first-touch-dashboard"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["outbound-first-touch-list"],
      }),
    ]);
  };

  const saveSettings = useMutation({
    mutationFn: updateFirstTouchSettings,
    onSuccess: async () => {
      toast.success("First Touch atualizado");
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível salvar."));
    },
  });

  const generate = useMutation({
    mutationFn: () =>
      generateFirstTouch({
        importBatchId: importBatchId.trim() || undefined,
        limit: Number(limit) || 20,
      }),
    onSuccess: async (data) => {
      toast.success(
        `Gerados ${data.created} D0${data.skipped ? ` · ${data.skipped} ignorados` : ""}`,
      );
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Falha ao gerar First Touch."));
    },
  });

  const approve = useMutation({
    mutationFn: approveFirstTouch,
    onSuccess: async () => {
      toast.success("D0 aprovado (SCHEDULED)");
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Falha ao aprovar."));
    },
  });

  const reject = useMutation({
    mutationFn: rejectFirstTouch,
    onSuccess: async () => {
      toast.success("D0 rejeitado");
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Falha ao rejeitar."));
    },
  });

  const execute = useMutation({
    mutationFn: executeFollowUp,
    onSuccess: async () => {
      toast.success("D0 enviado");
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Falha ao enviar D0."));
    },
  });

  if (settingsQuery.isLoading || dashboardQuery.isLoading) {
    return <LoadingBlock />;
  }
  if (settingsQuery.isError) {
    return (
      <ErrorPanel
        title="Erro ao carregar First Touch"
        description={friendlyError(settingsQuery.error, "Tente novamente.")}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const settings = settingsQuery.data!;
  const metrics = dashboardQuery.data?.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title="First Touch"
        description="Gere e aprove a primeira abordagem (D0) para leads importados — sem blast."
        breadcrumbs={breadcrumbsForPath("/outbound/first-touch")}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <MetricCard label="Elegíveis" value={metrics?.eligible} />
        <MetricCard label="D0 gerados" value={metrics?.generated} />
        <MetricCard label="D0 aprovados" value={metrics?.approved} />
        <MetricCard label="D0 enviados" value={metrics?.sent} />
        <MetricCard label="D0 entregues" value={metrics?.delivered} />
        <MetricCard label="D0 respondidos" value={metrics?.responded} />
        <MetricCard
          label="Taxa resposta"
          value={
            metrics
              ? `${Math.round((metrics.replyRate ?? 0) * 100)}%`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Modo e playbook</CardTitle>
          <CardDescription>
            OFF · HUMAN_APPROVE · AUTO_SEND — Protection V1.1 aplica no envio.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="ft-mode">Modo</Label>
            <select
              id="ft-mode"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={settings.mode}
              onChange={(e) =>
                saveSettings.mutate({ mode: e.target.value })
              }
            >
              <option value="OFF">OFF</option>
              <option value="HUMAN_APPROVE">HUMAN_APPROVE</option>
              <option value="AUTO_SEND">AUTO_SEND</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ft-playbook">Playbook</Label>
            <select
              id="ft-playbook"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={settings.verticalPlaybook}
              onChange={(e) =>
                saveSettings.mutate({ verticalPlaybook: e.target.value })
              }
            >
              <option value="generic">generic</option>
              <option value="financeira">financeira</option>
              <option value="imobiliaria">imobiliaria</option>
              <option value="solar">solar</option>
              <option value="ecommerce">ecommerce</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ft-batch">Máx. por geração</Label>
            <Input
              id="ft-batch"
              type="number"
              min={1}
              max={100}
              defaultValue={settings.maxBatchSize}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (n && n !== settings.maxBatchSize) {
                  saveSettings.mutate({ maxBatchSize: n });
                }
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={settings.enableKbGrounding}
              onChange={(e) =>
                saveSettings.mutate({ enableKbGrounding: e.target.checked })
              }
            />
            Grounding KB
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enableMemorySeed}
              onChange={(e) =>
                saveSettings.mutate({ enableMemorySeed: e.target.checked })
              }
            />
            Seed Sales Memory (11E DISCOVERY)
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gerar D0</CardTitle>
          <CardDescription>
            Leads NEW sem outbound. Opcional: filtrar por importBatchId.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2 flex-1">
            <Label htmlFor="ft-import">Import batch ID (opcional)</Label>
            <Input
              id="ft-import"
              value={importBatchId}
              onChange={(e) => setImportBatchId(e.target.value)}
              placeholder="uuid do lote V1.2"
            />
          </div>
          <div className="space-y-2 w-28">
            <Label htmlFor="ft-limit">Limite</Label>
            <Input
              id="ft-limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || settings.mode === "OFF"}
          >
            {generate.isPending ? "Gerando…" : "Gerar First Touch"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fila First Touch</CardTitle>
          <CardDescription>Lead · Mensagem · Status · Modo · Ações</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {listQuery.isLoading ? (
            <LoadingBlock />
          ) : listQuery.isError ? (
            <ErrorPanel
              title="Erro na lista"
              description={friendlyError(listQuery.error, "Tente novamente.")}
              onRetry={() => void listQuery.refetch()}
            />
          ) : (listQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum D0 gerado ainda.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Lead</th>
                  <th className="py-2 pr-3 font-medium">Mensagem</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Modo</th>
                  <th className="py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.data!.items.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="py-3 pr-3">
                      <div className="font-medium">
                        {row.leadName || "Sem nome"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.leadPhone}
                      </div>
                    </td>
                    <td className="py-3 pr-3 max-w-md">
                      <p className="line-clamp-3 text-muted-foreground">
                        {row.body}
                      </p>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant="secondary">{row.status}</Badge>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant="outline">{row.mode}</Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        {row.status === "SUGGESTED" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => approve.mutate(row.id)}
                              disabled={approve.isPending}
                            >
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reject.mutate(row.id)}
                              disabled={reject.isPending}
                            >
                              Rejeitar
                            </Button>
                          </>
                        ) : null}
                        {row.status === "SCHEDULED" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => execute.mutate(row.id)}
                              disabled={execute.isPending}
                            >
                              Enviar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reject.mutate(row.id)}
                              disabled={reject.isPending}
                            >
                              Cancelar
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function OutboundFirstTouchPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <FirstTouchContent />
    </RequireRole>
  );
}
