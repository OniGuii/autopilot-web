"use client";

import { useEffect, useState } from "react";
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
import { breadcrumbsForPath, pageTitleForPath, ROLE_LABEL } from "@/lib/nav";
import { BrandLogo } from "@/components/brand/logo";
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
  { id: "dashboard", href: "/dashboard", label: "Painel", icon: LayoutDashboard, group: "ops" },
  { id: "leads", href: "/leads", label: "Leads", icon: Users, group: "ops" },
  { id: "conversations", href: "/conversations", label: "Conversas", icon: MessageSquare, group: "ops" },
  { id: "follow-ups", href: "/follow-ups", label: "Follow-ups", icon: CalendarClock, group: "ops" },
  { id: "whatsapp", href: "/whatsapp", label: "WhatsApp", icon: Smartphone, group: "ops" },
  { id: "pipeline", href: "/pipeline", label: "Funil", icon: GitBranch, group: "ops" },
  { id: "team", href: "/team", label: "Equipe", icon: Users, group: "admin" },
  { id: "users", href: "/users", label: "Usuários", icon: UserCog, group: "admin" },
  { id: "settings", href: "/settings", label: "Configurações", icon: Settings, group: "admin" },
  { id: "exports", href: "/exports", label: "Exportações", icon: Download, group: "admin" },
  { id: "diagnostics", href: "/diagnostics", label: "Diagnósticos", icon: Activity, group: "admin" },
  { id: "setup", href: "/setup", label: "Primeiros passos", icon: Sparkles, group: "admin" },
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
            "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
            active
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-foreground/80 hover:bg-accent",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </Link>
      );
    });

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pb-2">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Operação
      </p>
      {render(ops)}
      {admin.length > 0 ? (
        <>
          <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
  const roleLabel = membership?.role
    ? ROLE_LABEL[membership.role] ?? membership.role
    : null;
  const pageTitle = pageTitleForPath(pathname);
  const crumbs = breadcrumbsForPath(pathname);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const footer = (
    <div className="mt-auto space-y-2 rounded-xl border bg-background/90 p-3">
      <p className="truncate text-sm font-medium">{company?.name ?? "—"}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        {roleLabel ? <Badge variant="secondary">{roleLabel}</Badge> : null}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          if (window.confirm("Deseja sair da sua conta?")) {
            void logout();
          }
        }}
      >
        <LogOut className="h-4 w-4" />
        Sair
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1440px]">
        <aside className="hidden w-64 shrink-0 border-r border-border/70 surface-panel p-4 lg:flex lg:flex-col">
          <div className="px-1 py-2">
            <BrandLogo subtitle="CRM comercial" />
          </div>
          <Separator className="my-3" />
          <NavLinks items={items} pathname={pathname} />
          {footer}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border/70 surface-panel px-4 py-3 md:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
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
              <div className="min-w-0 lg:hidden">
                <BrandLogo />
              </div>
              <div className="hidden min-w-0 lg:block">
                <p className="truncate text-sm text-muted-foreground">
                  {company?.name ? (
                    <>
                      Empresa:{" "}
                      <span className="font-medium text-foreground">
                        {company.name}
                      </span>
                    </>
                  ) : (
                    pageTitle
                  )}
                </p>
                {crumbs.length > 1 ? (
                  <p className="truncate text-xs text-muted-foreground/80">
                    {crumbs.map((c) => c.label).join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
            {roleLabel ? (
              <Badge variant="secondary" className="shrink-0">
                {roleLabel}
              </Badge>
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
              <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-white p-4 shadow-xl animate-in slide-in-from-left duration-200">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <BrandLogo subtitle="Menu" />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Fechar"
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

          <main className="flex-1 px-4 py-5 md:px-6 md:py-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
