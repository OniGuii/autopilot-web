"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth requireCompany>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
