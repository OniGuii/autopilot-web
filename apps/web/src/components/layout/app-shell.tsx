"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LogOut, Users } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, company, membership, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#e8f1ec,_transparent_40%),linear-gradient(180deg,#f7f8f6_0%,#eef1ef_100%)]">
      <div className="mx-auto flex min-h-screen max-w-[1400px]">
        <aside className="hidden w-64 shrink-0 border-r border-border/70 bg-white/70 p-4 backdrop-blur md:flex md:flex-col">
          <div className="px-2 py-3">
            <p className="font-display text-2xl tracking-tight text-foreground">
              Autopilot
            </p>
            <p className="mt-1 text-xs text-muted-foreground">CRM SaaS · Sprint 1</p>
          </div>
          <Separator className="my-3" />
          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground/80 hover:bg-accent",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto space-y-2 rounded-lg border bg-background/80 p-3">
            <p className="truncate text-sm font-medium">{company?.name ?? "—"}</p>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              {membership?.role ? (
                <Badge variant="secondary">{membership.role}</Badge>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void logout()}
            >
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border/70 bg-white/60 px-4 py-3 backdrop-blur md:px-8">
            <div className="md:hidden">
              <p className="font-display text-xl">Autopilot</p>
            </div>
            <div className="hidden text-sm text-muted-foreground md:block">
              Empresa ativa:{" "}
              <span className="font-medium text-foreground">
                {company?.name ?? "—"}
              </span>
            </div>
            <div className="flex gap-2 md:hidden">
              {nav.map((item) => (
                <Button key={item.href} asChild size="sm" variant="outline">
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
            </div>
          </header>
          <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
