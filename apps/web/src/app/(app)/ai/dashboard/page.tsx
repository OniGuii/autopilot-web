"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RequireRole } from "@/components/auth/require-role";
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
import { fetchAiDashboard } from "@/features/ai/api";
import { AI_MODE_LABEL } from "@/features/ai/constants";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";

function AiDashboardContent() {
  const query = useQuery({
    queryKey: ["ai-dashboard"],
    queryFn: fetchAiDashboard,
    refetchInterval: 30_000,
  });

  if (query.isLoading) {
    return <LoadingBlock label="Carregando dashboard de IA…" />;
  }

  if (query.isError || !query.data) {
    return (
      <ErrorPanel
        title="Não foi possível carregar o dashboard"
        description={friendlyError(query.error, "Tente novamente.")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const data = query.data;
  const m = data.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard IA"
        description={`Agente supervisionado · ${formatDateTime(data.generatedAt)}`}
        breadcrumbs={breadcrumbsForPath("/ai/dashboard")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={data.autoEnabled ? "success" : "secondary"}>
              {AI_MODE_LABEL[data.mode]}
            </Badge>
            <Button asChild variant="outline" size="sm">
              <Link href="/ai/settings">Configurações</Link>
            </Button>
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card className="bg-white/90">
          <CardHeader className="pb-2">
            <CardDescription>Respondidas automaticamente</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {m.autoReplied}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Outbounds com source=ai_agent
          </CardContent>
        </Card>

        <Card className="bg-white/90">
          <CardHeader className="pb-2">
            <CardDescription>Escaladas para humano</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {m.escalatedToHuman}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Eventos AI_ESCALATED
          </CardContent>
        </Card>

        <Card className="bg-white/90">
          <CardHeader className="pb-2">
            <CardDescription>Taxa de automação</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {m.automationRate == null
                ? "—"
                : `${Math.round(m.automationRate * 100)}%`}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            auto / (auto + escaladas)
          </CardContent>
        </Card>

        <Card className="bg-white/90">
          <CardHeader className="pb-2">
            <CardDescription>KB ativas</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {m.kbEntriesActive}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-white/90">
          <CardHeader className="pb-2">
            <CardDescription>Conversas com agente pausado</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {m.pausedConversations}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-white/90">
          <CardHeader className="pb-2">
            <CardDescription>Limite AUTO / lead / dia</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {data.maxAutoRepliesPerLeadDay}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

export default function AiDashboardPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <AiDashboardContent />
    </RequireRole>
  );
}
