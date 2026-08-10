import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  OutboundProtectionDashboardResponse,
  OutboundProtectionSettings,
  OutboundSuppressListResponse,
  OutboundSuppressEntry,
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
