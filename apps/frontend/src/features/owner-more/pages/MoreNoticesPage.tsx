import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, CalendarDays, Trash2, Plus } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { hostelContentService } from '@features/hostel-content/api';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';

const card = 'overflow-hidden rounded-[14px] border border-border bg-card';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
const inputStyle =
  'w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';
const primaryBtn =
  'rounded-xl bg-primary py-3 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50';

/**
 * Hostel → Settings → Notices. Owner-authored content shown on the tenant Home
 * tab: announcements (title/body) and upcoming events (title/date). Real data
 * via `hostelContentService` (`/api/announcements`, `/api/hostel-events`).
 *
 * **Moved here from the owner's Profile, where it was wrong twice over.** It
 * read `session.primaryHostelId` to decide which hostel it was posting to, so
 * an owner with two hostels announced a water cut to whichever hostel happened
 * to be first — with nothing on the screen naming it. It now takes the hostel
 * from the route via `useConfiguredHostelId`, the same way every other
 * per-hostel settings screen does, and it is reached from that hostel's own
 * Settings tab rather than from a screen about the owner's account.
 *
 * **List first.** Two creation forms used to sit permanently above their
 * lists, so an owner opening this screen to check *what did I already post*
 * scrolled past eleven empty inputs to find out. Posting is the rarer act; the
 * forms moved into sheets behind two buttons, and what is currently posted is
 * now the page.
 */
export function MoreNoticesPage() {
  const hostelId = useConfiguredHostelId();
  const queryClient = useQueryClient();

  const [annOpen, setAnnOpen] = useState(false);
  const [evtOpen, setEvtOpen] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [evtTitle, setEvtTitle] = useState('');
  const [evtDate, setEvtDate] = useState('');
  const [evtDesc, setEvtDesc] = useState('');

  const announcementsQuery = useQuery({
    queryKey: ['owner', 'announcements', hostelId],
    queryFn: () => hostelContentService.getAnnouncements(hostelId!),
    enabled: Boolean(hostelId),
  });
  const eventsQuery = useQuery({
    queryKey: ['owner', 'hostel-events', hostelId],
    queryFn: () => hostelContentService.getEvents(hostelId!),
    enabled: Boolean(hostelId),
  });

  const addAnnouncement = useMutation({
    mutationFn: () => hostelContentService.createAnnouncement(hostelId!, annTitle.trim(), annBody.trim()),
    onSuccess: () => {
      stayoToast.success('Announcement posted');
      setAnnTitle('');
      setAnnBody('');
      setAnnOpen(false);
      queryClient.invalidateQueries({ queryKey: ['owner', 'announcements', hostelId] });
    },
    onError: () => stayoToast.error('Could not post announcement'),
  });
  const deleteAnnouncement = useMutation({
    mutationFn: (id: string) => hostelContentService.deleteAnnouncement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'announcements', hostelId] }),
    onError: () => stayoToast.error('Could not delete announcement'),
  });

  const addEvent = useMutation({
    mutationFn: () => hostelContentService.createEvent(hostelId!, evtTitle.trim(), evtDate, evtDesc.trim() || undefined),
    onSuccess: () => {
      stayoToast.success('Event added');
      setEvtTitle('');
      setEvtDate('');
      setEvtDesc('');
      setEvtOpen(false);
      queryClient.invalidateQueries({ queryKey: ['owner', 'hostel-events', hostelId] });
    },
    onError: () => stayoToast.error('Could not add event'),
  });
  const deleteEvent = useMutation({
    mutationFn: (id: string) => hostelContentService.deleteEvent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'hostel-events', hostelId] }),
    onError: () => stayoToast.error('Could not delete event'),
  });

  const announcements = announcementsQuery.data ?? [];
  const events = eventsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6 px-4 pb-10 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo={hostelId ? `/owner/hostels/${hostelId}/settings` : undefined}
        backLabel="Settings"
        title="Notices"
        subtitle="What your tenants see on their Home tab"
      />

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className={sectionLabel}>Announcements</h2>
          <button
            type="button"
            onClick={() => setAnnOpen(true)}
            disabled={!hostelId}
            className="flex items-center gap-1 text-[12.5px] font-semibold text-primary disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Post
          </button>
        </div>
        <div className={card}>
          {announcements.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
              Nothing posted yet
            </div>
          ) : (
            announcements.map((a) => (
              <div key={a.id} className="flex items-start gap-3 border-t border-border/60 p-3.5 first:border-t-0">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
                  <Megaphone className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground">{a.title}</div>
                  <div className="mt-0.5 text-[11.5px] leading-[1.5] text-muted-foreground">{a.body}</div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteAnnouncement.mutate(a.id)}
                  aria-label={`Delete announcement ${a.title}`}
                  className="flex-none text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className={sectionLabel}>Upcoming events</h2>
          <button
            type="button"
            onClick={() => setEvtOpen(true)}
            disabled={!hostelId}
            className="flex items-center gap-1 text-[12.5px] font-semibold text-primary disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add
          </button>
        </div>
        <div className={card}>
          {events.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
              Nothing coming up
            </div>
          ) : (
            events.map((e) => (
              <div key={e.id} className="flex items-start gap-3 border-t border-border/60 p-3.5 first:border-t-0">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
                  <CalendarDays className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground">{e.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {new Date(e.event_date).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {e.description ? ` · ${e.description}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteEvent.mutate(e.id)}
                  aria-label={`Delete event ${e.title}`}
                  className="flex-none text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <BottomSheet open={annOpen} onOpenChange={setAnnOpen} title="Post an announcement">
        <div className="flex flex-col gap-3 px-4 pb-4">
          <label className="block">
            <span className={labelStyle}>Title</span>
            <input
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              className={inputStyle}
              placeholder="e.g. Water tank cleaning tomorrow"
            />
          </label>
          <label className="block">
            <span className={labelStyle}>Message</span>
            <textarea
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
              className={`${inputStyle} min-h-[96px]`}
            />
          </label>
          <button
            type="button"
            disabled={!annTitle.trim() || !annBody.trim() || addAnnouncement.isPending || !hostelId}
            onClick={() => addAnnouncement.mutate()}
            className={primaryBtn}
          >
            {addAnnouncement.isPending ? 'Posting…' : 'Post announcement'}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={evtOpen} onOpenChange={setEvtOpen} title="Add an event">
        <div className="flex flex-col gap-3 px-4 pb-4">
          <label className="block">
            <span className={labelStyle}>Title</span>
            <input
              value={evtTitle}
              onChange={(e) => setEvtTitle(e.target.value)}
              className={inputStyle}
              placeholder="e.g. Festival dinner"
            />
          </label>
          <label className="block">
            <span className={labelStyle}>Date</span>
            <input type="date" value={evtDate} onChange={(e) => setEvtDate(e.target.value)} className={inputStyle} />
          </label>
          <label className="block">
            <span className={labelStyle}>Description (optional)</span>
            <input value={evtDesc} onChange={(e) => setEvtDesc(e.target.value)} className={inputStyle} />
          </label>
          <button
            type="button"
            disabled={!evtTitle.trim() || !evtDate || addEvent.isPending || !hostelId}
            onClick={() => addEvent.mutate()}
            className={primaryBtn}
          >
            {addEvent.isPending ? 'Adding…' : 'Add event'}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
