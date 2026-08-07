"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  closeConversation,
  createMessage,
  getConversation,
} from "@/features/conversations/api";
import { CONVERSATION_STATUS_LABEL } from "@/features/conversations/constants";
import {
  approveFollowUp,
  createFollowUp,
  rejectFollowUp,
  updateFollowUp,
} from "@/features/follow-ups/api";
import { getWhatsAppStatus, sendWhatsAppMessage } from "@/features/whatsapp/api";
import { WhatsAppStatusBadge } from "@/features/whatsapp/status-badge";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const messageSchema = z.object({
  body: z.string().min(1, "Mensagem obrigatória").max(4096),
  mode: z.enum(["crm", "whatsapp"]),
});

type MessageForm = z.infer<typeof messageSchema>;

const followUpSchema = z.object({
  suggestedBody: z.string().min(1, "Texto obrigatório"),
});

type FollowUpForm = z.infer<typeof followUpSchema>;

const DIRECTION_LABEL: Record<string, string> = {
  OUTBOUND: "Enviada",
  INBOUND: "Recebida",
};

export default function ConversationDetailPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;
  const router = useRouter();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["conversations", conversationId],
    queryFn: () => getConversation(conversationId),
    enabled: Boolean(conversationId),
    refetchInterval: 10_000,
  });

  const waQuery = useQuery({
    queryKey: ["whatsapp", "status"],
    queryFn: getWhatsAppStatus,
    retry: false,
  });

  const messageForm = useForm<MessageForm>({
    resolver: zodResolver(messageSchema),
    defaultValues: { body: "", mode: "crm" },
  });

  const followUpForm = useForm<FollowUpForm>({
    resolver: zodResolver(followUpSchema),
    defaultValues: { suggestedBody: "" },
  });

  const [editingAi, setEditingAi] = useState(false);
  const [aiDraft, setAiDraft] = useState("");

  useEffect(() => {
    const suggestion = query.data?.aiSuggestion?.suggestedBody ?? "";
    setAiDraft(suggestion);
    setEditingAi(false);
  }, [query.data?.aiSuggestion?.followUpId, query.data?.aiSuggestion?.suggestedBody]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["conversations", conversationId],
    });
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    await queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
  };

  const sendMutation = useMutation({
    mutationFn: async (values: MessageForm) => {
      if (!query.data) throw new Error("Conversa indisponível");
      if (values.mode === "whatsapp") {
        return sendWhatsAppMessage({
          leadId: query.data.leadId,
          conversationId: query.data.id,
          body: values.body,
        });
      }
      return createMessage(query.data.id, {
        direction: "OUTBOUND",
        body: values.body,
      });
    },
    onSuccess: async () => {
      toast.success("Mensagem enviada");
      messageForm.reset({ body: "", mode: messageForm.getValues("mode") });
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível enviar a mensagem."));
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => closeConversation(conversationId),
    onSuccess: async () => {
      toast.success("Conversa fechada");
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível fechar a conversa."));
    },
  });

  const followUpMutation = useMutation({
    mutationFn: (values: FollowUpForm) => {
      if (!query.data) throw new Error("Conversa indisponível");
      return createFollowUp({
        leadId: query.data.leadId,
        conversationId: query.data.id,
        suggestedBody: values.suggestedBody,
        type: "RECOVERY",
        channel: "WHATSAPP",
      });
    },
    onSuccess: async (followUp) => {
      toast.success("Follow-up criado como sugestão");
      followUpForm.reset();
      await invalidate();
      router.push(`/follow-ups/${followUp.id}`);
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível criar o follow-up."));
    },
  });

  const approveAiMutation = useMutation({
    mutationFn: async () => {
      const suggestion = query.data?.aiSuggestion;
      if (!suggestion) throw new Error("Sugestão indisponível");
      if (editingAi && aiDraft.trim() && aiDraft !== suggestion.suggestedBody) {
        await updateFollowUp(suggestion.followUpId, {
          suggestedBody: aiDraft.trim(),
        });
      }
      return approveFollowUp(suggestion.followUpId, {
        scheduledAt: new Date().toISOString(),
      });
    },
    onSuccess: async () => {
      toast.success("Sugestão da IA aprovada (agendada)");
      setEditingAi(false);
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível aprovar a sugestão."));
    },
  });

  const rejectAiMutation = useMutation({
    mutationFn: () => {
      const suggestion = query.data?.aiSuggestion;
      if (!suggestion) throw new Error("Sugestão indisponível");
      return rejectFollowUp(suggestion.followUpId, {
        reason: "Rejeitado na conversa",
      });
    },
    onSuccess: async () => {
      toast.success("Sugestão da IA rejeitada");
      setEditingAi(false);
      await invalidate();
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível rejeitar a sugestão."));
    },
  });

  if (query.isLoading) {
    return <LoadingBlock rows={4} label="Carregando conversa…" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Conversa"
          breadcrumbs={breadcrumbsForPath(`/conversations/${conversationId}`)}
        />
        <ErrorPanel
          title="Conversa não encontrada"
          description="Verifique o link ou o contexto da empresa e tente novamente."
          onRetry={() => void query.refetch()}
        />
        <Button asChild variant="outline">
          <Link href="/conversations">Voltar às conversas</Link>
        </Button>
      </div>
    );
  }

  const conversation = query.data;
  const messages = conversation.messages ?? [];
  const waConnected = waQuery.data?.status === "CONNECTED";
  const aiSuggestion = conversation.aiSuggestion;

  return (
    <div className="space-y-6">
      <PageHeader
        title={conversation.lead?.name || "Conversa"}
        description={`${formatPhone(conversation.lead?.phone)} · ${CONVERSATION_STATUS_LABEL[conversation.status]}`}
        breadcrumbs={breadcrumbsForPath(`/conversations/${conversation.id}`)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {CONVERSATION_STATUS_LABEL[conversation.status]}
            </Badge>
            {waQuery.data ? (
              <WhatsAppStatusBadge status={waQuery.data.status} />
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/leads/${conversation.leadId}`}>Ver lead</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/follow-ups?leadId=${conversation.leadId}`}>
                Follow-ups
              </Link>
            </Button>
            {conversation.status !== "CLOSED" ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    window.confirm(
                      "Fechar esta conversa? Você poderá consultá-la depois, mas não enviará novas mensagens por aqui.",
                    )
                  ) {
                    closeMutation.mutate();
                  }
                }}
                disabled={closeMutation.isPending}
              >
                {closeMutation.isPending ? "Fechando…" : "Fechar conversa"}
              </Button>
            ) : null}
          </div>
        }
      />

      {aiSuggestion ? (
        <Card className="border-primary/20 bg-white/90">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Resposta sugerida pela IA</CardTitle>
                <CardDescription>
                  Humano no loop — nada é enviado automaticamente
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {aiSuggestion.intent ? (
                  <Badge variant="secondary">{aiSuggestion.intent}</Badge>
                ) : null}
                {aiSuggestion.requiresHuman ? (
                  <Badge variant="warning">Precisa humano</Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Intent</dt>
                <dd className="font-medium">{aiSuggestion.intent ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Confiança</dt>
                <dd className="font-medium">
                  {aiSuggestion.confidence == null
                    ? "—"
                    : `${Math.round(aiSuggestion.confidence * 100)}%`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Fonte KB</dt>
                <dd className="font-medium break-words">
                  {aiSuggestion.kbTitle || aiSuggestion.kbSource || "—"}
                </dd>
              </div>
            </dl>

            {editingAi ? (
              <Textarea
                value={aiDraft}
                onChange={(e) => setAiDraft(e.target.value)}
                rows={6}
              />
            ) : (
              <p className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-sm">
                {aiSuggestion.suggestedBody}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => approveAiMutation.mutate()}
                disabled={
                  approveAiMutation.isPending || rejectAiMutation.isPending
                }
              >
                {approveAiMutation.isPending ? "Aprovando…" : "Aprovar"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (!editingAi) {
                    setAiDraft(aiSuggestion.suggestedBody ?? "");
                    setEditingAi(true);
                  } else {
                    setEditingAi(false);
                    setAiDraft(aiSuggestion.suggestedBody ?? "");
                  }
                }}
                disabled={
                  approveAiMutation.isPending || rejectAiMutation.isPending
                }
              >
                {editingAi ? "Cancelar edição" : "Editar"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    window.confirm(
                      "Rejeitar esta sugestão da IA? Ela não será enviada.",
                    )
                  ) {
                    rejectAiMutation.mutate();
                  }
                }}
                disabled={
                  approveAiMutation.isPending || rejectAiMutation.isPending
                }
              >
                {rejectAiMutation.isPending ? "Rejeitando…" : "Rejeitar"}
              </Button>
              <Button asChild variant="ghost">
                <Link href={`/follow-ups/${aiSuggestion.followUpId}`}>
                  Abrir follow-up
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Mensagens</CardTitle>
            <CardDescription>
              Histórico recente desta conversa
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[480px] space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-4">
              {messages.length === 0 ? (
                <EmptyState
                  title="Nenhuma mensagem ainda"
                  description="Envie a primeira mensagem abaixo."
                  className="border-0 bg-transparent py-8"
                />
              ) : (
                messages.map((message) => {
                  const outbound = message.direction === "OUTBOUND";
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "flex",
                        outbound ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
                          outbound
                            ? "bg-primary text-primary-foreground"
                            : "bg-white border",
                        )}
                      >
                        <p className="whitespace-pre-wrap">{message.body}</p>
                        <p
                          className={cn(
                            "mt-1 text-[11px]",
                            outbound
                              ? "text-primary-foreground/80"
                              : "text-muted-foreground",
                          )}
                        >
                          {DIRECTION_LABEL[message.direction] ??
                            message.direction}{" "}
                          · {formatDateTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form
              className="space-y-3"
              onSubmit={messageForm.handleSubmit((values) =>
                sendMutation.mutate(values),
              )}
            >
              <Textarea
                placeholder="Escreva a mensagem…"
                {...messageForm.register("body")}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={
                    messageForm.watch("mode") === "crm" ? "default" : "outline"
                  }
                  onClick={() => messageForm.setValue("mode", "crm")}
                >
                  Registrar no CRM
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    messageForm.watch("mode") === "whatsapp"
                      ? "default"
                      : "outline"
                  }
                  onClick={() => messageForm.setValue("mode", "whatsapp")}
                  disabled={!waConnected}
                >
                  Enviar pelo WhatsApp
                </Button>
                {!waConnected ? (
                  <span className="text-xs text-muted-foreground">
                    WhatsApp precisa estar conectado —{" "}
                    <Link href="/whatsapp" className="text-primary underline">
                      conectar
                    </Link>
                  </span>
                ) : null}
                <Button
                  className="ml-auto"
                  type="submit"
                  disabled={sendMutation.isPending}
                >
                  {sendMutation.isPending ? "Enviando…" : "Enviar"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Criar follow-up</CardTitle>
            <CardDescription>
              Sugira um próximo contato para esta conversa. Ele começa como
              sugestão e pode ser aprovado depois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={followUpForm.handleSubmit((values) =>
                followUpMutation.mutate(values),
              )}
            >
              <Textarea
                placeholder="Texto sugerido para o follow-up"
                {...followUpForm.register("suggestedBody")}
              />
              <Button type="submit" disabled={followUpMutation.isPending}>
                {followUpMutation.isPending ? "Criando…" : "Criar follow-up"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
