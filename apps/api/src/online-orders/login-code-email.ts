import { brandedEmail } from '../common/email/brand-layout';
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email that carries a shopper's one-time sign-in code. */
export function buildLoginCodeEmail(code: string, minutesValid: number): { subject: string; html: string; text: string } {
  const safe = escapeHtml(code);
  return {
    // The code in the subject lets phones show it without opening the email.
    subject: `Your Zaroda code: ${code}`,
    html: brandedEmail({
      title: 'Your sign-in code',
      maxWidth: 480,
      bodyHtml: `
        <div style="text-align:center">
          <p style="margin:0 0 12px">Enter this code to sign in to Zaroda:</p>
          <p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:12px 0;color:#0a1633">${safe}</p>
          <p style="font-size:13px;color:#64748b">It expires in ${minutesValid} minutes. If you didn't ask for it, you can ignore this email - nobody can sign in without the code.</p>
        </div>`,
    }),
    text: `Your Zaroda sign-in code is ${code}. It expires in ${minutesValid} minutes. If you didn't ask for it, ignore this email.`,
  };
}
