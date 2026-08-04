export type MembershipRole = "OWNER" | "ADMIN" | "AGENT";

export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "RESPONDED"
  | "QUALIFIED"
  | "CONVERTED"
  | "LOST";

export type MembershipSummary = {
  membershipId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  role: MembershipRole;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  status?: string;
};

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  requiresCompanySelection: boolean;
  user: AuthUser;
  memberships: MembershipSummary[];
  sessionId: string;
};

export type SelectCompanyResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  requiresCompanySelection: boolean;
  company: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    id: string;
    role: MembershipRole;
  };
  sessionId: string;
};

export type RefreshResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  requiresCompanySelection: boolean;
  sessionId: string;
};

export type MeResponse = {
  user: AuthUser;
  sessionId: string;
  company: { id: string; name: string; slug: string } | null;
  membership: { id: string; role: MembershipRole } | null;
  memberships: MembershipSummary[];
  claims: {
    sub: string;
    sid: string;
    mid: string | null;
    cid: string | null;
    role: MembershipRole | null;
  };
};

export type Lead = {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  status: LeadStatus;
  score: number;
  ownerId: string | null;
  externalId: string | null;
  convertedAt: string | null;
  firstResponseAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Paginated<T> = {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ListLeadsQuery = {
  status?: LeadStatus;
  ownerId?: string;
  unassigned?: boolean;
  search?: string;
  page?: number;
  limit?: number;
};

export type CreateLeadInput = {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  status?: LeadStatus;
  ownerId?: string | null;
  score?: number;
  externalId?: string;
};

export type UpdateLeadInput = {
  name?: string;
  phone?: string;
  email?: string | null;
  source?: string;
  status?: LeadStatus;
  ownerId?: string | null;
  score?: number;
  externalId?: string | null;
};

export type DashboardFull = {
  companyId: string;
  generatedAt: string;
  period: { from: string | null; to: string | null };
  overview: {
    totalLeads: number;
    newLeads: number;
    convertedLeads: number;
    lostLeads: number;
    conversionRate: number;
    period: { from: string | null; to: string | null };
  };
  leads: {
    byStatus: Record<LeadStatus, number>;
    period: { from: string | null; to: string | null };
  };
  conversations: {
    openConversations: number;
    closedConversations: number;
    messagesSent: number;
    messagesReceived: number;
    avgMessagesPerConversation: number;
    period: { from: string | null; to: string | null };
  };
  followUps: {
    pending: number;
    overdue: number;
    executed: number;
    executionRate: number;
    period: { from: string | null; to: string | null };
  };
};

export type ApiErrorBody = {
  statusCode?: number;
  message?: string | string[];
  error?: string;
};
