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
} as const;
