const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email that carries a shopper's one-time sign-in code. */
export function buildLoginCodeEmail(code: string, minutesValid: number): { subject: string; html: string; text: string } {
  const safe = escapeHtml(code);
  return {
    // The code in the subject lets phones show it without opening the email.
    subject: `Your Zaroda code: ${code}`,
    html: `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#0f172a">
      <div style="background:#0a1633;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0"><h2 style="margin:0;font-size:18px">Your sign-in code</h2></div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:24px 20px;border-radius:0 0 8px 8px;text-align:center">
        <p style="margin:0 0 12px">Enter this code to sign in to Zaroda:</p>
        <p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:12px 0">${safe}</p>
        <p style="font-size:13px;color:#64748b">It expires in ${minutesValid} minutes. If you didn't ask for it, you can ignore this email - nobody can sign in without the code.</p>
      </div>
    </div>`,
    text: `Your Zaroda sign-in code is ${code}. It expires in ${minutesValid} minutes. If you didn't ask for it, ignore this email.`,
  };
}
