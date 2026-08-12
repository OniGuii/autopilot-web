"use client";

import { useParams } from "next/navigation";
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
  attachImportToCampaign,
  campaignArchive,
  campaignComplete,
  campaignPause,
  campaignReady,
  campaignResume,
  campaignStart,
  fetchCampaign,
  generateCampaignFirstTouch,
  listCampaignLeads,
  listLeadImportBatches,
  removeCampaignLeads,
  updateCampaign,
} from "@/features/outbound/api";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";

function pct(n: number | undefined) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function CampaignDetailContent() {
  const params = useParams<{ campaignId: string }>();
  const campaignId = params.campaignId;
  const queryClient = useQueryClient();
  const [importBatchId, setImportBatchId] = useState("");
  const [editName, setEditName] = useState<string | null>(null);
  const [editObjective, setEditObjective] = useState<string | null>(null);

  const campaignQuery = useQuery({
    queryKey: ["outbound-campaign", campaignId],
    queryFn: () => fetchCampaign(campaignId),
  });
  const leadsQuery = useQuery({
    queryKey: ["outbound-campaign-leads", campaignId],
    queryFn: () => listCampaignLeads(campaignId, { pageSize: 50 }),
  });
  const batchesQuery = useQuery({
    queryKey: ["lead-import-batches-for-campaign"],
    queryFn: () => listLeadImportBatches({ pageSize: 20 }),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["outbound-campaign", campaignId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["outbound-campaign-leads", campaignId],
      }),
      queryClient.invalidateQueries({ queryKey: ["outbound-campaigns"] }),
      queryClient.invalidateQueries({
        queryKey: ["outbound-campaigns-dashboard"],
      }),
    ]);
  };

  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      toast.success("Atualizado");
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Operação falhou."));
    },
  });

  if (campaignQuery.isLoading) return <LoadingBlock />;
  if (campaignQuery.isError || !campaignQuery.data) {
    return (
      <ErrorPanel
        title="Campanha não encontrada"
        description={friendlyError(campaignQuery.error)}
        onRetry={() => void campaignQuery.refetch()}
      />
    );
  }

  const c = campaignQuery.data;
  const metrics = c.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={c.objective}
        breadcrumbs={breadcrumbsForPath(`/outbound/campaigns/${campaignId}`)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{c.status}</Badge>
        <span className="text-sm text-muted-foreground">
          {metrics?.totalLeads ?? c.leadCount} leads
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total leads</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics?.totalLeads ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Elegíveis</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics?.eligible ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>First touch enviados</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics?.firstTouchSent ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Responderam</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics?.responded ?? 0}{" "}
              <span className="text-base font-normal text-muted-foreground">
                ({pct(metrics?.replyRate)})
              </span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>HOT</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics?.hot ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Convertidos</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics?.converted ?? 0}{" "}
              <span className="text-base font-normal text-muted-foreground">
                ({pct(metrics?.convertRate)})
              </span>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informações</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={editName ?? c.name}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => {
                if (editName != null && editName.trim() && editName !== c.name) {
                  run.mutate(() =>
                    updateCampaign(campaignId, { name: editName.trim() }),
                  );
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Objetivo</Label>
            <Input
              value={editObjective ?? c.objective}
              onChange={(e) => setEditObjective(e.target.value)}
              onBlur={() => {
                if (
                  editObjective != null &&
                  editObjective.trim() &&
                  editObjective !== c.objective
                ) {
                  run.mutate(() =>
                    updateCampaign(campaignId, {
                      objective: editObjective.trim(),
                    }),
                  );
                }
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground md:col-span-2">
            {c.description || "Sem descrição."}
          </p>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            {c.status === "DRAFT" ? (
              <Button
                size="sm"
                onClick={() => run.mutate(() => campaignReady(campaignId))}
              >
                Marcar READY
              </Button>
            ) : null}
            {c.status === "READY" || c.status === "PAUSED" ? (
              <Button
                size="sm"
                onClick={() =>
                  run.mutate(() =>
                    c.status === "PAUSED"
                      ? campaignResume(campaignId)
                      : campaignStart(campaignId),
                  )
                }
              >
                {c.status === "PAUSED" ? "Retomar" : "Iniciar"}
              </Button>
            ) : null}
            {c.status === "RUNNING" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => run.mutate(() => campaignPause(campaignId))}
              >
                Pausar
              </Button>
            ) : null}
            {c.status === "RUNNING" || c.status === "PAUSED" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => run.mutate(() => campaignComplete(campaignId))}
              >
                Concluir
              </Button>
            ) : null}
            {c.status !== "ARCHIVED" ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => run.mutate(() => campaignArchive(campaignId))}
              >
                Arquivar
              </Button>
            ) : null}
            {c.status === "RUNNING" ? (
              <Button
                size="sm"
                onClick={() =>
                  run.mutate(async () => {
                    const res = (await generateCampaignFirstTouch(
                      campaignId,
                      20,
                    )) as { created?: number };
                    toast.message(`D0 gerados: ${res.created ?? 0}`);
                  })
                }
              >
                Gerar First Touch
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adicionar leads do Import</CardTitle>
          <CardDescription>
            Seleciona todos os leads de um batch COMPLETED (V1.2).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2 flex-1">
            <Label>Import batch</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={importBatchId}
              onChange={(e) => setImportBatchId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {(batchesQuery.data?.items ?? [])
                .filter((b) => b.status === "COMPLETED")
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.filename || b.inputKind} · {b.rowCount} rows ·{" "}
                    {b.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </div>
          <Button
            disabled={!importBatchId || run.isPending}
            onClick={() =>
              run.mutate(() =>
                attachImportToCampaign(campaignId, importBatchId),
              )
            }
          >
            Adicionar todos do import
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {leadsQuery.isLoading ? (
            <LoadingBlock />
          ) : (leadsQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum lead na campanha.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Lead</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Score</th>
                  <th className="py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {leadsQuery.data!.items.map((row) => (
                  <tr key={row.membershipId} className="border-b">
                    <td className="py-3 pr-3">
                      <div className="font-medium">
                        {row.name || "Sem nome"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.phone}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant="outline">{row.status}</Badge>
                    </td>
                    <td className="py-3 pr-3 tabular-nums">{row.score}</td>
                    <td className="py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          run.mutate(() =>
                            removeCampaignLeads(campaignId, [row.leadId]),
                          )
                        }
                      >
                        Remover
                      </Button>
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

export default function CampaignDetailPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <CampaignDetailContent />
    </RequireRole>
  );
}
