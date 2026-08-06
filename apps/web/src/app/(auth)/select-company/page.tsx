"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { navigateAfterAuth } from "@/lib/auth/navigate";
import { RequireAuth } from "@/components/auth/require-auth";
import { useAuth } from "@/providers/auth-provider";
import { friendlyError } from "@/lib/errors";
import { breadcrumbsForPath, ROLE_LABEL } from "@/lib/nav";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
      toast.error(
        friendlyError(error, "Não foi possível selecionar a empresa."),
      );
      setLoadingSlug(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-10">
      <PageHeader
        title="Escolher empresa"
        description={`Olá, ${user?.name ?? "bem-vindo"}. Selecione a empresa para continuar.`}
        breadcrumbs={breadcrumbsForPath("/select-company")}
        actions={
          <Button variant="outline" onClick={() => void logout()}>
            Sair
          </Button>
        }
      />

      {memberships.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa disponível"
          description="Sua conta ainda não está vinculada a uma empresa. Crie uma nos primeiros passos ou peça um convite."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/setup">Primeiros passos</Link>
              </Button>
              <Button variant="outline" onClick={() => void logout()}>
                Voltar ao login
              </Button>
            </div>
          }
        />
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
                    <p className="text-sm text-muted-foreground">
                      {m.companySlug}
                    </p>
                    <Badge variant="secondary" className="mt-2">
                      {ROLE_LABEL[m.role] ?? m.role}
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
