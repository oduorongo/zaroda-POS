// The Zaroda look for every email the POS sends: a navy header with the logo and a gold rule, a white body, and
// the navy "Powered by ZARODA SOLUTIONS" footer - the same frame as the apps and Zaroda Events. Inline styles
// only, because mail apps ignore stylesheets.

const NAVY = '#0a1633';
const GOLD = '#c99a2e';

/** The white logo, hosted with the marketing site. Override with EMAIL_LOGO_URL if it moves. */
const logoUrl = () => process.env.EMAIL_LOGO_URL || 'https://zarodashop.com/zaroda-logo-white.png';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface BrandLayoutOptions {
  /** The heading under the logo. Plain text; escaped here. */
  title: string;
  /** Already-safe HTML for the body of the card. */
  bodyHtml: string;
  /** The rule under the header: gold normally, red for something overdue, green for a receipt. */
  accent?: string;
  maxWidth?: number;
}

export const BRAND = { NAVY, GOLD };

/** A call-to-action button in the brand colours (navy with a gold edge). */
export function brandButton(label: string, url: string, colour: string = NAVY): string {
  return `<a href="${escape(url)}" style="background:${colour};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;display:inline-block;border-bottom:3px solid ${GOLD}">${escape(label)}</a>`;
}

export function brandedEmail({ title, bodyHtml, accent = GOLD, maxWidth = 520 }: BrandLayoutOptions): string {
  return `
    <div style="background:#f1f5f9;padding:16px 8px">
    <div style="font-family:Arial,sans-serif;max-width:${maxWidth}px;margin:auto;color:#0f172a">
      <div style="background:${NAVY};padding:16px 20px;border-radius:8px 8px 0 0">
        <img src="${escape(logoUrl())}" alt="ZARODA SOLUTIONS" height="44" style="height:44px;width:auto;display:block;border:0;color:${GOLD};font-weight:bold;font-size:16px" />
        <h2 style="margin:12px 0 0;font-size:18px;color:#ffffff">${escape(title)}</h2>
      </div>
      <div style="height:4px;background:${accent};line-height:4px;font-size:0">&nbsp;</div>
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;padding:20px">
        ${bodyHtml}
      </div>
      <div style="background:${NAVY};color:#cbd5e1;text-align:center;font-size:12px;padding:12px 16px;border-radius:0 0 8px 8px">
        Powered by <strong style="color:#ffffff">ZARODA SOLUTIONS</strong> - Innovative. Reliable. Forward.
      </div>
    </div>
    </div>`;
}
