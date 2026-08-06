"use client";

import { useState } from "react";
import { toast } from "sonner";
import { downloadExport } from "@/features/exports/api";
import { RequireRole } from "@/components/auth/require-role";
import type { ExportKind } from "@/lib/api/types";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { PageHeader } from "@/components/layout/page-header";
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
}> = [
  {
    kind: "leads",
    title: "Leads",
    description: "Planilha CSV com os leads da empresa",
  },
  {
    kind: "activities",
    title: "Atividades",
    description: "Planilha CSV com atividades dos leads",
  },
  {
    kind: "followups",
    title: "Follow-ups",
    description: "Planilha CSV com follow-ups",
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
      toast.success(`Download iniciado: ${filename}`);
    } catch (error) {
      toast.error(friendlyError(error, "Não foi possível gerar a exportação."));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exportações"
        description="Baixe planilhas CSV dos dados da empresa. Exportações grandes podem levar alguns instantes."
        breadcrumbs={breadcrumbsForPath("/exports")}
      />

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>Período opcional</CardTitle>
          <CardDescription>
            Defina um intervalo para limitar o que será exportado.
          </CardDescription>
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
            <CardContent>
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
