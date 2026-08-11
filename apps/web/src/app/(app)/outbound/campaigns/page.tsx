"use client";

import Link from "next/link";
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
  createCampaign,
  fetchCampaignDashboard,
  listCampaigns,
} from "@/features/outbound/api";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {value ?? "—"}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function pct(n: number | undefined) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function CampaignsContent() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [description, setDescription] = useState("");

  const dashQuery = useQuery({
    queryKey: ["outbound-campaigns-dashboard"],
    queryFn: fetchCampaignDashboard,
    refetchInterval: 30_000,
  });
  const listQuery = useQuery({
    queryKey: ["outbound-campaigns"],
    queryFn: () => listCampaigns({ pageSize: 50 }),
  });

  const create = useMutation({
    mutationFn: createCampaign,
    onSuccess: async () => {
      toast.success("Campanha criada");
      setName("");
      setObjective("");
      setDescription("");
      await queryClient.invalidateQueries({ queryKey: ["outbound-campaigns"] });
      await queryClient.invalidateQueries({
        queryKey: ["outbound-campaigns-dashboard"],
      });
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Falha ao criar campanha."));
    },
  });

  if (listQuery.isLoading || dashQuery.isLoading) return <LoadingBlock />;
  if (listQuery.isError) {
    return (
      <ErrorPanel
        title="Erro ao carregar campanhas"
        description={friendlyError(listQuery.error)}
        onRetry={() => void listQuery.refetch()}
      />
    );
  }

  const m = dashQuery.data?.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campanhas"
        description="Agrupe leads importados e orquestre First Touch — sem blast."
        breadcrumbs={breadcrumbsForPath("/outbound/campaigns")}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <MetricCard label="Ativas" value={m?.active} />
        <MetricCard label="Concluídas" value={m?.completed} />
        <MetricCard label="Leads" value={m?.totalLeads} />
        <MetricCard label="Elegíveis" value={m?.eligible} />
        <MetricCard label="D0 enviados" value={m?.firstTouchSent} />
        <MetricCard label="Resposta" value={pct(m?.replyRate)} />
        <MetricCard label="HOT / Conv." value={`${m?.hot ?? 0} / ${m?.converted ?? 0}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nova campanha</CardTitle>
          <CardDescription>Cria em status DRAFT.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="c-name">Nome</Label>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Reativação Q3"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-obj">Objetivo</Label>
            <Input
              id="c-obj"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Reativar base opt-in"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="c-desc">Descrição</Label>
            <Input
              id="c-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div>
            <Button
              disabled={!name.trim() || !objective.trim() || create.isPending}
              onClick={() =>
                create.mutate({
                  name: name.trim(),
                  objective: objective.trim(),
                  description: description.trim() || undefined,
                })
              }
            >
              Criar campanha
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lista</CardTitle>
          <CardDescription>
            Nome · Status · Leads · Resposta · HOT · Conversão
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {(listQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma campanha ainda.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Nome</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Leads</th>
                  <th className="py-2 pr-3 font-medium">Resposta</th>
                  <th className="py-2 pr-3 font-medium">HOT</th>
                  <th className="py-2 font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.data!.items.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-3 pr-3">
                      <Link
                        href={`/outbound/campaigns/${c.id}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {c.objective}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant="secondary">{c.status}</Badge>
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {c.metrics?.totalLeads ?? c.leadCount}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {pct(c.metrics?.replyRate)}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {c.metrics?.hot ?? 0}
                    </td>
                    <td className="py-3 tabular-nums">
                      {pct(c.metrics?.convertRate)}
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

export default function OutboundCampaignsPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <CampaignsContent />
    </RequireRole>
  );
}
