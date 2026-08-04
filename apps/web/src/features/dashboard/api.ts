import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { DashboardFull } from "@/lib/api/types";

export function fetchDashboard() {
  return apiRequest<DashboardFull>(endpoints.dashboard.full);
}
