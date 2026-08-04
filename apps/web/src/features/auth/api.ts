import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  LoginResponse,
  MeResponse,
  SelectCompanyResponse,
} from "@/lib/api/types";
import {
  clearSession,
  getRefreshToken,
  setSessionTokens,
} from "@/lib/auth/session";

export async function loginRequest(email: string, password: string) {
  const data = await apiRequest<LoginResponse>(endpoints.auth.login, {
    method: "POST",
    auth: false,
    body: { email, password },
  });

  setSessionTokens({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    hasCompany: false,
  });

  return data;
}

export async function selectCompanyRequest(companySlug: string) {
  const data = await apiRequest<SelectCompanyResponse>(
    endpoints.auth.selectCompany,
    {
      method: "POST",
      body: { companySlug },
    },
  );

  setSessionTokens({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    hasCompany: true,
  });

  return data;
}

export async function meRequest() {
  return apiRequest<MeResponse>(endpoints.auth.me);
}

export async function logoutRequest() {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await apiRequest(endpoints.auth.logout, {
        method: "POST",
        auth: false,
        skipRefresh: true,
        body: { refreshToken },
      });
    }
  } finally {
    clearSession();
  }
}
