"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  createMembership,
  listMemberships,
  revokeMembership,
  updateMembership,
} from "@/features/memberships/api";
import { RequireRole } from "@/components/auth/require-role";
import { useAuth } from "@/providers/auth-provider";
import { canInviteRole, canManageTeam } from "@/lib/auth/rbac";
import type { MembershipRole } from "@/lib/api/types";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath, ROLE_LABEL } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["OWNER", "ADMIN", "AGENT"]),
});

type InviteForm = z.infer<typeof inviteSchema>;

const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  INVITED: "Convidado",
  REVOKED: "Removido",
};

function TeamContent() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");

  const query = useQuery({
    queryKey: ["memberships", statusFilter],
    queryFn: () =>
      listMemberships({
        status: statusFilter === "ALL" ? undefined : statusFilter,
        limit: 100,
      }),
  });

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", name: "", role: "AGENT" },
  });

  const invite = useMutation({
    mutationFn: createMembership,
    onSuccess: (data) => {
      toast.success(`Convite registrado para ${data.email}`);
      setOpen(false);
      form.reset({ email: "", name: "", role: "AGENT" });
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível enviar o convite.")),
  });

  const patchRole = useMutation({
    mutationFn: ({ id, next }: { id: string; next: MembershipRole }) =>
      updateMembership(id, { role: next }),
    onSuccess: () => {
      toast.success("Papel atualizado");
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível atualizar o papel.")),
  });

  const revoke = useMutation({
    mutationFn: revokeMembership,
    onSuccess: (data) => {
      toast.success(
        `Membro removido${data.revokedSessions ? ` · ${data.revokedSessions} sessão(ões) encerrada(s)` : ""}`,
      );
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível remover o membro.")),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipe"
        description="Convide pessoas e gerencie papéis na empresa."
        breadcrumbs={breadcrumbsForPath("/team")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Ativos</SelectItem>
                <SelectItem value="INVITED">Convidados</SelectItem>
                <SelectItem value="ALL">Todos</SelectItem>
              </SelectContent>
            </Select>
            {canManageTeam(role) ? (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button>Convidar membro</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Convidar membro</DialogTitle>
                    <DialogDescription>
                      O convite fica pendente até a pessoa ativar a conta. Por
                      enquanto o e-mail não é enviado automaticamente.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    className="space-y-3"
                    onSubmit={form.handleSubmit((v) => {
                      if (!canInviteRole(role, v.role)) {
                        toast.error("Você não pode convidar para este papel.");
                        return;
                      }
                      invite.mutate(v);
                    })}
                  >
                    <div className="space-y-2">
                      <Label>E-mail</Label>
                      <Input type="email" {...form.register("email")} />
                    </div>
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input {...form.register("name")} />
                    </div>
                    <div className="space-y-2">
                      <Label>Papel</Label>
                      <Select
                        value={form.watch("role")}
                        onValueChange={(v) =>
                          form.setValue("role", v as InviteForm["role"])
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {canInviteRole(role, "OWNER") ? (
                            <SelectItem value="OWNER">
                              {ROLE_LABEL.OWNER}
                            </SelectItem>
                          ) : null}
                          <SelectItem value="ADMIN">
                            {ROLE_LABEL.ADMIN}
                          </SelectItem>
                          <SelectItem value="AGENT">
                            {ROLE_LABEL.AGENT}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O convite fica pendente até a pessoa ativar a conta. Por
                      enquanto o e-mail não é enviado automaticamente.
                    </p>
                    <Button type="submit" disabled={invite.isPending}>
                      {invite.isPending ? "Enviando…" : "Registrar convite"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        }
      />

      {query.isLoading ? (
        <LoadingBlock rows={3} label="Carregando equipe…" />
      ) : query.isError ? (
        <ErrorPanel
          title="Não foi possível carregar a equipe"
          description={friendlyError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (query.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhum membro encontrado"
          description="Ajuste o filtro ou convide alguém para a equipe."
        />
      ) : (
        <div className="space-y-3">
          {(query.data?.data ?? []).map((m) => {
            const isSelf = m.userId === user?.id;
            return (
              <Card key={m.id} className="bg-white/90">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">
                      {m.name || m.email}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (você)
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {m.email}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="secondary">
                        {ROLE_LABEL[m.role] ?? m.role}
                      </Badge>
                      <Badge variant="outline">
                        {MEMBERSHIP_STATUS_LABEL[m.status] ?? m.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        desde {formatDateTime(m.joinedAt ?? m.createdAt)}
                      </span>
                    </div>
                  </div>
                  {canManageTeam(role) && !isSelf && m.status !== "REVOKED" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={m.role}
                        onValueChange={(v) =>
                          patchRole.mutate({
                            id: m.id,
                            next: v as MembershipRole,
                          })
                        }
                      >
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {canInviteRole(role, "OWNER") ? (
                            <SelectItem value="OWNER">
                              {ROLE_LABEL.OWNER}
                            </SelectItem>
                          ) : null}
                          <SelectItem value="ADMIN">
                            {ROLE_LABEL.ADMIN}
                          </SelectItem>
                          <SelectItem value="AGENT">
                            {ROLE_LABEL.AGENT}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remover ${m.email} da empresa? As sessões ativas serão encerradas.`,
                            )
                          ) {
                            revoke.mutate(m.id);
                          }
                        }}
                      >
                        Remover
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TeamPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <TeamContent />
    </RequireRole>
  );
}
