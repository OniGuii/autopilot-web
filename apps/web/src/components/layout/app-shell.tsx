"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarClock,
  Download,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Smartphone,
  Users,
  UserCog,
  X,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { canAccessNav, type NavItemId } from "@/lib/auth/rbac";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type NavItem = {
  id: NavItemId;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "ops" | "admin";
};

const NAV: NavItem[] = [
  { id: "dashboard", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "ops" },
  { id: "leads", href: "/leads", label: "Leads", icon: Users, group: "ops" },
  { id: "conversations", href: "/conversations", label: "Conversations", icon: MessageSquare, group: "ops" },
  { id: "follow-ups", href: "/follow-ups", label: "FollowUps", icon: CalendarClock, group: "ops" },
  { id: "whatsapp", href: "/whatsapp", label: "WhatsApp", icon: Smartphone, group: "ops" },
  { id: "pipeline", href: "/pipeline", label: "Pipeline", icon: GitBranch, group: "ops" },
  { id: "team", href: "/team", label: "Team", icon: Users, group: "admin" },
  { id: "users", href: "/users", label: "Users", icon: UserCog, group: "admin" },
  { id: "settings", href: "/settings", label: "Settings", icon: Settings, group: "admin" },
  { id: "exports", href: "/exports", label: "Exports", icon: Download, group: "admin" },
  { id: "diagnostics", href: "/diagnostics", label: "Diagnostics", icon: Activity, group: "admin" },
  { id: "setup", href: "/setup", label: "Setup", icon: Sparkles, group: "admin" },
];

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const ops = items.filter((i) => i.group === "ops");
  const admin = items.filter((i) => i.group === "admin");

  const render = (list: NavItem[]) =>
    list.map((item) => {
      const Icon = item.icon;
      const active =
        pathname === item.href || pathname.startsWith(`${item.href}/`);
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "text-foreground/80 hover:bg-accent",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </Link>
      );
    });

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
      <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Operação
      </p>
      {render(ops)}
      {admin.length > 0 ? (
        <>
          <p className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Administração
          </p>
          {render(admin)}
        </>
      ) : null}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, company, membership, role, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = NAV.filter((item) => canAccessNav(role, item.id));

  const footer = (
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
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#e8f1ec,_transparent_40%),linear-gradient(180deg,#f7f8f6_0%,#eef1ef_100%)]">
      <div className="mx-auto flex min-h-screen max-w-[1400px]">
        <aside className="hidden w-64 shrink-0 border-r border-border/70 bg-white/70 p-4 backdrop-blur lg:flex lg:flex-col">
          <div className="px-2 py-3">
            <p className="font-display text-2xl tracking-tight text-foreground">
              Autopilot
            </p>
            <p className="mt-1 text-xs text-muted-foreground">CRM SaaS · Sprint 3</p>
          </div>
          <Separator className="my-3" />
          <NavLinks items={items} pathname={pathname} />
          {footer}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border/70 bg-white/80 px-4 py-3 backdrop-blur md:px-8">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Abrir menu"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div>
                <p className="font-display text-xl lg:hidden">Autopilot</p>
                <p className="hidden text-sm text-muted-foreground lg:block">
                  Empresa ativa:{" "}
                  <span className="font-medium text-foreground">
                    {company?.name ?? "—"}
                  </span>
                </p>
              </div>
            </div>
            {membership?.role ? (
              <Badge variant="secondary">{membership.role}</Badge>
            ) : null}
          </header>

          {mobileOpen ? (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Fechar menu"
                onClick={() => setMobileOpen(false)}
              />
              <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-white p-4 shadow-xl">
                <div className="mb-2 flex items-center justify-between px-2">
                  <p className="font-display text-2xl">Autopilot</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setMobileOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <Separator className="my-3" />
                <NavLinks
                  items={items}
                  pathname={pathname}
                  onNavigate={() => setMobileOpen(false)}
                />
                {footer}
              </aside>
            </div>
          ) : null}

          <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
