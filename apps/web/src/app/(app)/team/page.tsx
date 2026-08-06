"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["OWNER", "ADMIN", "AGENT"]),
});

type InviteForm = z.infer<typeof inviteSchema>;

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
      toast.success(`Convite para ${data.email} (delivery: NONE)`);
      setOpen(false);
      form.reset({ email: "", name: "", role: "AGENT" });
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : "Falha ao convidar"),
  });

  const patchRole = useMutation({
    mutationFn: ({ id, next }: { id: string; next: MembershipRole }) =>
      updateMembership(id, { role: next }),
    onSuccess: () => {
      toast.success("Role atualizado");
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : "Falha ao atualizar"),
  });

  const revoke = useMutation({
    mutationFn: revokeMembership,
    onSuccess: (data) => {
      toast.success(`Membro removido (${data.revokedSessions} sessões)`);
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : "Falha ao remover"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Team</h1>
          <p className="text-muted-foreground">
            Memberships da empresa (`/api/memberships`)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">ACTIVE</SelectItem>
              <SelectItem value="INVITED">INVITED</SelectItem>
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
                </DialogHeader>
                <form
                  className="space-y-3"
                  onSubmit={form.handleSubmit((v) => {
                    if (!canInviteRole(role, v.role)) {
                      toast.error("Você não pode convidar este role");
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
                    <Label>Role</Label>
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
                          <SelectItem value="OWNER">OWNER</SelectItem>
                        ) : null}
                        <SelectItem value="ADMIN">ADMIN</SelectItem>
                        <SelectItem value="AGENT">AGENT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Convite cria membership INVITED — e-mail não é enviado
                    (`delivery: NONE`).
                  </p>
                  <Button type="submit" disabled={invite.isPending}>
                    Enviar convite
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Falha ao listar memberships</CardTitle>
            <CardDescription>
              {query.error instanceof Error
                ? query.error.message
                : "Erro desconhecido"}
            </CardDescription>
          </CardHeader>
        </Card>
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
                      <Badge variant="secondary">{m.role}</Badge>
                      <Badge variant="outline">{m.status}</Badge>
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
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {canInviteRole(role, "OWNER") ? (
                            <SelectItem value="OWNER">OWNER</SelectItem>
                          ) : null}
                          <SelectItem value="ADMIN">ADMIN</SelectItem>
                          <SelectItem value="AGENT">AGENT</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remover ${m.email} da empresa?`,
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
          {(query.data?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum membro.</p>
          ) : null}
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
