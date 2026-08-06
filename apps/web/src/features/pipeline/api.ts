import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { PipelineResponse } from "@/lib/api/types";

export function fetchPipeline(query?: { from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (query?.from) params.set("from", query.from);
  if (query?.to) params.set("to", query.to);
  const qs = params.toString();
  return apiRequest<PipelineResponse>(
    `${endpoints.pipeline.get}${qs ? `?${qs}` : ""}`,
  );
}
