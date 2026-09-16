import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { AdminDrawer } from '../drawer/AdminDrawer';
import { LeadDrawerBody } from '../drawer/LeadDrawerBody';
import { tintForId } from '../theme/palette';
import { useToast } from '../layout/toastContext';
import { STATUS_LABEL, canMarkLost } from './leadQueue';
import { nextStage, canAdvance, LOST_REASONS, LOST_REASON_LABEL } from './leadPipeline';

/**
 * The lead detail drawer — advance stage, mark lost, approve & send invite.
 *
 * Shared by the Leads screen and the Owners page's "Pending onboarding"
 * panel (Admin -> Add Owner leads), so both act on a `platform_leads` row
 * through the exact same mutations without either page reimplementing them,
 * and without the Owners page having to navigate to the Leads screen to do
 * it — the two are different admin actions (marketing lead vs. manual
 * onboarding) that happen to share a pipeline underneath.
 */
export function LeadPipelineDrawer({ lead, onClose }: { lead: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const fireToast = useToast();
  const [lostFor, setLostFor] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });

  const advance = async () => {
    const to = nextStage(lead.status);
    if (!to) return;
    try {
      await platformAdminService.updateLeadStatus(lead.id, to);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead', lead.id] });
      fireToast(`Moved to ${STATUS_LABEL[to] ?? to}`);
    } catch {
      fireToast('Could not move that lead', 'no');
    }
  };

  const markLost = async (reason: string) => {
    try {
      await platformAdminService.markLeadLost(lead.id, reason);
      setLostFor(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead', lead.id] });
      fireToast('Lead marked lost', 'no');
    } catch {
      fireToast('Could not mark that lead lost', 'no');
    }
  };

  const approve = async () => {
    try {
      const result = await platformAdminService.approveLead(lead.id);
      refresh();
      fireToast(
        result?.whatsapp_sent || result?.email_sent
          ? 'Approved — activation link sent'
          : 'Approved, but the invite could not be delivered',
        result?.whatsapp_sent || result?.email_sent ? 'ok' : 'no',
      );
    } catch {
      fireToast('Could not approve that lead', 'no');
    }
  };

  return (
    <AdminDrawer
      title={lead.name}
      subtitle={[lead.hostel_name, lead.city].filter(Boolean).join(' · ')}
      initials={(lead.name ?? '?').slice(0, 2).toUpperCase()}
      tint={tintForId(lead.id)}
      photoUrl={lead.display_photo_url}
      onClose={onClose}
      footer={
        lostFor === lead.id ? (
          <div>
            <div className="mb-2 font-admin text-[12px] font-bold text-[#221E1A]">
              Why is this lead lost?
            </div>
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {LOST_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => markLost(reason)}
                  className="rounded-full border border-[#E7DDD1] bg-white px-3 py-2 text-[11.5px] font-semibold text-[#5A5147] hover:border-[#B3402F] hover:text-[#B3402F]"
                >
                  {LOST_REASON_LABEL[reason]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLostFor(null)}
              className="w-full rounded-xl border border-[#E9DFD3] bg-white py-2.5 font-admin text-[13px] font-bold text-[#5A5147]"
            >
              Cancel
            </button>
          </div>
        ) : canMarkLost(lead.status) || canAdvance(lead.status) || lead.status === 'NEGOTIATING' ? (
          <div className="flex items-center gap-3">
            {canMarkLost(lead.status) && (
              <button
                type="button"
                onClick={() => setLostFor(lead.id)}
                className="flex-1 rounded-xl border border-[#E6C7BF] bg-[#FBEFE9] py-3 font-admin text-[13.5px] font-bold text-[#B3402F]"
              >
                Mark lost
              </button>
            )}
            {canAdvance(lead.status) ? (
              <button
                type="button"
                onClick={() => advance()}
                className="flex-[1.4] rounded-xl bg-[#B46A55] py-3 font-admin text-[13.5px] font-bold text-white shadow-[0_4px_14px_rgba(180,106,85,.3)]"
              >
                Move to {STATUS_LABEL[nextStage(lead.status) as string]}
              </button>
            ) : lead.status === 'NEGOTIATING' ? (
              <button
                type="button"
                onClick={() => approve()}
                className="flex-[1.4] rounded-xl bg-[#1F7A52] py-3 font-admin text-[13.5px] font-bold text-white shadow-[0_4px_14px_rgba(31,122,82,.3)]"
              >
                Approve &amp; send invite
              </button>
            ) : null}
          </div>
        ) : null
      }
    >
      <LeadDrawerBody leadId={lead.id} />
    </AdminDrawer>
  );
}
