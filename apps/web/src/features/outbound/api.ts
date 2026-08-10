import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  FirstTouchDashboardResponse,
  FirstTouchFollowUpListResponse,
  FirstTouchGenerateResponse,
  FirstTouchSettings,
  LeadImportBatch,
  LeadImportBatchListResponse,
  LeadImportDashboardResponse,
  OutboundProtectionDashboardResponse,
  OutboundProtectionSettings,
  OutboundSuppressListResponse,
  OutboundSuppressEntry,
  FirstTouchFollowUpItem,
} from "@/lib/api/types";

export function fetchOutboundProtectionSettings() {
  return apiRequest<OutboundProtectionSettings>(
    endpoints.outbound.protectionSettings,
  );
}

export function updateOutboundProtectionSettings(
  input: Partial<{
    enabled: boolean;
    dailyProactiveCap: number;
    hourlyProactiveCap: number;
    leadCooldownMinutes: number;
    minSpacingSeconds: number;
    allowedHoursStart: number | null;
    allowedHoursEnd: number | null;
    suppressOnKeywords: string[];
    autoSuppressOnLost: boolean;
  }>,
) {
  return apiRequest<OutboundProtectionSettings>(
    endpoints.outbound.protectionSettings,
    { method: "PATCH", body: input },
  );
}

export function fetchOutboundProtectionDashboard() {
  return apiRequest<OutboundProtectionDashboardResponse>(
    endpoints.outbound.protectionDashboard,
  );
}

export function listOutboundSuppress(params?: {
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.activeOnly !== undefined) {
    sp.set("activeOnly", String(params.activeOnly));
  }
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const q = sp.toString();
  return apiRequest<OutboundSuppressListResponse>(
    `${endpoints.outbound.suppress}${q ? `?${q}` : ""}`,
  );
}

export function createOutboundSuppress(input: {
  phone: string;
  leadId?: string;
  reason?: string;
}) {
  return apiRequest<OutboundSuppressEntry>(endpoints.outbound.suppress, {
    method: "POST",
    body: input,
  });
}

export function removeOutboundSuppress(id: string) {
  return apiRequest<OutboundSuppressEntry>(endpoints.outbound.suppressById(id), {
    method: "DELETE",
  });
}

export function fetchLeadImportDashboard() {
  return apiRequest<LeadImportDashboardResponse>(
    endpoints.outbound.importDashboard,
  );
}

export function listLeadImportBatches(params?: {
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const q = sp.toString();
  return apiRequest<LeadImportBatchListResponse>(
    `${endpoints.outbound.importBatches}${q ? `?${q}` : ""}`,
  );
}

export function fetchLeadImportBatch(id: string) {
  return apiRequest<LeadImportBatch>(endpoints.outbound.importBatch(id));
}

export function uploadLeadImportFile(file: File, sourceDefault?: string) {
  const form = new FormData();
  form.append("file", file);
  if (sourceDefault) form.append("sourceDefault", sourceDefault);
  return apiRequest<LeadImportBatch>(endpoints.outbound.importUpload, {
    method: "POST",
    body: form,
  });
}

export function pasteLeadImport(input: {
  text?: string;
  headers?: string[];
  rows?: string[][];
  sourceDefault?: string;
}) {
  return apiRequest<LeadImportBatch>(endpoints.outbound.importPaste, {
    method: "POST",
    body: input,
  });
}

export function updateLeadImportMapping(
  id: string,
  input: {
    columnMapping: Record<string, string | null | undefined>;
    sourceDefault?: string;
    dedupeMode?: "skip" | "reject";
  },
) {
  return apiRequest<LeadImportBatch>(endpoints.outbound.importMapping(id), {
    method: "PATCH",
    body: input,
  });
}

export function validateLeadImport(id: string) {
  return apiRequest<LeadImportBatch>(endpoints.outbound.importValidate(id), {
    method: "POST",
  });
}

export function commitLeadImport(id: string) {
  return apiRequest<LeadImportBatch>(endpoints.outbound.importCommit(id), {
    method: "POST",
  });
}

export function cancelLeadImport(id: string) {
  return apiRequest<LeadImportBatch>(endpoints.outbound.importCancel(id), {
    method: "POST",
  });
}

export function fetchFirstTouchSettings() {
  return apiRequest<FirstTouchSettings>(endpoints.outbound.firstTouchSettings);
}

export function updateFirstTouchSettings(
  input: Partial<{
    mode: string;
    verticalPlaybook: string;
    maxBatchSize: number;
    requireImportBatch: boolean;
    enableKbGrounding: boolean;
    enableMemorySeed: boolean;
  }>,
) {
  return apiRequest<FirstTouchSettings>(endpoints.outbound.firstTouchSettings, {
    method: "PATCH",
    body: input,
  });
}

export function fetchFirstTouchDashboard() {
  return apiRequest<FirstTouchDashboardResponse>(
    endpoints.outbound.firstTouchDashboard,
  );
}

export function listFirstTouchFollowUps(params?: {
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const q = sp.toString();
  return apiRequest<FirstTouchFollowUpListResponse>(
    `${endpoints.outbound.firstTouchFollowUps}${q ? `?${q}` : ""}`,
  );
}

export function generateFirstTouch(input?: {
  leadIds?: string[];
  importBatchId?: string;
  limit?: number;
}) {
  return apiRequest<FirstTouchGenerateResponse>(
    endpoints.outbound.firstTouchGenerate,
    { method: "POST", body: input ?? {} },
  );
}

export function approveFirstTouch(id: string) {
  return apiRequest<FirstTouchFollowUpItem>(
    endpoints.outbound.firstTouchApprove(id),
    { method: "POST" },
  );
}

export function rejectFirstTouch(id: string) {
  return apiRequest<FirstTouchFollowUpItem>(
    endpoints.outbound.firstTouchReject(id),
    { method: "POST" },
  );
}
