import {
  classifyResult,
  explainResult,
  isValidBhfId,
  isValidPin,
  isValidSerial,
  kraTimestamp,
  maskForLog,
  maskPin,
  normalizePin,
} from './etims.util';

describe('KRA PIN, branch ID and serial', () => {
  it('accepts a PIN as KRA writes it, however it was typed', () => {
    expect(isValidPin('A123456789Z')).toBe(true);
    expect(isValidPin(' a123456789z ')).toBe(true);
    expect(isValidPin('P051234567K')).toBe(true);
    expect(normalizePin(' a123 456789z ')).toBe('A123456789Z');
  });
  it('refuses anything else', () => {
    for (const bad of [
      '',
      'A12345678Z',
      'B123456789Z',
      'A1234567890',
      '123456789',
      'A123456789ZZ',
    ])
      expect(isValidPin(bad)).toBe(false);
  });
  it('a branch ID is two digits', () => {
    expect(isValidBhfId('00')).toBe(true);
    expect(isValidBhfId('12')).toBe(true);
    for (const bad of ['', '0', '001', 'AB', '0 '])
      expect(isValidBhfId(bad)).toBe(false);
  });
  it('a serial is 1 to 100 characters with no spaces at the ends', () => {
    expect(isValidSerial('dvcv1130')).toBe(true);
    expect(isValidSerial('x'.repeat(100))).toBe(true);
    for (const bad of ['', ' dvc', 'dvc ', 'x'.repeat(101)])
      expect(isValidSerial(bad)).toBe(false);
  });
});

describe('kraTimestamp', () => {
  it('is yyyyMMddHHmmss in Kenya time', () => {
    expect(kraTimestamp(new Date('2026-11-05T09:30:15Z'))).toBe(
      '20261105123015',
    );
    expect(kraTimestamp(new Date('2026-11-05T21:30:00Z'))).toBe(
      '20261106003000',
    );
  });
});

describe('classifyResult', () => {
  it('success, nothing new, and already there', () => {
    expect(classifyResult('000')).toBe('OK');
    expect(classifyResult('001')).toBe('NO_DATA');
    expect(classifyResult('994')).toBe('DUPLICATE');
  });
  it('trouble reaching KRA is worth retrying', () => {
    for (const c of [
      '891',
      '892',
      '893',
      '894',
      '895',
      '896',
      '899',
      '990',
      '999',
    ])
      expect(classifyResult(c)).toBe('RETRY');
  });
  it('a device KRA does not accept needs setup fixed', () => {
    for (const c of ['900', '901', '902', '903'])
      expect(classifyResult(c)).toBe('DEVICE');
  });
  it('bad data needs a person, and an unknown code is treated that way too (never retried blindly)', () => {
    expect(classifyResult('910')).toBe('FIX');
    expect(classifyResult('921')).toBe('FIX');
    expect(classifyResult('922')).toBe('FIX');
    expect(classifyResult('991')).toBe('FIX');
    expect(classifyResult('777')).toBe('FIX');
  });
});

describe('explainResult', () => {
  it("says what to do in plain words and keeps KRA's own words", () => {
    expect(explainResult('901', 'It is not valid device')).toMatch(
      /does not recognise this device/,
    );
    expect(explainResult('901', 'It is not valid device')).toContain(
      'It is not valid device',
    );
    expect(explainResult('902')).toMatch(/already installed/);
    expect(explainResult('894')).toMatch(/Could not reach KRA/);
    expect(explainResult('555', 'odd')).toBe('KRA answered 555: odd');
  });
});

describe('maskForLog', () => {
  it('hides the key and passwords and shortens customer PINs, at any depth, without touching the original', () => {
    const body = {
      tin: 'A123456789Z',
      cmcKey: 'secretkey',
      pwd: 'p',
      custTin: 'A987654321B',
      list: [{ spplrTin: 'P011111111C', note: 'ok' }],
    };
    const out = maskForLog(body);
    expect(out.cmcKey).toBe('***');
    expect(out.pwd).toBe('***');
    expect(out.custTin).toBe('A*******21B');
    expect(out.list[0].spplrTin).toBe('P*******11C');
    expect(out.list[0].note).toBe('ok');
    expect(out.tin).toBe('A123456789Z');
    expect(body.cmcKey).toBe('secretkey');
  });
  it('leaves short or missing values alone', () => {
    expect(maskPin('ab')).toBe('ab');
    expect(maskPin(undefined)).toBeUndefined();
  });
});
