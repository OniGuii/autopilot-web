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
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime, formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      toast.error(friendlyError(error, "Não foi possível criar a conversa."));
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conversas"
        description="Acompanhe o histórico de mensagens com seus leads."
        breadcrumbs={breadcrumbsForPath("/conversations")}
      />

      <Card className="bg-white/90">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Nova conversa</CardTitle>
          <CardDescription>
            Abra um novo fio de mensagens a partir de um lead existente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="leadId">Identificador do lead</Label>
            <Input
              id="leadId"
              placeholder="Cole o código do lead"
              value={newLeadId}
              onChange={(e) => setNewLeadId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Cole o código do lead (encontrado na página do lead)
            </p>
          </div>
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
          <CardDescription>Busca por lead e status da conversa</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <Input
            placeholder="Buscar lead (nome ou telefone)"
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
            <div className="p-6">
              <LoadingBlock rows={3} label="Carregando conversas…" />
            </div>
          ) : query.isError ? (
            <div className="p-6">
              <ErrorPanel
                title="Não foi possível carregar as conversas"
                onRetry={() => void query.refetch()}
              />
            </div>
          ) : !query.data?.data.length ? (
            <div className="p-6">
              <EmptyState
                title="Nenhuma conversa por aqui"
                description="Abra uma conversa a partir de um lead ou ajuste os filtros."
              />
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {query.data.data.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/conversations/${conversation.id}`}
                    className="block rounded-xl border bg-background/80 p-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">
                        {conversation.lead?.name || "Lead"}
                      </p>
                      <Badge variant="secondary">
                        {CONVERSATION_STATUS_LABEL[conversation.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatPhone(conversation.lead?.phone)}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDateTime(conversation.lastMessageAt)}
                    </p>
                  </Link>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
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
                            {conversation.lead?.name || "Lead"}
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
                        <td className="px-4 py-3">
                          {conversation.channel === "WHATSAPP"
                            ? "WhatsApp"
                            : conversation.channel}
                        </td>
                        <td className="px-4 py-3">
                          {formatDateTime(conversation.lastMessageAt)}
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
    <Suspense fallback={<LoadingBlock rows={4} label="Carregando conversas…" />}>
      <ConversationsContent />
    </Suspense>
  );
}
