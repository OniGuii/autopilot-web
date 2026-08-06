"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
import { downloadExport } from "@/features/exports/api";
import { RequireRole } from "@/components/auth/require-role";
import type { ExportKind } from "@/lib/api/types";
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

const EXPORTS: Array<{
  kind: ExportKind;
  title: string;
  description: string;
  path: string;
}> = [
  {
    kind: "leads",
    title: "Leads",
    description: "CSV de leads da empresa",
    path: "GET /api/exports/leads",
  },
  {
    kind: "activities",
    title: "Activities",
    description: "CSV de atividades de leads",
    path: "GET /api/exports/activities",
  },
  {
    kind: "followups",
    title: "Follow-ups",
    description: "CSV de follow-ups",
    path: "GET /api/exports/followups",
  },
];

function ExportsContent() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState<ExportKind | null>(null);

  async function onDownload(kind: ExportKind) {
    setLoading(kind);
    try {
      const filename = await downloadExport(kind, {
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
      });
      toast.success(`Download: ${filename}`);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Falha no export",
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Exports</h1>
        <p className="text-muted-foreground">
          Downloads CSV (OWNER/ADMIN) — limite 10.000 linhas na API
        </p>
      </div>

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Filtro opcional</CardTitle>
          <CardDescription>Intervalo enviado como `from` / `to`</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>De</Label>
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Até</Label>
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {EXPORTS.map((item) => (
          <Card key={item.kind} className="bg-white/90">
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{item.path}</p>
              <Button
                className="w-full"
                disabled={loading === item.kind}
                onClick={() => void onDownload(item.kind)}
              >
                {loading === item.kind ? "Gerando…" : "Baixar CSV"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function ExportsPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <ExportsContent />
    </RequireRole>
  );
}
