"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { CompanyGate } from "@/components/auth/company-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <CompanyGate>{children}</CompanyGate>
    </RequireAuth>
  );
}
