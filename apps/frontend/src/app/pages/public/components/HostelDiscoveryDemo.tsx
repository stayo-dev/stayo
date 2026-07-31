import { useMemo, useRef, useState, type ComponentType } from 'react';
import {
  Search, MapPin, BedDouble, ShieldCheck, ArrowRight, X, Check,
  Building2, Home, Users, Wifi, Utensils, Snowflake, Shirt,
} from 'lucide-react';
import { FilterSelect } from './FilterSelect';

/**
 * Live, self-contained hostel-finder demo for the landing page. Replaces the
 * previously-static search card: the filter fields are now interactive
 * dropdowns, results filter instantly (client-side over DEMO_HOSTELS), each
 * result has an icon, and "Enquire" opens a working demo modal. No backend —
 * this is a marketing/demo surface (the real Discover marketplace is V2), so
 * everything is intentionally in-memory and clearly labelled a demo.
 */

const AMENITY_ICONS: Record<string, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  WiFi: Wifi,
  Meals: Utensils,
  AC: Snowflake,
  Laundry: Shirt,
};

interface DemoHostel {
  id: string;
  name: string;
  city: string;
  gender: 'Boys' | 'Girls' | 'Co-living';
  distance: string;
  sharing: Array<'Single' | 'Double' | 'Triple'>;
  price: number;
  amenities: string[];
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tint: string;
}

const DEMO_HOSTELS: DemoHostel[] = [
  { id: 'h1', name: 'Sunrise Boys Hostel', city: 'Pune, Maharashtra', gender: 'Boys', distance: '0.4 km', sharing: ['Triple', 'Double'], price: 6000, amenities: ['Meals', 'WiFi'], icon: Building2, tint: 'from-[#EBD9C4] to-[#F3E7D8]' },
  { id: 'h2', name: 'Nest Co-Living', city: 'Pune, Maharashtra', gender: 'Co-living', distance: '0.9 km', sharing: ['Double'], price: 8500, amenities: ['WiFi', 'AC'], icon: Users, tint: 'from-[#E7D3C6] to-[#F0E1D3]' },
  { id: 'h3', name: 'Urban Roost Girls PG', city: 'Pune, Maharashtra', gender: 'Girls', distance: '1.2 km', sharing: ['Single'], price: 11000, amenities: ['AC', 'Laundry'], icon: Home, tint: 'from-[#E9D8CC] to-[#F2E5D9]' },
  { id: 'h4', name: 'Scholars Den', city: 'Kota, Rajasthan', gender: 'Boys', distance: '0.6 km', sharing: ['Triple'], price: 5500, amenities: ['Meals', 'WiFi'], icon: Building2, tint: 'from-[#EBD9C4] to-[#F3E7D8]' },
  { id: 'h5', name: 'Maple Girls Hostel', city: 'Bengaluru, Karnataka', gender: 'Girls', distance: '1.0 km', sharing: ['Double'], price: 9500, amenities: ['WiFi', 'Meals'], icon: Home, tint: 'from-[#E9D8CC] to-[#F2E5D9]' },
  { id: 'h6', name: 'CityNest Co-Living', city: 'Bengaluru, Karnataka', gender: 'Co-living', distance: '2.1 km', sharing: ['Single'], price: 12000, amenities: ['AC', 'WiFi'], icon: Users, tint: 'from-[#E7D3C6] to-[#F0E1D3]' },
  { id: 'h7', name: 'Cauvery Boys Hostel', city: 'Chennai, Tamil Nadu', gender: 'Boys', distance: '0.8 km', sharing: ['Double', 'Triple'], price: 6800, amenities: ['Meals', 'WiFi'], icon: Building2, tint: 'from-[#EBD9C4] to-[#F3E7D8]' },
  { id: 'h8', name: 'Orchid Residency', city: 'Hyderabad, Telangana', gender: 'Girls', distance: '1.5 km', sharing: ['Single', 'Double'], price: 10500, amenities: ['AC', 'Laundry'], icon: Home, tint: 'from-[#E9D8CC] to-[#F2E5D9]' },
];

const LOCATIONS = ['Pune, Maharashtra', 'Bengaluru, Karnataka', 'Hyderabad, Telangana', 'Kota, Rajasthan', 'Chennai, Tamil Nadu', 'All cities'];
const COLLEGES = ['Any college', 'VIT Pune', 'Christ University', 'IIT Hyderabad', 'Allen Kota', 'SRM Chennai'];
const BUDGETS = ['Any budget', 'Under ₹7,000', '₹5k – ₹9k', '₹7k – ₹12k'];
const SHARING = ['Any', 'Single', 'Double', 'Triple'];
const MOVE_INS = ['15 Jul 2026', '1 Aug 2026', 'Immediate'];

const BUDGET_RANGE: Record<string, [number, number]> = {
  'Any budget': [0, Infinity],
  'Under ₹7,000': [0, 7000],
  '₹5k – ₹9k': [5000, 9000],
  '₹7k – ₹12k': [7000, 12000],
};

const POPULAR: Array<{ label: string; patch: Partial<Filters> }> = [
  { label: 'Stays in Pune', patch: { location: 'Pune, Maharashtra' } },
  { label: 'Stays in Bengaluru', patch: { location: 'Bengaluru, Karnataka' } },
  { label: 'Under ₹7,000', patch: { location: 'All cities', budget: 'Under ₹7,000' } },
  { label: 'Single sharing', patch: { location: 'All cities', sharing: 'Single' } },
];

interface Filters {
  location: string;
  college: string;
  budget: string;
  sharing: string;
  moveIn: string;
}

const DEFAULT_FILTERS: Filters = {
  location: 'Pune, Maharashtra',
  college: 'Any college',
  budget: 'Any budget',
  sharing: 'Any',
  moveIn: '15 Jul 2026',
};

export function HostelDiscoveryDemo() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [enquire, setEnquire] = useState<DemoHostel | null>(null);
  const [enquireSent, setEnquireSent] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const [min, max] = BUDGET_RANGE[filters.budget] ?? [0, Infinity];
    return DEMO_HOSTELS.filter((h) => {
      if (filters.location !== 'All cities' && h.city !== filters.location) return false;
      if (filters.sharing !== 'Any' && !h.sharing.includes(filters.sharing as DemoHostel['sharing'][number])) return false;
      if (h.price < min || h.price > max) return false;
      return true;
    });
  }, [filters]);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const openEnquire = (h: DemoHostel) => {
    setEnquire(h);
    setEnquireSent(false);
  };

  const scrollToResults = () =>
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    <div>
      {/* ── Filter card ── */}
      <div className="rounded-[22px] border border-border bg-card p-3.5 shadow-[0_30px_70px_-42px_rgba(47,47,47,0.34)]">
        <div className="flex flex-wrap items-stretch gap-0.5">
          <FilterSelect label="LOCATION" value={filters.location} options={LOCATIONS} onChange={(v) => patch({ location: v })} />
          <FilterSelect label="NEARBY COLLEGE" value={filters.college} options={COLLEGES} onChange={(v) => patch({ college: v })} />
          <FilterSelect label="BUDGET" value={filters.budget} options={BUDGETS} onChange={(v) => patch({ budget: v })} />
          <FilterSelect label="SHARING" value={filters.sharing} options={SHARING} onChange={(v) => patch({ sharing: v })} />
          <FilterSelect label="MOVE-IN" value={filters.moveIn} options={MOVE_INS} onChange={(v) => patch({ moveIn: v })} />
          <button
            type="button"
            onClick={scrollToResults}
            className="m-1.5 flex flex-none items-center gap-2 rounded-2xl bg-primary px-6.5 font-display text-[15px] font-bold text-primary-foreground shadow-[0_10px_24px_-10px_rgba(164,93,68,0.6)] transition-transform hover:scale-[1.03] max-sm:w-full max-sm:justify-center max-sm:py-3.5"
          >
            <Search className="h-4 w-4" strokeWidth={2.4} />
            Search
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 px-1.5 pb-1 pt-3">
          <span className="text-sm font-semibold text-muted-foreground">Popular:</span>
          {POPULAR.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => patch(p.patch)}
              className="rounded-full border border-border bg-muted px-3.5 py-1.5 text-[13px] font-semibold text-foreground/80 transition-colors hover:border-primary hover:text-primary"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Live results ── */}
      <div ref={resultsRef} className="mt-6 scroll-mt-24">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-[15px] font-bold text-foreground">
              {results.length} verified {results.length === 1 ? 'stay' : 'stays'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 font-display text-[10px] font-bold tracking-wide text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              LIVE DEMO
            </span>
          </div>
          {(filters.location !== DEFAULT_FILTERS.location || filters.budget !== 'Any budget' || filters.sharing !== 'Any') && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="text-[13px] font-semibold text-muted-foreground hover:text-primary"
            >
              Reset filters
            </button>
          )}
        </div>

        {results.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-border bg-card/60 px-6 py-12 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
              <Search className="h-5 w-5 text-primary" strokeWidth={2} />
            </div>
            <p className="mb-4 text-[15px] font-semibold text-foreground">No stays match these filters</p>
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 font-display text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.02]"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {results.map((h) => {
              const Icon = h.icon;
              return (
                <div
                  key={h.id}
                  className="rounded-[20px] border border-border bg-card p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-30px_rgba(47,47,47,0.4)] animate-in fade-in duration-300"
                >
                  <div className="flex gap-3.5">
                    <div className={`flex h-[86px] w-24 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${h.tint}`}>
                      <Icon className="h-9 w-9 text-primary/75" strokeWidth={1.5} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-display text-[15px] font-bold text-foreground">{h.name}</span>
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.2} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-medium text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" strokeWidth={2.2} /> {h.distance}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1"><BedDouble className="h-3 w-3" strokeWidth={2.2} /> {h.sharing.join('/')}</span>
                        <span>·</span>
                        <span>{h.gender}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {h.amenities.map((a) => {
                          const AIcon = AMENITY_ICONS[a];
                          return (
                            <span key={a} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-primary">
                              {AIcon && <AIcon className="h-2.5 w-2.5" strokeWidth={2.4} />}
                              {a}
                            </span>
                          );
                        })}
                      </div>
                      <div className="mt-auto flex items-center justify-between pt-2.5">
                        <span className="font-display text-[15px] font-bold text-primary">
                          ₹{h.price.toLocaleString('en-IN')}
                          <span className="text-[11px] font-medium text-muted-foreground">/mo</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => openEnquire(h)}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3.5 py-1.5 font-display text-[12px] font-bold text-primary-foreground transition-transform hover:scale-[1.04]"
                        >
                          Enquire
                          <ArrowRight className="h-3 w-3" strokeWidth={2.6} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Enquire modal (demo) ── */}
      {enquire && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/45 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setEnquire(null)}
        >
          <div
            className="w-full max-w-sm rounded-[22px] border border-border bg-card p-6 shadow-[0_40px_90px_-30px_rgba(47,47,47,0.5)] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-[11px] font-bold tracking-wide text-primary">ENQUIRE</div>
                <div className="font-display text-lg font-extrabold text-foreground">{enquire.name}</div>
                <div className="text-[12.5px] font-medium text-muted-foreground">{enquire.distance} · {enquire.city}</div>
              </div>
              <button type="button" onClick={() => setEnquire(null)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" strokeWidth={2.4} />
              </button>
            </div>

            {enquireSent ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-full bg-success/12">
                  <Check className="h-6 w-6 text-success" strokeWidth={2.6} />
                </div>
                <p className="mb-1.5 font-display text-lg font-bold text-foreground">Enquiry sent!</p>
                <p className="mx-auto max-w-[260px] text-[13.5px] leading-relaxed text-muted-foreground">
                  This is a demo. In the live app, the owner reviews your request and replies on WhatsApp — no instant booking.
                </p>
                <button
                  type="button"
                  onClick={() => setEnquire(null)}
                  className="mt-5 w-full rounded-xl bg-primary py-3 font-display text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.02]"
                >
                  Done
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setEnquireSent(true);
                }}
                className="space-y-3.5"
              >
                <input
                  required
                  placeholder="Your name"
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary"
                />
                <input
                  required
                  type="tel"
                  placeholder="Phone number"
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary"
                />
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-3 font-display text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.02]"
                >
                  Send enquiry
                  <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
                </button>
                <p className="text-center text-[11.5px] text-muted-foreground">Demo only — no data is submitted.</p>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
