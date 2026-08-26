import { useState } from 'react';
import { StickyNote, Plus, Trash2 } from 'lucide-react';
import { useTenantNotes } from '../hooks/useTenantNotes';

/**
 * Owner-private notes.
 *
 * `useTenantNotes` and its GET/POST/DELETE API have both existed for a while;
 * this page rendered the composer with no `onClick` on the add button and a
 * hardcoded "No private notes yet." beneath it, so an owner could type a note,
 * press the button, and watch nothing happen — including the note they'd
 * written, which the input kept until they navigated away.
 */

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PrivateNotesCard({ tenantId }: { tenantId: string }) {
  const { notes, isLoading, addNote, deleteNote } = useTenantNotes(tenantId);
  const [draft, setDraft] = useState('');

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !addNote.isPending;

  const submit = () => {
    if (!canSubmit) return;
    // Cleared only once the write succeeds — losing a typed note to a failed
    // request is exactly the silent data loss this card used to guarantee.
    addNote.mutate(trimmed, { onSuccess: () => setDraft('') });
  };

  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <span className="font-display text-sm font-extrabold text-foreground">Private Notes</span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-muted-foreground">
          OWNER ONLY
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Add an owner-private note…"
          aria-label="Add an owner-private note"
          className="min-w-0 flex-1 rounded-[11px] border border-border bg-muted px-3.5 py-2.5 text-[12.5px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          aria-label="Add note"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
        </button>
      </div>

      {addNote.isError && (
        <p className="text-[11px] font-semibold text-destructive">
          Couldn’t save that note. Your text is still here — try again.
        </p>
      )}

      {isLoading ? (
        <div className="h-10 animate-pulse rounded-[11px] bg-muted" />
      ) : notes.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          No private notes yet. Notes are only visible to you and co-owners.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start gap-2.5 rounded-[11px] bg-muted/50 p-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground">
                  {note.content}
                </p>
                <p className="mt-1 text-[10.5px] text-muted-foreground">{formatWhen(note.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => deleteNote.mutate(note.id)}
                disabled={deleteNote.isPending}
                aria-label="Delete note"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
