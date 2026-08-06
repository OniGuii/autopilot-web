"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listConversations } from "@/features/conversations/api";
import { listFollowUps } from "@/features/follow-ups/api";
import { CONVERSATION_STATUS_LABEL } from "@/features/conversations/constants";
import { FOLLOW_UP_STATUS_LABEL } from "@/features/follow-ups/constants";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LeadConversationsPanel({ leadId }: { leadId: string }) {
  const query = useQuery({
    queryKey: ["conversations", { leadId, limit: 5 }],
    queryFn: () => listConversations({ leadId, limit: 5, page: 1 }),
  });

  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Últimas conversas</CardTitle>
            <CardDescription>Histórico recente deste lead.</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/conversations?leadId=${leadId}`}>Ver todas</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingBlock rows={2} label="Carregando conversas…" />
        ) : !query.data?.data.length ? (
          <EmptyState
            title="Nenhuma conversa"
            description="Abra a primeira conversa a partir da inbox."
            className="py-8"
            action={
              <Button asChild size="sm">
                <Link href={`/conversations?leadId=${leadId}`}>
                  Ir para conversas
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {query.data.data.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/conversations/${c.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {c.channel === "WHATSAPP" ? "WhatsApp" : c.channel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.lastMessageAt
                        ? formatDateTime(c.lastMessageAt)
                        : formatDateTime(c.createdAt)}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {CONVERSATION_STATUS_LABEL[c.status] ?? c.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const UPCOMING_STATUSES = new Set([
  "SUGGESTED",
  "APPROVED",
  "SCHEDULED",
]);

export function LeadFollowUpsPanel({ leadId }: { leadId: string }) {
  const query = useQuery({
    queryKey: ["follow-ups", { leadId, limit: 8 }],
    queryFn: () => listFollowUps({ leadId, limit: 8, page: 1 }),
  });

  const upcoming =
    query.data?.data.filter((f) => UPCOMING_STATUSES.has(f.status)) ?? [];

  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Próximos follow-ups</CardTitle>
            <CardDescription>Pendentes e agendados.</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/follow-ups?leadId=${leadId}`}>Ver todos</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingBlock rows={2} label="Carregando follow-ups…" />
        ) : upcoming.length === 0 ? (
          <EmptyState
            title="Nenhum follow-up pendente"
            description="Sugestões e agendamentos deste lead aparecem aqui."
            className="py-8"
            action={
              <Button asChild size="sm">
                <Link href={`/follow-ups?leadId=${leadId}`}>
                  Abrir follow-ups
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {upcoming.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/follow-ups/${f.id}`}
                  className="block rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">
                      {f.suggestedBody?.slice(0, 80) || f.type || "Follow-up"}
                    </p>
                    <Badge variant="secondary">
                      {FOLLOW_UP_STATUS_LABEL[f.status] ?? f.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {f.scheduledAt
                      ? `Agendado: ${formatDateTime(f.scheduledAt)}`
                      : `Criado: ${formatDateTime(f.createdAt)}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
