"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getLead, updateLead } from "@/features/leads/api";
import { LeadStatusBadge } from "@/features/leads/lead-status-badge";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@/features/leads/constants";
import { LeadAssignCard } from "@/features/leads/lead-assign-card";
import { LeadNotesPanel } from "@/features/leads/lead-notes-panel";
import { LeadActivitiesPanel } from "@/features/leads/lead-activities-panel";
import { LeadTimelinePanel } from "@/features/leads/lead-timeline-panel";
import { LeadStatusHistory } from "@/features/leads/lead-status-history";
import {
  LeadConversationsPanel,
  LeadFollowUpsPanel,
} from "@/features/leads/lead-related-panels";
import { NbaRecommendedActionCard } from "@/features/ai/nba-card";
import { PurchaseIntentCard } from "@/features/ai/purchase-intent-card";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const schema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(8).max(32),
  email: z.string().email().optional().or(z.literal("")),
  source: z.string().max(32).optional(),
  status: z.enum([
    "NEW",
    "CONTACTED",
    "RESPONDED",
    "QUALIFIED",
    "CONVERTED",
    "LOST",
  ]),
  score: z.coerce.number().int().min(0).max(100),
});

type FormValues = z.infer<typeof schema>;

type WorkspaceTab = "overview" | "timeline" | "notes" | "activities";

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "overview", label: "Visão geral" },
  { id: "timeline", label: "Timeline" },
  { id: "notes", label: "Notas" },
  { id: "activities", label: "Atividades" },
];

export default function LeadDetailPage() {
  const params = useParams<{ leadId: string }>();
  const leadId = params.leadId;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<WorkspaceTab>("overview");

  const query = useQuery({
    queryKey: ["leads", leadId],
    queryFn: () => getLead(leadId),
    enabled: Boolean(leadId),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      source: "",
      status: "NEW",
      score: 0,
    },
  });

  useEffect(() => {
    if (!query.data) return;
    form.reset({
      name: query.data.name ?? "",
      phone: query.data.phone,
      email: query.data.email ?? "",
      source: query.data.source ?? "",
      status: query.data.status,
      score: query.data.score ?? 0,
    });
  }, [query.data, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      updateLead(leadId, {
        name: values.name,
        phone: values.phone,
        email: values.email || null,
        source: values.source || undefined,
        status: values.status,
        score: values.score,
      }),
    onSuccess: async () => {
      toast.success("Lead atualizado");
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["leads", leadId] });
      await queryClient.invalidateQueries({
        queryKey: ["leads", leadId, "timeline"],
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível atualizar o lead."));
    },
  });

  if (query.isLoading) {
    return <LoadingBlock rows={5} label="Carregando workspace do lead…" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Detalhe do lead"
          breadcrumbs={breadcrumbsForPath(`/leads/${leadId}`)}
        />
        <ErrorPanel
          title="Lead não encontrado"
          description="Verifique o link ou o contexto da empresa e tente novamente."
          onRetry={() => void query.refetch()}
        />
        <Button asChild variant="outline">
          <Link href="/leads">Voltar aos leads</Link>
        </Button>
      </div>
    );
  }

  const lead = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={lead.name || "Lead sem nome"}
        description={`${formatPhone(lead.phone)} · Atualizado ${formatDateTime(lead.updatedAt)}`}
        breadcrumbs={breadcrumbsForPath(`/leads/${lead.id}`)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LeadStatusBadge status={lead.status} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/conversations?leadId=${lead.id}`}>Conversas</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/follow-ups?leadId=${lead.id}`}>Follow-ups</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 rounded-xl border bg-white/80 p-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Pontuação</p>
          <p className="font-semibold">{lead.score}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Último contato</p>
          <p className="font-semibold">
            {lead.lastContactAt ? formatDateTime(lead.lastContactAt) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Origem</p>
          <p className="font-semibold">{lead.source || "—"}</p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Áreas do lead"
        className="flex flex-wrap gap-1 rounded-xl border bg-white/80 p-1"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              tab === item.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card className="bg-white/90">
              <CardHeader>
                <CardTitle>Dados do lead</CardTitle>
                <CardDescription>
                  Atualize informações e status deste contato.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-4 md:grid-cols-2"
                  onSubmit={form.handleSubmit((values) =>
                    mutation.mutate(values),
                  )}
                >
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome</Label>
                    <Input id="name" {...form.register("name")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone</Label>
                    <Input id="phone" {...form.register("phone")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input id="email" {...form.register("email")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source">Origem</Label>
                    <Input id="source" {...form.register("source")} />
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={form.watch("status")}
                      onValueChange={(value) =>
                        form.setValue("status", value as FormValues["status"])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {LEAD_STATUS_LABEL[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="score">Pontuação</Label>
                    <Input
                      id="score"
                      type="number"
                      min={0}
                      max={100}
                      {...form.register("score")}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Button type="submit" disabled={mutation.isPending}>
                      {mutation.isPending ? "Salvando…" : "Salvar alterações"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <LeadConversationsPanel leadId={lead.id} />
            <LeadFollowUpsPanel leadId={lead.id} />
          </div>

          <div className="space-y-6">
            <NbaRecommendedActionCard leadId={lead.id} />
            <PurchaseIntentCard leadId={lead.id} />
            <LeadAssignCard lead={lead} />
            <LeadStatusHistory leadId={lead.id} />
            <Card className="bg-white/90">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Identificador</CardTitle>
                <CardDescription>
                  Use ao vincular uma conversa a este lead.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <code className="rounded-md border bg-muted/40 px-3 py-2 text-xs break-all">
                  {lead.id}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(lead.id);
                      toast.success("Identificador copiado");
                    } catch {
                      toast.error(
                        "Não foi possível copiar. Selecione o código manualmente.",
                      );
                    }
                  }}
                >
                  Copiar
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "timeline" ? <LeadTimelinePanel leadId={lead.id} /> : null}
      {tab === "notes" ? <LeadNotesPanel leadId={lead.id} /> : null}
      {tab === "activities" ? <LeadActivitiesPanel leadId={lead.id} /> : null}
    </div>
  );
}
