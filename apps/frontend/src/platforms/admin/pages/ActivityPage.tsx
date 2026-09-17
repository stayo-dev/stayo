import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { EmptyState } from '../ui';
import { ADMIN_CARD } from '../theme/palette';
import { toManagerRows } from '../managers/managerRows';
import {
  describeAction,
  describeChangedFields,
  formatActivityTimestamp,
  cleanActivityFilters,
  type ActivityFilters,
} from '../activity/activityView';

const selectClass =
  'rounded-xl border border-border bg-white px-3 py-2 text-[12.5px] font-semibold text-[#2A2521] outline-none';

/**
 * Super Admin's manager-activity feed (ADR-212, spec §9). ADMIN-only route.
 * Reads `GET /api/platform-admin/activity`, which itself reads the same
 * `activity_logs` table (and `metadata.hostel_id` convention) the
 * owner-facing hostel activity feed already uses — no separate audit store.
 */
export function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilters>({});

  const managers = useQuery({
    queryKey: ['admin', 'managers', 'all-for-activity-filter'],
    queryFn: () => platformAdminService.getManagers(),
    staleTime: 60_000,
  });
  const managerRows = toManagerRows(managers.data ?? []);

  const hostels = useQuery({
    queryKey: ['admin', 'hostels', 'all-for-activity-filter'],
    queryFn: () => platformAdminService.getHostels(),
    staleTime: 60_000,
  });
  const hostelById = new Map((hostels.data ?? []).map((h: any) => [String(h.id), h]));

  const activity = useQuery({
    queryKey: ['admin', 'activity', filters],
    queryFn: () => platformAdminService.getManagerActivity(cleanActivityFilters(filters)),
    staleTime: 10_000,
  });

  const set = (patch: Partial<ActivityFilters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <div className="flex flex-wrap gap-2.5">
        <select className={selectClass} value={filters.managerId ?? ''} onChange={(e) => set({ managerId: e.target.value })}>
          <option value="">All managers</option>
          {managerRows.map((m) => (
            <option key={m.id} value={m.profileId}>
              {m.name}
            </option>
          ))}
        </select>
        <select className={selectClass} value={filters.hostelId ?? ''} onChange={(e) => set({ hostelId: e.target.value })}>
          <option value="">All hostels</option>
          {(hostels.data ?? []).map((h: any) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <input
          className={selectClass}
          value={filters.actionType ?? ''}
          onChange={(e) => set({ actionType: e.target.value })}
          placeholder="Action (e.g. HOSTEL_UPDATED)"
        />
        <input
          className={selectClass}
          type="date"
          value={filters.from ?? ''}
          onChange={(e) => set({ from: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
        />
        <input
          className={selectClass}
          type="date"
          value={filters.to ?? ''}
          onChange={(e) => set({ to: e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : undefined })}
        />
        {(filters.managerId || filters.hostelId || filters.actionType || filters.from || filters.to) && (
          <button type="button" onClick={() => setFilters({})} className="text-[12px] font-semibold text-[#B46A55]">
            Clear filters
          </button>
        )}
      </div>

      {activity.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading activity…</div>
      ) : activity.isError ? (
        <EmptyState title="Couldn't load activity" message="The request failed. Refresh to try again." />
      ) : (activity.data ?? []).length === 0 ? (
        <EmptyState title="No activity yet" message="Manager actions on hostels appear here automatically as they happen." />
      ) : (
        <div className={`${ADMIN_CARD} overflow-hidden`}>
          {(activity.data ?? []).map((entry, index) => {
            const { time, date } = formatActivityTimestamp(entry.timestamp);
            const hostel = entry.hostelId ? hostelById.get(entry.hostelId) : null;
            const changed = describeChangedFields(entry.metadata?.changed_fields);
            return (
              <div key={entry.id} className={`px-5 py-3.5 ${index > 0 ? 'border-t border-[#F2ECE5]' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#2A2521]">
                      {entry.actorName ?? 'Unknown'}
                      <span className="ml-2 font-normal text-[#8A7F75]">{describeAction(entry.actionType)}</span>
                    </div>
                    {hostel && <div className="mt-0.5 text-[12px] text-[#9A8F84]">{hostel.name}</div>}
                    {changed.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-0.5">
                        {changed.map((line) => (
                          <li key={line} className="text-[11.5px] text-[#5A5147]">{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex-none text-right">
                    <div className="text-[12px] font-semibold text-[#2A2521]">{time}</div>
                    <div className="text-[10.5px] text-[#A2978B]">{date}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
