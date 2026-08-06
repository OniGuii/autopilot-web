import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { TimelineResponse } from "@/lib/api/types";

export function fetchLeadTimeline(
  leadId: string,
  query?: { page?: number; limit?: number },
) {
  const params = new URLSearchParams();
  if (query?.page) params.set("page", String(query.page));
  if (query?.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return apiRequest<TimelineResponse>(
    `${endpoints.leads.timeline(leadId)}${qs ? `?${qs}` : ""}`,
  );
}
