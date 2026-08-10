"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RequireRole } from "@/components/auth/require-role";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  commitLeadImport,
  fetchLeadImportBatch,
  fetchLeadImportDashboard,
  pasteLeadImport,
  updateLeadImportMapping,
  uploadLeadImportFile,
  validateLeadImport,
} from "@/features/outbound/api";
import type { LeadImportBatch } from "@/lib/api/types";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath } from "@/lib/nav";
import { formatDateTime } from "@/lib/format";

const TARGET_FIELDS: Array<{ key: string; label: string; required?: boolean }> =
  [
    { key: "phone", label: "Telefone", required: true },
    { key: "name", label: "Nome" },
    { key: "email", label: "E-mail" },
    { key: "city", label: "Cidade" },
    { key: "product", label: "Produto" },
    { key: "value", label: "Valor" },
    { key: "source", label: "Origem" },
    { key: "notes", label: "Observação" },
    { key: "externalId", label: "ID externo" },
  ];

type Step = "upload" | "map" | "validate" | "result";

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number | undefined;
  hint?: string;
}) {
  return (
    <Card className="bg-white/90">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value ?? "—"}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function ImportWizard() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("upload");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [sourceDefault, setSourceDefault] = useState("OUTBOUND_IMPORT");
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const dashboardQuery = useQuery({
    queryKey: ["lead-import-dashboard"],
    queryFn: fetchLeadImportDashboard,
    refetchInterval: 30_000,
  });

  const batchQuery = useQuery({
    queryKey: ["lead-import-batch", batchId],
    queryFn: () => fetchLeadImportBatch(batchId!),
    enabled: Boolean(batchId),
  });

  const batch = batchQuery.data;

  const applyBatch = (b: LeadImportBatch, next: Step) => {
    setBatchId(b.id);
    const base = {
      ...(b.guessedMapping ?? {}),
      ...(b.columnMapping ?? {}),
    };
    const nextMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(base)) {
      if (typeof v === "string" && v) nextMap[k] = v;
    }
    setMapping(nextMap);
    setStep(next);
    void queryClient.setQueryData(["lead-import-batch", b.id], b);
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadLeadImportFile(file, sourceDefault),
    onSuccess: (b) => {
      toast.success("Arquivo carregado");
      applyBatch(b, "map");
      void queryClient.invalidateQueries({ queryKey: ["lead-import-dashboard"] });
    },
    onError: (e) => toast.error(friendlyError(e, "Falha no upload")),
  });

  const pasteMutation = useMutation({
    mutationFn: () => pasteLeadImport({ text: pasteText, sourceDefault }),
    onSuccess: (b) => {
      toast.success("Tabela colada");
      applyBatch(b, "map");
      void queryClient.invalidateQueries({ queryKey: ["lead-import-dashboard"] });
    },
    onError: (e) => toast.error(friendlyError(e, "Falha ao colar")),
  });

  const mappingMutation = useMutation({
    mutationFn: async () => {
      const mapped = await updateLeadImportMapping(batchId!, {
        columnMapping: mapping,
        sourceDefault,
        dedupeMode: "skip",
      });
      const validated = await validateLeadImport(mapped.id);
      return validated;
    },
    onSuccess: (b) => {
      toast.success("Mapeamento salvo e validado");
      applyBatch(b, "validate");
    },
    onError: (e) => toast.error(friendlyError(e, "Falha no mapeamento/validação")),
  });

  const validateMutation = useMutation({
    mutationFn: () => validateLeadImport(batchId!),
    onSuccess: (b) => {
      toast.success("Validação concluída");
      void queryClient.setQueryData(["lead-import-batch", b.id], b);
      setStep("validate");
    },
    onError: (e) => toast.error(friendlyError(e, "Falha na validação")),
  });

  const commitMutation = useMutation({
    mutationFn: () => commitLeadImport(batchId!),
    onSuccess: (b) => {
      toast.success("Importação concluída");
      void queryClient.setQueryData(["lead-import-batch", b.id], b);
      void queryClient.invalidateQueries({ queryKey: ["lead-import-dashboard"] });
      setStep("result");
    },
    onError: (e) => toast.error(friendlyError(e, "Falha no commit")),
  });

  const headers = batch?.columnHeaders ?? [];
  const previewRows = useMemo(() => batch?.previewSample ?? [], [batch]);
  const report = batch?.report;
  const metrics = dashboardQuery.data?.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead Import"
        description="Importe CSV, XLSX ou cole uma tabela — preview, mapeamento e validação antes de gravar leads."
        breadcrumbs={breadcrumbsForPath("/outbound/import")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">V1.2</Badge>
            <Badge variant="outline">Máx. 500 linhas</Badge>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Importados (7d)" value={metrics?.imported} />
        <MetricCard label="Válidos" value={metrics?.valid} />
        <MetricCard label="Inválidos" value={metrics?.invalid} />
        <MetricCard label="Duplicados" value={metrics?.duplicates} />
        <MetricCard label="Ignorados" value={metrics?.ignored} hint="dup + suppress + inválidos" />
      </div>

      {dashboardQuery.data ? (
        <p className="text-xs text-muted-foreground">
          Painel gerado em {formatDateTime(dashboardQuery.data.generatedAt)} ·
          criados no CRM: {metrics?.created ?? 0}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["upload", "1. Upload"],
            ["map", "2. Mapear"],
            ["validate", "3. Validar"],
            ["result", "4. Resultado"],
          ] as const
        ).map(([key, label]) => (
          <Badge
            key={key}
            variant={step === key ? "default" : "secondary"}
          >
            {label}
          </Badge>
        ))}
      </div>

      {step === "upload" ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Upload ou colar</CardTitle>
            <CardDescription>
              Colunas sugeridas: Nome, Telefone, Cidade, Produto, Valor, Origem,
              Observação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="sourceDefault">Source padrão</Label>
              <Input
                id="sourceDefault"
                value={sourceDefault}
                onChange={(e) => setSourceDefault(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="file">Arquivo CSV / XLSX</Label>
              <Input
                id="file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={uploadMutation.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paste">Colar tabela (TSV/CSV)</Label>
              <textarea
                id="paste"
                className="min-h-40 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={"Nome\tTelefone\tCidade\nAna\t11987654321\tSP"}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <Button
                disabled={pasteMutation.isPending || !pasteText.trim()}
                onClick={() => pasteMutation.mutate()}
              >
                Continuar com texto colado
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "map" && batch ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Mapear colunas</CardTitle>
            <CardDescription>
              Batch {batch.filename} · {batch.rowCount} linhas · telefone
              obrigatório
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {TARGET_FIELDS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label>
                    {field.label}
                    {field.required ? " *" : ""}
                  </Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={mapping[field.key] ?? ""}
                    onChange={(e) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                  >
                    <option value="">— não mapear —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 8).map((row, idx) => (
                    <tr key={idx} className="border-t">
                      {headers.map((h) => (
                        <td key={h} className="px-3 py-2 tabular-nums">
                          {row[h] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Voltar
              </Button>
              <Button
                disabled={mappingMutation.isPending || !mapping.phone}
                onClick={() => mappingMutation.mutate()}
              >
                Salvar mapeamento e validar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "validate" && batch && batchId ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Validar e importar</CardTitle>
            <CardDescription>
              Status: {batch.status}. Dry-run verifica telefone, duplicados e
              suppress list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={validateMutation.isPending}
                onClick={() => validateMutation.mutate()}
              >
                Rodar validação
              </Button>
              <Button
                disabled={
                  commitMutation.isPending || batch.status !== "VALIDATED"
                }
                onClick={() => commitMutation.mutate()}
              >
                Importar válidos
              </Button>
              <Button variant="outline" onClick={() => setStep("map")}>
                Ajustar mapeamento
              </Button>
            </div>

            {report ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Total" value={report.total} />
                <MetricCard label="Válidos" value={report.valid} />
                <MetricCard label="Inválidos" value={report.invalid} />
                <MetricCard label="Duplicados" value={report.duplicates} />
                <MetricCard label="Suppress" value={report.suppressed} />
                <MetricCard label="Ignorados" value={report.ignored} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ainda sem relatório — rode a validação.
              </p>
            )}

            {report?.errors?.length ? (
              <ul className="max-h-56 overflow-auto rounded-md border text-sm">
                {report.errors.slice(0, 40).map((err, i) => (
                  <li key={i} className="border-b px-3 py-2 last:border-0">
                    Linha {err.row}
                    {err.phone ? ` · ${err.phone}` : ""} — {err.code}:{" "}
                    {err.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === "result" && batch ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
            <CardDescription>
              {batch.status}
              {batch.committedAt
                ? ` · ${formatDateTime(batch.committedAt)}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Criados" value={batch.report?.created} />
              <MetricCard label="Válidos" value={batch.report?.valid} />
              <MetricCard label="Ignorados" value={batch.report?.ignored} />
            </div>
            <Button
              onClick={() => {
                setBatchId(null);
                setPasteText("");
                setMapping({});
                setStep("upload");
              }}
            >
              Nova importação
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {batchQuery.isLoading && batchId ? (
        <LoadingBlock label="Carregando batch…" />
      ) : null}
      {batchQuery.isError ? (
        <ErrorPanel
          title="Falha ao carregar batch"
          description={friendlyError(batchQuery.error)}
          onRetry={() => void batchQuery.refetch()}
        />
      ) : null}
    </div>
  );
}

export default function OutboundImportPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <ImportWizard />
    </RequireRole>
  );
}
