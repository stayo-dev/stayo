import { useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { AGREEMENT_VARIABLES, insertToken } from '../config/agreementDraft';

/**
 * One section of the agreement, open or closed.
 *
 * Two things this fixes from the editor it replaces:
 *
 * - **Lines commit on `onChange`, not `onBlur`.** Tapping straight from one
 *   line to another used to drop the edit that was in progress.
 * - **The variable picker no longer reaches through the DOM.** It used to find
 *   its own textarea with `closest('div')?.parentElement?.querySelector(…)` and
 *   assign `el.value` directly, so React state and the DOM disagreed until blur.
 *   It now uses a ref and the pure `insertToken`.
 *
 * `locked` renders a fixed-heading commercial term: the body is editable, and
 * the controls that would delete, rename or reorder it **do not exist** rather
 * than existing and refusing.
 */
export function SectionRow({
  title,
  lines,
  open,
  locked = false,
  subtitle,
  onToggle,
  onEditLine,
  onOverflow,
}: {
  title: string;
  lines: string[];
  open: boolean;
  locked?: boolean;
  subtitle?: string;
  onToggle: () => void;
  onEditLine: (index: number, text: string) => void;
  onOverflow?: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const refs = useRef<Array<HTMLTextAreaElement | null>>([]);

  const applyToken = (index: number, token: string) => {
    const el = refs.current[index];
    if (!el) return;
    const { value, caret } = insertToken(el.value, el.selectionStart ?? el.value.length, token);
    onEditLine(index, value);
    // Restore the caret after React re-renders with the new value.
    requestAnimationFrame(() => {
      const node = refs.current[index];
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-card">
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="block text-[13.5px] font-bold text-foreground">{title}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {lines.length} line{lines.length === 1 ? '' : 's'}
            {subtitle ? ` · ${subtitle}` : ''}
          </span>
        </button>
        {!locked && onOverflow && (
          <button
            type="button"
            onClick={onOverflow}
            aria-label={`More actions for ${title}`}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-border text-muted-foreground"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
        <button type="button" onClick={onToggle} aria-label={open ? 'Collapse' : 'Expand'} className="flex-none">
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground/60 transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={2}
          />
        </button>
      </div>

      {open && (
        <div className="border-t border-border/60 px-4 py-3">
          {lines.map((line, index) => (
            <div key={index} className="mb-2.5 rounded-xl bg-secondary/60 p-2.5">
              <textarea
                ref={(node) => { refs.current[index] = node; }}
                value={line}
                rows={3}
                onFocus={() => setEditing(index)}
                onChange={(e) => onEditLine(index, e.target.value)}
                placeholder="Write this clause…"
                className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.55] text-foreground outline-none focus:border-primary"
              />

              {editing === index && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                  {AGREEMENT_VARIABLES.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyToken(index, v.token)}
                      className="rounded-full bg-primary/10 px-2.5 py-1 text-[10.5px] font-semibold text-primary"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
