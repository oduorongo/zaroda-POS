import { Injectable } from '@nestjs/common';

const MAX_CONSECUTIVE_FAILURES = 5;
// The terminal id comes from the request, so a pair-only key can be dodged by sending a new terminal id each guess.
// A wider count per user, across every terminal, closes that.
const MAX_USER_FAILURES = 10;
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
 * defeat by rotating source IPs. This tracks failures per (terminalId, orgUserId),
 * and per orgUserId across all terminals, independent of who's calling from where.
 *
 * Deliberately in-memory, not a persisted+RLS'd table: this is a security
 * speed bump, not business data anyone ever reads back, and this codebase's
 * own target scale (a single Node process) makes "state resets on a
 * restart/redeploy" an acceptable trade - the same reasoning
 * @nestjs/throttler's own default in-memory storage already relies on.
 */
@Injectable()
export class PinLockoutService {
  private readonly attempts = new Map<string, AttemptState>();

  private keys(terminalId: string, orgUserId: string): [string, number][] {
    return [
      [`${terminalId}:${orgUserId}`, MAX_CONSECUTIVE_FAILURES],
      [`user:${orgUserId}`, MAX_USER_FAILURES],
    ];
  }

  /** Seconds remaining before this terminal+orgUser pair may try again, or null if not locked. */
  getLockoutRemainingSeconds(terminalId: string, orgUserId: string): number | null {
    let longest: number | null = null;
    for (const [k] of this.keys(terminalId, orgUserId)) {
      const state = this.attempts.get(k);
      if (!state?.lockedUntil) continue;
      const remainingMs = state.lockedUntil - Date.now();
      if (remainingMs <= 0) {
        this.attempts.delete(k);
        continue;
      }
      longest = Math.max(longest ?? 0, Math.ceil(remainingMs / 1000));
    }
    return longest;
  }

  recordFailure(terminalId: string, orgUserId: string): void {
    const now = Date.now();
    for (const [k, max] of this.keys(terminalId, orgUserId)) {
      const state = this.attempts.get(k) ?? { failureTimestamps: [] };
      state.failureTimestamps = state.failureTimestamps.filter((t) => now - t < FAILURE_WINDOW_MS);
      state.failureTimestamps.push(now);
      if (state.failureTimestamps.length >= max) state.lockedUntil = now + LOCKOUT_MS;
      this.attempts.set(k, state);
    }
  }

  /** A successful PIN login clears this terminal+orgUser pair's history, and the user's own. */
  recordSuccess(terminalId: string, orgUserId: string): void {
    for (const [k] of this.keys(terminalId, orgUserId)) this.attempts.delete(k);
  }
}
