"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RequireRole } from "@/components/auth/require-role";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
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
import { Label } from "@/components/ui/label";
import { fetchAiSettings, updateAiSettings } from "@/features/ai/api";
import { AI_MODE_LABEL } from "@/features/ai/constants";
import type { AiAgentMode } from "@/lib/api/types";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import Link from "next/link";

function AiSettingsContent() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["ai-settings"],
    queryFn: fetchAiSettings,
  });

  const mutation = useMutation({
    mutationFn: updateAiSettings,
    onSuccess: async (data) => {
      toast.success("Configurações de IA salvas");
      await queryClient.setQueryData(["ai-settings"], data);
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível salvar."));
    },
  });

  if (query.isLoading) {
    return <LoadingBlock label="Carregando configurações de IA…" />;
  }
  if (query.isError || !query.data) {
    return (
      <ErrorPanel
        title="Não foi possível carregar"
        description={friendlyError(query.error, "Tente novamente.")}
      />
    );
  }

  const settings = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agente de IA"
        description="Modo supervisionado: ASSIST sugere; AUTO responde só com grounding na KB e guardrails."
        breadcrumbs={breadcrumbsForPath("/ai/settings")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/ai/dashboard">Dashboard IA</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/ai/knowledge-base">Base de conhecimento</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/ai/recovery">Recovery</Link>
            </Button>
          </div>
        }
      />

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Modo do agente</CardTitle>
          <CardDescription>
            ASSIST é o padrão (humano no loop). AUTO é opt-in: envia só
            PRICE/PRODUCT/PAYMENT/DELIVERY/HOURS/ADDRESS com hit na KB.
            COMPLAINT, HUMAN e UNKNOWN sempre escalam.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 max-w-md">
            <Label>Modo</Label>
            <Select
              value={settings.mode}
              onValueChange={(v) =>
                mutation.mutate({ mode: v as AiAgentMode })
              }
              disabled={mutation.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["OFF", "ASSIST", "AUTO"] as AiAgentMode[]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {AI_MODE_LABEL[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p>
              Status atual: <strong>{AI_MODE_LABEL[settings.mode]}</strong>
            </p>
            <p className="mt-1">
              Envio automático:{" "}
              <strong>{settings.autoEnabled ? "ligado" : "desligado"}</strong>
            </p>
            <p className="mt-1">
              Limite de respostas automáticas por lead/dia:{" "}
              {settings.maxAutoRepliesPerLeadDay}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AiSettingsPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <AiSettingsContent />
    </RequireRole>
  );
}
