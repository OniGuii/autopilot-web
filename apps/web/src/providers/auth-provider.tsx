"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  loginRequest,
  logoutRequest,
  meRequest,
  selectCompanyRequest,
} from "@/features/auth/api";
import type {
  AuthUser,
  MembershipRole,
  MembershipSummary,
  MeResponse,
} from "@/lib/api/types";
import { navigateAfterAuth } from "@/lib/auth/navigate";
import { getAccessToken } from "@/lib/auth/session";

type AuthContextValue = {
  bootstrapping: boolean;
  user: AuthUser | null;
  memberships: MembershipSummary[];
  company: MeResponse["company"];
  membership: MeResponse["membership"];
  role: MembershipRole | null;
  hasCompany: boolean;
  login: (email: string, password: string) => Promise<MembershipSummary[]>;
  selectCompany: (companySlug: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<MeResponse | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberships, setMemberships] = useState<MembershipSummary[]>([]);
  const [company, setCompany] = useState<MeResponse["company"]>(null);
  const [membership, setMembership] = useState<MeResponse["membership"]>(null);

  const applyMe = useCallback((me: MeResponse) => {
    setUser(me.user);
    setMemberships(me.memberships);
    setCompany(me.company);
    setMembership(me.membership);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      setMemberships([]);
      setCompany(null);
      setMembership(null);
      return null;
    }
    const me = await meRequest();
    applyMe(me);
    return me;
  }, [applyMe]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (getAccessToken()) {
          await refreshMe();
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setMemberships([]);
          setCompany(null);
          setMembership(null);
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await loginRequest(email, password);
    setUser(data.user);
    setMemberships(data.memberships);
    setCompany(null);
    setMembership(null);
    return data.memberships;
  }, []);

  const selectCompany = useCallback(
    async (companySlug: string) => {
      const data = await selectCompanyRequest(companySlug);
      // Apply company immediately from select response so RequireAuth
      // does not bounce to /select-company if a follow-up /me is slow.
      setCompany(data.company);
      setMembership(data.membership);
      try {
        await refreshMe();
      } catch {
        // Keep select-company context; bootstrap will retry /me later.
      }
    },
    [refreshMe],
  );

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setMemberships([]);
    setCompany(null);
    setMembership(null);
    navigateAfterAuth("/login");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      bootstrapping,
      user,
      memberships,
      company,
      membership,
      role: membership?.role ?? null,
      hasCompany: Boolean(company?.id),
      login,
      selectCompany,
      logout,
      refreshMe,
    }),
    [
      bootstrapping,
      user,
      memberships,
      company,
      membership,
      login,
      selectCompany,
      logout,
      refreshMe,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
