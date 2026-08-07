import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  AiAgentMode,
  AiClassifyResponse,
  AiDashboardResponse,
  CompanyAiSettings,
  KnowledgeBaseEntry,
  KnowledgeBaseKind,
  KnowledgeBaseListResponse,
} from "@/lib/api/types";

export function fetchAiSettings() {
  return apiRequest<CompanyAiSettings>(endpoints.ai.settings);
}

export function fetchAiDashboard() {
  return apiRequest<AiDashboardResponse>(endpoints.ai.dashboard);
}

export function updateAiSettings(input: {
  mode?: AiAgentMode;
  maxAutoRepliesPerLeadDay?: number;
}) {
  return apiRequest<CompanyAiSettings>(endpoints.ai.settings, {
    method: "PATCH",
    body: input,
  });
}

export function classifyIntent(input: {
  message: string;
  recentContext?: string[];
}) {
  return apiRequest<AiClassifyResponse>(endpoints.ai.classify, {
    method: "POST",
    body: input,
  });
}

export function listKnowledgeBase(params?: {
  kind?: KnowledgeBaseKind;
  active?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.kind) sp.set("kind", params.kind);
  if (params?.active !== undefined) sp.set("active", String(params.active));
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const q = sp.toString();
  return apiRequest<KnowledgeBaseListResponse>(
    `${endpoints.knowledgeBase.list}${q ? `?${q}` : ""}`,
  );
}

export function createKnowledgeBaseEntry(input: {
  kind: KnowledgeBaseKind;
  title: string;
  body: string;
  tags?: string[];
  active?: boolean;
  sortOrder?: number;
}) {
  return apiRequest<KnowledgeBaseEntry>(endpoints.knowledgeBase.create, {
    method: "POST",
    body: input,
  });
}

export function updateKnowledgeBaseEntry(
  id: string,
  input: Partial<{
    kind: KnowledgeBaseKind;
    title: string;
    body: string;
    tags: string[];
    active: boolean;
    sortOrder: number;
  }>,
) {
  return apiRequest<KnowledgeBaseEntry>(endpoints.knowledgeBase.byId(id), {
    method: "PATCH",
    body: input,
  });
}

export function deleteKnowledgeBaseEntry(id: string) {
  return apiRequest<{ id: string; deleted: boolean }>(
    endpoints.knowledgeBase.byId(id),
    { method: "DELETE" },
  );
}
