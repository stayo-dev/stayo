import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, CalendarDays, Trash2 } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { hostelContentService } from '@features/hostel-content/api';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
const inputStyle = 'w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';

/**
 * More → Settings → Notices. Owner-authored content shown on the tenant
 * Home tab: announcements (title/body) and upcoming events (title/date).
 * Real data via `hostelContentService` (`/api/announcements`, `/api/hostel-events`).
 */
export function MoreNoticesPage() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const queryClient = useQueryClient();

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
      queryClient.invalidateQueries({ queryKey: ['owner', 'hostel-events', hostelId] });
    },
    onError: () => stayoToast.error('Could not add event'),
  });
  const deleteEvent = useMutation({
    mutationFn: (id: string) => hostelContentService.deleteEvent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'hostel-events', hostelId] }),
    onError: () => stayoToast.error('Could not delete event'),
  });

  return (
    <div className="flex flex-col gap-5 px-4 pb-10 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more" backLabel="Configuration" title="Notices" />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Post an announcement</span>
        <div className={`${card} flex flex-col gap-3 p-4`}>
          <label className="block">
            <span className={labelStyle}>Title</span>
            <input value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} className={inputStyle} placeholder="e.g. Water tank cleaning tomorrow" />
          </label>
          <label className="block">
            <span className={labelStyle}>Message</span>
            <textarea value={annBody} onChange={(e) => setAnnBody(e.target.value)} className={`${inputStyle} min-h-[80px]`} />
          </label>
          <button
            type="button"
            disabled={!annTitle.trim() || !annBody.trim() || addAnnouncement.isPending || !hostelId}
            onClick={() => addAnnouncement.mutate()}
            className="rounded-xl bg-primary py-3 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {addAnnouncement.isPending ? 'Posting…' : 'Post announcement'}
          </button>
        </div>
        <div className={card}>
          {(announcementsQuery.data ?? []).length === 0 ? (
            <div className="p-4 text-center text-[12.5px] text-muted-foreground">No announcements yet</div>
          ) : (
            announcementsQuery.data!.map((a) => (
              <div key={a.id} className="flex items-start gap-3 border-t border-border p-3.5 first:border-t-0">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary"><Megaphone className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground">{a.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">{a.body}</div>
                </div>
                <button type="button" onClick={() => deleteAnnouncement.mutate(a.id)} className="flex-none text-muted-foreground">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Add an upcoming event</span>
        <div className={`${card} flex flex-col gap-3 p-4`}>
          <label className="block">
            <span className={labelStyle}>Title</span>
            <input value={evtTitle} onChange={(e) => setEvtTitle(e.target.value)} className={inputStyle} placeholder="e.g. Festival dinner" />
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
            className="rounded-xl bg-primary py-3 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {addEvent.isPending ? 'Adding…' : 'Add event'}
          </button>
        </div>
        <div className={card}>
          {(eventsQuery.data ?? []).length === 0 ? (
            <div className="p-4 text-center text-[12.5px] text-muted-foreground">No upcoming events</div>
          ) : (
            eventsQuery.data!.map((e) => (
              <div key={e.id} className="flex items-start gap-3 border-t border-border p-3.5 first:border-t-0">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary"><CalendarDays className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground">{e.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {new Date(e.event_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {e.description ? ` · ${e.description}` : ''}
                  </div>
                </div>
                <button type="button" onClick={() => deleteEvent.mutate(e.id)} className="flex-none text-muted-foreground">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
