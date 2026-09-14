import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, MoreHorizontal, Printer } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { parseApiError } from '@lib/errors';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { HostelSwitcher } from '@features/owner-food/components/HostelSwitcher';
import { stayApi } from '@features/stay/api';
import { ReturnDateSheet } from '@features/stay/components/ReturnDateSheet';
import {
  boardHeadline, boardSections, MORE_ACTION_LABEL, roomLines,
  type BoardRow, type BoardSection, type ReturnDateMode,
} from '@features/stay/stayState';
import type { StayEventInput } from '@features/stay/types';
import { useOwnerStayAction, useStayBoard } from '../hooks/useStay';

/**
 * `/owner/stay` — "How is my hostel tonight?" answered: how many are here,
 * how many meals, who is late, who is back today, which rooms need a look.
 * Each person has one action; edits live behind that row's More. The hostel
 * rides on `?hostelId=` like the kitchen sheet — never "the first hostel".
 * See ADR-193.
 */
export function StayBoardPage() {
  const session = useOwnerSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostelId = searchParams.get('hostelId') ?? session.primaryHostelId;
  const hostelName = session.hostels.find((h) => h.id === hostelId)?.name ?? 'Hostel';
  const boardQuery = useStayBoard(hostelId);
  const action = useOwnerStayAction(hostelId);
  const [dateSheet, setDateSheet] = useState<{ row: BoardRow; mode: ReturnDateMode } | null>(null);
  const [moreFor, setMoreFor] = useState<BoardRow | null>(null);
  const [downloading, setDownloading] = useState(false);
  const board = boardQuery.data;

  const send = async (row: BoardRow, input: Omit<StayEventInput, 'idempotencyKey'>, done: string) => {
    try {
      await action.mutateAsync({ tenantId: row.tenantId, input: { ...input, idempotencyKey: crypto.randomUUID() } });
      stayoToast.success(done);
    } catch (error) {
      stayoToast.error(parseApiError(error) || 'Could not update. Try again.');
    }
  };

  const onPrimary = (row: BoardRow) => {
    if (row.primary === 'MARK_BACK') void send(row, { type: 'RETURNED' }, `${row.name} is back`);
    else if (row.primary === 'PUT_ON_LEAVE') setDateSheet({ row, mode: 'GOING_HOME' });
  };

  const onMoreChoice = (row: BoardRow, choice: 'CHANGE_DATE' | 'CANCEL_LEAVE') => {
    setMoreFor(null);
    if (choice === 'CANCEL_LEAVE') void send(row, { type: 'LEAVE_CANCELLED' }, `${row.name}'s leave cancelled`);
    else setDateSheet({ row, mode: 'CHANGE_DATE' });
  };

  const onPickDate = (date: string) => {
    const pending = dateSheet;
    setDateSheet(null);
    if (!pending) return;
    if (pending.mode === 'CHANGE_DATE') {
      void send(pending.row, { type: 'RETURN_DATE_CHANGED', expectedReturnDate: date }, 'New return date saved');
    } else {
      void send(pending.row, { type: 'LEAVE_STARTED', leaveType: pending.mode, expectedReturnDate: date }, `${pending.row.name} is on leave`);
    }
  };

  // A designed PDF, not window.print() — same reasoning as the kitchen sheet (ADR-144).
  const downloadPoster = async () => {
    if (!hostelId || downloading) return;
    setDownloading(true);
    try {
      const { blob, filename } = await stayApi.downloadPoster(hostelId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      stayoToast.error(parseApiError(error) || 'Could not build the QR poster.');
    } finally {
      setDownloading(false);
    }
  };

  const sections = board ? boardSections(board) : [];
  const urgent = sections.filter((s) => s.id === 'late' || s.id === 'back-today');
  const calm = sections.filter((s) => s.id === 'away' || s.id === 'here');
  const rooms = board ? roomLines(board) : [];
  const headline = board ? boardHeadline(board) : null;

  const renderSection = (section: BoardSection) => {
    const list = (
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {section.rows.map((row) => (
          <li key={row.tenantId} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-foreground">{row.name}</p>
              <p className="text-[12.5px] text-muted-foreground">
                Room {row.roomNo}
                {row.detail ? ` · ${row.detail}` : ''}
              </p>
            </div>
            {row.primary && (
              <button
                type="button"
                disabled={action.isPending}
                onClick={() => onPrimary(row)}
                className="h-10 flex-none rounded-xl bg-primary px-3.5 text-[13px] font-bold text-primary-foreground disabled:opacity-60"
              >
                {row.primary === 'MARK_BACK' ? 'Mark back' : 'Put on leave'}
              </button>
            )}
            {row.more.length > 0 && (
              <button
                type="button"
                aria-label={`More for ${row.name}`}
                onClick={() => setMoreFor(row)}
                className="flex h-10 w-10 flex-none items-center justify-center rounded-xl text-muted-foreground"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    );
    const title = (
      <span className={`text-xs font-bold uppercase tracking-wider ${section.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground'}`}>
        {section.title}
      </span>
    );
    return section.collapsed ? (
      <details key={section.id} className="flex flex-col gap-2">
        <summary className="cursor-pointer list-none py-1">{title}</summary>
        <div className="mt-2">{list}</div>
      </details>
    ) : (
      <section key={section.id} className="flex flex-col gap-2">
        {title}
        {list}
      </section>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pb-24 pt-4 sm:px-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tonight</p>
          <h1 className="truncate font-display text-2xl font-extrabold text-foreground">{hostelName}</h1>
        </div>
        <HostelSwitcher
          hostels={session.hostels}
          selectedId={hostelId}
          onSelect={(id) =>
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set('hostelId', id);
                return next;
              },
              { replace: true },
            )
          }
        />
      </header>

      {!board || !headline ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : board.residents === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-[15px] text-muted-foreground">
          No one is living here yet. Once residents move in, tonight's picture appears here.
        </p>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="font-display text-4xl font-extrabold tabular-nums tracking-tight text-foreground">{headline.here}</p>
            <p className="mt-1 text-[15px] text-foreground">{headline.meals}</p>
            <p className="text-[13px] text-muted-foreground">{headline.beds} · based on who's staying</p>
          </section>

          {urgent.map(renderSection)}

          {rooms.length > 0 && (
            <section className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Rooms to check</span>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                {rooms.map((room) => (
                  <li key={room.roomId} className="px-4 py-3">
                    <p className="text-[15px] font-semibold text-foreground">{room.text}</p>
                    <p className="text-[12.5px] text-muted-foreground">{room.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {calm.map(renderSection)}
        </>
      )}

      <button
        type="button"
        onClick={downloadPoster}
        disabled={!hostelId || downloading}
        className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card text-[14px] font-semibold text-foreground disabled:opacity-60"
      >
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
        Print hostel QR
      </button>

      {dateSheet && board && (
        <ReturnDateSheet
          mode={dateSheet.mode}
          suggested={board.suggestedReturn}
          minDate={board.minReturnDate}
          maxDate={board.maxReturnDate}
          onPick={onPickDate}
          onClose={() => setDateSheet(null)}
        />
      )}

      {moreFor && (
        <BottomSheet open onOpenChange={(open) => !open && setMoreFor(null)} title={moreFor.name}>
          <div className="flex flex-col gap-2 pb-2">
            {moreFor.more.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => onMoreChoice(moreFor, choice)}
                className="h-12 w-full rounded-xl border border-border bg-card text-[15px] font-semibold text-foreground"
              >
                {MORE_ACTION_LABEL[choice]}
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
