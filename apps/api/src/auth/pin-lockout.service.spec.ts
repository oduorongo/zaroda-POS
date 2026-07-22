import { PinLockoutService } from './pin-lockout.service';

describe('PinLockoutService', () => {
  let service: PinLockoutService;
  const terminalId = 'terminal-1';
  const orgUserId = 'org-user-1';

  beforeEach(() => {
    service = new PinLockoutService();
  });

  it('is not locked before any failures', () => {
    expect(service.getLockoutRemainingSeconds(terminalId, orgUserId)).toBeNull();
  });

  it('locks out after 5 consecutive failures', () => {
    for (let i = 0; i < 4; i++) service.recordFailure(terminalId, orgUserId);
    expect(service.getLockoutRemainingSeconds(terminalId, orgUserId)).toBeNull();

    service.recordFailure(terminalId, orgUserId);
    const remaining = service.getLockoutRemainingSeconds(terminalId, orgUserId);
    expect(remaining).not.toBeNull();
    expect(remaining!).toBeGreaterThan(0);
    expect(remaining!).toBeLessThanOrEqual(15 * 60);
  });

  it('tracks lockout independently per terminalId+orgUserId pair', () => {
    for (let i = 0; i < 5; i++) service.recordFailure(terminalId, orgUserId);
    expect(service.getLockoutRemainingSeconds(terminalId, orgUserId)).not.toBeNull();
    // A different terminal, same orgUserId - unaffected.
    expect(service.getLockoutRemainingSeconds('terminal-2', orgUserId)).toBeNull();
    // Same terminal, different orgUserId - unaffected.
    expect(service.getLockoutRemainingSeconds(terminalId, 'org-user-2')).toBeNull();
  });

  it('a success clears the failure history entirely', () => {
    for (let i = 0; i < 4; i++) service.recordFailure(terminalId, orgUserId);
    service.recordSuccess(terminalId, orgUserId);
    // One more failure after a success starts a fresh count, not the 5th
    // of the previous run - shouldn't be locked yet.
    service.recordFailure(terminalId, orgUserId);
    expect(service.getLockoutRemainingSeconds(terminalId, orgUserId)).toBeNull();
  });
});
