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

export type ConversationStatus = "OPEN" | "IDLE" | "CLOSED" | "ARCHIVED";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type Channel = "WHATSAPP";

export type WhatsAppConnectionStatus =
  | "QR_PENDING"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "ERROR";

export type FollowUpStatus =
  | "SUGGESTED"
  | "APPROVED"
  | "REJECTED"
  | "SCHEDULED"
  | "EXECUTING"
  | "EXECUTED"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED";

export type ConversationLeadSummary = {
  id: string;
  name: string | null;
  phone: string;
};

export type Message = {
  id: string;
  companyId: string;
  conversationId: string;
  direction: MessageDirection;
  status: string;
  body: string;
  contentType: string;
  senderType: string;
  senderUserId: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  companyId: string;
  leadId: string;
  channel: Channel;
  status: ConversationStatus;
  assignedUserId: string | null;
  externalThreadId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  lead?: ConversationLeadSummary;
  messages?: Message[];
};

export type ListConversationsQuery = {
  status?: ConversationStatus;
  leadId?: string;
  assignedUserId?: string;
  search?: string;
  page?: number;
  limit?: number;
};

export type CreateConversationInput = {
  leadId: string;
  channel?: Channel;
  status?: ConversationStatus;
  assignedUserId?: string | null;
  externalThreadId?: string | null;
};

export type CreateMessageInput = {
  direction: MessageDirection;
  body: string;
  senderUserId?: string;
};

export type WhatsAppStatus = {
  companyId: string;
  status: WhatsAppConnectionStatus;
  phoneNumber: string | null;
  instanceName: string;
  instanceKey: string;
  connectedAt: string | null;
  qrCode?: string | null;
  lastError?: string | null;
};

export type SendWhatsAppInput = {
  leadId: string;
  conversationId: string;
  body: string;
};

export type FollowUp = {
  id: string;
  companyId: string;
  leadId: string;
  conversationId: string | null;
  assignedUserId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  channel: Channel;
  status: FollowUpStatus;
  type: string;
  scheduledAt: string | null;
  executedAt: string | null;
  suggestedBody: string | null;
  resultMessageId: string | null;
  cancelReason: string | null;
  attemptCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lead?: { id: string; name: string | null; phone: string };
  conversation?: { id: string; status: string } | null;
  resultMessage?: {
    id: string;
    body: string | null;
    direction: string;
    sentAt: string | null;
  } | null;
};

export type ListFollowUpsQuery = {
  status?: FollowUpStatus;
  leadId?: string;
  assignedUserId?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  overdue?: boolean;
  page?: number;
  limit?: number;
};

export type CreateFollowUpInput = {
  leadId: string;
  conversationId?: string | null;
  suggestedBody: string;
  type?: string;
  channel?: Channel;
  scheduledAt?: string | null;
  assignedUserId?: string | null;
};

export type ApproveFollowUpInput = {
  scheduledAt?: string;
};

export type RejectFollowUpInput = {
  reason: string;
};

export type RescheduleFollowUpInput = {
  scheduledAt: string;
};
