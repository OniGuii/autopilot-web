import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  CompanyMembership,
  CreateMembershipInput,
  CreateMembershipResponse,
  ListMembershipsQuery,
  Paginated,
  RevokeMembershipResponse,
  UpdateMembershipInput,
} from "@/lib/api/types";

function toQuery(query: ListMembershipsQuery = {}) {
  const params = new URLSearchParams();
  if (query.role) params.set("role", query.role);
  if (query.status) params.set("status", query.status);
  if (query.page) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listMemberships(query?: ListMembershipsQuery) {
  return apiRequest<Paginated<CompanyMembership>>(
    `${endpoints.memberships.list}${toQuery(query)}`,
  );
}

export function createMembership(input: CreateMembershipInput) {
  return apiRequest<CreateMembershipResponse>(endpoints.memberships.create, {
    method: "POST",
    body: input,
  });
}

export function updateMembership(id: string, input: UpdateMembershipInput) {
  return apiRequest<CompanyMembership>(endpoints.memberships.byId(id), {
    method: "PATCH",
    body: input,
  });
}

export function revokeMembership(id: string) {
  return apiRequest<RevokeMembershipResponse>(endpoints.memberships.byId(id), {
    method: "DELETE",
  });
}
