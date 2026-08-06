"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check, Circle } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { createSetupCompany, fetchSetupStatus } from "@/features/setup/api";
import { createMembership } from "@/features/memberships/api";
import { getWhatsAppStatus } from "@/features/whatsapp/api";
import { useAuth } from "@/providers/auth-provider";
import { canManageTeam } from "@/lib/auth/rbac";
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
import type { MembershipRole } from "@/lib/api/types";

const companySchema = z.object({
  name: z.string().min(2, "Informe o nome"),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug inválido (kebab-case)")
    .optional()
    .or(z.literal("")),
  timezone: z.string().min(1),
  locale: z.string().min(1),
});

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["ADMIN", "AGENT", "OWNER"]),
});

type CompanyForm = z.infer<typeof companySchema>;
type InviteForm = z.infer<typeof inviteSchema>;

type WizardStep = "empresa" | "equipe" | "whatsapp" | "conclusao";

export default function SetupPage() {
  const { hasCompany, selectCompany, role } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState<WizardStep>(hasCompany ? "equipe" : "empresa");
  const [invited, setInvited] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["setup-status"],
    queryFn: fetchSetupStatus,
    enabled: hasCompany,
  });

  const waQuery = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: getWhatsAppStatus,
    enabled: hasCompany && (step === "whatsapp" || step === "conclusao"),
    refetchInterval: (q) =>
      q.state.data?.status === "QR_PENDING" ? 3000 : false,
  });

  const companyForm = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      slug: "",
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
    },
  });

  const inviteForm = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", name: "", role: "AGENT" },
  });

  const createCompany = useMutation({
    mutationFn: async (values: CompanyForm) => {
      const created = await createSetupCompany({
        name: values.name,
        slug: values.slug || undefined,
        timezone: values.timezone,
        locale: values.locale,
      });
      await selectCompany(created.company.slug);
      return created;
    },
    onSuccess: async () => {
      toast.success("Empresa criada");
      await qc.invalidateQueries({ queryKey: ["setup-status"] });
      setStep("equipe");
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Falha ao criar empresa",
      );
    },
  });

  const invite = useMutation({
    mutationFn: (values: InviteForm) =>
      createMembership({
        email: values.email,
        name: values.name || undefined,
        role: values.role as MembershipRole,
      }),
    onSuccess: (data) => {
      setInvited(true);
      toast.success(
        `Convite registrado para ${data.email} (delivery: ${data.invite.delivery})`,
      );
      inviteForm.reset({ email: "", name: "", role: "AGENT" });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Falha ao convidar",
      );
    },
  });

  const steps = useMemo(
    () =>
      [
        { key: "empresa" as const, label: "Empresa", done: hasCompany },
        {
          key: "equipe" as const,
          label: "Equipe",
          done: invited || Boolean(statusQuery.data?.complete),
        },
        {
          key: "whatsapp" as const,
          label: "WhatsApp",
          done: waQuery.data?.status === "CONNECTED",
        },
        {
          key: "conclusao" as const,
          label: "Conclusão",
          done: Boolean(statusQuery.data?.complete),
        },
      ] as const,
    [hasCompany, invited, statusQuery.data?.complete, waQuery.data?.status],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Setup</h1>
        <p className="text-muted-foreground">
          Configure a empresa sem SQL ou seeds — só pela API.
        </p>
      </div>

      <ol className="grid gap-2 sm:grid-cols-4">
        {steps.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => {
                if (s.key === "empresa" || hasCompany) setStep(s.key);
              }}
              className="flex w-full items-center gap-2 rounded-md border bg-white/90 px-3 py-2 text-left text-sm"
            >
              {s.done ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" />
              )}
              <span className={step === s.key ? "font-medium" : ""}>
                {s.label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {step === "empresa" ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>1. Empresa</CardTitle>
            <CardDescription>
              `POST /api/setup/company` + select-company automático
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasCompany ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Empresa já vinculada. Avance para equipe.
                </p>
                <Button type="button" onClick={() => setStep("equipe")}>
                  Continuar
                </Button>
              </div>
            ) : (
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={companyForm.handleSubmit((v) =>
                  createCompany.mutate(v),
                )}
              >
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" {...companyForm.register("name")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug (opcional)</Label>
                  <Input
                    id="slug"
                    placeholder="minha-empresa"
                    {...companyForm.register("slug")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locale">Locale</Label>
                  <Input id="locale" {...companyForm.register("locale")} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input id="timezone" {...companyForm.register("timezone")} />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={createCompany.isPending}>
                    {createCompany.isPending ? "Criando…" : "Criar empresa"}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      {step === "equipe" ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>2. Equipe</CardTitle>
            <CardDescription>
              Convide pelo menos um colega (opcional) via `POST /api/memberships`
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManageTeam(role) ? (
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={inviteForm.handleSubmit((v) => invite.mutate(v))}
              >
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input type="email" {...inviteForm.register("email")} />
                </div>
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input {...inviteForm.register("name")} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={inviteForm.watch("role")}
                    onValueChange={(v) =>
                      inviteForm.setValue("role", v as InviteForm["role"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {role === "OWNER" ? (
                        <SelectItem value="OWNER">OWNER</SelectItem>
                      ) : null}
                      <SelectItem value="ADMIN">ADMIN</SelectItem>
                      <SelectItem value="AGENT">AGENT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={invite.isPending}>
                    Convidar
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Seu papel não convida membros — pule esta etapa.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStep("empresa")}>
                Voltar
              </Button>
              <Button type="button" onClick={() => setStep("whatsapp")}>
                {invited ? "Continuar" : "Pular / Continuar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "whatsapp" ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>3. WhatsApp</CardTitle>
            <CardDescription>
              Conecte a instância na tela dedicada e volte aqui.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              Status atual:{" "}
              <span className="font-medium">
                {waQuery.data?.status ?? "carregando…"}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/whatsapp">Abrir WhatsApp</Link>
              </Button>
              <Button type="button" variant="outline" onClick={() => setStep("equipe")}>
                Voltar
              </Button>
              <Button type="button" onClick={() => setStep("conclusao")}>
                Continuar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "conclusao" ? (
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>4. Conclusão</CardTitle>
            <CardDescription>`GET /api/setup/status`</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando status…</p>
            ) : (
              <ul className="space-y-2">
                {(statusQuery.data?.steps ?? []).map((s) => (
                  <li
                    key={s.key}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span>{s.key}</span>
                    <span className={s.done ? "text-primary" : "text-muted-foreground"}>
                      {s.done ? "ok" : s.detail ?? "pendente"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void statusQuery.refetch()}
              >
                Atualizar status
              </Button>
              <Button asChild>
                <Link href="/dashboard">Ir ao dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
