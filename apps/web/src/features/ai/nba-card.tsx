"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchNbaForConversation, fetchNbaForLead } from "@/features/ai/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingBlock } from "@/components/feedback/loading-block";

type Props =
  | { conversationId: string; leadId?: never }
  | { leadId: string; conversationId?: never };

export function NbaRecommendedActionCard(props: Props) {
  const conversationId =
    "conversationId" in props ? props.conversationId : undefined;
  const leadId = "leadId" in props ? props.leadId : undefined;

  const query = useQuery({
    queryKey: conversationId
      ? ["ai", "nba", "conversation", conversationId]
      : ["ai", "nba", "lead", leadId],
    queryFn: () =>
      conversationId
        ? fetchNbaForConversation(conversationId)
        : fetchNbaForLead(leadId!),
    enabled: Boolean(conversationId || leadId),
    refetchInterval: 15_000,
  });

  if (query.isLoading) {
    return (
      <Card className="bg-white/90">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Próxima ação recomendada</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingBlock className="py-4" />
        </CardContent>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return null;
  }

  const data = query.data;
  const recommended = data.recommended;
  if (!recommended) {
    return (
      <Card className="bg-white/90">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Próxima ação recomendada</CardTitle>
          <CardDescription>Somente leitura · sem conversa ativa</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Ainda não há ação comercial calculada para este lead.
          </p>
        </CardContent>
      </Card>
    );
  }

  const label =
    data.labels?.[recommended.action] ?? recommended.action.replace(/_/g, " ");

  return (
    <Card className="border-primary/15 bg-white/90">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Próxima ação recomendada</CardTitle>
            <CardDescription>
              Somente leitura · orienta a conversa (não executa sozinha)
            </CardDescription>
          </div>
          <Badge variant="secondary">{recommended.action}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-base font-medium tracking-tight">{label}</p>
        <p className="text-sm text-muted-foreground">{recommended.replyGoal}</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Temperatura</dt>
            <dd className="font-medium">{recommended.temperature}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Score</dt>
            <dd className="font-medium">{recommended.score}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Motivo</dt>
            <dd className="font-medium break-words">{recommended.reason}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
