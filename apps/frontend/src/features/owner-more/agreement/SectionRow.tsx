import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { AGREEMENT_VARIABLES, insertToken } from '../config/agreementDraft';
import type { SectionAction, SectionActionId } from './agreementWorkspace';

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
 *
 * ## Why the line controls only appear on the line you are editing
 *
 * Move and delete are per line, and drawing three buttons under every textarea
 * put more chrome on the screen than agreement. They share the disclosure the
 * variable picker already uses — tap a clause, and the tools for that clause
 * appear with it. Every one of them keeps focus (`onMouseDown` preventDefault)
 * so the row does not close underneath the tap.
 */
export function SectionRow({
  title,
  lines,
  open,
  locked = false,
  subtitle,
  dimmed = false,
  actions,
  onToggle,
  onEditLine,
  onAddLine,
  onRemoveLine,
  onMoveLine,
  onRename,
  onAction,
}: {
  title: string;
  lines: string[];
  open: boolean;
  locked?: boolean;
  subtitle?: string;
  /** A section the owner has left out still shows its text, faded. */
  dimmed?: boolean;
  /** From `sectionActions`. Omitted for a locked term, which has none. */
  actions?: SectionAction[];
  onToggle: () => void;
  onEditLine: (index: number, text: string) => void;
  onAddLine?: () => void;
  onRemoveLine?: (index: number) => void;
  onMoveLine?: (index: number, direction: -1 | 1) => void;
  onRename?: (title: string) => void;
  onAction?: (id: SectionActionId) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const refs = useRef<Array<HTMLTextAreaElement | null>>([]);

  /** Put the caret back after React re-renders with a new value or order. */
  const restoreCaret = (index: number, caret?: number) => {
    requestAnimationFrame(() => {
      const node = refs.current[index];
      if (!node) return;
      node.focus();
      const at = caret ?? node.value.length;
      node.setSelectionRange(at, at);
    });
  };

  const applyToken = (index: number, token: string) => {
    const el = refs.current[index];
    if (!el) return;
    const { value, caret } = insertToken(el.value, el.selectionStart ?? el.value.length, token);
    onEditLine(index, value);
    restoreCaret(index, caret);
  };

  /**
   * Moving keeps the clause selected, not the position. Otherwise "move up"
   * could only ever be tapped once — the second tap would move whichever line
   * had slid into the old index.
   */
  const moveLine = (index: number, direction: -1 | 1) => {
    onMoveLine?.(index, direction);
    setEditing(index + direction);
    restoreCaret(index + direction);
  };

  const removeLine = (index: number) => {
    onRemoveLine?.(index);
    // The index now belongs to a different clause, so nothing is selected.
    setEditing(null);
  };

  return (
    <div className={`overflow-hidden rounded-[16px] border border-border bg-card ${dimmed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="block text-[13.5px] font-bold text-foreground">{title}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {lines.length} line{lines.length === 1 ? '' : 's'}
            {subtitle ? ` · ${subtitle}` : ''}
          </span>
        </button>
        {!locked && onAddLine && (
          <button
            type="button"
            onClick={onAddLine}
            aria-label={`Add a line to ${title}`}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-border text-muted-foreground"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
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
          {/* A locked term's heading is fixed, so it is shown but not offered. */}
          {!locked && onRename && (
            <input
              value={title}
              onChange={(e) => onRename(e.target.value)}
              aria-label="Section title"
              className="mb-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-semibold text-foreground outline-none focus:border-primary"
            />
          )}

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
                <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2">
                  <div className="flex flex-wrap gap-1.5">
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

                  {!locked && (onMoveLine || onRemoveLine) && (
                    <div className="flex items-center gap-1">
                      {onMoveLine && (
                        <>
                          <LineButton
                            label="Move this line up"
                            disabled={index === 0}
                            onClick={() => moveLine(index, -1)}
                          >
                            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
                          </LineButton>
                          <LineButton
                            label="Move this line down"
                            disabled={index === lines.length - 1}
                            onClick={() => moveLine(index, 1)}
                          >
                            <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} />
                          </LineButton>
                        </>
                      )}
                      <span className="flex-1" />
                      {onRemoveLine && (
                        <LineButton label="Delete this line" destructive onClick={() => removeLine(index)}>
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                        </LineButton>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {!locked && actions && onAction && actions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    // A confirmation is part of the action's definition, not
                    // the screen's discretion — `sectionActions` sets it on
                    // the one operation that loses text.
                    if (action.confirm && !window.confirm(action.confirm)) return;
                    onAction(action.id);
                  }}
                  className={`flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] font-semibold disabled:opacity-40 ${
                    action.destructive ? 'text-destructive' : 'text-foreground/80'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LineButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card disabled:opacity-40 ${
        destructive ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      {children}
    </button>
  );
}
