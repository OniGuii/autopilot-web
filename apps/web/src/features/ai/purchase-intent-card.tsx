"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchPurchaseIntentForConversation,
  fetchPurchaseIntentForLead,
} from "@/features/ai/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { formatDateTime } from "@/lib/format";

type Props =
  | { conversationId: string; leadId?: never }
  | { leadId: string; conversationId?: never };

const BAND_LABEL: Record<string, string> = {
  VERY_HIGH: "Muito alta",
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
  VERY_LOW: "Muito baixa",
};

export function PurchaseIntentCard(props: Props) {
  const conversationId =
    "conversationId" in props ? props.conversationId : undefined;
  const leadId = "leadId" in props ? props.leadId : undefined;

  const query = useQuery({
    queryKey: conversationId
      ? ["ai", "purchase-intent", "conversation", conversationId]
      : ["ai", "purchase-intent", "lead", leadId],
    queryFn: () =>
      conversationId
        ? fetchPurchaseIntentForConversation(conversationId)
        : fetchPurchaseIntentForLead(leadId!),
    enabled: Boolean(conversationId || leadId),
    refetchInterval: 15_000,
  });

  if (query.isLoading) {
    return (
      <Card className="bg-white/90">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Purchase Intent</CardTitle>
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
  if (!data.purchaseIntent && !data.purchaseIntentUpdatedAt) {
    return (
      <Card className="bg-white/90">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Purchase Intent</CardTitle>
          <CardDescription>Somente leitura · ainda sem cálculo</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            A intenção de compra será calculada após interações do lead.
          </p>
        </CardContent>
      </Card>
    );
  }

  const band = data.purchaseIntent ?? "VERY_LOW";

  return (
    <Card className="border-primary/15 bg-white/90">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Purchase Intent</CardTitle>
            <CardDescription>
              Somente leitura · contexto comercial (não dispara ações)
            </CardDescription>
          </div>
          <Badge variant="secondary">{band}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-base font-medium tracking-tight">
          {BAND_LABEL[band] ?? band}
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Score</dt>
            <dd className="font-medium">{data.purchaseIntentScore}/100</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Faixa</dt>
            <dd className="font-medium">{band}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Última atualização</dt>
            <dd className="font-medium">
              {data.purchaseIntentUpdatedAt
                ? formatDateTime(data.purchaseIntentUpdatedAt)
                : "—"}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
