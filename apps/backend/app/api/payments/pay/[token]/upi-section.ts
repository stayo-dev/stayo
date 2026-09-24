/**
 * The UPI payment panel on `/pay/{token}`.
 *
 * Extracted from `route.ts` rather than inlined: that file is already 1,200+
 * lines of server-rendered HTML, and this replaces the single most delicate
 * part of it — the bit tenants actually tap. Keeping it here means the swap
 * from gateway checkout to UPI is a readable diff and the markup rules can be
 * tested without a database (ADR-235).
 *
 * The page is deliberately framework-free: no React, no bundler, one request.
 * Everything below is strings.
 */

/** HTML-escape. The page interpolates hostel and tenant names into markup. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type UpiPanelInput = {
  /** Inline SVG from `renderUpiQrSvg`, or null when the hostel has no UPI ID. */
  qrSvg: string | null;
  /** The `upi://pay?…` intent, or null. */
  uri: string | null;
  appLinks: { label: string; href: string }[];
  hostelName: string;
  /** Where to send the tenant when the hostel has not set a UPI ID. */
  supportPhone?: string;
};

/**
 * What the tenant sees when the hostel has never set a UPI ID.
 *
 * This is not an edge case: 0 of 6 production hostels had one set when this
 * shipped. Showing a broken QR, or nothing at all, would make the tenant think
 * Stayo is broken — so it names the real situation and gives them the one
 * action that resolves it.
 */
function notConfiguredPanel(input: UpiPanelInput): string {
  const call = input.supportPhone
    ? `<a class="upi-call" href="tel:${esc(input.supportPhone)}">Call ${esc(input.hostelName)}</a>`
    : "";
  return `
    <div class="upi-panel upi-panel--unset">
      <p class="upi-unset-title">Online payment isn't set up yet</p>
      <p class="upi-unset-sub">${esc(input.hostelName)} hasn't added their UPI ID. Pay them directly as usual — and once you have, you can still record it below so your rent is marked paid.</p>
      ${call}
    </div>
  `;
}

/**
 * The payment panel: QR, the tap-to-pay button, and the per-app fallbacks.
 *
 * **The QR is always rendered.** It is the only mechanism that works
 * everywhere: iOS has no UPI app chooser and will not reliably resolve
 * `upi://`, desktop cannot open it at all, and in-app browsers (WhatsApp,
 * Instagram — how tenants actually arrive here) routinely block custom
 * schemes. None of those failures are detectable from this page, so the
 * fallback has to be on screen already rather than offered after something
 * has visibly gone wrong.
 *
 * A tenant also cannot scan a QR with the phone displaying it, which is why
 * the intent button leads on mobile and the QR sits beneath it.
 */
export function renderUpiPanel(input: UpiPanelInput): string {
  if (!input.qrSvg || !input.uri) return notConfiguredPanel(input);

  const appButtons = input.appLinks
    .map((l) => `<a class="upi-app" href="${esc(l.href)}">${esc(l.label)}</a>`)
    .join("");

  return `
    <div class="upi-panel">
      <a id="upi-open" class="upi-open" href="${esc(input.uri)}">
        Pay with any UPI app
      </a>

      <div class="upi-apps">${appButtons}</div>

      <div class="upi-qr-wrap">
        <p class="upi-qr-label">Or scan with another phone</p>
        <div id="upi-qr" class="upi-qr">${input.qrSvg}</div>
        <p class="upi-qr-note">Paying to ${esc(input.hostelName)}</p>
      </div>
    </div>
  `;
}

/**
 * The "I've paid" form.
 *
 * The reference is required and the screenshot is not, and that ordering is
 * the point: a UTR is a number the owner can match against their own bank
 * statement, while a screenshot is an image that is trivially edited and
 * endlessly reusable. The copy says why, so the tenant understands the
 * reference is the thing that actually gets them marked paid.
 */
export function renderClaimForm(hostelName: string): string {
  const who = esc(hostelName) || "the hostel";
  return `
    <div class="claim-box">
      <button type="button" id="claim-toggle" class="claim-toggle">I've already paid</button>

      <form id="claim-form" class="claim-form" style="display:none;">
        <p class="claim-title">Tell ${who} what you paid</p>
        <p class="claim-sub">Your rent is marked paid once ${who} confirms it.</p>

        <label class="claim-label" for="claim-utr">UPI reference number</label>
        <input type="text" id="claim-utr" class="claim-input" inputmode="latin"
               autocomplete="off" placeholder="e.g. 412345678901" />
        <p class="claim-hint">Find this in your UPI app under the payment's details. It's how the hostel matches your payment in their bank statement.</p>

        <label class="claim-label" for="claim-amount">Amount you paid</label>
        <div class="claim-amount-row">
          <span class="amount-currency">₹</span>
          <input type="number" id="claim-amount" class="claim-input claim-input--amount"
                 min="1" step="1" inputmode="numeric" />
        </div>

        <label class="claim-label" for="claim-proof">Screenshot (optional)</label>
        <input type="file" id="claim-proof" class="claim-file" accept="image/*" />

        <button type="submit" id="claim-submit" class="claim-submit">Send to the hostel</button>
        <div id="claim-error" class="error-msg" style="display:none;"></div>
      </form>

      <div id="claim-done" class="claim-done" style="display:none;">
        <p class="claim-done-title">Sent to the hostel</p>
        <p class="claim-done-sub">They'll confirm it and your rent will show as paid. You don't need to do anything else.</p>
      </div>
    </div>
  `;
}

/**
 * Client script for the UPI flow.
 *
 * Keeps the QR in step with the amount box — a tenant who edits the amount and
 * then scans a QR encoding the old one would pay the wrong sum, and with no
 * gateway there is no callback to catch it.
 */
export function upiClientScript(token: string): string {
  return `
    <script>
      (function () {
        var tokenValue = ${JSON.stringify(token)};
        var amountInput = document.getElementById('amount-input');
        var claimAmount = document.getElementById('claim-amount');
        var qrBox = document.getElementById('upi-qr');
        var openLink = document.getElementById('upi-open');
        var toggle = document.getElementById('claim-toggle');
        var form = document.getElementById('claim-form');
        var done = document.getElementById('claim-done');
        var errorBox = document.getElementById('claim-error');
        var submitBtn = document.getElementById('claim-submit');
        var qrTimer = null;

        function post(action, payload) {
          return fetch(window.location.pathname, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ action: action }, payload || {}))
          }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); });
        }

        // The QR encodes the amount, so it must follow the amount box.
        function refreshQr() {
          if (!qrBox || !amountInput) return;
          var rupees = Number(amountInput.value);
          if (!isFinite(rupees) || rupees <= 0) return;
          post('qr', { amount: rupees }).then(function (res) {
            if (!res.ok || !res.body || !res.body.svg) return;
            qrBox.innerHTML = res.body.svg;
            if (openLink && res.body.uri) openLink.setAttribute('href', res.body.uri);
            var apps = document.querySelectorAll('.upi-app');
            if (res.body.appLinks) {
              for (var i = 0; i < apps.length && i < res.body.appLinks.length; i++) {
                apps[i].setAttribute('href', res.body.appLinks[i].href);
              }
            }
          }).catch(function () { /* the existing QR stays; it is still valid for its own amount */ });
        }

        if (amountInput) {
          amountInput.addEventListener('input', function () {
            if (claimAmount) claimAmount.value = amountInput.value;
            clearTimeout(qrTimer);
            qrTimer = setTimeout(refreshQr, 400);
          });
          if (claimAmount) claimAmount.value = amountInput.value;
        }

        if (toggle && form) {
          toggle.addEventListener('click', function () {
            var open = form.style.display !== 'none';
            form.style.display = open ? 'none' : 'block';
            toggle.textContent = open ? "I've already paid" : 'Hide';
          });
        }

        function readFileAsDataUrl(file) {
          return new Promise(function (resolve, reject) {
            if (!file) return resolve(null);
            // Keep well under the 4.5 MB function body limit.
            if (file.size > 3 * 1024 * 1024) {
              return reject(new Error('That image is too large. Please pick one under 3 MB.'));
            }
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('Could not read that image.')); };
            reader.readAsDataURL(file);
          });
        }

        if (form) {
          form.addEventListener('submit', function (e) {
            e.preventDefault();
            errorBox.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending…';

            var proofInput = document.getElementById('claim-proof');
            var file = proofInput && proofInput.files ? proofInput.files[0] : null;

            readFileAsDataUrl(file).then(function (dataUrl) {
              return post('claim', {
                utr: (document.getElementById('claim-utr') || {}).value || '',
                amount: Number((claimAmount || {}).value || 0),
                proof: dataUrl
              });
            }).then(function (res) {
              if (!res.ok || !res.body || res.body.success === false) {
                var msg = (res.body && res.body.error && res.body.error.message)
                  || 'Could not send that. Please try again.';
                throw new Error(msg);
              }
              form.style.display = 'none';
              if (toggle) toggle.style.display = 'none';
              done.style.display = 'block';
            }).catch(function (err) {
              errorBox.textContent = err.message || 'Could not send that. Please try again.';
              errorBox.style.display = 'block';
              submitBtn.disabled = false;
              submitBtn.textContent = 'Send to the hostel';
            });
          });
        }

        void tokenValue;
      })();
    </script>
  `;
}

/** Styles for the panel and claim form, appended to the page's existing CSS. */
export const UPI_STYLES = `
  .upi-panel { margin-top: 14px; }
  .upi-panel--unset { background: #FDF6EC; border: 1px solid #E8D9BF; border-radius: 14px; padding: 14px; }
  .upi-unset-title { font-weight: 800; font-size: 14px; margin: 0 0 4px; }
  .upi-unset-sub { font-size: 12.5px; line-height: 1.5; color: #6B6257; margin: 0 0 8px; }
  .upi-call { display: inline-block; font-weight: 700; font-size: 13px; color: #B2560D; text-decoration: none; }
  .upi-open { display: flex; align-items: center; justify-content: center; gap: 8px;
    background: #C2410C; color: #fff; font-weight: 800; font-size: 15px;
    padding: 15px; border-radius: 14px; text-decoration: none; }
  .upi-apps { display: flex; gap: 8px; margin-top: 10px; }
  .upi-app { flex: 1; text-align: center; font-size: 12.5px; font-weight: 700; color: #3A332B;
    background: #fff; border: 1px solid #E5DED4; border-radius: 12px; padding: 10px 6px; text-decoration: none; }
  .upi-qr-wrap { margin-top: 16px; text-align: center; }
  .upi-qr-label { font-size: 12px; color: #6B6257; margin: 0 0 8px; }
  .upi-qr { display: inline-block; background: #fff; padding: 10px; border-radius: 14px; border: 1px solid #E5DED4; }
  .upi-qr svg { display: block; width: 190px; height: 190px; }
  .upi-qr-note { font-size: 11.5px; color: #8A8179; margin: 8px 0 0; }
  .claim-box { margin-top: 18px; border-top: 1px solid #EDE6DC; padding-top: 14px; }
  .claim-toggle { width: 100%; background: none; border: none; font-size: 13.5px; font-weight: 700;
    color: #B2560D; padding: 8px; cursor: pointer; }
  .claim-form { margin-top: 8px; text-align: left; }
  .claim-title { font-weight: 800; font-size: 14px; margin: 0 0 2px; }
  .claim-sub { font-size: 12.5px; color: #6B6257; margin: 0 0 12px; }
  .claim-label { display: block; font-size: 12px; font-weight: 700; margin: 10px 0 4px; }
  .claim-input { width: 100%; box-sizing: border-box; border: 1px solid #E5DED4; border-radius: 11px;
    padding: 12px; font-size: 15px; background: #fff; }
  .claim-input--amount { border: none; padding-left: 2px; }
  .claim-amount-row { display: flex; align-items: center; border: 1px solid #E5DED4;
    border-radius: 11px; padding: 0 10px; background: #fff; }
  .claim-hint { font-size: 11.5px; color: #8A8179; margin: 5px 0 0; line-height: 1.45; }
  .claim-file { margin-top: 4px; font-size: 12.5px; }
  .claim-submit { width: 100%; margin-top: 14px; background: #3A332B; color: #fff; border: none;
    border-radius: 13px; padding: 14px; font-size: 14.5px; font-weight: 800; cursor: pointer; }
  .claim-submit:disabled { opacity: .6; }
  .claim-done { margin-top: 10px; background: #EEF7EE; border: 1px solid #CFE6CF;
    border-radius: 13px; padding: 14px; }
  .claim-done-title { font-weight: 800; font-size: 14px; margin: 0 0 3px; color: #2F6B36; }
  .claim-done-sub { font-size: 12.5px; color: #4B6B4E; margin: 0; line-height: 1.5; }
`;
