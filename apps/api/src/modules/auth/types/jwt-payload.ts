import { MembershipRole } from '@prisma/client';

export type JwtPayload = {
  /** userId */
  sub: string;
  /** sessionId */
  sid: string;
  /** membershipId — present after company selection */
  mid?: string;
  /** companyId — present after company selection */
  cid?: string;
  /** membership role — present after company selection */
  role?: MembershipRole;
};

export type AuthenticatedUser = JwtPayload & {
  email?: string;
};

export function hasCompanyContext(
  payload: JwtPayload,
): payload is JwtPayload & { mid: string; cid: string; role: MembershipRole } {
  return Boolean(payload.mid && payload.cid && payload.role);
}
