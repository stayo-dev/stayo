import { StayoLoader } from '@shared/ui/brand';
import { HOSTEL_TYPE_OPTIONS, type HostelTypeCode } from '../hostelType';
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
 * The only things asked before the hostel exists.
 *
 * A name is enough to create the `hostels` row, which is what makes every
 * later step resumable — address, pincode and phone are genuinely "later"
 * and are editable from the hostel's own settings.
 *
 * Who the hostel takes is asked here too, and it is not cosmetic. The backend
 * has always known how to skip a tenant's gender question when the hostel type
 * answers it (`identity-field-policy.ts`), but nothing ever asked the owner —
 * so `hostels.hostel_type` stayed NULL and every tenant was asked anyway. One
 * tap here is the whole of that fix.
 *
 * There is no `<form>` here: `HostelBuilderPage` wraps every step in one, so
 * Enter submits from any field and the sticky footer button drives it.
 */
export function NameStep({
  name,
  onNameChange,
  city,
  onCityChange,
  hostelType,
  onHostelTypeChange,
  isSubmitting,
  error,
}: {
  name: string;
  onNameChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  hostelType: HostelTypeCode | null;
  onHostelTypeChange: (value: HostelTypeCode) => void;
  isSubmitting: boolean;
  error: string | null;
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
            autoFocus
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

        <div className="block">
          <span className={fieldLabel}>WHO STAYS HERE?</span>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {HOSTEL_TYPE_OPTIONS.map((option) => {
              const selected = hostelType === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => onHostelTypeChange(option.code)}
                  aria-pressed={selected}
                  className={`rounded-xl border-[1.5px] px-3 py-2.5 text-left transition-colors ${
                    selected ? 'border-primary bg-primary/5' : 'border-border bg-card'
                  }`}
                >
                  <span className="block font-display text-[13.5px] font-bold text-foreground">{option.label}</span>
                </button>
              );
            })}
          </div>
          <span className={fieldHint}>
            {hostelType
              ? HOSTEL_TYPE_OPTIONS.find((o) => o.code === hostelType)?.hint
              : 'A boys-only or girls-only hostel has already answered this for every tenant, so they are never asked.'}
          </span>
        </div>

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
