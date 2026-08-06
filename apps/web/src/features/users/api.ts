import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  LogoutAllResponse,
  RevokeMembershipResponse,
  UserSessionsResponse,
} from "@/lib/api/types";

export function fetchUserSessions(userId: string) {
  return apiRequest<UserSessionsResponse>(endpoints.users.sessions(userId));
}

export function logoutUserAll(userId: string) {
  return apiRequest<LogoutAllResponse>(endpoints.users.logoutAll(userId), {
    method: "POST",
  });
}

export function revokeUserAccess(userId: string) {
  return apiRequest<RevokeMembershipResponse>(
    endpoints.users.revokeAccess(userId),
    { method: "POST" },
  );
}
