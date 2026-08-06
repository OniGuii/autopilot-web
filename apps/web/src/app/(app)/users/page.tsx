"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
import { listMemberships } from "@/features/memberships/api";
import {
  fetchUserSessions,
  logoutUserAll,
  revokeUserAccess,
} from "@/features/users/api";
import { RequireRole } from "@/components/auth/require-role";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

function UsersContent() {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState("");

  const members = useQuery({
    queryKey: ["memberships", "users-admin"],
    queryFn: () => listMemberships({ limit: 100 }),
  });

  const sessions = useQuery({
    queryKey: ["user-sessions", selectedUserId],
    queryFn: () => fetchUserSessions(selectedUserId!),
    enabled: Boolean(selectedUserId),
  });

  const logoutAll = useMutation({
    mutationFn: logoutUserAll,
    onSuccess: (data) => {
      toast.success(`${data.revokedSessions} sessão(ões) encerrada(s)`);
      void qc.invalidateQueries({ queryKey: ["user-sessions", selectedUserId] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : "Falha ao encerrar"),
  });

  const revoke = useMutation({
    mutationFn: revokeUserAccess,
    onSuccess: (data) => {
      toast.success(`Acesso revogado (${data.revokedSessions} sessões)`);
      setSelectedUserId(null);
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : "Falha ao revogar"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Users</h1>
        <p className="text-muted-foreground">
          Administração por usuário (sessões / logout-all / revoke-access). A
          API não expõe listagem de users — usamos memberships.
        </p>
      </div>

      {members.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-3">
          {(members.data?.data ?? []).map((m) => (
            <Card key={m.id} className="bg-white/90">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{m.name || m.email}</p>
                  <p className="text-sm text-muted-foreground">{m.email}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary">{m.role}</Badge>
                    <Badge variant="outline">{m.status}</Badge>
                    <Badge variant="outline">user: {m.userStatus}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedUserId(m.userId);
                      setSelectedLabel(m.email);
                    }}
                  >
                    Sessões
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Encerrar todas as sessões de ${m.email}?`,
                        )
                      ) {
                        logoutAll.mutate(m.userId);
                      }
                    }}
                  >
                    Encerrar sessões
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={m.status === "REVOKED"}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Revogar acesso de ${m.email} nesta empresa?`,
                        )
                      ) {
                        revoke.mutate(m.userId);
                      }
                    }}
                  >
                    Revogar acesso
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(selectedUserId)}
        onOpenChange={(open) => {
          if (!open) setSelectedUserId(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sessões — {selectedLabel}</DialogTitle>
          </DialogHeader>
          {sessions.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : sessions.isError ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Falha ao carregar</CardTitle>
                <CardDescription>
                  {sessions.error instanceof Error
                    ? sessions.error.message
                    : "Erro"}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {(sessions.data?.items ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma sessão ativa.
                </p>
              ) : (
                sessions.data?.items.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    <p className="font-medium">{s.id.slice(0, 8)}…</p>
                    <p className="text-xs text-muted-foreground">
                      Criada {formatDateTime(s.createdAt)} · expira{" "}
                      {formatDateTime(s.expiresAt)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.ip ?? "—"} · {s.userAgent ?? "—"}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
          {selectedUserId ? (
            <Button
              variant="outline"
              onClick={() => logoutAll.mutate(selectedUserId)}
              disabled={logoutAll.isPending}
            >
              Encerrar todas
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function UsersPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <UsersContent />
    </RequireRole>
  );
}
