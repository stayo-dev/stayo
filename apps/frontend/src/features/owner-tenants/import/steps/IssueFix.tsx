import { Check } from 'lucide-react';
import type { RowIssue, QueueRow } from '../reviewQueue';
import { controlFor } from '../issueCopy';
import { isEdited, valueFor, type RowEdits } from '../rowEdits';

interface IssueFixProps {
  row: QueueRow;
  issue: RowIssue;
  edits: RowEdits;
  onEdit: (row: number, field: string, value: string) => void;
  onAcknowledge: (code: string) => void;
}

/**
 * The control that sits under an error, so the owner can fix it here.
 *
 * Most of what an import gets wrong is small — a digit missing from a phone, a
 * room from the wrong hostel, a date the spreadsheet mangled. Sending someone
 * back to Excel for those turns a five-minute job into an afternoon.
 *
 * The field shown is the one the backend named in the issue, so the control
 * always matches the sentence above it. A field the owner has already changed
 * says so, because the issue list does not move until the next re-check and a
 * row they have just fixed should stop shouting at them.
 */
export function IssueFix({ row, issue, edits, onEdit, onAcknowledge }: IssueFixProps) {
  const control = controlFor(issue);
  const field = control.field;
  const touched = isEdited(edits, row, field);

  if (control.kind === 'acknowledge') {
    return (
      <button
        type="button"
        onClick={() => onAcknowledge(issue.code)}
        className="mt-2 ml-5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-bold text-foreground"
      >
        {control.label}
      </button>
    );
  }

  if (control.kind === 'link' || control.kind === 'skip' || !field) {
    return null;
  }

  const value = valueFor(edits, row, field);
  const inputClass =
    'w-full rounded-lg border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
    (touched ? 'border-primary' : 'border-border');

  return (
    <div className="mt-2 pl-5">
      <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
        {control.label}
        {touched && (
          <span className="flex items-center gap-0.5 text-primary">
            <Check className="h-3 w-3" strokeWidth={3} />
            changed
          </span>
        )}
      </label>

      <div className="mt-1">
        {control.kind === 'room' || control.kind === 'option' ? (
          <select
            value={value}
            onChange={(e) => onEdit(row.row, field, e.target.value)}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {/* What the sheet already had, so the owner can see it was kept. */}
            {value && !control.options.includes(value) && <option value={value}>{value}</option>}
            {control.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : control.kind === 'date' ? (
          <input
            type="date"
            value={toDateInput(value)}
            onChange={(e) => onEdit(row.row, field, e.target.value)}
            className={inputClass}
          />
        ) : (
          <input
            type="text"
            inputMode={field === 'phone' ? 'numeric' : undefined}
            value={value}
            onChange={(e) => onEdit(row.row, field, e.target.value)}
            className={inputClass}
          />
        )}
      </div>
    </div>
  );
}

/**
 * `<input type="date">` speaks ISO only. The sheet may hold DD/MM/YYYY or an
 * Excel serial, so anything else is left blank rather than shown wrong — the
 * owner picks the date they meant, and the browser renders it in their own
 * format.
 */
function toDateInput(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}
