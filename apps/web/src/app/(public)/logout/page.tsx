"use client";

import { useEffect } from "react";
import { useAuth } from "@/providers/auth-provider";

export default function LogoutPage() {
  const { logout } = useAuth();

  useEffect(() => {
    void logout();
  }, [logout]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Encerrando sessão…
    </div>
  );
}
