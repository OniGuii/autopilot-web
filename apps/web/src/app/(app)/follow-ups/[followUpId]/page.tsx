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
import { ApiError } from "@/lib/api/client";
import { formatDateTime, formatPhone } from "@/lib/format";
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
import { Skeleton } from "@/components/ui/skeleton";

const rejectSchema = z.object({
  reason: z.string().min(1, "Motivo obrigatório").max(500),
});

const scheduleSchema = z.object({
  scheduledAt: z.string().min(1, "Data obrigatória"),
});

type RejectForm = z.infer<typeof rejectSchema>;
type ScheduleForm = z.infer<typeof scheduleSchema>;

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
    toast.error(error instanceof ApiError ? error.message : fallback);
  };

  const approveMutation = useMutation({
    mutationFn: (values: ScheduleForm) =>
      approveFollowUp(followUpId, {
        scheduledAt: new Date(values.scheduledAt).toISOString(),
      }),
    onSuccess: async () => {
      toast.success("Follow-up aprovado (SCHEDULED)");
      await invalidate();
    },
    onError: (e) => onError(e, "Falha ao aprovar"),
  });

  const rejectMutation = useMutation({
    mutationFn: (values: RejectForm) => rejectFollowUp(followUpId, values),
    onSuccess: async () => {
      toast.success("Follow-up rejeitado");
      await invalidate();
    },
    onError: (e) => onError(e, "Falha ao rejeitar"),
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
    onError: (e) => onError(e, "Falha ao reagendar"),
  });

  const executeMutation = useMutation({
    mutationFn: () => executeFollowUp(followUpId),
    onSuccess: async (data) => {
      toast.success(`Execução: ${data.status}`);
      await invalidate();
    },
    onError: (e) => onError(e, "Falha ao executar"),
  });

  const retryMutation = useMutation({
    mutationFn: () => retryFollowUp(followUpId),
    onSuccess: async (data) => {
      toast.success(`Retry: ${data.status}`);
      await invalidate();
    },
    onError: (e) => onError(e, "Falha no retry"),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Follow-up não encontrado</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/follow-ups">Voltar</Link>
          </Button>
        </CardContent>
      </Card>
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
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/follow-ups">← Follow-ups</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl tracking-tight">
            {item.lead?.name || "Follow-up"}
          </h1>
          <FollowUpStatusBadge status={item.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {formatPhone(item.lead?.phone)} · tipo {item.type} · tentativas{" "}
          {item.attemptCount}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Detalhes</CardTitle>
            <CardDescription>`GET /api/follow-ups/:id`</CardDescription>
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
                <Link href={`/leads/${item.leadId}`}>Lead</Link>
              </Button>
              {item.conversationId ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/conversations/${item.conversationId}`}>
                    Conversa
                  </Link>
                </Button>
              ) : null}
            </div>
            {item.resultMessage ? (
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Mensagem resultado</p>
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
                  `POST /approve` → SCHEDULED
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
                <CardDescription>`POST /reject` (motivo obrigatório)</CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={rejectForm.handleSubmit((values) =>
                    rejectMutation.mutate(values),
                  )}
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
                <CardDescription>`POST /reschedule`</CardDescription>
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
                  `POST /execute` — requer WhatsApp CONNECTED
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => executeMutation.mutate()}
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
                <CardTitle className="text-lg">Retry</CardTitle>
                <CardDescription>`POST /retry` (FAILED)</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                >
                  {retryMutation.isPending ? "Retentando…" : "Tentar novamente"}
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
