"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createConversation,
  listConversations,
} from "@/features/conversations/api";
import {
  CONVERSATION_STATUSES,
  CONVERSATION_STATUS_LABEL,
} from "@/features/conversations/constants";
import type { ConversationStatus } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

function ConversationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadIdFromQuery = searchParams.get("leadId") ?? undefined;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ConversationStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [newLeadId, setNewLeadId] = useState(leadIdFromQuery ?? "");

  const queryKey = useMemo(
    () => ["conversations", { search, status, page, leadIdFromQuery }] as const,
    [search, status, page, leadIdFromQuery],
  );

  const query = useQuery({
    queryKey,
    queryFn: () =>
      listConversations({
        page,
        limit: 20,
        search: search.trim() || undefined,
        status: status === "ALL" ? undefined : status,
        leadId: leadIdFromQuery,
      }),
  });

  const createMutation = useMutation({
    mutationFn: () => createConversation({ leadId: newLeadId.trim() }),
    onSuccess: async (conversation) => {
      toast.success("Conversa criada");
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/conversations/${conversation.id}`);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Falha ao criar conversa",
      );
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Conversas</h1>
          <p className="text-muted-foreground">
            Inbox via `GET /api/conversations`
          </p>
        </div>
      </div>

      <Card className="bg-white/90">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Nova conversa</CardTitle>
          <CardDescription>`POST /api/conversations` com leadId</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row">
          <Input
            placeholder="UUID do lead"
            value={newLeadId}
            onChange={(e) => setNewLeadId(e.target.value)}
          />
          <Button
            disabled={!newLeadId.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "Criando…" : "Abrir conversa"}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-white/90">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <Input
            placeholder="Buscar lead (nome/telefone)"
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
              setStatus(value as ConversationStatus | "ALL");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              {CONVERSATION_STATUSES.map((item) => (
                <SelectItem key={item} value={item}>
                  {CONVERSATION_STATUS_LABEL[item]}
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
              Falha ao carregar conversas.
            </div>
          ) : !query.data?.data.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma conversa encontrada.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Lead</th>
                    <th className="px-4 py-3 font-medium">Telefone</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Canal</th>
                    <th className="px-4 py-3 font-medium">Última msg</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.map((conversation) => (
                    <tr
                      key={conversation.id}
                      className="border-b last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/conversations/${conversation.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {conversation.lead?.name || conversation.leadId}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {formatPhone(conversation.lead?.phone)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">
                          {CONVERSATION_STATUS_LABEL[conversation.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{conversation.channel}</td>
                      <td className="px-4 py-3">
                        {formatDateTime(conversation.lastMessageAt)}
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
            {query.data.meta.total} conversas
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

export default function ConversationsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <ConversationsContent />
    </Suspense>
  );
}
