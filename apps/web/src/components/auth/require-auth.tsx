"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { Skeleton } from "@/components/ui/skeleton";

export function RequireAuth({
  children,
  requireCompany = false,
}: {
  children: React.ReactNode;
  requireCompany?: boolean;
}) {
  const router = useRouter();
  const { bootstrapping, user, hasCompany } = useAuth();

  useEffect(() => {
    if (bootstrapping) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (requireCompany && !hasCompany) {
      router.replace("/select-company");
    }
  }, [bootstrapping, user, hasCompany, requireCompany, router]);

  if (bootstrapping || !user || (requireCompany && !hasCompany)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
