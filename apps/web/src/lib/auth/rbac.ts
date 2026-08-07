import type { MembershipRole } from "@/lib/api/types";

export type NavItemId =
  | "dashboard"
  | "leads"
  | "conversations"
  | "follow-ups"
  | "whatsapp"
  | "pipeline"
  | "team"
  | "users"
  | "settings"
  | "ai-settings"
  | "ai-dashboard"
  | "ai-knowledge-base"
  | "exports"
  | "diagnostics"
  | "setup";

/** Visual RBAC — mirrors API RolesGuard. */
export function canAccessNav(
  role: MembershipRole | null | undefined,
  item: NavItemId,
): boolean {
  if (!role) return false;

  const agentOps: NavItemId[] = [
    "dashboard",
    "leads",
    "conversations",
    "follow-ups",
    "whatsapp",
    "pipeline",
    "diagnostics",
  ];

  if (role === "AGENT") {
    return agentOps.includes(item);
  }

  // ADMIN: no critical company controls (slug) — page-level. Menu full except
  // we still show Settings with limited fields.
  // OWNER: full menu.
  return true;
}

export function canManageTeam(role: MembershipRole | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageUsers(role: MembershipRole | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

/** Critical company settings (slug) — OWNER only. */
export function canEditCriticalSettings(
  role: MembershipRole | null | undefined,
) {
  return role === "OWNER";
}

export function canEditSettings(role: MembershipRole | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

export function canExport(role: MembershipRole | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

export function canInviteRole(
  actor: MembershipRole | null | undefined,
  target: MembershipRole,
) {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target === "ADMIN" || target === "AGENT";
  return false;
}
