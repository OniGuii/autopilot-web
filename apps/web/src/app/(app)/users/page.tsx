"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listMemberships } from "@/features/memberships/api";
import {
  fetchUserSessions,
  logoutUserAll,
  revokeUserAccess,
} from "@/features/users/api";
import { RequireRole } from "@/components/auth/require-role";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath, ROLE_LABEL } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  INVITED: "Convidado",
  REVOKED: "Removido",
};

const USER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  DISABLED: "Desativado",
};

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
      toast.error(friendlyError(e, "Não foi possível encerrar as sessões.")),
  });

  const revoke = useMutation({
    mutationFn: revokeUserAccess,
    onSuccess: (data) => {
      toast.success(
        `Acesso revogado${data.revokedSessions ? ` · ${data.revokedSessions} sessão(ões)` : ""}`,
      );
      setSelectedUserId(null);
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível revogar o acesso.")),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        description="Gerencie sessões e acesso das pessoas da empresa."
        breadcrumbs={breadcrumbsForPath("/users")}
      />

      {members.isLoading ? (
        <LoadingBlock rows={3} label="Carregando usuários…" />
      ) : members.isError ? (
        <ErrorPanel
          title="Não foi possível carregar os usuários"
          description={friendlyError(members.error)}
          onRetry={() => void members.refetch()}
        />
      ) : (members.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhum usuário encontrado"
          description="Convide alguém na página Equipe para começar."
        />
      ) : (
        <div className="space-y-3">
          {(members.data?.data ?? []).map((m) => (
            <Card key={m.id} className="bg-white/90">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{m.name || m.email}</p>
                  <p className="text-sm text-muted-foreground">{m.email}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {ROLE_LABEL[m.role] ?? m.role}
                    </Badge>
                    <Badge variant="outline">
                      {MEMBERSHIP_STATUS_LABEL[m.status] ?? m.status}
                    </Badge>
                    <Badge variant="outline">
                      Conta:{" "}
                      {USER_STATUS_LABEL[m.userStatus] ?? m.userStatus}
                    </Badge>
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
            <DialogDescription>
              Dispositivos e navegadores com sessão ativa.
            </DialogDescription>
          </DialogHeader>
          {sessions.isLoading ? (
            <LoadingBlock rows={2} label="Carregando sessões…" />
          ) : sessions.isError ? (
            <ErrorPanel
              title="Não foi possível carregar as sessões"
              description={friendlyError(sessions.error)}
              onRetry={() => void sessions.refetch()}
            />
          ) : (sessions.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="Nenhuma sessão ativa"
              description="Este usuário não possui sessões abertas no momento."
              className="py-8"
            />
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {sessions.data?.items.map((s) => (
                <div
                  key={s.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <p className="text-xs text-muted-foreground">
                    Criada {formatDateTime(s.createdAt)} · expira{" "}
                    {formatDateTime(s.expiresAt)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.ip ?? "IP desconhecido"} · {s.userAgent ?? "Dispositivo desconhecido"}
                  </p>
                </div>
              ))}
            </div>
          )}
          {selectedUserId ? (
            <Button
              variant="outline"
              onClick={() => {
                if (
                  window.confirm(
                    `Encerrar todas as sessões de ${selectedLabel}?`,
                  )
                ) {
                  logoutAll.mutate(selectedUserId);
                }
              }}
              disabled={logoutAll.isPending}
            >
              {logoutAll.isPending ? "Encerrando…" : "Encerrar todas"}
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
