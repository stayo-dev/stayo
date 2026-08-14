import type { ServiceRequest, ServiceRequestEvent, ServiceRequestStatus } from '@features/tenant-room/api';
import type { DetailConfig, OverlayTone } from '../types';

const STEP_ORDER: ServiceRequestStatus[] = ['RAISED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
const STEP_LABEL: Record<ServiceRequestStatus, string> = {
  RAISED: 'Raised',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

const PILL_TONE: Record<ServiceRequestStatus, OverlayTone> = {
  RAISED: 'yellow',
  ASSIGNED: 'orange',
  IN_PROGRESS: 'orange',
  RESOLVED: 'green',
  REJECTED: 'red',
};

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Ticket/service-request detail — used for both Room's active-maintenance card and any ticket opened from Profile's list. Mirrors Stayo Tenant.dc.html's `maint_ticket`/`tk_*` DETAIL entries, built from the real `ServiceRequest` + its event log rather than static mock content. */
export function buildServiceRequestDetailConfig(request: ServiceRequest, events: ServiceRequestEvent[]): DetailConfig {
  const stepIndex = request.status === 'REJECTED' ? -1 : STEP_ORDER.indexOf(request.status as (typeof STEP_ORDER)[number]);

  const config: DetailConfig = {
    title: request.category ?? request.type.replace('_', ' '),
    sub: `Raised ${dateLabel(request.created_at)}`,
    headPill: STEP_LABEL[request.status],
    pillTone: PILL_TONE[request.status],
    sections: [
      {
        kind: 'rows',
        title: 'Details',
        rows: [
          { label: 'Type', value: request.type.replace('_', ' ') },
          { label: 'Category', value: request.category ?? 'General' },
          { label: 'Raised', value: dateLabel(request.created_at) },
          ...(request.assigned_to ? [{ label: 'Assigned to', value: request.assigned_to }] : []),
          ...(request.eta ? [{ label: 'ETA', value: request.eta }] : []),
          ...(request.fee_amount ? [{ label: 'Fee', value: `₹${request.fee_amount}` }] : []),
        ],
      },
      ...(request.description
        ? [{ kind: 'notices' as const, title: 'Description', notices: [{ title: request.description, meta: 'Submitted by you', tone: 'grey' as const }] }]
        : []),
      ...(request.photo_url ? [{ kind: 'photos' as const, title: 'Photos', count: 1 }] : []),
      ...(request.status !== 'REJECTED'
        ? [
            {
              kind: 'timeline' as const,
              title: 'Progress',
              steps: STEP_ORDER.map((key, i) => ({
                label: STEP_LABEL[key],
                meta: i < stepIndex ? 'Completed' : i === stepIndex ? 'Current stage' : 'Pending',
                state: (i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'todo') as 'done' | 'active' | 'todo',
              })),
            },
          ]
        : []),
      {
        kind: 'notices',
        title: 'Updates',
        notices:
          events.length > 0
            ? events.map((e) => ({ title: e.note ?? `Status changed to ${STEP_LABEL[e.status]}`, meta: dateLabel(e.created_at), tone: PILL_TONE[e.status] }))
            : [{ title: 'Request received', meta: dateLabel(request.created_at), tone: 'grey' as const }],
      },
    ],
  };

  return config;
}
