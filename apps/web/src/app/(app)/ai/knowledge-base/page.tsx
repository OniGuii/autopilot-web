"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RequireRole } from "@/components/auth/require-role";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import {
  createKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry,
  listKnowledgeBase,
} from "@/features/ai/api";
import { KB_KIND_LABEL, KB_KINDS } from "@/features/ai/constants";
import type { KnowledgeBaseKind } from "@/lib/api/types";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";

const schema = z.object({
  kind: z.enum([
    "FAQ",
    "PRODUCT",
    "PRICE",
    "PAYMENT",
    "DELIVERY",
    "HOURS",
    "ADDRESS",
  ]),
  title: z.string().min(1, "Título obrigatório").max(200),
  body: z.string().min(1, "Conteúdo obrigatório").max(8000),
});

type FormValues = z.infer<typeof schema>;

function KnowledgeBaseContent() {
  const queryClient = useQueryClient();
  const [kindFilter, setKindFilter] = useState<KnowledgeBaseKind | "ALL">(
    "ALL",
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { kind: "FAQ", title: "", body: "" },
  });

  const query = useQuery({
    queryKey: ["knowledge-base", kindFilter],
    queryFn: () =>
      listKnowledgeBase({
        kind: kindFilter === "ALL" ? undefined : kindFilter,
        pageSize: 100,
      }),
  });

  const createMutation = useMutation({
    mutationFn: createKnowledgeBaseEntry,
    onSuccess: async () => {
      toast.success("Entrada adicionada à base");
      form.reset({ kind: form.getValues("kind"), title: "", body: "" });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível criar."));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeBaseEntry,
    onSuccess: async () => {
      toast.success("Entrada removida");
      await queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível remover."));
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Base de conhecimento"
        description="FAQ, produtos, preços, pagamento, entrega, horários e endereço usados pelo agente supervisionado."
        breadcrumbs={breadcrumbsForPath("/ai/knowledge-base")}
        actions={
          <Button asChild variant="outline">
            <Link href="/ai/settings">Configurações de IA</Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Nova entrada</CardTitle>
            <CardDescription>
              Quanto mais clara a base, menor o risco de resposta inventada.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={form.handleSubmit((values) =>
                createMutation.mutate(values),
              )}
            >
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={form.watch("kind")}
                  onValueChange={(v) =>
                    form.setValue("kind", v as KnowledgeBaseKind)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KB_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {KB_KIND_LABEL[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input id="title" {...form.register("title")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="body">Conteúdo</Label>
                <Textarea id="body" rows={5} {...form.register("body")} />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Salvando…" : "Adicionar"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-white/90">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Entradas</CardTitle>
              <CardDescription>
                {query.data ? `${query.data.total} no total` : "—"}
              </CardDescription>
            </div>
            <Select
              value={kindFilter}
              onValueChange={(v) =>
                setKindFilter(v as KnowledgeBaseKind | "ALL")
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filtrar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                {KB_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {KB_KIND_LABEL[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading ? (
              <LoadingBlock label="Carregando base…" />
            ) : query.isError ? (
              <ErrorPanel
                title="Falha ao listar"
                description={friendlyError(query.error, "Tente novamente.")}
              />
            ) : !query.data?.items.length ? (
              <EmptyState
                title="Nenhuma entrada ainda"
                description="Comece por horários, endereço e 5 FAQs."
              />
            ) : (
              query.data.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {KB_KIND_LABEL[item.kind]}
                        </Badge>
                        {!item.active ? (
                          <Badge variant="outline">Inativa</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 font-medium">{item.title}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {item.body}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Remover esta entrada da base de conhecimento?",
                          )
                        ) {
                          deleteMutation.mutate(item.id);
                        }
                      }}
                    >
                      Remover
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function KnowledgeBasePage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <KnowledgeBaseContent />
    </RequireRole>
  );
}
