"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "@/features/dashboard/api";
import { LEAD_STATUS_LABEL } from "@/features/leads/constants";
import type { LeadStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-display text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export default function DashboardPage() {
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
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
          <CardTitle>Falha ao carregar dashboard</CardTitle>
          <CardDescription>
            Não foi possível obter `GET /api/dashboard`.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
        </CardContent>
      </Card>
    );
  }

  const { overview, leads, conversations, followUps, generatedAt } = query.data;
  const statuses = Object.entries(leads.byStatus) as Array<[LeadStatus, number]>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Atualizado em {formatDateTime(generatedAt)}
          </p>
        </div>
        <Button asChild>
          <Link href="/leads">Abrir leads</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="Total de leads" value={overview.totalLeads} />
        <Kpi label="Conversas abertas" value={conversations.openConversations} />
        <Kpi label="Follow-ups pendentes" value={followUps.pending} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Leads por status</CardTitle>
            <CardDescription>
              Taxa de conversão: {(overview.conversionRate * 100).toFixed(1)}%
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {statuses.map(([status, count]) => (
              <div
                key={status}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{LEAD_STATUS_LABEL[status]}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Resumo operacional</CardTitle>
            <CardDescription>KPIs do período atual da API</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Novos</p>
              <p className="text-2xl font-semibold">{overview.newLeads}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Convertidos</p>
              <p className="text-2xl font-semibold">{overview.convertedLeads}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Msgs enviadas</p>
              <p className="text-2xl font-semibold">{conversations.messagesSent}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Follow-ups atrasados</p>
              <p className="text-2xl font-semibold">{followUps.overdue}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
