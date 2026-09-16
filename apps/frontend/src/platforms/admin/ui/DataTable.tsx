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
  columns, rows, renderCell, onRowClick, empty, renderMobileCard,
}: {
  columns: DataColumn[];
  rows: T[];
  renderCell: (row: T, columnKey: string) => ReactNode;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  /** Full control over the <sm card body for rows with real hierarchy (a status,
   * an amount, secondary meta) that the generic label/value grid flattens into
   * one undifferentiated list. Falls back to that generic grid when omitted. */
  renderMobileCard?: (row: T) => ReactNode;
}) {
  const template = columns.map((c) => c.width).join(' ');

  if (rows.length === 0 && empty) return <>{empty}</>;

  // First column is treated as the row's identity (e.g. "Owner") and gets top
  // billing on the mobile card; columns with no label (e.g. "Actions") run
  // full-width at the card's bottom instead of being squeezed into a label/value pair.
  const [identityCol, ...restCols] = columns;
  const labelledCols = restCols.filter((c) => c.label);
  const unlabelledCols = restCols.filter((c) => !c.label);

  return (
    <div className={`${ADMIN_CARD} overflow-hidden`}>
      {/* ≥sm: the design's grid, columns at their asked-for widths, scrolling
          horizontally on its own below that width so the page never does.
          <sm: a stacked card per row — a horizontally-scrolling multi-column
          grid is unusable at phone width, so mobile gets its own layout below. */}
      <div className="hidden overflow-x-auto sm:block">
        <div className="min-w-max">
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
      </div>
      <div className="sm:hidden">
        {rows.map((row, index) => (
          <div
            key={row.id}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
            className={`px-4 py-3 ${index > 0 ? 'border-t border-[#F2ECE5]' : ''} ${
              onRowClick ? 'cursor-pointer active:bg-[#FCFAF7]' : ''
            }`}
          >
            {renderMobileCard ? (
              renderMobileCard(row)
            ) : (
              <div className="flex flex-col gap-2">
                <div className="min-w-0">{renderCell(row, identityCol.key)}</div>
                {labelledCols.length > 0 && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-[10px] bg-[#FAF6F1] px-2.5 py-2">
                    {labelledCols.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <div className="text-[9px] font-bold uppercase tracking-[.05em] text-[#A2978B]">{c.label}</div>
                        <div className="mt-0.5 text-[12px]">{renderCell(row, c.key)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {unlabelledCols.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {unlabelledCols.map((c) => <div key={c.key} className="min-w-0">{renderCell(row, c.key)}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
