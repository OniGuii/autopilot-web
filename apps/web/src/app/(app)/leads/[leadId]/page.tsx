"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { toast } from "sonner";
import { getLead, updateLead } from "@/features/leads/api";
import { LeadStatusBadge } from "@/features/leads/lead-status-badge";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@/features/leads/constants";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, formatPhone } from "@/lib/format";
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
import { Skeleton } from "@/components/ui/skeleton";

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

export default function LeadDetailPage() {
  const params = useParams<{ leadId: string }>();
  const leadId = params.leadId;
  const queryClient = useQueryClient();

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
      name: query.data.name,
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
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Falha ao atualizar lead",
      );
    },
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
          <CardTitle>Lead não encontrado</CardTitle>
          <CardDescription>Verifique o id ou o contexto da empresa.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/leads">Voltar</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const lead = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/leads">← Voltar</Link>
          </Button>
          <h1 className="font-display text-4xl tracking-tight">{lead.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <LeadStatusBadge status={lead.status} />
            <span>{formatPhone(lead.phone)}</span>
            <span>·</span>
            <span>Atualizado {formatDateTime(lead.updatedAt)}</span>
          </div>
        </div>
      </div>

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Editar lead</CardTitle>
          <CardDescription>`PATCH /api/leads/:id`</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
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
              <Label htmlFor="score">Score</Label>
              <Input id="score" type="number" min={0} max={100} {...form.register("score")} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Salvando…" : "Salvar alterações"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
