"use client";

import Link from "next/link";
import type { MembershipRole } from "@/lib/api/types";
import { useAuth } from "@/providers/auth-provider";
import { ROLE_LABEL } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function RequireRole({
  allow,
  children,
}: {
  allow: MembershipRole[];
  children: React.ReactNode;
}) {
  const { role, bootstrapping } = useAuth();

  if (bootstrapping) return null;

  if (!role || !allow.includes(role)) {
    const roleLabel = role ? ROLE_LABEL[role] ?? role : "não definido";
    const allowedLabels = allow
      .map((r) => ROLE_LABEL[r] ?? r)
      .join(" ou ");

    return (
      <Card className="mx-auto max-w-lg bg-white/90">
        <CardHeader>
          <CardTitle>Acesso restrito</CardTitle>
          <CardDescription>
            Seu papel ({roleLabel}) não tem permissão para esta área. É
            necessário ser {allowedLabels}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard">Voltar ao painel</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
