import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { summarise, type Issue } from './stepIssues';
import { isComfortablyVisible, revealScrollTop } from './revealTarget';
import { FLOW_INK } from '../skyTheme';

/**
 * Guiding a tenant to whatever is still missing, instead of leaving them at a
 * button that does nothing.
 *
 * The rule this whole file exists to enforce: **a step's primary action is
 * never disabled for a validation reason.** A disabled button gives no reason
 * and no next move — at the scale this flow runs at, that is a support call.
 * Tapping it while something is outstanding marks every outstanding thing,
 * scrolls to the first, focuses it and pulses it once.
 *
 * Fields are anchored by id through `useFieldGuidance`, not by CSS selector, so
 * a renamed class can never silently break the jump (same reasoning as
 * `shared/ui-patterns/Spotlight`).
 *
 * Nothing is marked until the tenant has actually tried to continue: red ink
 * on a field someone has not reached yet reads as being told off mid-form.
 * After that first blocked attempt, marks update live as each thing is fixed,
 * so the list only ever shrinks.
 *
 * Accessibility: the marked control carries `aria-invalid` and points at its
 * message through `aria-describedby`, every message pairs its colour with an
 * icon and words (never colour alone), and the count is announced politely.
 */

type GuidanceValue = {
  /** Outstanding items, in screen order. Empty until the tenant tries to continue. */
  shown: Issue[];
  issueFor: (field: string) => Issue | undefined;
  anchor: (field: string) => (el: HTMLElement | null) => void;
  reveal: (field: string) => void;
  /**
   * Marks everything outstanding and jumps to the first. Returns true when the
   * caller should stop — i.e. there is something to fix.
   */
  block: () => boolean;
  attention: string | null;
};

const noop: GuidanceValue = {
  shown: [],
  issueFor: () => undefined,
  anchor: () => () => {},
  reveal: () => {},
  block: () => false,
  attention: null,
};

const GuidanceContext = createContext<GuidanceValue>(noop);

/** How long the ring pulses. Long enough to catch the eye, short enough not to nag. */
const ATTENTION_MS = 1600;
/**
 * How many shortcuts the summary lists before it just counts the rest. A tenant
 * who has opened an empty form does not need eight chips — they need the first
 * one and a sense of how far there is to go.
 */
const MAX_CHIPS = 4;

/**
 * Fallback height of the sticky action bar, used only if it cannot be measured.
 * It is measured in practice, because the summary sits inside it and makes it
 * taller — guess low and the field lands behind the very list pointing at it.
 */
const ACTION_BAR_FALLBACK = 116;
/** A little air above the field; the fixed error banner also lives up there. */
const TOP_INSET = 12;
/** Extra scrolling room at the end of a step while the summary is on screen. */
const SUMMARY_SPACER = 136;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * What to focus for a field: the control the tenant would edit, or the field
 * itself when that control cannot take focus.
 *
 * The photo picker and every document row are a visible label wrapping a
 * `display:none` file input. Focusing that input silently does nothing —
 * focus stays on `<body>`, so a keyboard or screen-reader user is sent
 * nowhere. Those fall back to the container, made focusable just in time, so
 * the message is announced and the ring has something to sit on.
 */
function focusTarget(el: HTMLElement): HTMLElement {
  const candidate = el.matches('input, select, textarea, button')
    ? el
    : el.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])');
  // offsetParent is null for a hidden element; such a control cannot be focused.
  if (candidate && candidate.offsetParent !== null) return candidate;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  return el;
}

export function Guidance({ issues, children }: { issues: Issue[]; children: ReactNode }) {
  const [attempted, setAttempted] = useState(false);
  const [attention, setAttention] = useState<string | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const attentionTimer = useRef<number | undefined>(undefined);

  const shown = attempted ? issues : [];

  const anchor = useCallback(
    (field: string) => (el: HTMLElement | null) => {
      if (el) anchors.current.set(field, el);
      else anchors.current.delete(field);
    },
    [],
  );

  const reveal = useCallback((field: string) => {
    const el = anchors.current.get(field);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const bar = document.querySelector('[data-step-action-bar]');
    const metrics = {
      fieldTop: rect.top + window.scrollY,
      fieldHeight: rect.height,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      topInset: TOP_INSET,
      bottomInset: bar ? bar.getBoundingClientRect().height : ACTION_BAR_FALLBACK,
      maxScroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    };
    const reduced = prefersReducedMotion();
    if (!isComfortablyVisible(metrics)) {
      window.scrollTo({ top: revealScrollTop(metrics), behavior: reduced ? 'auto' : 'smooth' });
    }
    // preventScroll: the scroll above is already going where we want; letting
    // focus scroll too fights it and lands somewhere else.
    focusTarget(el).focus({ preventScroll: true });

    window.clearTimeout(attentionTimer.current);
    setAttention(field);
    attentionTimer.current = window.setTimeout(() => setAttention(null), ATTENTION_MS);
  }, []);

  const block = useCallback(() => {
    if (issues.length === 0) return false;
    setAttempted(true);
    // Let React commit the marks before measuring: a field's message changes
    // its height, so measuring first lands the scroll slightly off. A timeout
    // rather than requestAnimationFrame — rAF does not run in a background or
    // otherwise non-rendering tab, and this must not silently do nothing.
    window.setTimeout(() => reveal(issues[0].field), 0);
    return true;
  }, [issues, reveal]);

  const value = useMemo<GuidanceValue>(
    () => ({
      shown,
      issueFor: (field) => shown.find((i) => i.field === field),
      anchor,
      reveal,
      block,
      attention,
    }),
    [shown, anchor, reveal, block, attention],
  );

  return (
    <GuidanceContext.Provider value={value}>
      {children}
      {/*
       * The summary makes the sticky action bar taller than the 108px the step
       * body reserves for it, and the last field on a step is often the one
       * being pointed at — without this the page cannot scroll far enough to
       * lift it clear, and the list ends up covering the field it names.
       */}
      {shown.length > 0 && <div aria-hidden style={{ height: SUMMARY_SPACER }} />}
      {/* Politely announced, so a screen-reader user hears the count change as they fix things. */}
      <p role="status" aria-live="polite" className="sr-only">
        {summarise(shown)}
      </p>
    </GuidanceContext.Provider>
  );
}

export function useGuidance(): GuidanceValue {
  return useContext(GuidanceContext);
}

/**
 * Everything a field needs to mark itself: `ref` to be found and scrolled to,
 * `issue` to render, and the ARIA wiring that ties the two together.
 */
export function useFieldGuidance(field: string) {
  const { anchor, issueFor, attention } = useGuidance();
  const issue = issueFor(field);
  const messageId = `guide-${field.replace(/[^a-zA-Z0-9]/g, '-')}`;
  return {
    ref: anchor(field),
    issue,
    invalid: Boolean(issue),
    messageId,
    /** Spread onto the control itself. */
    aria: issue ? ({ 'aria-invalid': true, 'aria-describedby': messageId } as const) : {},
    /** Pulses once when this field is the one being pointed at. */
    className: attention === field ? 'ob-attention' : '',
  };
}

/** The message under a field. Icon + words, so colour is never the only signal (WCAG 1.4.1). */
export function GuidanceNote({ field }: { field: string }) {
  const { issueFor } = useGuidance();
  const issue = issueFor(field);
  if (!issue) return null;
  return (
    <div id={`guide-${field.replace(/[^a-zA-Z0-9]/g, '-')}`} className="ob-up-fast mt-1.5 flex items-start gap-1.5 text-[11.5px] font-semibold leading-snug" style={{ color: '#A3372C' }}>
      <AlertCircle className="mt-px h-3.5 w-3.5 flex-none" strokeWidth={2.2} />
      <span>{issue.message}</span>
    </div>
  );
}

/**
 * What is left, above the action bar — the tenant's map out of the step.
 *
 * Framed as progress ("2 things left"), not as errors: the goal-gradient
 * effect is real, and a tenant who has filled ten fields correctly should not
 * be told they have made two mistakes. Each chip jumps to its field, so the
 * list is a set of shortcuts rather than a scolding.
 */
export function GuidanceSummary() {
  const { shown, reveal } = useGuidance();
  if (shown.length === 0) return null;

  return (
    <div
      className="ob-up-fast mb-2 rounded-[14px] border px-3 py-2.5"
      style={{ background: '#FCEFEC', borderColor: 'rgba(163,55,44,.22)' }}
    >
      <div className="flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 flex-none" style={{ color: '#A3372C' }} strokeWidth={2.2} />
        <span className="text-[12px] font-extrabold" style={{ color: '#A3372C' }}>
          {summarise(shown)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {shown.slice(0, MAX_CHIPS).map((issue) => (
          <button
            key={issue.field}
            type="button"
            onClick={() => reveal(issue.field)}
            // min-h-8 keeps every chip a comfortable tap target on a phone.
            className="inline-flex min-h-8 items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[11.5px] font-bold"
            style={{ borderColor: 'rgba(163,55,44,.24)', color: FLOW_INK.title }}
          >
            {issue.label}
            <ArrowRight className="h-3 w-3" style={{ color: '#A3372C' }} />
          </button>
        ))}
        {shown.length > MAX_CHIPS && (
          <span className="text-[11.5px] font-bold" style={{ color: '#A3372C' }}>
            +{shown.length - MAX_CHIPS} more
          </span>
        )}
      </div>
    </div>
  );
}
