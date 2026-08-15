import { StayoLoader } from '@shared/ui/brand';
import { eyebrow, h1, sub, fieldLabel, textInput } from '@features/owner-onboarding/components/stepStyles';

/**
 * The only thing asked before the hostel exists.
 *
 * A name is enough to create the `hostels` row, which is what makes every
 * later step resumable — address, pincode and phone are genuinely "later"
 * and are editable from the hostel's own settings.
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
        That&apos;s all we need to get started. Floors and rooms come next, and everything stays editable
        afterwards.
      </p>

      <div className="flex max-w-[440px] flex-col gap-6">
        <label className="block">
          <span className={fieldLabel}>HOSTEL NAME</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Sunrise Residency"
            className={textInput}
          />
        </label>

        <label className="block">
          <span className={fieldLabel}>CITY (OPTIONAL)</span>
          <input value={city} onChange={(e) => onCityChange(e.target.value)} placeholder="Hyderabad" className={textInput} />
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
              className={textInput}
            />
            {/* Only from the second hostel onward — by then the account holds
                real tenants and money worth protecting. */}
            <span className="mt-2 block text-[12.5px] leading-relaxed text-muted-foreground">
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
