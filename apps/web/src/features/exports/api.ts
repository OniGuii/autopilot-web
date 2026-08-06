import { apiDownload } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { ExportKind, ExportQuery } from "@/lib/api/types";

function toQuery(query: ExportQuery = {}) {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.status) params.set("status", query.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const pathByKind: Record<ExportKind, string> = {
  leads: endpoints.exports.leads,
  activities: endpoints.exports.activities,
  followups: endpoints.exports.followups,
};

export async function downloadExport(kind: ExportKind, query?: ExportQuery) {
  const { blob, filename } = await apiDownload(
    `${pathByKind[kind]}${toQuery(query)}`,
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}
