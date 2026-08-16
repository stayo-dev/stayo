import type { ReactNode } from 'react';
import { ADMIN_CARD } from '../theme/palette';

export type DataColumn = { key: string; label: string; width: string };

/**
 * The design's list treatment: a header strip over hairline-separated rows.
 *
 * Header and body share one `grid-template-columns` string so the two can
 * never drift out of alignment — the failure mode of maintaining two parallel
 * width lists.
 */
export function DataTable<T extends { id: string }>({
  columns, rows, renderCell, onRowClick, empty,
}: {
  columns: DataColumn[];
  rows: T[];
  renderCell: (row: T, columnKey: string) => ReactNode;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  const template = columns.map((c) => c.width).join(' ');

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={`${ADMIN_CARD} overflow-hidden`}>
      <div
        className="grid gap-3 border-b border-[#EFE6DA] bg-[#FAF6F1] px-5 py-[13px] text-[10.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((c) => <div key={c.key}>{c.label}</div>)}
      </div>
      {rows.map((row, index) => (
        <div
          key={row.id}
          role={onRowClick ? 'button' : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
          className={`grid items-center gap-3 px-5 py-3.5 ${index > 0 ? 'border-t border-[#F2ECE5]' : ''} ${
            onRowClick ? 'cursor-pointer hover:bg-[#FCFAF7]' : ''
          }`}
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((c) => <div key={c.key} className="min-w-0">{renderCell(row, c.key)}</div>)}
        </div>
      ))}
    </div>
  );
}
