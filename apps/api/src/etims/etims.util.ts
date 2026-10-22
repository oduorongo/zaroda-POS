// Plain rules for talking to KRA's eTIMS (OSCU): the shapes KRA insists on, and what each answer means. Tested without a network.

/** The first "last request" date, asking KRA for everything it has. */
export const INITIAL_LAST_REQ = '20180101000000';

/** A KRA PIN: a letter A or P, nine digits and a letter (11 characters). */
const PIN = /^[AP]\d{9}[A-Z]$/;

export const normalizePin = (input: string): string =>
  input.replace(/\s+/g, '').toUpperCase();
export const isValidPin = (input: string): boolean =>
  PIN.test(normalizePin(input));

/** KRA's branch ID is two characters; "00" is the head office. */
export const isValidBhfId = (input: string): boolean => /^\d{2}$/.test(input);

/** The device serial number: 1 to 100 characters, no spaces at the ends. */
export const isValidSerial = (input: string): boolean =>
  input === input.trim() && input.length >= 1 && input.length <= 100;

/** KRA's timestamp, yyyyMMddHHmmss, in Kenya time (UTC+3, no daylight saving). */
export function kraTimestamp(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 3 * 3_600_000);
  return d.toISOString().slice(0, 19).replace(/[-T:]/g, '');
}

export type ResultKind =
  /** It worked. */
  | 'OK'
  /** It worked and there is nothing new. */
  | 'NO_DATA'
  /** Could not reach KRA or KRA had a hiccup: try again later. */
  | 'RETRY'
  /** KRA already has it: counts as done. */
  | 'DUPLICATE'
  /** The device or its key is not accepted: setup must be fixed. */
  | 'DEVICE'
  /** What was sent is wrong: a person must correct it. Retrying the same thing will not help. */
  | 'FIX';

/** What KRA's response code (section 4.18 of the spec) means for what to do next. */
export function classifyResult(code: string): ResultKind {
  switch (code) {
    case '000':
      return 'OK';
    case '001':
      return 'NO_DATA';
    case '891':
    case '892':
    case '893':
    case '894':
    case '895':
    case '896':
    case '899':
    case '990':
    case '999':
      return 'RETRY';
    case '994':
      return 'DUPLICATE';
    case '900':
    case '901':
    case '902':
    case '903':
      return 'DEVICE';
    default:
      return 'FIX';
  }
}

/** A plain-words explanation of a response code, for the screen. KRA's own message is kept alongside by the caller. */
export function explainResult(code: string, kraMessage?: string): string {
  const own = kraMessage ? ` (KRA says: ${kraMessage})` : '';
  switch (code) {
    case '894':
    case '899':
      return 'Could not reach KRA. Check the internet connection and try again.';
    case '900':
      return `KRA did not receive the device details${own}`;
    case '901':
      return `KRA does not recognise this device. Check the PIN, the branch ID and the device serial number are exactly what KRA approved${own}`;
    case '902':
      return `KRA says this device is already installed. A device can only be connected once - ask KRA to reset it if it needs connecting again${own}`;
    case '903':
      return `KRA says only an OSCU device can be connected this way. The business must be approved for OSCU on the eTIMS portal${own}`;
    case '910':
      return `KRA rejected the request because something in it is wrong${own}`;
    case '990':
      return `KRA says too many requests were made. Wait a little and try again${own}`;
    case '999':
      return `KRA had an unknown error. Try again later${own}`;
    default:
      return kraMessage
        ? `KRA answered ${code}: ${kraMessage}`
        : `KRA answered ${code}`;
  }
}

/** A copy of something that is about to be logged, with the key and customer PINs hidden. */
export function maskForLog<T>(value: T): T {
  const hide = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(hide);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [
          k,
          k === 'cmcKey' || k === 'pwd'
            ? '***'
            : k === 'custTin' || k === 'spplrTin' || k === 'custmTin'
              ? maskPin(x)
              : hide(x),
        ]),
      );
    }
    return v;
  };
  return hide(value) as T;
}

export function maskPin(v: unknown): unknown {
  return typeof v === 'string' && v.length > 4
    ? `${v.slice(0, 1)}*******${v.slice(-3)}`
    : v;
}
