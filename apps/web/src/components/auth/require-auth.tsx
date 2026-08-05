"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { navigateAfterAuth } from "@/lib/auth/navigate";
import { Skeleton } from "@/components/ui/skeleton";

export function RequireAuth({
  children,
  requireCompany = false,
}: {
  children: React.ReactNode;
  requireCompany?: boolean;
}) {
  const { bootstrapping, user, hasCompany } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (bootstrapping) return;
    if (!user) {
      if (pathname !== "/login") {
        navigateAfterAuth("/login");
      }
      return;
    }
    if (requireCompany && !hasCompany && pathname !== "/select-company") {
      navigateAfterAuth("/select-company");
    }
  }, [bootstrapping, user, hasCompany, requireCompany, pathname]);

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
