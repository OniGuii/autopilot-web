export type Crumb = { label: string; href?: string };

const TITLES: Record<string, string> = {
  "/dashboard": "Painel",
  "/leads": "Leads",
  "/conversations": "Conversas",
  "/follow-ups": "Follow-ups",
  "/whatsapp": "WhatsApp",
  "/pipeline": "Funil",
  "/team": "Equipe",
  "/users": "Usuários",
  "/settings": "Configurações",
  "/ai/settings": "Agente de IA",
  "/ai/knowledge-base": "Base de conhecimento",
  "/exports": "Exportações",
  "/diagnostics": "Diagnósticos",
  "/setup": "Primeiros passos",
  "/select-company": "Escolher empresa",
  "/login": "Entrar",
};

export function pageTitleForPath(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/leads/")) return "Detalhe do lead";
  if (pathname.startsWith("/conversations/")) return "Conversa";
  if (pathname.startsWith("/follow-ups/")) return "Follow-up";
  return "Autopilot";
}

export function breadcrumbsForPath(pathname: string): Crumb[] {
  const home: Crumb = { label: "Início", href: "/dashboard" };

  if (pathname === "/dashboard") {
    return [{ label: "Painel" }];
  }
  if (pathname === "/leads") {
    return [home, { label: "Leads" }];
  }
  if (pathname.startsWith("/leads/")) {
    return [home, { label: "Leads", href: "/leads" }, { label: "Detalhe" }];
  }
  if (pathname === "/conversations") {
    return [home, { label: "Conversas" }];
  }
  if (pathname.startsWith("/conversations/")) {
    return [
      home,
      { label: "Conversas", href: "/conversations" },
      { label: "Mensagens" },
    ];
  }
  if (pathname === "/follow-ups") {
    return [home, { label: "Follow-ups" }];
  }
  if (pathname.startsWith("/follow-ups/")) {
    return [
      home,
      { label: "Follow-ups", href: "/follow-ups" },
      { label: "Detalhe" },
    ];
  }
  if (pathname === "/whatsapp") return [home, { label: "WhatsApp" }];
  if (pathname === "/pipeline") return [home, { label: "Funil" }];
  if (pathname === "/team") return [home, { label: "Equipe" }];
  if (pathname === "/users") return [home, { label: "Usuários" }];
  if (pathname === "/settings") return [home, { label: "Configurações" }];
  if (pathname === "/ai/settings") {
    return [home, { label: "Agente de IA" }];
  }
  if (pathname === "/ai/knowledge-base") {
    return [
      home,
      { label: "Agente de IA", href: "/ai/settings" },
      { label: "Base de conhecimento" },
    ];
  }
  if (pathname === "/exports") return [home, { label: "Exportações" }];
  if (pathname === "/diagnostics") return [home, { label: "Diagnósticos" }];
  if (pathname === "/setup") return [home, { label: "Primeiros passos" }];
  return [home];
}

export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  AGENT: "Agente",
};
