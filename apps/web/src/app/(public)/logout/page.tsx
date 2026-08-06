"use client";

import { useEffect } from "react";
import { useAuth } from "@/providers/auth-provider";
import { BrandLogo } from "@/components/brand/logo";

export default function LogoutPage() {
  const { logout } = useAuth();

  useEffect(() => {
    void logout();
  }, [logout]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <BrandLogo />
      <p className="text-sm text-muted-foreground">Encerrando sua sessão…</p>
    </div>
  );
}
