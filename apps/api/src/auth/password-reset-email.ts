import { brandedEmail } from '../common/email/brand-layout';

/** The email carrying a back office "forgot password" code. */
export function buildPasswordResetEmail(code: string, minutesValid: number): { subject: string; html: string; text: string } {
  const safe = code.replace(/\D/g, '');
  return {
    subject: `Your Zaroda password reset code: ${safe}`,
    html: brandedEmail({
      title: 'Reset your password',
      maxWidth: 480,
      bodyHtml: `
        <div style="text-align:center">
          <p style="margin:0 0 12px">Enter this code on the Zaroda sign-in page to choose a new password:</p>
          <p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:12px 0;color:#0f1f45">${safe}</p>
          <p style="font-size:13px;color:#64748b">It expires in ${minutesValid} minutes. If you did not ask to reset your password, ignore this email - your password stays the same.</p>
        </div>`,
    }),
    text: `Your Zaroda password reset code is ${safe}. It expires in ${minutesValid} minutes. If you did not ask for it, ignore this email - your password stays the same.`,
  };
}
