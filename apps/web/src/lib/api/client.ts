import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSessionTokens,
} from "@/lib/auth/session";
import type { ApiErrorBody, RefreshResponse } from "@/lib/api/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "/backend";

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message || body.error || `Request failed (${status})`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
  skipRefresh?: boolean;
};

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearSession();
      return false;
    }
    const data = (await res.json()) as RefreshResponse;
    setSessionTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      hasCompany: !data.requiresCompanySelection,
    });
    return true;
  } catch {
    clearSession();
    return false;
  }
}

async function ensureRefreshed() {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, auth = true, skipRefresh = false, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);
  const isFormData =
    typeof FormData !== "undefined" && body instanceof FormData;

  // FormData must set its own multipart boundary — do not force JSON.
  if (body !== undefined && !isFormData) {
    requestHeaders.set("Content-Type", "application/json");
  }

  if (auth) {
    const token = getAccessToken();
    if (token) {
      requestHeaders.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: requestHeaders,
    body:
      body === undefined
        ? undefined
        : isFormData
          ? (body as FormData)
          : JSON.stringify(body),
  });

  if (response.status === 401 && auth && !skipRefresh) {
    const refreshed = await ensureRefreshed();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (parsed as ApiErrorBody) ?? { message: response.statusText },
    );
  }

  return parsed as T;
}

/** Download binary/text responses (CSV exports) with auth + refresh. */
export async function apiDownload(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; filename: string }> {
  const { body, auth = true, skipRefresh = false, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);

  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
  }

  if (auth) {
    const token = getAccessToken();
    if (token) {
      requestHeaders.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && auth && !skipRefresh) {
    const refreshed = await ensureRefreshed();
    if (refreshed) {
      return apiDownload(path, { ...options, skipRefresh: true });
    }
  }

  if (!response.ok) {
    const text = await response.text();
    let parsed: ApiErrorBody | null = null;
    try {
      parsed = text ? (JSON.parse(text) as ApiErrorBody) : null;
    } catch {
      parsed = { message: text || response.statusText };
    }
    throw new ApiError(response.status, parsed ?? { message: response.statusText });
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? "export.csv";
  const blob = await response.blob();
  return { blob, filename };
}
