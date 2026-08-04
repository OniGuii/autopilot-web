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
import { formatDateTime, formatPhone } from "@/lib/format";
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
import { Skeleton } from "@/components/ui/skeleton";

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
      <div>
        <h1 className="font-display text-4xl tracking-tight">Follow-ups</h1>
        <p className="text-muted-foreground">
          Lista via `GET /api/follow-ups`
          {leadId ? ` · lead ${leadId}` : ""}
        </p>
      </div>

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
            <div className="space-y-3 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : query.isError ? (
            <div className="p-6 text-sm text-destructive">
              Falha ao carregar follow-ups.
            </div>
          ) : !query.data?.data.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum follow-up encontrado.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                          {item.lead?.name || item.leadId}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {formatPhone(item.lead?.phone)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <FollowUpStatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3">{item.type}</td>
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
          )}
        </CardContent>
      </Card>

      {query.data ? (
        <div className="flex items-center justify-between gap-3">
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
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <FollowUpsContent />
    </Suspense>
  );
}
