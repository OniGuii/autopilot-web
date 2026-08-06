export const endpoints = {
  auth: {
    login: "/api/auth/login",
    selectCompany: "/api/auth/select-company",
    refresh: "/api/auth/refresh",
    logout: "/api/auth/logout",
    me: "/api/auth/me",
  },
  dashboard: {
    full: "/api/dashboard",
  },
  leads: {
    list: "/api/leads",
    create: "/api/leads",
    byId: (id: string) => `/api/leads/${id}`,
  },
  conversations: {
    list: "/api/conversations",
    create: "/api/conversations",
    byId: (id: string) => `/api/conversations/${id}`,
    close: (id: string) => `/api/conversations/${id}/close`,
    messages: (id: string) => `/api/conversations/${id}/messages`,
  },
  whatsapp: {
    connect: "/api/whatsapp/connect",
    status: "/api/whatsapp/status",
    disconnect: "/api/whatsapp/disconnect",
    send: "/api/whatsapp/send",
  },
  followUps: {
    list: "/api/follow-ups",
    create: "/api/follow-ups",
    byId: (id: string) => `/api/follow-ups/${id}`,
    approve: (id: string) => `/api/follow-ups/${id}/approve`,
    reject: (id: string) => `/api/follow-ups/${id}/reject`,
    reschedule: (id: string) => `/api/follow-ups/${id}/reschedule`,
    execute: (id: string) => `/api/follow-ups/${id}/execute`,
    cancel: (id: string) => `/api/follow-ups/${id}/cancel`,
    retry: (id: string) => `/api/follow-ups/${id}/retry`,
  },
  pipeline: {
    get: "/api/pipeline",
  },
  memberships: {
    list: "/api/memberships",
    create: "/api/memberships",
    byId: (id: string) => `/api/memberships/${id}`,
  },
  users: {
    sessions: (id: string) => `/api/users/${id}/sessions`,
    logoutAll: (id: string) => `/api/users/${id}/logout-all`,
    revokeAccess: (id: string) => `/api/users/${id}/revoke-access`,
  },
  settings: {
    company: "/api/settings/company",
  },
  setup: {
    status: "/api/setup/status",
    company: "/api/setup/company",
  },
  ops: {
    diagnostics: "/api/ops/diagnostics",
  },
  exports: {
    leads: "/api/exports/leads",
    activities: "/api/exports/activities",
    followups: "/api/exports/followups",
  },
} as const;
