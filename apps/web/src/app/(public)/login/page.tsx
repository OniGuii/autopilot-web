"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
import { navigateAfterAuth } from "@/lib/auth/navigate";
import { useAuth } from "@/providers/auth-provider";
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

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "Mínimo de 8 caracteres"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { login, selectCompany, bootstrapping, user, hasCompany, memberships } =
    useAuth();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  // If session already exists (e.g. bounce after toast), enter the app.
  useEffect(() => {
    if (bootstrapping || submitting) return;
    if (user && hasCompany) {
      navigateAfterAuth("/dashboard");
      return;
    }
    if (user && !hasCompany) {
      navigateAfterAuth(
        memberships.length === 0 ? "/setup" : "/select-company",
      );
    }
  }, [bootstrapping, user, hasCompany, memberships.length, submitting]);

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const nextMemberships = await login(values.email, values.password);
      toast.success("Login realizado");

      if (nextMemberships.length === 0) {
        toast.message("Crie sua empresa para começar");
        navigateAfterAuth("/setup");
        return;
      }

      if (nextMemberships.length === 1) {
        await selectCompany(nextMemberships[0].companySlug);
        toast.success("Empresa selecionada");
        navigateAfterAuth("/dashboard");
        return;
      }

      navigateAfterAuth("/select-company");
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Falha ao autenticar";
      toast.error(message);
      setSubmitting(false);
    }
  }

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando sessão…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-center">
        <div className="space-y-4">
          <p className="font-display text-5xl leading-none tracking-tight text-foreground md:text-6xl">
            Autopilot
          </p>
          <p className="max-w-md text-lg text-muted-foreground">
            Entre para operar leads e acompanhar o dashboard da sua empresa.
          </p>
        </div>

        <Card className="border-border/80 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-3xl">Entrar</CardTitle>
            <CardDescription>
              Use as credenciais provisionadas no ambiente da API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="owner@pilot.autopilot.dev"
                  {...form.register("email")}
                />
                {form.formState.errors.email ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.email.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...form.register("password")}
                />
                {form.formState.errors.password ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.password.message}
                  </p>
                ) : null}
              </div>
              <Button className="w-full" type="submit" disabled={submitting}>
                {submitting ? "Entrando…" : "Continuar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
