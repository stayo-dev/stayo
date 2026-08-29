import { StayoLoader } from '@shared/ui/brand';
import { titleCaseText } from '@shared/lib/textFormat';
import {
  eyebrow,
  h1,
  sub,
  fieldLabel,
  fieldHint,
  textInput,
} from '@features/owner-onboarding/components/stepStyles';

/**
 * The only thing asked before the hostel exists.
 *
 * A name is enough to create the `hostels` row, which is what makes every
 * later step resumable — address, pincode and phone are genuinely "later"
 * and are editable from the hostel's own settings.
 *
 * There is no `<form>` here: `HostelBuilderPage` wraps every step in one, so
 * Enter submits from any field and the sticky footer button drives it.
 */
export function NameStep({
  name,
  onNameChange,
  city,
  onCityChange,
  isSubmitting,
  error,
  needsPassword,
  password,
  onPasswordChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  isSubmitting: boolean;
  error: string | null;
  /** The owner already has a hostel, so this one needs a password. */
  needsPassword: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
}) {
  return (
    <div>
      <div className={eyebrow}>YOUR PROPERTY</div>
      <h1 className={h1}>What&apos;s your hostel called?</h1>
      <p className={sub}>
        Just the name to get started — floors and rooms come next, and everything stays editable
        afterwards.
      </p>

      <div className="flex max-w-[440px] flex-col gap-5">
        <label className="block">
          <span className={fieldLabel}>HOSTEL NAME</span>
          <input
            // Only when there's no password field. Both carrying `autoFocus`
            // meant React focused whichever mounted last, so the owner's
            // cursor landed in a field they had not asked for.
            autoFocus={!needsPassword}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            // On blur, not per keystroke — this is the name tenants know the
            // hostel by and it ends up on every agreement and receipt.
            onBlur={(e) => onNameChange(titleCaseText(e.target.value))}
            placeholder="Sunrise Residency"
            autoComplete="organization"
            enterKeyHint="next"
            maxLength={120}
            aria-describedby="hostel-name-hint"
            className={textInput}
          />
          <span id="hostel-name-hint" className={fieldHint}>
            The name your tenants know it by. You can change it later.
          </span>
        </label>

        <label className="block">
          <span className={fieldLabel}>
            CITY <span className="font-medium normal-case tracking-normal text-muted-foreground">— optional</span>
          </span>
          <input
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            placeholder="Hyderabad"
            autoComplete="address-level2"
            enterKeyHint="go"
            maxLength={80}
            className={textInput}
          />
        </label>

        {needsPassword && (
          <label className="block">
            <span className={fieldLabel}>CONFIRM YOUR PASSWORD</span>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              enterKeyHint="go"
              className={textInput}
            />
            {/* Only from the second hostel onward — by then the account holds
                real tenants and money worth protecting. */}
            <span className={fieldHint}>
              You already have a hostel on this account, so we ask for your password before adding another.
            </span>
          </label>
        )}

        {error && <p className="text-[13px] font-semibold text-destructive">{error}</p>}
        {isSubmitting && (
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <StayoLoader size="sm" label={null} /> Creating your hostel…
          </span>
        )}
      </div>
    </div>
  );
}
