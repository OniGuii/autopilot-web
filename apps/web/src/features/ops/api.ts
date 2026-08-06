import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { DiagnosticsResponse } from "@/lib/api/types";

export function fetchDiagnostics() {
  return apiRequest<DiagnosticsResponse>(endpoints.ops.diagnostics);
}
