"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
} from "@/features/whatsapp/api";
import { WhatsAppStatusBadge } from "@/features/whatsapp/status-badge";
import type { WhatsAppConnectionStatus } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath, ROLE_LABEL } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/providers/auth-provider";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
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

const STATUS_FRIENDLY: Record<WhatsAppConnectionStatus, string> = {
  QR_PENDING: "Aguardando leitura do QR Code",
  CONNECTING: "Conectando…",
  CONNECTED: "Conectado e pronto para enviar",
  DISCONNECTED: "Desconectado",
  ERROR: "Há um problema na conexão",
};

export default function WhatsAppPage() {
  const { role } = useAuth();
  const canManage = role === "OWNER" || role === "ADMIN";
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["whatsapp", "status"],
    queryFn: getWhatsAppStatus,
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.status === "QR_PENDING" ? 3000 : 15_000,
  });

  const connectMutation = useMutation({
    mutationFn: connectWhatsApp,
    onSuccess: async (data) => {
      toast.success(STATUS_FRIENDLY[data.status] ?? "Conexão atualizada");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp", "status"] });
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível conectar o WhatsApp."));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectWhatsApp,
    onSuccess: async () => {
      toast.success("WhatsApp desconectado");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp", "status"] });
    },
    onError: (error) => {
      toast.error(
        friendlyError(error, "Não foi possível desconectar o WhatsApp."),
      );
    },
  });

  const notFound =
    query.isError &&
    query.error instanceof ApiError &&
    query.error.status === 404;

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Conecte o número da empresa para enviar e receber mensagens."
        breadcrumbs={breadcrumbsForPath("/whatsapp")}
      />

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Status da conexão</CardTitle>
          <CardDescription>
            {canManage
              ? "Conecte, escaneie o QR Code e acompanhe o status."
              : `Somente ${ROLE_LABEL.OWNER} ou ${ROLE_LABEL.ADMIN} podem alterar a conexão.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading ? (
            <LoadingBlock rows={2} label="Carregando status do WhatsApp…" />
          ) : notFound ? (
            <EmptyState
              title="WhatsApp ainda não conectado"
              description="Conecte um número para começar a enviar mensagens."
              action={
                canManage ? (
                  <Button
                    onClick={() => connectMutation.mutate()}
                    disabled={connectMutation.isPending}
                  >
                    {connectMutation.isPending ? "Conectando…" : "Conectar"}
                  </Button>
                ) : undefined
              }
            />
          ) : query.isError ? (
            <ErrorPanel
              title="Não foi possível carregar o status"
              description={friendlyError(query.error)}
              onRetry={() => void query.refetch()}
            />
          ) : query.data ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <WhatsAppStatusBadge status={query.data.status} />
                <span className="text-sm text-muted-foreground">
                  {STATUS_FRIENDLY[query.data.status]}
                </span>
              </div>
              {query.data.instanceName ? (
                <p className="text-sm text-muted-foreground">
                  Conta: {query.data.instanceName}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <p className="font-medium">
                    {query.data.phoneNumber || "—"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Conectado em</p>
                  <p className="font-medium">
                    {formatDateTime(query.data.connectedAt)}
                  </p>
                </div>
              </div>
              {query.data.lastError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {query.data.lastError}
                </p>
              ) : null}
              {query.data.status === "QR_PENDING" && query.data.qrCode ? (
                <div className="max-w-full overflow-hidden rounded-lg border bg-muted/30 p-4">
                  <p className="mb-3 text-sm font-medium">
                    Escaneie o QR Code no WhatsApp do celular
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      query.data.qrCode.startsWith("data:")
                        ? query.data.qrCode
                        : `data:image/png;base64,${query.data.qrCode}`
                    }
                    alt="QR Code WhatsApp"
                    width={256}
                    height={256}
                    className="mx-auto h-auto w-full max-w-xs rounded-md border bg-white p-2"
                  />
                </div>
              ) : null}
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => connectMutation.mutate()}
                    disabled={
                      connectMutation.isPending ||
                      query.data.status === "CONNECTED"
                    }
                  >
                    {connectMutation.isPending
                      ? "Conectando…"
                      : query.data.status === "CONNECTED"
                        ? "Já conectado"
                        : "Conectar / Reconectar"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Desconectar o WhatsApp? Mensagens deixarão de ser enviadas até reconectar.",
                        )
                      ) {
                        return;
                      }
                      disconnectMutation.mutate();
                    }}
                    disabled={
                      disconnectMutation.isPending ||
                      query.data.status === "DISCONNECTED"
                    }
                  >
                    {disconnectMutation.isPending
                      ? "Desconectando…"
                      : "Desconectar"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
