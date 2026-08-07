import { useEffect, useRef, useState } from 'react';
import { Search, MapPin, Loader2 } from 'lucide-react';
import type { OwnerOnboardingData } from '../../hooks/useOwnerOnboardingState';
import { eyebrow, h1, sub, fieldLabel } from '../stepStyles';
import { SEARCH_DEBOUNCE_MS, shouldSearch, type PlaceSuggestion } from '../../places/placesProvider';
import { stubPlacesProvider } from '../../places/stubPlacesProvider';

interface LocationStepProps {
  data: OwnerOnboardingData;
  setD: (patch: Partial<OwnerOnboardingData>) => void;
}

/**
 * Swap this for a GooglePlacesProvider once a Maps API key exists — the whole
 * point of the interface. Nothing else in this file needs to change.
 */
const provider = stubPlacesProvider;

export function LocationStep({ data, setD }: LocationStepProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  /** Set when a suggestion is picked, so we don't immediately re-search it. */
  const justPickedRef = useRef(false);

  useEffect(() => {
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    if (!shouldSearch(data.address)) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    // Debounced: under a real provider each keystroke is a billed request.
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await provider.search(data.address);
        if (!cancelled) {
          setSuggestions(results);
          setOpen(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data.address]);

  const pick = async (suggestion: PlaceSuggestion) => {
    justPickedRef.current = true;
    const resolved = await provider.resolve(suggestion);
    setD({ address: resolved.address, city: resolved.city || data.city });
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div>
      <div className={eyebrow}>PIN THE PLACE</div>
      <h1 className={h1}>Where does it stand?</h1>
      <p className={sub}>Where should students look for you? Street, area and city.</p>

      <div className="relative mb-4 w-full max-w-[440px]">
        <label className="block">
          <span className={fieldLabel}>STREET ADDRESS</span>
          <div className="mt-1.5 flex items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3.5">
            <Search className="h-4.5 w-4.5 flex-none text-primary" strokeWidth={2.2} />
            <input
              value={data.address}
              onChange={(e) => setD({ address: e.target.value })}
              onFocus={() => suggestions.length > 0 && setOpen(true)}
              placeholder="Start typing an area or landmark"
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent text-[15px] font-semibold text-foreground focus:outline-none"
            />
            {searching && <Loader2 className="h-4 w-4 flex-none animate-spin text-muted-foreground" />}
          </div>
        </label>

        {open && suggestions.length > 0 && (
          <>
            {/* Click-away, so the list closes without stealing the next tap. */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <ul className="absolute inset-x-0 z-20 mt-1.5 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_50px_-20px_rgba(47,47,47,0.35)]">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 flex-none text-primary" strokeWidth={2.2} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold text-foreground">{s.primary}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">{s.secondary}</span>
                    </span>
                  </button>
                </li>
              ))}
              {/* Never let placeholder data pass for the real thing. */}
              {!provider.isReal && (
                <li className="border-t border-border bg-muted/50 px-4 py-2 text-[11.5px] font-semibold text-muted-foreground">
                  Example suggestions — full address search is coming soon. You can type any address.
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      <label className="mb-4 block w-full max-w-[440px]">
        <span className={fieldLabel}>CITY</span>
        <div className="mt-1.5 rounded-2xl border border-border bg-card px-4 py-3.5">
          <input
            value={data.city}
            onChange={(e) => setD({ city: e.target.value })}
            placeholder="e.g. Bengaluru"
            autoComplete="address-level2"
            className="w-full border-0 bg-transparent text-[15px] font-semibold text-foreground focus:outline-none"
          />
        </div>
      </label>

      {/* Reflects what the owner actually typed. This card used to assert
          "Location verified · Hyderabad, Telangana · Near JNTU" for everyone
          regardless of input, with invented college distances. */}
      {(data.address.trim() || data.city.trim()) && (
        <div className="w-full max-w-[440px] rounded-2xl border border-border bg-card p-4">
          <div className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-primary">
            Your address so far
          </div>
          <div className="font-display text-[17px] font-bold text-foreground">
            {data.address.trim() || 'Add a street address'}
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium text-muted-foreground">
            {data.city.trim() || 'Add a city'}
          </div>
          <div className="mt-3 border-t border-border pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            We verify the address and map nearby colleges after you publish — you can edit it any time before then.
          </div>
        </div>
      )}
    </div>
  );
}
