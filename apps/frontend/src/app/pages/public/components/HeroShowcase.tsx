import { Check, MapPin, ArrowUp, MessageSquare } from 'lucide-react';

interface HeroShowcaseProps {
  active: 'tenant' | 'owner';
}

const TENANT_LISTINGS = [
  {
    name: 'Sunrise Boys Hostel',
    meta: '0.4 km · Triple sharing · Meals',
    price: '₹6,000',
    swatch: 'from-[#EBD9C4] to-[#F3E7D8]',
    cta: 'bg-primary text-primary-foreground',
  },
  {
    name: 'Nest Co-Living',
    meta: '0.9 km · Double sharing · WiFi',
    price: '₹8,500',
    swatch: 'from-[#E7D3C6] to-[#F0E1D3]',
    cta: 'bg-secondary text-primary',
  },
  {
    name: 'Urban Roost Girls PG',
    meta: '1.2 km · Single sharing · AC',
    price: '₹11,000',
    swatch: 'from-[#E9D8CC] to-[#F2E5D9]',
    cta: 'bg-secondary text-primary',
  },
];

const OWNER_TENANTS = [
  { name: 'Riya Sharma · Room 204', amount: '₹6,000', status: 'Paid', swatch: 'from-[#D2986C] to-[#c88a5c]' },
  { name: 'Rohit Verma · Room 108', amount: '₹6,000', status: 'Due', swatch: 'from-[#B46A55] to-[#a55f4b]' },
];

/**
 * The hero's swapping visual card, per HeroShowcase.dc.html — a mock
 * marketplace search-results card for the tenant tab, a mock dashboard
 * overview card for the owner tab. Purely decorative/static (all values are
 * the design's own example data), matching the "mock data" nature of the
 * rest of this page.
 */
export function HeroShowcase({ active }: HeroShowcaseProps) {
  return (
    <div className="relative mx-auto w-full max-w-[540px]">
      {active === 'tenant' ? (
        <div className="relative animate-in fade-in slide-in-from-right-3 duration-300">
          <div className="overflow-hidden rounded-[22px] border border-border bg-card shadow-[0_44px_90px_-42px_rgba(47,47,47,0.42),0_12px_30px_-18px_rgba(47,47,47,0.14)]">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#E4C9B4]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#EBD9C4]" />
              <div className="ml-1.5 flex flex-1 items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 text-primary" strokeWidth={2.2} />
                Hostels near VIT, Pune
              </div>
            </div>
            <div className="flex flex-col gap-2.5 p-3.5">
              {TENANT_LISTINGS.map((item) => (
                <div key={item.name} className="flex gap-3 rounded-2xl border border-border/60 bg-muted p-2.5">
                  <div className={`h-16 w-[78px] shrink-0 rounded-xl bg-gradient-to-br ${item.swatch}`} />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-[13px] font-bold text-foreground">
                        {item.name}
                      </span>
                      <span className="text-primary">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2 4 5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V5z" />
                        </svg>
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground">{item.meta}</span>
                    <div className="flex items-center justify-between">
                      <span className="font-display text-[13px] font-bold text-primary">
                        {item.price}
                        <span className="text-[11px] font-medium text-muted-foreground">/mo</span>
                      </span>
                      <span className={`rounded-lg px-2.5 py-1 font-display text-[10px] font-bold ${item.cta}`}>
                        Enquire
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -right-[2%] -top-[4%] hidden items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-2.5 shadow-[0_22px_44px_-18px_rgba(47,47,47,0.32)] sm:flex">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-success/10">
              <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.6} />
            </span>
            <div>
              <div className="font-display text-[11px] font-bold text-foreground">Enquiry approved</div>
              <div className="text-[9.5px] font-medium text-muted-foreground">Riya · Room 204</div>
            </div>
          </div>
          <div className="absolute -bottom-[3%] -left-[3%] hidden items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 shadow-[0_20px_40px_-16px_rgba(164,93,68,0.6)] sm:flex">
            <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={2.4} />
            <span className="font-display text-[10.5px] font-bold text-primary-foreground">
              Every hostel manually verified
            </span>
          </div>
        </div>
      ) : (
        <div className="relative animate-in fade-in slide-in-from-right-3 duration-300">
          <div className="overflow-hidden rounded-[22px] border border-border bg-card shadow-[0_44px_90px_-42px_rgba(47,47,47,0.46),0_12px_30px_-18px_rgba(47,47,47,0.16)]">
            <div className="flex items-center gap-2.5 bg-foreground px-4 py-3.5">
              <span className="font-display text-sm font-extrabold text-background">Overview</span>
              <div className="flex-1" />
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-semibold text-[#EBD9C4]">
                This month
              </span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex gap-2.5">
                <div className="flex-1 rounded-xl bg-muted p-3">
                  <div className="mb-1 text-[9px] font-medium text-muted-foreground">Tenants</div>
                  <div className="font-display text-lg font-extrabold text-foreground">128</div>
                </div>
                <div className="flex-[1.35] rounded-xl bg-primary p-3">
                  <div className="mb-1 text-[9px] font-medium text-primary-foreground/80">Collected</div>
                  <div className="font-display text-lg font-extrabold text-primary-foreground">₹2,45,600</div>
                </div>
                <div className="flex-1 rounded-xl bg-muted p-3">
                  <div className="mb-1 text-[9px] font-medium text-muted-foreground">Occupancy</div>
                  <div className="font-display text-lg font-extrabold text-foreground">92%</div>
                </div>
              </div>
              <div className="rounded-[13px] bg-muted p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-display text-[10px] font-bold text-foreground">Collection overview</span>
                  <span className="flex items-center gap-0.5 text-[9px] font-bold text-success">
                    <ArrowUp className="h-2.5 w-2.5" strokeWidth={3} /> 18%
                  </span>
                </div>
                <svg width="100%" height="62" viewBox="0 0 260 62" preserveAspectRatio="none">
                  <polyline
                    points="4,50 44,44 84,46 124,32 164,34 204,20 256,10"
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points="4,50 44,44 84,46 124,32 164,34 204,20 256,10 256,62 4,62"
                    fill="var(--primary)"
                    opacity="0.08"
                    stroke="none"
                  />
                </svg>
              </div>
              <div className="rounded-[13px] border border-border bg-card px-3 py-1.5">
                {OWNER_TENANTS.map((t, i) => (
                  <div
                    key={t.name}
                    className={`flex items-center justify-between py-2 ${i === 0 ? 'border-b border-border/60' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-6 w-6 rounded-full bg-gradient-to-br ${t.swatch}`} />
                      <span className="text-[11.5px] font-semibold text-foreground">{t.name}</span>
                    </div>
                    <span className="flex items-center gap-2">
                      <span className="font-display text-[11px] font-bold text-foreground">{t.amount}</span>
                      <span
                        className={`rounded-md px-2 py-0.5 font-display text-[9px] font-bold ${
                          t.status === 'Paid' ? 'bg-success/10 text-success' : 'bg-secondary text-primary'
                        }`}
                      >
                        {t.status}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="absolute -right-[2%] -top-[4%] hidden items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-2.5 shadow-[0_22px_44px_-18px_rgba(47,47,47,0.32)] sm:flex">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary">
              <ArrowUp className="h-3.5 w-3.5 text-primary" strokeWidth={2.4} />
            </span>
            <div>
              <div className="font-display text-[11px] font-bold text-foreground">Collected today</div>
              <div className="text-[9.5px] font-medium text-success">+ ₹18,400</div>
            </div>
          </div>
          <div className="absolute -bottom-[3%] -left-[3%] hidden items-center gap-2 rounded-xl bg-foreground px-3.5 py-2.5 shadow-[0_20px_40px_-16px_rgba(47,47,47,0.5)] sm:flex">
            <MessageSquare className="h-3.5 w-3.5 text-[#EBD9C4]" strokeWidth={2.2} />
            <span className="font-display text-[10.5px] font-bold text-background">
              Rent reminders sent on WhatsApp
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
