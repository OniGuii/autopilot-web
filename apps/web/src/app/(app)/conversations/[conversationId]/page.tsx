"use client";

import Link from "next/link";
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
import { createFollowUp } from "@/features/follow-ups/api";
import { getWhatsAppStatus, sendWhatsAppMessage } from "@/features/whatsapp/api";
import { WhatsAppStatusBadge } from "@/features/whatsapp/status-badge";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { Skeleton } from "@/components/ui/skeleton";

const messageSchema = z.object({
  body: z.string().min(1, "Mensagem obrigatória").max(4096),
  mode: z.enum(["crm", "whatsapp"]),
});

type MessageForm = z.infer<typeof messageSchema>;

const followUpSchema = z.object({
  suggestedBody: z.string().min(1, "Texto obrigatório"),
});

type FollowUpForm = z.infer<typeof followUpSchema>;

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
      toast.error(
        error instanceof ApiError ? error.message : "Falha ao enviar mensagem",
      );
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => closeConversation(conversationId),
    onSuccess: async () => {
      toast.success("Conversa fechada");
      await invalidate();
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Falha ao fechar conversa",
      );
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
      toast.success("Follow-up criado (SUGGESTED)");
      followUpForm.reset();
      await invalidate();
      router.push(`/follow-ups/${followUp.id}`);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Falha ao criar follow-up",
      );
    },
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Conversa não encontrada</CardTitle>
          <CardDescription>Verifique o id ou o contexto da empresa.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/conversations">Voltar</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const conversation = query.data;
  const messages = conversation.messages ?? [];
  const waConnected = waQuery.data?.status === "CONNECTED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/conversations">← Inbox</Link>
          </Button>
          <h1 className="font-display text-4xl tracking-tight">
            {conversation.lead?.name || "Conversa"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">
              {CONVERSATION_STATUS_LABEL[conversation.status]}
            </Badge>
            <span>{formatPhone(conversation.lead?.phone)}</span>
            <span>·</span>
            <Link
              href={`/leads/${conversation.leadId}`}
              className="text-primary hover:underline"
            >
              Ver lead
            </Link>
            {waQuery.data ? (
              <>
                <span>·</span>
                <WhatsAppStatusBadge status={waQuery.data.status} />
              </>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/follow-ups?leadId=${conversation.leadId}`}>
              Follow-ups
            </Link>
          </Button>
          {conversation.status !== "CLOSED" ? (
            <Button
              variant="outline"
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending}
            >
              Fechar
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Timeline de mensagens</CardTitle>
            <CardDescription>
              Últimas 50 mensagens (`GET /api/conversations/:id`)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[480px] space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-4">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma mensagem ainda.
                </p>
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
                          {message.direction} · {formatDateTime(message.createdAt)}
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
                  CRM (`/messages`)
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
                  WhatsApp (`/whatsapp/send`)
                </Button>
                {!waConnected ? (
                  <span className="text-xs text-muted-foreground">
                    WhatsApp precisa estar CONNECTED —{" "}
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
              `POST /api/follow-ups` (status inicial SUGGESTED)
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
