"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  fetchCompanySettings,
  updateCompanySettings,
} from "@/features/settings/api";
import { RequireRole } from "@/components/auth/require-role";
import { useAuth } from "@/providers/auth-provider";
import {
  canEditCriticalSettings,
  canEditSettings,
} from "@/lib/auth/rbac";
import type { CompanyCurrency } from "@/lib/api/types";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath, ROLE_LABEL } from "@/lib/nav";
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

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

type DayKey = (typeof DAYS)[number];

const DAY_LABEL: Record<DayKey, string> = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};

const schema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Identificador inválido")
    .optional()
    .or(z.literal("")),
  timezone: z.string().min(1).max(64),
  locale: z.string().min(1).max(16),
  logoUrl: z.union([
    z.literal(""),
    z.string().url("URL HTTPS inválida"),
  ]),
  currency: z.enum(["BRL", "USD", "EUR"]),
  mondayOpen: z.string().optional(),
  mondayClose: z.string().optional(),
  tuesdayOpen: z.string().optional(),
  tuesdayClose: z.string().optional(),
  wednesdayOpen: z.string().optional(),
  wednesdayClose: z.string().optional(),
  thursdayOpen: z.string().optional(),
  thursdayClose: z.string().optional(),
  fridayOpen: z.string().optional(),
  fridayClose: z.string().optional(),
  saturdayOpen: z.string().optional(),
  saturdayClose: z.string().optional(),
  sundayOpen: z.string().optional(),
  sundayClose: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function dayOpenKey(day: DayKey): keyof FormValues {
  return `${day}Open` as keyof FormValues;
}
function dayCloseKey(day: DayKey): keyof FormValues {
  return `${day}Close` as keyof FormValues;
}

function buildBusinessHours(values: FormValues): Record<string, unknown> | null {
  const hours: Record<string, { open: string; close: string }> = {};
  for (const day of DAYS) {
    const open = String(values[dayOpenKey(day)] ?? "").trim();
    const close = String(values[dayCloseKey(day)] ?? "").trim();
    if (open && close) {
      hours[day] = { open, close };
    }
  }
  return Object.keys(hours).length ? hours : null;
}

function SettingsContent() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const editable = canEditSettings(role);
  const critical = canEditCriticalSettings(role);

  const query = useQuery({
    queryKey: ["company-settings"],
    queryFn: fetchCompanySettings,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      slug: "",
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
      logoUrl: "",
      currency: "BRL",
    },
  });

  useEffect(() => {
    if (!query.data) return;
    const bh = (query.data.businessHours ?? {}) as Record<
      string,
      { open?: string; close?: string }
    >;
    form.reset({
      name: query.data.name,
      slug: query.data.slug ?? "",
      timezone: query.data.timezone,
      locale: query.data.locale,
      logoUrl: query.data.logoUrl ?? "",
      currency: query.data.currency,
      mondayOpen: bh.monday?.open ?? "",
      mondayClose: bh.monday?.close ?? "",
      tuesdayOpen: bh.tuesday?.open ?? "",
      tuesdayClose: bh.tuesday?.close ?? "",
      wednesdayOpen: bh.wednesday?.open ?? "",
      wednesdayClose: bh.wednesday?.close ?? "",
      thursdayOpen: bh.thursday?.open ?? "",
      thursdayClose: bh.thursday?.close ?? "",
      fridayOpen: bh.friday?.open ?? "",
      fridayClose: bh.friday?.close ?? "",
      saturdayOpen: bh.saturday?.open ?? "",
      saturdayClose: bh.saturday?.close ?? "",
      sundayOpen: bh.sunday?.open ?? "",
      sundayClose: bh.sunday?.close ?? "",
    });
  }, [query.data, form]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: Parameters<typeof updateCompanySettings>[0] = {
        name: values.name,
        timezone: values.timezone,
        locale: values.locale,
        currency: values.currency as CompanyCurrency,
        logoUrl: values.logoUrl ? values.logoUrl : null,
        businessHours: buildBusinessHours(values),
      };
      if (critical && values.slug) {
        payload.slug = values.slug;
      }
      return updateCompanySettings(payload);
    },
    onSuccess: () => {
      toast.success("Configurações salvas");
      void qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e) =>
      toast.error(friendlyError(e, "Não foi possível salvar as configurações.")),
  });

  if (query.isLoading) {
    return <LoadingBlock rows={4} label="Carregando configurações…" />;
  }

  if (query.isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Configurações"
          breadcrumbs={breadcrumbsForPath("/settings")}
        />
        <ErrorPanel
          title="Não foi possível carregar as configurações"
          description={friendlyError(query.error)}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Identidade, fuso horário e horário de atendimento da empresa."
        breadcrumbs={breadcrumbsForPath("/settings")}
      />

      {!editable ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Somente leitura</CardTitle>
            <CardDescription>
              {ROLE_LABEL.AGENT} pode visualizar. Alterações exigem{" "}
              {ROLE_LABEL.OWNER} ou {ROLE_LABEL.ADMIN}.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <form
        className="space-y-6"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
      >
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Identidade</CardTitle>
            <CardDescription>Nome, logo e preferências regionais</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome</Label>
              <Input disabled={!editable} {...form.register("name")} />
            </div>
            <div className="space-y-2">
              <Label>
                Identificador {critical ? "" : `(somente ${ROLE_LABEL.OWNER})`}
              </Label>
              <Input
                disabled={!editable || !critical}
                {...form.register("slug")}
              />
            </div>
            <div className="space-y-2">
              <Label>Idioma / locale</Label>
              <Input disabled={!editable} {...form.register("locale")} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>URL do logo (HTTPS)</Label>
              <Input
                disabled={!editable}
                placeholder="https://..."
                {...form.register("logoUrl")}
              />
              {form.watch("logoUrl") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.watch("logoUrl")}
                  alt="Pré-visualização do logo"
                  className="mt-2 h-12 object-contain"
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Fuso horário</Label>
              <Input disabled={!editable} {...form.register("timezone")} />
            </div>
            <div className="space-y-2">
              <Label>Moeda</Label>
              <Select
                disabled={!editable}
                value={form.watch("currency")}
                onValueChange={(v) =>
                  form.setValue("currency", v as FormValues["currency"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">Real (BRL)</SelectItem>
                  <SelectItem value="USD">Dólar (USD)</SelectItem>
                  <SelectItem value="EUR">Euro (EUR)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Horário de atendimento</CardTitle>
            <CardDescription>
              Defina abertura e fechamento por dia da semana
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {DAYS.map((day) => (
              <div
                key={day}
                className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2"
              >
                <span className="text-sm">{DAY_LABEL[day]}</span>
                <Input
                  type="time"
                  disabled={!editable}
                  {...form.register(dayOpenKey(day))}
                />
                <Input
                  type="time"
                  disabled={!editable}
                  {...form.register(dayCloseKey(day))}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {editable ? (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        ) : null}
      </form>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequireRole allow={["OWNER", "ADMIN"]}>
      <SettingsContent />
    </RequireRole>
  );
}
