import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import { platformAdminService } from '@features/platform-admin/api';

import { MAX_FEATURED, moveItem } from '../leads/homepageLineup';

/**
 * Which hostels the public homepage shows, and in what order.
 *
 * The line-up is sent wholesale rather than patched per row, so what the admin
 * is looking at is exactly what gets stored — patching one row's position is
 * how orderings develop gaps and duplicates.
 *
 * Only discoverable hostels can be added. A hostel that stops being
 * discoverable after it was curated stays in this list, flagged, rather than
 * vanishing: the homepage already drops it silently, and an admin wondering
 * why the front page is one short needs somewhere to find out.
 */
export function HomepageLineupPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'homepage-features'],
    queryFn: () => platformAdminService.getHomepageFeatures(),
    staleTime: 30_000,
  });

  const [order, setOrder] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!query.data || dirty) return;
    setOrder(query.data.features.map((f) => f.hostel_id));
  }, [query.data, dirty]);

  const byId = useMemo(() => {
    const map = new Map<string, { name: string | null; city: string | null; live: boolean; why: string }>();
    for (const f of query.data?.features ?? []) {
      map.set(f.hostel_id, {
        name: f.name,
        city: f.city,
        live: f.live_on_homepage,
        why: [f.status, f.listing_status, f.verification_status].filter(Boolean).join(' · '),
      });
    }
    for (const c of query.data?.candidates ?? []) {
      if (!map.has(c.id)) map.set(c.id, { name: c.name, city: c.city, live: true, why: '' });
    }
    return map;
  }, [query.data]);

  const save = useMutation({
    mutationFn: (ids: string[]) => platformAdminService.setHomepageFeatures(ids),
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'homepage-features'] });
    },
  });

  const candidates = (query.data?.candidates ?? []).filter((c) => !order.includes(c.id));
  const full = order.length >= MAX_FEATURED;

  const update = (next: string[]) => {
    setOrder(next);
    setDirty(true);
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <h1 className="text-[20px] font-bold text-[#2A2521]">Homepage line-up</h1>
      <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-[#6E645B]">
        The hostels the public homepage shows, in this order. Leave it empty and the homepage falls back to the
        recommended sort — it never goes blank. At most {MAX_FEATURED}.
      </p>

      {query.isLoading && <p className="mt-6 text-[13px] text-[#9A8F84]">Loading…</p>}

      {query.data && (
        <>
          <ol className="mt-6 flex flex-col gap-2">
            {order.length === 0 && (
              <li className="rounded-[12px] border border-dashed border-[#E0D4C6] px-4 py-6 text-center text-[13px] text-[#9A8F84]">
                Nothing curated. The homepage is showing the recommended sort.
              </li>
            )}
            {order.map((id, index) => {
              const info = byId.get(id);
              return (
                <li key={id} className="flex items-center gap-3 rounded-[12px] border border-[#EADCCD] bg-white px-4 py-3">
                  <span className="w-5 flex-none text-[12px] font-bold text-[#9A8F84]">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-[#2A2521]">{info?.name ?? id}</div>
                    <div className="truncate text-[11.5px] text-[#9A8F84]">
                      {info?.city ?? '—'}
                      {info && !info.live && (
                        <span className="ml-2 rounded-full bg-[#FBE9E4] px-2 py-[1px] font-bold text-[#A33F2C]">
                          not showing{info.why ? ` · ${info.why}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => update(moveItem(order, index, index - 1))}
                    className="rounded-[8px] border border-[#EADCCD] p-1.5 disabled:opacity-35"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={index === order.length - 1}
                    onClick={() => update(moveItem(order, index, index + 1))}
                    className="rounded-[8px] border border-[#EADCCD] p-1.5 disabled:opacity-35"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove from homepage"
                    onClick={() => update(order.filter((x) => x !== id))}
                    className="rounded-[8px] border border-[#EADCCD] p-1.5"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="mt-6">
            <h2 className="text-[13px] font-bold text-[#2A2521]">Add a hostel</h2>
            <p className="mt-1 text-[11.5px] text-[#9A8F84]">
              Only verified, live, admissions-open hostels can be featured.
            </p>
            {candidates.length === 0 && <p className="mt-3 text-[12.5px] text-[#9A8F84]">Nothing left to add.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={full}
                  onClick={() => update([...order, c.id])}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#EADCCD] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#2A2521] disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                  {c.name}
                </button>
              ))}
            </div>
            {full && <p className="mt-2 text-[11.5px] text-[#A33F2C]">The line-up is full at {MAX_FEATURED}.</p>}
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(order)}
              className="h-10 rounded-[10px] bg-[#2A2521] px-5 text-[13px] font-bold text-white disabled:opacity-40"
            >
              {save.isPending ? 'Saving…' : 'Save line-up'}
            </button>
            {dirty && <span className="text-[12px] text-[#9A8F84]">Unsaved changes</span>}
            {save.isError && <span className="text-[12px] font-semibold text-[#A33F2C]">That didn’t save. Try again.</span>}
            {save.isSuccess && !dirty && <span className="text-[12px] font-semibold text-[#3F6B50]">Saved.</span>}
          </div>
        </>
      )}
    </div>
  );
}
