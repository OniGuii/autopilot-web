"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  approveFollowUp,
  executeFollowUp,
  getFollowUp,
  rejectFollowUp,
  rescheduleFollowUp,
  retryFollowUp,
} from "@/features/follow-ups/api";
import { FollowUpStatusBadge } from "@/features/follow-ups/follow-up-status-badge";
import { FOLLOW_UP_STATUS_LABEL } from "@/features/follow-ups/constants";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime, formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const rejectSchema = z.object({
  reason: z.string().min(1, "Motivo obrigatório").max(500),
});

const scheduleSchema = z.object({
  scheduledAt: z.string().min(1, "Data obrigatória"),
});

type RejectForm = z.infer<typeof rejectSchema>;
type ScheduleForm = z.infer<typeof scheduleSchema>;

const TYPE_LABEL: Record<string, string> = {
  RECOVERY: "Recuperação",
  NURTURE: "Nutrição",
  REMINDER: "Lembrete",
  CUSTOM: "Personalizado",
};

function toLocalInputValue(iso: string | null | undefined) {
  if (!iso) {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function FollowUpDetailPage() {
  const params = useParams<{ followUpId: string }>();
  const followUpId = params.followUpId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["follow-ups", followUpId],
    queryFn: () => getFollowUp(followUpId),
    enabled: Boolean(followUpId),
  });

  const rejectForm = useForm<RejectForm>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });

  const approveForm = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { scheduledAt: toLocalInputValue(null) },
  });

  const rescheduleForm = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { scheduledAt: toLocalInputValue(null) },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["follow-ups", followUpId] });
    await queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const onError = (error: unknown, fallback: string) => {
    toast.error(friendlyError(error, fallback));
  };

  const approveMutation = useMutation({
    mutationFn: (values: ScheduleForm) =>
      approveFollowUp(followUpId, {
        scheduledAt: new Date(values.scheduledAt).toISOString(),
      }),
    onSuccess: async () => {
      toast.success("Follow-up aprovado e agendado");
      await invalidate();
    },
    onError: (e) => onError(e, "Não foi possível aprovar o follow-up."),
  });

  const rejectMutation = useMutation({
    mutationFn: (values: RejectForm) => rejectFollowUp(followUpId, values),
    onSuccess: async () => {
      toast.success("Follow-up rejeitado");
      await invalidate();
    },
    onError: (e) => onError(e, "Não foi possível rejeitar o follow-up."),
  });

  const rescheduleMutation = useMutation({
    mutationFn: (values: ScheduleForm) =>
      rescheduleFollowUp(followUpId, {
        scheduledAt: new Date(values.scheduledAt).toISOString(),
      }),
    onSuccess: async () => {
      toast.success("Follow-up reagendado");
      await invalidate();
    },
    onError: (e) => onError(e, "Não foi possível reagendar o follow-up."),
  });

  const executeMutation = useMutation({
    mutationFn: () => executeFollowUp(followUpId),
    onSuccess: async (data) => {
      toast.success(
        `Execução concluída: ${FOLLOW_UP_STATUS_LABEL[data.status] ?? data.status}`,
      );
      await invalidate();
    },
    onError: (e) => onError(e, "Não foi possível executar o follow-up."),
  });

  const retryMutation = useMutation({
    mutationFn: () => retryFollowUp(followUpId),
    onSuccess: async (data) => {
      toast.success(
        `Nova tentativa: ${FOLLOW_UP_STATUS_LABEL[data.status] ?? data.status}`,
      );
      await invalidate();
    },
    onError: (e) => onError(e, "Não foi possível tentar de novo."),
  });

  if (query.isLoading) {
    return <LoadingBlock rows={4} label="Carregando follow-up…" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Follow-up"
          breadcrumbs={breadcrumbsForPath(`/follow-ups/${followUpId}`)}
        />
        <ErrorPanel
          title="Follow-up não encontrado"
          description="Verifique o link ou o contexto da empresa e tente novamente."
          onRetry={() => void query.refetch()}
        />
        <Button asChild variant="outline">
          <Link href="/follow-ups">Voltar aos follow-ups</Link>
        </Button>
      </div>
    );
  }

  const item = query.data;
  const canApprove = item.status === "SUGGESTED";
  const canReject = item.status === "SUGGESTED";
  const canReschedule =
    item.status === "APPROVED" || item.status === "SCHEDULED";
  const canExecute = item.status === "SCHEDULED";
  const canRetry = item.status === "FAILED";

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.lead?.name || "Follow-up"}
        description={`${formatPhone(item.lead?.phone)} · ${TYPE_LABEL[item.type] ?? item.type} · ${item.attemptCount} tentativa(s)`}
        breadcrumbs={breadcrumbsForPath(`/follow-ups/${item.id}`)}
        actions={<FollowUpStatusBadge status={item.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Detalhes</CardTitle>
            <CardDescription>
              Texto sugerido, agenda e resultado deste follow-up.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Texto sugerido</p>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3">
                {item.suggestedBody || "—"}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Agendado</p>
                <p>{formatDateTime(item.scheduledAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Executado</p>
                <p>{formatDateTime(item.executedAt)}</p>
              </div>
            </div>
            {item.cancelReason ? (
              <div>
                <p className="text-xs text-muted-foreground">Motivo</p>
                <p>{item.cancelReason}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/leads/${item.leadId}`}>Ver lead</Link>
              </Button>
              {item.conversationId ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/conversations/${item.conversationId}`}>
                    Ver conversa
                  </Link>
                </Button>
              ) : null}
            </div>
            {item.resultMessage ? (
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  Mensagem enviada
                </p>
                <p className="mt-1 whitespace-pre-wrap">
                  {item.resultMessage.body}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {canApprove ? (
            <Card className="bg-white/90">
              <CardHeader>
                <CardTitle className="text-lg">Aprovar</CardTitle>
                <CardDescription>
                  Confirme a sugestão e escolha quando o contato deve acontecer.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={approveForm.handleSubmit((values) =>
                    approveMutation.mutate(values),
                  )}
                >
                  <div className="space-y-2">
                    <Label htmlFor="approveAt">Agendar para</Label>
                    <Input
                      id="approveAt"
                      type="datetime-local"
                      {...approveForm.register("scheduledAt")}
                    />
                  </div>
                  <Button type="submit" disabled={approveMutation.isPending}>
                    {approveMutation.isPending ? "Aprovando…" : "Aprovar"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {canReject ? (
            <Card className="bg-white/90">
              <CardHeader>
                <CardTitle className="text-lg">Rejeitar</CardTitle>
                <CardDescription>
                  Informe o motivo. Esta ação não pode ser desfeita.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={rejectForm.handleSubmit((values) => {
                    if (
                      !window.confirm(
                        "Rejeitar este follow-up? Esta ação não pode ser desfeita.",
                      )
                    ) {
                      return;
                    }
                    rejectMutation.mutate(values);
                  })}
                >
                  <Textarea
                    placeholder="Motivo da rejeição"
                    {...rejectForm.register("reason")}
                  />
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={rejectMutation.isPending}
                  >
                    {rejectMutation.isPending ? "Rejeitando…" : "Rejeitar"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {canReschedule ? (
            <Card className="bg-white/90">
              <CardHeader>
                <CardTitle className="text-lg">Reagendar</CardTitle>
                <CardDescription>
                  Escolha uma nova data e horário para o contato.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={rescheduleForm.handleSubmit((values) =>
                    rescheduleMutation.mutate(values),
                  )}
                >
                  <div className="space-y-2">
                    <Label htmlFor="rescheduleAt">Nova data</Label>
                    <Input
                      id="rescheduleAt"
                      type="datetime-local"
                      defaultValue={toLocalInputValue(item.scheduledAt)}
                      {...rescheduleForm.register("scheduledAt")}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={rescheduleMutation.isPending}
                  >
                    {rescheduleMutation.isPending ? "Salvando…" : "Reagendar"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {canExecute ? (
            <Card className="bg-white/90">
              <CardHeader>
                <CardTitle className="text-lg">Executar</CardTitle>
                <CardDescription>
                  Envia o follow-up agora. O WhatsApp precisa estar conectado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Executar este follow-up agora? A mensagem será enviada.",
                      )
                    ) {
                      return;
                    }
                    executeMutation.mutate();
                  }}
                  disabled={executeMutation.isPending}
                >
                  {executeMutation.isPending ? "Executando…" : "Executar agora"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {canRetry ? (
            <Card className="bg-white/90">
              <CardHeader>
                <CardTitle className="text-lg">Tentar de novo</CardTitle>
                <CardDescription>
                  Este follow-up falhou. Você pode tentar o envio novamente.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                >
                  {retryMutation.isPending ? "Tentando…" : "Tentar de novo"}
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
