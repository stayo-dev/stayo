/**
 * Stayo's email design system.
 *
 * Transactional mail is the brand surface people actually keep — it sits in an
 * inbox long after the tab is closed — so it uses the same palette as the
 * marketing site (`apps/frontend/src/styles/tokens/marketing.css`) rather than
 * the generic indigo/violet these templates shipped with.
 *
 * Everything is inline hex: mail clients strip <style> blocks and know nothing
 * about CSS custom properties. Layout stays table-free and single-column, which
 * is the one structure Outlook, Gmail and Apple Mail all render the same way.
 *
 * The brand is **Stayo** — never "StayO" (see the branding work in
 * docs/obsidian/Decisions.md ADR-033).
 */

export const EMAIL = {
  background: '#fbefe9',
  card: '#ffffff',
  foreground: '#2f2f2f',
  primary: '#a45d44',
  primaryForeground: '#ffffff',
  secondary: '#f3e7dd',
  accent: '#d2986c',
  muted: '#fbf8f3',
  mutedForeground: '#7a6e64',
  border: '#ece1d8',
  success: '#1f8a5b',
  destructive: '#b4453a',
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
} as const;

/**
 * Wraps content in the Stayo shell: wordmark, card, and a footer carrying the
 * Trishul Solutions attribution the public site states everywhere else.
 *
 * @param preheader Inbox preview text. Worth setting — without it clients pull
 *                  the first words of the body, which is usually "Hello Name".
 */
export function emailShell(options: {
  title: string;
  subtitle?: string;
  body: string;
  preheader?: string;
}): string {
  const { title, subtitle, body, preheader } = options;

  return `
<div style="margin:0;padding:24px 12px;background:${EMAIL.background};font-family:${EMAIL.font};">
  ${
    preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${preheader}</div>`
      : ''
  }
  <div style="max-width:560px;margin:0 auto;">

    <div style="padding:4px 4px 16px;">
      <span style="font-size:20px;font-weight:800;letter-spacing:-0.3px;color:${EMAIL.primary};">Stayo</span>
    </div>

    <div style="background:${EMAIL.card};border:1px solid ${EMAIL.border};border-radius:18px;overflow:hidden;">
      <div style="padding:28px 28px 20px;border-bottom:1px solid ${EMAIL.border};">
        <h1 style="margin:0;font-size:21px;line-height:1.25;font-weight:800;color:${EMAIL.foreground};">${title}</h1>
        ${
          subtitle
            ? `<p style="margin:8px 0 0;font-size:14.5px;line-height:1.5;color:${EMAIL.mutedForeground};">${subtitle}</p>`
            : ''
        }
      </div>
      <div style="padding:24px 28px 28px;color:${EMAIL.foreground};font-size:15px;line-height:1.65;">
        ${body}
      </div>
    </div>

    <div style="padding:18px 8px 4px;text-align:center;">
      <p style="margin:0;font-size:12px;line-height:1.6;color:${EMAIL.mutedForeground};">
        Stayo — the stay operations platform.<br />
        Developed and operated by Trishul Solutions.
      </p>
    </div>

  </div>
</div>`.trim();
}

/** Primary call-to-action. Bulletproof enough for Gmail/Apple Mail/Outlook. */
export function emailButton(label: string, href: string): string {
  return `
<div style="text-align:center;margin:26px 0 22px;">
  <a href="${href}" target="_blank" rel="noopener"
     style="display:inline-block;background:${EMAIL.primary};color:${EMAIL.primaryForeground};padding:14px 34px;text-decoration:none;border-radius:12px;font-weight:700;font-size:15.5px;">
    ${label}
  </a>
</div>`.trim();
}

/** Quiet note for expiry/single-use caveats. */
export function emailNote(text: string): string {
  return `<p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:${EMAIL.mutedForeground};text-align:center;">${text}</p>`;
}

/** Fallback for clients that strip the button — always pair with emailButton. */
export function emailLinkFallback(href: string): string {
  return `<p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:${EMAIL.mutedForeground};text-align:center;word-break:break-all;">
  If the button doesn't work, paste this into your browser:<br /><span style="color:${EMAIL.primary};">${href}</span>
</p>`;
}
