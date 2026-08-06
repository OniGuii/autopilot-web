import { ApiError } from "@/lib/api/client";

/** User-facing error message — never leak raw API paths. */
export function friendlyError(
  error: unknown,
  fallback = "Não foi possível concluir a ação. Tente novamente.",
): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sua sessão expirou. Entre novamente.";
    if (error.status === 403) {
      return "Você não tem permissão para esta ação.";
    }
    if (error.status === 404) return "Registro não encontrado.";
    if (error.status === 413) {
      return "O arquivo ou exportação é grande demais. Reduza o período e tente de novo.";
    }
    if (error.status >= 500) {
      return "Serviço temporariamente indisponível. Tente novamente em instantes.";
    }
    if (error.message && !error.message.includes("/api/")) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message && !error.message.includes("/api/")) {
    return error.message;
  }
  return fallback;
}
