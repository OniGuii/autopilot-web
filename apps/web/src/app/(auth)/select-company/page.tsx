"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
import { navigateAfterAuth } from "@/lib/auth/navigate";
import { RequireAuth } from "@/components/auth/require-auth";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function SelectCompanyContent() {
  const { memberships, selectCompany, logout, user } = useAuth();
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);

  async function onSelect(companySlug: string) {
    setLoadingSlug(companySlug);
    try {
      await selectCompany(companySlug);
      toast.success("Empresa selecionada");
      navigateAfterAuth("/dashboard");
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Falha ao selecionar empresa";
      toast.error(message);
      setLoadingSlug(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-10">
      <div className="mb-8 space-y-2">
        <p className="font-display text-4xl tracking-tight">Autopilot</p>
        <h1 className="text-2xl font-semibold">Selecione a empresa</h1>
        <p className="text-muted-foreground">
          Olá, {user?.name}. Escolha o contexto (slug) para continuar.
        </p>
      </div>

      {memberships.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma empresa disponível</CardTitle>
            <CardDescription>
              Não há memberships ACTIVE para este usuário. Verifique o seed da API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void logout()}>
              Voltar ao login
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {memberships.map((m) => (
            <Card key={m.membershipId} className="bg-white/90">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-md bg-accent p-2 text-accent-foreground">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium">{m.companyName}</p>
                    <p className="text-sm text-muted-foreground">{m.companySlug}</p>
                    <Badge variant="secondary" className="mt-2">
                      {m.role}
                    </Badge>
                  </div>
                </div>
                <Button
                  onClick={() => void onSelect(m.companySlug)}
                  disabled={loadingSlug === m.companySlug}
                >
                  {loadingSlug === m.companySlug ? "Abrindo…" : "Entrar"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SelectCompanyPage() {
  return (
    <RequireAuth>
      <SelectCompanyContent />
    </RequireAuth>
  );
}
