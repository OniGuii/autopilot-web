"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
} from "@/features/whatsapp/api";
import { WhatsAppStatusBadge } from "@/features/whatsapp/status-badge";
import { ApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
      toast.success(`Status: ${data.status}`);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp", "status"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Falha ao conectar WhatsApp",
      );
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
        error instanceof ApiError
          ? error.message
          : "Falha ao desconectar WhatsApp",
      );
    },
  });

  const notFound =
    query.isError &&
    query.error instanceof ApiError &&
    query.error.status === 404;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl tracking-tight">WhatsApp</h1>
        <p className="text-muted-foreground">
          Conexão e status da instância Evolution (`/api/whatsapp/*`)
        </p>
      </div>

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Status da conexão</CardTitle>
          <CardDescription>
            `GET /api/whatsapp/status` · Connect/Disconnect: OWNER|ADMIN
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : notFound ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Nenhuma instância encontrada. Conecte para criar.
              </p>
              {canManage ? (
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                >
                  {connectMutation.isPending ? "Conectando…" : "Conectar"}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Apenas OWNER/ADMIN podem conectar.
                </p>
              )}
            </div>
          ) : query.isError ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">
                {query.error instanceof ApiError
                  ? query.error.message
                  : "Falha ao carregar status"}
              </p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : query.data ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <WhatsAppStatusBadge status={query.data.status} />
                <span className="text-sm text-muted-foreground">
                  {query.data.instanceName}
                </span>
              </div>
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
                <div className="rounded-md border p-3 sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Instance key</p>
                  <p className="break-all font-mono text-xs">
                    {query.data.instanceKey}
                  </p>
                </div>
              </div>
              {query.data.lastError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {query.data.lastError}
                </p>
              ) : null}
              {query.data.status === "QR_PENDING" && query.data.qrCode ? (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="mb-3 text-sm font-medium">
                    Escaneie o QR Code no WhatsApp
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      query.data.qrCode.startsWith("data:")
                        ? query.data.qrCode
                        : `data:image/png;base64,${query.data.qrCode}`
                    }
                    alt="QR Code WhatsApp"
                    className="mx-auto max-w-xs rounded-md border bg-white p-2"
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
                    onClick={() => disconnectMutation.mutate()}
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
