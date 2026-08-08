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
    timeline: (id: string) => `/api/leads/${id}/timeline`,
    assign: (id: string) => `/api/leads/${id}/assign`,
    unassign: (id: string) => `/api/leads/${id}/unassign`,
    notes: (leadId: string) => `/api/leads/${leadId}/notes`,
    note: (leadId: string, noteId: string) =>
      `/api/leads/${leadId}/notes/${noteId}`,
    activities: (leadId: string) => `/api/leads/${leadId}/activities`,
    activity: (leadId: string, activityId: string) =>
      `/api/leads/${leadId}/activities/${activityId}`,
    activityComplete: (leadId: string, activityId: string) =>
      `/api/leads/${leadId}/activities/${activityId}/complete`,
    activityCancel: (leadId: string, activityId: string) =>
      `/api/leads/${leadId}/activities/${activityId}/cancel`,
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
  ai: {
    settings: "/api/ai/settings",
    dashboard: "/api/ai/dashboard",
    classify: "/api/ai/classify",
    recoverySettings: "/api/ai/recovery/settings",
    recoveryDashboard: "/api/ai/recovery/dashboard",
    nbaDashboard: "/api/ai/nba/dashboard",
    nbaConversation: (conversationId: string) =>
      `/api/ai/nba/conversation/${conversationId}`,
    nbaLead: (leadId: string) => `/api/ai/nba/lead/${leadId}`,
    purchaseIntentDashboard: "/api/ai/purchase-intent/dashboard",
    purchaseIntentConversation: (conversationId: string) =>
      `/api/ai/purchase-intent/conversation/${conversationId}`,
    purchaseIntentLead: (leadId: string) =>
      `/api/ai/purchase-intent/lead/${leadId}`,
  },
  knowledgeBase: {
    list: "/api/knowledge-base",
    create: "/api/knowledge-base",
    byId: (id: string) => `/api/knowledge-base/${id}`,
  },
} as const;
