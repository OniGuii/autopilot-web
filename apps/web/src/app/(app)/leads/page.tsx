"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listLeads } from "@/features/leads/api";
import { CreateLeadDialog } from "@/features/leads/create-lead-dialog";
import { LeadStatusBadge } from "@/features/leads/lead-status-badge";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@/features/leads/constants";
import type { LeadStatus } from "@/lib/api/types";
import { formatDateTime, formatPhone } from "@/lib/format";
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
import { Skeleton } from "@/components/ui/skeleton";

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Leads</h1>
          <p className="text-muted-foreground">
            Lista paginada via `GET /api/leads`
          </p>
        </div>
        <CreateLeadDialog />
      </div>

      <Card className="bg-white/90">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filtros</CardTitle>
          <CardDescription>Busca por nome/telefone e status</CardDescription>
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
            <div className="space-y-3 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : query.isError ? (
            <div className="p-6 text-sm text-destructive">
              Falha ao carregar leads.
            </div>
          ) : !query.data?.data.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                    <tr key={lead.id} className="border-b last:border-0 hover:bg-accent/40">
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
                      <td className="px-4 py-3">{formatDateTime(lead.updatedAt)}</td>
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
