"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { assignLead, unassignLead } from "@/features/leads/api";
import { listMemberships } from "@/features/memberships/api";
import { friendlyError } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
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
import type { Lead } from "@/lib/api/types";

export function LeadAssignCard({ lead }: { lead: Lead }) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canUnassign = role === "OWNER" || role === "ADMIN";

  const members = useQuery({
    queryKey: ["memberships", "assign-picker"],
    queryFn: () => listMemberships({ status: "ACTIVE", limit: 100 }),
  });

  const activeMembers = (members.data?.data ?? []).filter(
    (m) => m.status === "ACTIVE",
  );

  const owner = activeMembers.find((m) => m.userId === lead.ownerId);

  const assign = useMutation({
    mutationFn: (ownerId: string) => assignLead(lead.id, ownerId),
    onSuccess: async () => {
      toast.success("Responsável atualizado");
      await qc.invalidateQueries({ queryKey: ["leads", lead.id] });
      await qc.invalidateQueries({ queryKey: ["leads", lead.id, "timeline"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível atribuir o responsável.")),
  });

  const unassign = useMutation({
    mutationFn: () => unassignLead(lead.id),
    onSuccess: async () => {
      toast.success("Responsável removido");
      await qc.invalidateQueries({ queryKey: ["leads", lead.id] });
      await qc.invalidateQueries({ queryKey: ["leads", lead.id, "timeline"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível remover o responsável.")),
  });

  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Responsável</CardTitle>
        <CardDescription>
          Quem cuida deste lead no dia a dia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          Atual:{" "}
          <span className="font-medium">
            {owner ? owner.name || owner.email : "Sem responsável"}
          </span>
        </p>
        <Select
          value={lead.ownerId ?? "none"}
          onValueChange={(value) => {
            if (value === "none") {
              if (!canUnassign) {
                toast.error("Somente administradores podem remover o responsável.");
                return;
              }
              if (window.confirm("Remover o responsável deste lead?")) {
                unassign.mutate();
              }
              return;
            }
            assign.mutate(value);
          }}
          disabled={assign.isPending || unassign.isPending || members.isLoading}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecionar responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem responsável</SelectItem>
            {activeMembers.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name || m.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {lead.ownerId && canUnassign ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={unassign.isPending}
            onClick={() => {
              if (window.confirm("Remover o responsável deste lead?")) {
                unassign.mutate();
              }
            }}
          >
            Remover responsável
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
