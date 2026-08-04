import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  ApproveFollowUpInput,
  CreateFollowUpInput,
  FollowUp,
  ListFollowUpsQuery,
  Paginated,
  RejectFollowUpInput,
  RescheduleFollowUpInput,
} from "@/lib/api/types";

function toQuery(params: ListFollowUpsQuery) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.leadId) search.set("leadId", params.leadId);
  if (params.assignedUserId) search.set("assignedUserId", params.assignedUserId);
  if (params.scheduledFrom) search.set("scheduledFrom", params.scheduledFrom);
  if (params.scheduledTo) search.set("scheduledTo", params.scheduledTo);
  if (params.overdue !== undefined) search.set("overdue", String(params.overdue));
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function listFollowUps(query: ListFollowUpsQuery = {}) {
  return apiRequest<Paginated<FollowUp>>(
    `${endpoints.followUps.list}${toQuery(query)}`,
  );
}

export function getFollowUp(id: string) {
  return apiRequest<FollowUp>(endpoints.followUps.byId(id));
}

export function createFollowUp(input: CreateFollowUpInput) {
  return apiRequest<FollowUp>(endpoints.followUps.create, {
    method: "POST",
    body: input,
  });
}

export function approveFollowUp(id: string, input: ApproveFollowUpInput = {}) {
  return apiRequest<FollowUp>(endpoints.followUps.approve(id), {
    method: "POST",
    body: input,
  });
}

export function rejectFollowUp(id: string, input: RejectFollowUpInput) {
  return apiRequest<FollowUp>(endpoints.followUps.reject(id), {
    method: "POST",
    body: input,
  });
}

export function rescheduleFollowUp(id: string, input: RescheduleFollowUpInput) {
  return apiRequest<FollowUp>(endpoints.followUps.reschedule(id), {
    method: "POST",
    body: input,
  });
}

export function executeFollowUp(id: string) {
  return apiRequest<FollowUp>(endpoints.followUps.execute(id), {
    method: "POST",
  });
}

export function cancelFollowUp(id: string, reason?: string) {
  return apiRequest<FollowUp>(endpoints.followUps.cancel(id), {
    method: "POST",
    body: { reason },
  });
}

export function retryFollowUp(id: string) {
  return apiRequest<FollowUp>(endpoints.followUps.retry(id), {
    method: "POST",
  });
}
