/** Copies text to the clipboard, falling back to the legacy execCommand path
 * for browsers/WebViews without the async Clipboard API (some in-app
 * Android/iOS browsers). Never throws — callers just check the boolean. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Opens a WhatsApp chat pre-filled with `message` — to a specific contact
 * when `phone` is given (assumes a Indian 10-digit number unless already
 * prefixed with the 91 country code), otherwise WhatsApp's own contact
 * picker. `wa.me` works identically on Android and iOS (deep-links into the
 * app when installed, falls back to WhatsApp Web/App Store otherwise). */
export function openWhatsAppShare(message: string, phone?: string) {
  const cleanPhone = phone?.replace(/\D/g, '');
  const formattedPhone = cleanPhone
    ? (cleanPhone.startsWith('91') && cleanPhone.length === 12 ? cleanPhone : `91${cleanPhone}`)
    : undefined;
  const url = formattedPhone
    ? `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

/** Copies `link` to the clipboard and opens WhatsApp with `message` composed
 * around it — the standard "Share Payment Link" action used across the
 * owner app. Copying first means the link is on the clipboard even if the
 * owner picks a different app than WhatsApp from here. */
export async function sharePaymentLink(message: string, link: string, phone?: string) {
  const copied = await copyToClipboard(link);
  openWhatsAppShare(message, phone);
  return copied;
}
