"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listLeads } from "@/features/leads/api";
import { CreateLeadDialog } from "@/features/leads/create-lead-dialog";
import { LeadStatusBadge } from "@/features/leads/lead-status-badge";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@/features/leads/constants";
import type { LeadStatus } from "@/lib/api/types";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime, formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function LeadsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeadStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);

  const queryKey = useMemo(
    () => ["leads", { search, status, page }] as const,
    [search, status, page],
  );

  const query = useQuery({
    queryKey,
    queryFn: () =>
      listLeads({
        page,
        limit: 20,
        search: search.trim() || undefined,
        status: status === "ALL" ? undefined : status,
      }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Busque, filtre e acompanhe seus contatos."
        breadcrumbs={breadcrumbsForPath("/leads")}
        actions={<CreateLeadDialog />}
      />

      <Card className="bg-white/90">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filtros</CardTitle>
          <CardDescription>Busca por nome ou telefone e status</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <Input
            placeholder="Buscar nome ou telefone"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value as LeadStatus | "ALL");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              {LEAD_STATUSES.map((item) => (
                <SelectItem key={item} value={item}>
                  {LEAD_STATUS_LABEL[item]}
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
              <LoadingBlock rows={3} label="Carregando leads…" />
            </div>
          ) : query.isError ? (
            <div className="p-6">
              <ErrorPanel
                title="Não foi possível carregar os leads"
                onRetry={() => void query.refetch()}
              />
            </div>
          ) : !query.data?.data.length ? (
            <div className="p-6">
              <EmptyState
                title="Nenhum lead por aqui"
                description="Crie o primeiro lead ou ajuste os filtros de busca."
                action={<CreateLeadDialog />}
              />
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {query.data.data.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="block rounded-xl border bg-background/80 p-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{lead.name}</p>
                      <LeadStatusBadge status={lead.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatPhone(lead.phone)}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {lead.source || "—"} · {formatDateTime(lead.updatedAt)}
                    </p>
                  </Link>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Nome</th>
                      <th className="px-4 py-3 font-medium">Telefone</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Origem</th>
                      <th className="px-4 py-3 font-medium">Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.data.map((lead) => (
                      <tr
                        key={lead.id}
                        className="border-b last:border-0 hover:bg-accent/40"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {lead.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{formatPhone(lead.phone)}</td>
                        <td className="px-4 py-3">
                          <LeadStatusBadge status={lead.status} />
                        </td>
                        <td className="px-4 py-3">{lead.source || "—"}</td>
                        <td className="px-4 py-3">
                          {formatDateTime(lead.updatedAt)}
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
            {query.data.meta.total} leads
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
