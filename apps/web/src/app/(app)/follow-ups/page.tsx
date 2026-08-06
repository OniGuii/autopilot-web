"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listFollowUps } from "@/features/follow-ups/api";
import {
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_STATUS_LABEL,
} from "@/features/follow-ups/constants";
import { FollowUpStatusBadge } from "@/features/follow-ups/follow-up-status-badge";
import type { FollowUpStatus } from "@/lib/api/types";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime, formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const TYPE_LABEL: Record<string, string> = {
  RECOVERY: "Recuperação",
  NURTURE: "Nutrição",
  REMINDER: "Lembrete",
  CUSTOM: "Personalizado",
};

function FollowUpsContent() {
  const searchParams = useSearchParams();
  const leadId = searchParams.get("leadId") ?? undefined;
  const [status, setStatus] = useState<FollowUpStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);

  const queryKey = useMemo(
    () => ["follow-ups", { status, page, leadId }] as const,
    [status, page, leadId],
  );

  const query = useQuery({
    queryKey,
    queryFn: () =>
      listFollowUps({
        page,
        limit: 20,
        status: status === "ALL" ? undefined : status,
        leadId,
      }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups"
        description={
          leadId
            ? "Follow-ups filtrados para o lead selecionado."
            : "Sugestões e contatos agendados com seus leads."
        }
        breadcrumbs={breadcrumbsForPath("/follow-ups")}
      />

      <Card className="bg-white/90">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filtros</CardTitle>
          <CardDescription>Status e paginação</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value as FollowUpStatus | "ALL");
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              {FOLLOW_UP_STATUSES.map((item) => (
                <SelectItem key={item} value={item}>
                  {FOLLOW_UP_STATUS_LABEL[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Atualizar
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-white/90">
        <CardContent className="p-0">
          {query.isLoading ? (
            <div className="p-6">
              <LoadingBlock rows={3} label="Carregando follow-ups…" />
            </div>
          ) : query.isError ? (
            <div className="p-6">
              <ErrorPanel
                title="Não foi possível carregar os follow-ups"
                onRetry={() => void query.refetch()}
              />
            </div>
          ) : !query.data?.data.length ? (
            <div className="p-6">
              <EmptyState
                title="Nenhum follow-up por aqui"
                description="Crie um follow-up a partir de uma conversa ou ajuste os filtros."
              />
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {query.data.data.map((item) => (
                  <Link
                    key={item.id}
                    href={`/follow-ups/${item.id}`}
                    className="block rounded-xl border bg-background/80 p-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">
                        {item.lead?.name || "Lead"}
                      </p>
                      <FollowUpStatusBadge status={item.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatPhone(item.lead?.phone)}
                    </p>
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {item.suggestedBody || "—"}
                    </p>
                  </Link>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Lead</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Tipo</th>
                      <th className="px-4 py-3 font-medium">Agendado</th>
                      <th className="px-4 py-3 font-medium">Sugestão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.data.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b last:border-0 hover:bg-accent/40"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/follow-ups/${item.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {item.lead?.name || "Lead"}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {formatPhone(item.lead?.phone)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <FollowUpStatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-3">
                          {TYPE_LABEL[item.type] ?? item.type}
                        </td>
                        <td className="px-4 py-3">
                          {formatDateTime(item.scheduledAt)}
                        </td>
                        <td className="max-w-xs truncate px-4 py-3">
                          {item.suggestedBody || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {query.data && query.data.data.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Página {query.data.meta.page} de {query.data.meta.totalPages || 1} ·{" "}
            {query.data.meta.total} follow-ups
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !query.data.meta.totalPages || page >= query.data.meta.totalPages
              }
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function FollowUpsPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} label="Carregando follow-ups…" />}>
      <FollowUpsContent />
    </Suspense>
  );
}
