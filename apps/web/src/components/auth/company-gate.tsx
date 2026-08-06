"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { navigateAfterAuth } from "@/lib/auth/navigate";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

const ALLOW_WITHOUT_COMPANY = new Set(["/setup"]);

export function CompanyGate({ children }: { children: React.ReactNode }) {
  const { bootstrapping, user, hasCompany } = useAuth();
  const pathname = usePathname();
  const allowWithout = ALLOW_WITHOUT_COMPANY.has(pathname);

  useEffect(() => {
    if (bootstrapping || !user) return;
    if (!hasCompany && !allowWithout) {
      navigateAfterAuth("/setup");
    }
  }, [bootstrapping, user, hasCompany, allowWithout]);

  if (bootstrapping || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!hasCompany && allowWithout) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#e8f1ec,_transparent_40%),linear-gradient(180deg,#f7f8f6_0%,#eef1ef_100%)]">
        <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      </div>
    );
  }

  if (!hasCompany) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <Skeleton className="h-24 w-full max-w-md" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
