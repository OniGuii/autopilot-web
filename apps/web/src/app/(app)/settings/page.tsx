"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
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

const schema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug inválido")
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
      toast.error(e instanceof ApiError ? e.message : "Falha ao salvar"),
  });

  if (query.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configurações da empresa (`/api/settings/company`)
        </p>
      </div>

      {!editable ? (
        <Card>
          <CardHeader>
            <CardTitle>Somente leitura</CardTitle>
            <CardDescription>
              AGENT pode visualizar; alterações exigem OWNER ou ADMIN.
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
            <CardDescription>Nome, logo e locale</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome</Label>
              <Input disabled={!editable} {...form.register("name")} />
            </div>
            <div className="space-y-2">
              <Label>Slug {critical ? "" : "(somente OWNER)"}</Label>
              <Input
                disabled={!editable || !critical}
                {...form.register("slug")}
              />
            </div>
            <div className="space-y-2">
              <Label>Locale</Label>
              <Input disabled={!editable} {...form.register("locale")} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Logo URL (HTTPS)</Label>
              <Input
                disabled={!editable}
                placeholder="https://..."
                {...form.register("logoUrl")}
              />
              {form.watch("logoUrl") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.watch("logoUrl")}
                  alt="Logo preview"
                  className="mt-2 h-12 object-contain"
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input disabled={!editable} {...form.register("timezone")} />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
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
                  <SelectItem value="BRL">BRL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Business hours</CardTitle>
            <CardDescription>
              Horário semanal (JSON livre na API — UI padroniza open/close)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {DAYS.map((day) => (
              <div
                key={day}
                className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2"
              >
                <span className="text-sm capitalize">{day}</span>
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
