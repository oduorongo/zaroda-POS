import { Injectable } from '@nestjs/common';

const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_WINDOW_MS = 5 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

interface AttemptState {
  failureTimestamps: number[];
  lockedUntil?: number;
}

/**
 * A second, independent brake on PIN-login brute-forcing, on top of
 * AuthController's existing IP-based @Throttle(5/min) - that one is keyed
 * by caller IP, which a shared-office NAT dilutes (many legitimate
 * cashiers sharing one IP hit the same bucket) and an attacker can trivially
 * defeat by rotating source IPs while the terminalId+orgUserId pair they're
 * actually guessing against stays fixed. This tracks consecutive failures
 * per (terminalId, orgUserId) instead - the thing that actually identifies
 * "one PIN being brute-forced at one terminal," independent of who's
 * calling from where.
 *
 * Deliberately in-memory, not a persisted+RLS'd table: this is a security
 * speed bump, not business data anyone ever reads back, and this codebase's
 * own target scale (DESIGN.md: 1-10 tenants, <10 terminals total, a single
 * Node process) makes "state resets on a restart/redeploy" an acceptable
 * trade against the real cost of a new tenant-scoped table (a migration,
 * an RLS policy, and RLS's own audit surface) for what is fundamentally a
 * rate-limit counter - the same reasoning @nestjs/throttler's own default
 * in-memory storage already relies on for the IP-based limit above.
 */
@Injectable()
export class PinLockoutService {
  private readonly attempts = new Map<string, AttemptState>();

  private key(terminalId: string, orgUserId: string): string {
    return `${terminalId}:${orgUserId}`;
  }

  /** Seconds remaining before this terminal+orgUser pair may try again, or null if not locked. */
  getLockoutRemainingSeconds(terminalId: string, orgUserId: string): number | null {
    const state = this.attempts.get(this.key(terminalId, orgUserId));
    if (!state?.lockedUntil) return null;
    const remainingMs = state.lockedUntil - Date.now();
    if (remainingMs <= 0) {
      // Lockout has naturally expired - clear it now rather than waiting
      // for the next recordFailure/recordSuccess to overwrite it, so a
      // concurrent read of this same key sees the correct (unlocked) state.
      this.attempts.delete(this.key(terminalId, orgUserId));
      return null;
    }
    return Math.ceil(remainingMs / 1000);
  }

  recordFailure(terminalId: string, orgUserId: string): void {
    const k = this.key(terminalId, orgUserId);
    const now = Date.now();
    const state = this.attempts.get(k) ?? { failureTimestamps: [] };
    state.failureTimestamps = state.failureTimestamps.filter(
      (t) => now - t < FAILURE_WINDOW_MS,
    );
    state.failureTimestamps.push(now);
    if (state.failureTimestamps.length >= MAX_CONSECUTIVE_FAILURES) {
      state.lockedUntil = now + LOCKOUT_MS;
    }
    this.attempts.set(k, state);
  }

  /** A successful PIN login clears this terminal+orgUser pair's history entirely. */
  recordSuccess(terminalId: string, orgUserId: string): void {
    this.attempts.delete(this.key(terminalId, orgUserId));
  }
}
