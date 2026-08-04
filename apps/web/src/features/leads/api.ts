import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  CreateLeadInput,
  Lead,
  ListLeadsQuery,
  Paginated,
  UpdateLeadInput,
} from "@/lib/api/types";

function toQuery(params: ListLeadsQuery) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.ownerId) search.set("ownerId", params.ownerId);
  if (params.unassigned !== undefined) {
    search.set("unassigned", String(params.unassigned));
  }
  if (params.search) search.set("search", params.search);
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function listLeads(query: ListLeadsQuery = {}) {
  return apiRequest<Paginated<Lead>>(`${endpoints.leads.list}${toQuery(query)}`);
}

export function getLead(id: string) {
  return apiRequest<Lead>(endpoints.leads.byId(id));
}

export function createLead(input: CreateLeadInput) {
  return apiRequest<Lead>(endpoints.leads.create, {
    method: "POST",
    body: input,
  });
}

export function updateLead(id: string, input: UpdateLeadInput) {
  return apiRequest<Lead>(endpoints.leads.byId(id), {
    method: "PATCH",
    body: input,
  });
}
