"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createLeadNote,
  deleteLeadNote,
  listLeadNotes,
} from "@/features/leads/notes-api";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/providers/auth-provider";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LeadNotesPanel({ leadId }: { leadId: string }) {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const query = useQuery({
    queryKey: ["leads", leadId, "notes"],
    queryFn: () => listLeadNotes(leadId),
  });

  const create = useMutation({
    mutationFn: () => createLeadNote(leadId, body.trim()),
    onSuccess: async () => {
      setBody("");
      toast.success("Nota adicionada");
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "notes"] });
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "timeline"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível salvar a nota.")),
  });

  const remove = useMutation({
    mutationFn: (noteId: string) => deleteLeadNote(leadId, noteId),
    onSuccess: async () => {
      toast.success("Nota removida");
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "notes"] });
      await qc.invalidateQueries({ queryKey: ["leads", leadId, "timeline"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível remover a nota.")),
  });

  return (
    <Card className="bg-white/90">
      <CardHeader>
        <CardTitle>Notas</CardTitle>
        <CardDescription>
          Registre observações internas sobre este lead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            placeholder="Escreva uma nota…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          <Button
            type="button"
            disabled={!body.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Salvando…" : "Adicionar nota"}
          </Button>
        </div>

        {query.isLoading ? (
          <LoadingBlock rows={2} label="Carregando notas…" />
        ) : query.isError ? (
          <ErrorPanel
            title="Não foi possível carregar as notas"
            onRetry={() => void query.refetch()}
          />
        ) : !query.data?.length ? (
          <EmptyState
            title="Nenhuma nota ainda"
            description="Use notas para registrar contexto que a equipe precisa lembrar."
          />
        ) : (
          <ul className="space-y-3">
            {query.data.map((note) => {
              const canDelete =
                note.userId === user?.id ||
                role === "OWNER" ||
                role === "ADMIN";
              return (
                <li
                  key={note.id}
                  className="rounded-lg border bg-background/70 px-3 py-3"
                >
                  <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(note.createdAt)}
                    </p>
                    {canDelete ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm("Excluir esta nota?")) {
                            remove.mutate(note.id);
                          }
                        }}
                      >
                        Excluir
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
