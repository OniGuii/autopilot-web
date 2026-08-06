import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  CreateLeadActivityInput,
  LeadActivity,
  LeadActivityStatus,
  LeadActivityType,
} from "@/lib/api/types";

function toQuery(params?: {
  status?: LeadActivityStatus;
  type?: LeadActivityType;
}) {
  if (!params) return "";
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.type) search.set("type", params.type);
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function listLeadActivities(
  leadId: string,
  query?: { status?: LeadActivityStatus; type?: LeadActivityType },
) {
  return apiRequest<LeadActivity[]>(
    `${endpoints.leads.activities(leadId)}${toQuery(query)}`,
  );
}

export function createLeadActivity(
  leadId: string,
  input: CreateLeadActivityInput,
) {
  return apiRequest<LeadActivity>(endpoints.leads.activities(leadId), {
    method: "POST",
    body: input,
  });
}

export function completeLeadActivity(leadId: string, activityId: string) {
  return apiRequest<LeadActivity>(
    endpoints.leads.activityComplete(leadId, activityId),
    { method: "POST" },
  );
}

export function cancelLeadActivity(leadId: string, activityId: string) {
  return apiRequest<LeadActivity>(
    endpoints.leads.activityCancel(leadId, activityId),
    { method: "POST" },
  );
}

export function deleteLeadActivity(leadId: string, activityId: string) {
  return apiRequest<void>(endpoints.leads.activity(leadId, activityId), {
    method: "DELETE",
  });
}
