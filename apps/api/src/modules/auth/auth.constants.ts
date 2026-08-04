/** Membership.status string values (no enum migration in 6A.1). */
export const MEMBERSHIP_STATUS_ACTIVE = 'ACTIVE';
export const MEMBERSHIP_STATUS_REVOKED = 'REVOKED';
export const MEMBERSHIP_STATUS_INVITED = 'INVITED';

export const AUTH_MAX_SESSIONS_DEFAULT = 5;
export const AUTH_MEMBERSHIP_CACHE_TTL_DEFAULT = 30;

/** Redis key helpers for AH11 membership/access cache. */
export const AUTH_CACHE_PREFIX = 'autopilot:auth:access:';

export function authAccessCacheKey(
  userId: string,
  membershipId: string | null,
): string {
  return `${AUTH_CACHE_PREFIX}${userId}:${membershipId ?? 'none'}`;
}

export function authAccessCacheUserPattern(userId: string): string {
  return `${AUTH_CACHE_PREFIX}${userId}:*`;
}
