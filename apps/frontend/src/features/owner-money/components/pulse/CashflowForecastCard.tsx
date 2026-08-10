import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ForecastDay {
  label: string;
  value: string;
  amount: number;
}

interface CashflowForecastCardProps {
  forecast: ForecastDay[];
}

/**
 * Cashflow forecast chart with weekly page navigation.
 *
 * Renders one 7-day bar chart per page. The owner can swipe left/right
 * (touch), use chevron buttons, or snap-scroll (desktop) to move between
 * weeks. The most recent week (rightmost page) is shown first; earlier
 * weeks sit to the left.
 */
export function CashflowForecastCard({ forecast }: CashflowForecastCardProps) {
  /** Split forecast into 7-day pages, oldest first. */
  const pages = useMemo(() => {
    const result: ForecastDay[][] = [];
    for (let i = 0; i < forecast.length; i += 7) {
      result.push(forecast.slice(i, i + 7));
    }
    return result.length > 0 ? result : [[]] as ForecastDay[][];
  }, [forecast]);

  const totalPages = pages.length;
  const [activePage, setActivePage] = useState(totalPages - 1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to the last page (current week) on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
    setActivePage(totalPages - 1);
  }, [totalPages]);

  // Observe which page is snapped into view
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const pageWidth = el.clientWidth;
      if (pageWidth === 0) return;
      const idx = Math.round(el.scrollLeft / pageWidth);
      setActivePage(Math.min(Math.max(idx, 0), totalPages - 1));
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [totalPages]);

  const goToPage = useCallback((idx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = Math.min(Math.max(idx, 0), totalPages - 1);
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
  }, [totalPages]);

  const currentPage = pages[activePage] ?? [];
  const weekLabel = useMemo(() => {
    if (activePage === totalPages - 1) return 'This week';
    const diff = totalPages - 1 - activePage;
    return diff === 1 ? 'Last week' : `${diff} weeks ago`;
  }, [activePage, totalPages]);

  // Global max across ALL pages for consistent bar heights
  const globalMax = useMemo(() => Math.max(1, ...forecast.map((b) => b.amount)), [forecast]);

  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center justify-between">
        <span className="font-display text-[13.5px] font-bold text-foreground">Cashflow forecast</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => goToPage(activePage - 1)}
            disabled={activePage === 0}
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[76px] text-center text-[11px] font-semibold text-muted-foreground">
            {weekLabel}
          </span>
          <button
            type="button"
            onClick={() => goToPage(activePage + 1)}
            disabled={activePage === totalPages - 1}
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
            aria-label="Next week"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Horizontally-scrollable page container with snap */}
      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {pages.map((page, pageIdx) => {
          const pageTotal = page.reduce((s, d) => s + d.amount, 0);
          return (
            <div
              key={pageIdx}
              className="flex w-full flex-none snap-center flex-col gap-1"
            >
              <div className="flex h-16 items-end gap-1.5 pt-0.5">
                {page.map((b) => (
                  <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <span className="whitespace-nowrap text-[9.5px] font-bold text-primary">{b.value}</span>
                    <div
                      className="w-full rounded-t-md bg-primary/70 transition-all duration-300"
                      style={{ height: `${Math.max(2, (b.amount / globalMax) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                {page.map((b) => (
                  <span key={b.label} className="flex-1 text-center text-[9.5px] font-medium text-muted-foreground">
                    {b.label}
                  </span>
                ))}
              </div>
              <div className="mt-0.5 text-center text-[10px] font-semibold text-muted-foreground/70">
                Week total: <span className="text-foreground">₹{Math.round(pageTotal).toLocaleString('en-IN')}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dot indicators */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-0.5">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goToPage(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === activePage ? 'w-4 bg-primary' : 'w-1.5 bg-border'
              }`}
              aria-label={`Week ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
