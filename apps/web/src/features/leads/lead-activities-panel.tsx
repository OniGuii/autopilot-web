"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  cancelLeadActivity,
  completeLeadActivity,
  createLeadActivity,
  listLeadActivities,
} from "@/features/leads/activities-api";
import {
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_TYPE_LABEL,
} from "@/features/leads/workspace-constants";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { LeadActivityType } from "@/lib/api/types";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPES = Object.keys(ACTIVITY_TYPE_LABEL) as LeadActivityType[];

export function LeadActivitiesPanel({ leadId }: { leadId: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState<LeadActivityType>("CALL");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const query = useQuery({
    queryKey: ["leads", leadId, "activities"],
    queryFn: () => listLeadActivities(leadId),
  });

  const create = useMutation({
    mutationFn: () =>
      createLeadActivity(leadId, {
        type,
        title: title.trim(),
        body: body.trim() || null,
        scheduledAt: scheduledAt
          ? new Date(scheduledAt).toISOString()
          : null,
      }),
    onSuccess: async () => {
      setTitle("");
      setBody("");
      setScheduledAt("");
      toast.success("Atividade criada");
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "activities"] });
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "timeline"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível criar a atividade.")),
  });

  const complete = useMutation({
    mutationFn: (id: string) => completeLeadActivity(leadId, id),
    onSuccess: async () => {
      toast.success("Atividade concluída");
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "activities"] });
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "timeline"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível concluir a atividade.")),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelLeadActivity(leadId, id),
    onSuccess: async () => {
      toast.success("Atividade cancelada");
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "activities"] });
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "timeline"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível cancelar a atividade.")),
  });

  return (
    <Card className="bg-white/90">
      <CardHeader>
        <CardTitle>Atividades</CardTitle>
        <CardDescription>
          Planeje ligações, reuniões e próximos passos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 rounded-lg border bg-background/50 p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) {
              toast.error("Informe um título para a atividade.");
              return;
            }
            create.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as LeadActivityType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACTIVITY_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Quando (opcional)</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Ligar para confirmar interesse"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Detalhes</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder="Observações opcionais"
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Criando…" : "Criar atividade"}
            </Button>
          </div>
        </form>

        {query.isLoading ? (
          <LoadingBlock rows={2} label="Carregando atividades…" />
        ) : query.isError ? (
          <ErrorPanel
            title="Não foi possível carregar as atividades"
            onRetry={() => void query.refetch()}
          />
        ) : !query.data?.length ? (
          <EmptyState
            title="Nenhuma atividade"
            description="Crie a primeira tarefa para organizar o atendimento."
          />
        ) : (
          <ul className="space-y-3">
            {query.data.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border bg-background/70 px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {ACTIVITY_TYPE_LABEL[item.type]}
                      {item.scheduledAt
                        ? ` · ${formatDateTime(item.scheduledAt)}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {ACTIVITY_STATUS_LABEL[item.status]}
                  </Badge>
                </div>
                {item.body ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {item.body}
                  </p>
                ) : null}
                {item.status === "PLANNED" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => complete.mutate(item.id)}
                      disabled={complete.isPending}
                    >
                      Concluir
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("Cancelar esta atividade?")) {
                          cancel.mutate(item.id);
                        }
                      }}
                      disabled={cancel.isPending}
                    >
                      Cancelar
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
