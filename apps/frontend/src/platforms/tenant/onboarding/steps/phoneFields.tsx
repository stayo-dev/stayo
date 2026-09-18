import { AlertCircle, CheckCircle2, Send } from 'lucide-react';
import { FLOW_INK } from '../skyTheme';
import { GuidanceNote, useFieldGuidance } from '../guidance/Guidance';

/**
 * The two inputs that onboarding asks for twice: a mobile number with a
 * "Send code" affordance, and the six-digit box that answers it.
 *
 * Extracted when the Identity screen was split in two (ADR-213). They were
 * local to `WelcomeIdentityStep` while it was the only screen collecting a
 * phone number; the Guardian step needs the same pair, and a second copy would
 * have been two things to keep in step — with the copy that drifts being the
 * one nobody is looking at.
 *
 * Both stay wired to the Guidance context by a `field` anchor, so validation
 * messages still land on the right input.
 */

export const label = { color: FLOW_INK.label, letterSpacing: '.05em' };
export const cardWrap = { background: '#F6F1EA', borderRadius: 10, border: '1px solid #E7DDCE', padding: '0 13px' };
export const inputBase = { width: '100%', border: 'none', outline: 'none', background: 'transparent', color: '#2A2521', padding: '11px 0' };

export function PhoneField({
  field,
  value,
  onChange,
  placeholder,
  verified,
  disabled,
  onSend,
  sending,
  countdown,
  sent,
}: {
  /** Guidance anchor id — 'phone' or 'guardian_phone'. */
  field: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  verified: boolean;
  disabled?: boolean;
  onSend: () => void;
  sending: boolean;
  countdown: number;
  sent: boolean;
}) {
  const mobileValid = value.length === 10;
  const guide = useFieldGuidance(field);
  const border = guide.invalid ? '#D0473A' : verified ? '#1F9D57' : mobileValid ? '#B46A55' : '#E7DDCE';
  return (
    <div>
    <div ref={guide.ref} className={`flex items-center gap-2.5 ${guide.className}`} style={{ ...cardWrap, border: `1.5px solid ${border}`, transition: 'border-color .2s' }}>
      <span className="flex-none text-sm font-bold" style={{ color: '#8A7F75' }}>
        +91
      </span>
      <div className="h-5 w-px flex-none" style={{ background: '#E0D5C6' }} />
      <input
        type="tel"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        placeholder={placeholder}
        disabled={disabled || (sent && countdown > 0)}
        className="min-w-0 flex-1 text-sm font-semibold"
        style={inputBase}
        {...guide.aria}
      />
      {verified ? (
        <div className="flex flex-none items-center gap-1.5 text-[11px] font-extrabold" style={{ color: '#1F7A52' }}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: '#1F9D57' }}>
            <CheckCircle2 className="h-3 w-3 text-white" strokeWidth={2.6} />
          </span>
          Verified
        </div>
      ) : mobileValid ? (
        <button
          type="button"
          onClick={onSend}
          disabled={sending || countdown > 0}
          className="flex flex-none items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-60"
          style={{ background: '#B46A55', boxShadow: '0 4px 11px rgba(180,106,85,.28)' }}
        >
          <Send className="h-3 w-3" />
          {sending ? 'Sending' : countdown > 0 ? `${countdown}s` : sent ? 'Resend' : 'Send'}
        </button>
      ) : null}
    </div>
    <GuidanceNote field={field} />
    </div>
  );
}

export function OtpBlock({
  phone,
  otp,
  setOtp,
  onResend,
  sending,
  countdown,
  helperText,
  error,
}: {
  phone: string;
  otp: string;
  setOtp: (v: string) => void;
  onResend: () => void;
  sending: boolean;
  countdown: number;
  helperText: string;
  /** Server-side verification failure, shown inline under the box per the design. */
  error?: string;
}) {
  const guide = useFieldGuidance('otp');
  const borderColor = error || guide.invalid ? '#D0473A' : otp.length === 6 ? '#1F9D57' : '#E7DDCE';
  return (
    <div ref={guide.ref} className={`ob-up-fast mt-2.5 rounded-[11px] ${guide.className}`} style={{ background: '#FBF7F1', border: '1px solid #EEE3D4', padding: '12px 13px' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: '#1F7A52' }}>
          <Send className="h-3 w-3" />
          Code sent to +91 {phone}
        </span>
        <button type="button" onClick={onResend} disabled={sending || countdown > 0} className="font-display text-[11.5px] font-bold disabled:opacity-60" style={{ color: '#A45D44' }}>
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend'}
        </button>
      </div>
      <div className="mt-2.5 text-xs font-semibold" style={{ color: '#3A342E' }}>
        Enter 6-digit code
      </div>
      <div className="mt-1.5 flex items-center rounded-[10px] bg-white" style={{ border: `1.5px solid ${borderColor}`, padding: '0 14px', transition: 'border-color .2s' }}>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="— — — — — —"
          className="font-display w-full text-center text-[17px] font-bold"
          style={{ ...inputBase, letterSpacing: '.4em' }}
          {...guide.aria}
        />
      </div>
      {!error && <GuidanceNote field="otp" />}
      {error ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: '#D0473A' }}>
          <AlertCircle className="h-3 w-3 flex-none" />
          {error}
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] font-medium" style={{ color: '#9A8F84' }}>
          {helperText}
        </div>
      )}
    </div>
  );
}
