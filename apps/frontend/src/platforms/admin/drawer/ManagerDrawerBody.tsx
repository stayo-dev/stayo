import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { DrawerSection, KeyValueRows } from './AdminDrawer';
import { useToast } from '../layout/toastContext';
import { Modal, Field, ModalFooter, MODAL_INPUT } from '../ui';
import {
  PERMISSION_GROUPS,
  PERMISSION_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  toManagerRows,
  type ManagerPermission,
  type ManagerRow,
} from '../managers/managerRows';
import { togglePermission } from '../managers/addManagerFlow';

const TONE_COLOR: Record<string, string> = { green: '#1F7A52', amber: '#B8792B', red: '#B3402F' };

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The manager detail drawer body (ADR-212) — profile/status, a full-replace
 * permission editor, hostel assignment (assign/unassign/reassign), and
 * suspend/reactivate/resend-invitation. Every action here is a UX
 * convenience over a backend call that independently re-checks ADMIN access
 * — there is no manager-reachable path to any of these mutations.
 */
export function ManagerDrawerBody({ managerId }: { managerId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editingPermissions, setEditingPermissions] = useState(false);
  const [draftPermissions, setDraftPermissions] = useState<ManagerPermission[]>([]);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [reassignHostelId, setReassignHostelId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['admin', 'manager', managerId],
    queryFn: () => platformAdminService.getManager(managerId),
    staleTime: 15_000,
  });

  // Hostel names aren't joined server-side (manager_hostel_assignments.hostel_id
  // is a bare column by design, see Database.md) — resolved client-side from
  // the same roster the Hostels tab already fetches, rather than adding a
  // second backend query just for a name lookup.
  const hostels = useQuery({
    queryKey: ['admin', 'hostels', 'all-for-assignment'],
    queryFn: () => platformAdminService.getHostels(),
    staleTime: 60_000,
  });
  const hostelById = new Map((hostels.data ?? []).map((h: any) => [String(h.id), h]));

  const managers = useQuery({
    queryKey: ['admin', 'managers', 'all-for-reassign'],
    queryFn: () => platformAdminService.getManagers(),
    enabled: reassignHostelId !== null,
    staleTime: 15_000,
  });
  const otherManagerRows: ManagerRow[] = toManagerRows(managers.data ?? []).filter((m) => m.id !== managerId);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'manager', managerId] });

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      refresh();
      qc.invalidateQueries({ queryKey: ['admin', 'managers'] });
      toast(okMsg, 'ok');
    } catch (e: any) {
      toast(e?.response?.data?.error?.message || 'Something went wrong.', 'no');
    }
  };

  const savePermissions = useMutation({
    mutationFn: () => platformAdminService.updateManager(managerId, { permissions: draftPermissions }),
    onSuccess: () => {
      setEditingPermissions(false);
      refresh();
      toast('Permissions updated', 'ok');
    },
    onError: (e: any) => toast(e?.response?.data?.error?.message || 'Could not save permissions.', 'no'),
  });

  if (detail.isLoading) {
    return <div className="py-12 text-center text-[13px] text-[#8A7F75]">Loading manager…</div>;
  }
  if (detail.isError || !detail.data) {
    return <div className="py-12 text-center text-[13px] text-[#B3402F]">Couldn't load this manager.</div>;
  }

  const manager = detail.data;
  const status: string = manager.status ?? 'PENDING_INVITATION';
  const currentPermissions: ManagerPermission[] = (manager.permissions ?? []).map((p: any) => p.permission);
  const assignments = manager.hostel_assignments ?? [];
  const assignedHostelIds = new Set(assignments.map((a: any) => String(a.hostel_id)));
  const assignableHostels = (hostels.data ?? []).filter((h: any) => !assignedHostelIds.has(String(h.id)));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl border border-[#EFE6DA] bg-white px-3 py-[13px] text-center">
          <div className="font-admin text-[18px] font-extrabold" style={{ color: TONE_COLOR[STATUS_TONE[status as keyof typeof STATUS_TONE]] }}>
            {STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}
          </div>
          <div className="mt-0.5 text-[10px] font-medium text-[#9A8F84]">Status</div>
        </div>
        <div className="rounded-2xl border border-[#EFE6DA] bg-white px-3 py-[13px] text-center">
          <div className="font-admin text-[18px] font-extrabold text-[#221E1A]">{assignments.length}</div>
          <div className="mt-0.5 text-[10px] font-medium text-[#9A8F84]">Hostels assigned</div>
        </div>
      </div>

      <DrawerSection title="Account & contact">
        <KeyValueRows
          rows={[
            { k: 'Email', v: manager.profile?.email || '—' },
            { k: 'Phone', v: manager.profile?.phone || '—' },
            { k: 'Invited', v: formatDate(manager.created_at) },
            { k: 'Activated', v: formatDate(manager.activated_at) },
          ]}
        />
      </DrawerSection>

      <DrawerSection
        title="Permissions"
        action={
          !editingPermissions ? (
            <button
              type="button"
              onClick={() => {
                setDraftPermissions(currentPermissions);
                setEditingPermissions(true);
              }}
              className="text-[11.5px] font-bold text-[#B46A55]"
            >
              Edit
            </button>
          ) : null
        }
      >
        {!editingPermissions ? (
          <div className="flex flex-wrap gap-1.5 px-[18px] py-3.5">
            {currentPermissions.length === 0 ? (
              <span className="text-[12px] text-[#A2978B]">No permissions granted yet.</span>
            ) : (
              currentPermissions.map((p) => (
                <span key={p} className="rounded-full bg-[#F2ECE5] px-2.5 py-1 text-[11px] font-semibold text-[#5A5147]">
                  {PERMISSION_LABEL[p]}
                </span>
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-[18px] py-3.5">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]">{group.label}</div>
                <div className="flex flex-col gap-1.5">
                  {group.permissions.map((permission) => (
                    <label key={permission} className="flex cursor-pointer items-center justify-between gap-3">
                      <span className="text-[12.5px] font-semibold text-[#2A2521]">{PERMISSION_LABEL[permission]}</span>
                      <input
                        type="checkbox"
                        checked={draftPermissions.includes(permission)}
                        onChange={() => setDraftPermissions((current) => togglePermission(current, permission))}
                        className="h-4 w-4 accent-[#221E1A]"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                disabled={savePermissions.isPending}
                onClick={() => savePermissions.mutate()}
                className="flex-1 rounded-[10px] bg-[#221E1A] px-4 py-2.5 text-center font-admin text-[12.5px] font-bold text-white disabled:opacity-40"
              >
                {savePermissions.isPending ? 'Saving…' : 'Save permissions'}
              </button>
              <button
                type="button"
                onClick={() => setEditingPermissions(false)}
                className="flex-1 rounded-[10px] border border-[#E7DDD1] bg-white px-4 py-2.5 text-center text-[12.5px] font-semibold text-[#5A5147]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </DrawerSection>

      <DrawerSection
        title={`Assigned hostels (${assignments.length})`}
        action={
          <button type="button" onClick={() => setAssignOpen(true)} className="text-[11.5px] font-bold text-[#B46A55]">
            Assign
          </button>
        }
      >
        {assignments.length === 0 ? (
          <div className="px-[18px] py-4 text-[12px] text-[#A2978B]">No hostels assigned yet.</div>
        ) : (
          assignments.map((a: any, index: number) => {
            const hostel = hostelById.get(String(a.hostel_id));
            return (
              <div
                key={a.id}
                className={`flex items-center gap-3 px-[18px] py-[13px] ${index > 0 ? 'border-t border-[#F2ECE5]' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[#2A2521]">{hostel?.name ?? a.hostel_id}</div>
                  <div className="truncate text-[11px] text-[#9A8F84]">{hostel?.city ?? '—'}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setReassignHostelId(String(a.hostel_id))}
                  className="flex-none text-[11px] font-bold text-[#3B5B9E]"
                >
                  Reassign
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(() => platformAdminService.unassignManagerHostel(managerId, a.hostel_id), 'Hostel unassigned')
                  }
                  className="flex-none text-[11px] font-bold text-[#B3402F]"
                >
                  Unassign
                </button>
              </div>
            );
          })
        )}
      </DrawerSection>

      <DrawerSection title="Manager status">
        <div className="flex gap-2 px-[18px] py-3.5">
          {status === 'SUSPENDED' ? (
            <button
              type="button"
              onClick={() => run(() => platformAdminService.reactivateManager(managerId), 'Manager reactivated')}
              className="flex-1 rounded-[10px] bg-[#1F7A52] px-4 py-2.5 text-center font-admin text-[12.5px] font-bold text-white"
            >
              Reactivate
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSuspendOpen(true)}
              className="flex-1 rounded-[10px] border border-[#F1C6BC] bg-white px-4 py-2.5 text-center font-admin text-[12.5px] font-bold text-[#B3402F]"
            >
              Suspend
            </button>
          )}
          {status !== 'ACTIVE' && (
            <button
              type="button"
              onClick={() => run(() => platformAdminService.resendManagerInvitation(managerId), 'Invitation resent')}
              className="flex-1 rounded-[10px] border border-[#E7DDD1] bg-white px-4 py-2.5 text-center font-admin text-[12.5px] font-bold text-[#5A5147]"
            >
              Resend invite
            </button>
          )}
        </div>
      </DrawerSection>

      {suspendOpen && (
        <SuspendModal
          onClose={() => setSuspendOpen(false)}
          onConfirm={(reason) => run(() => platformAdminService.suspendManager(managerId, reason), 'Manager suspended').then(() => setSuspendOpen(false))}
        />
      )}

      {assignOpen && (
        <AssignHostelModal
          hostels={assignableHostels}
          onClose={() => setAssignOpen(false)}
          onConfirm={(hostelId) =>
            run(() => platformAdminService.assignManagerHostels(managerId, [hostelId]), 'Hostel assigned').then(() =>
              setAssignOpen(false),
            )
          }
        />
      )}

      {reassignHostelId && (
        <ReassignModal
          hostelName={hostelById.get(reassignHostelId)?.name ?? reassignHostelId}
          managers={otherManagerRows}
          onClose={() => setReassignHostelId(null)}
          onConfirm={(toManagerId) =>
            run(
              () => platformAdminService.reassignHostel(managerId, reassignHostelId, toManagerId),
              'Hostel reassigned',
            ).then(() => setReassignHostelId(null))
          }
        />
      )}
    </div>
  );
}

function SuspendModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason?: string) => void }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal title="Suspend this manager" subtitle="They lose console access immediately; permissions stay intact for reactivation." onClose={onClose}>
      <div className="px-5 py-4 sm:px-6">
        <Field label="Reason (optional)">
          <textarea className={`${MODAL_INPUT} min-h-[80px] resize-y`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this manager being suspended?" autoFocus />
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={async () => {
          setPending(true);
          await onConfirm(reason || undefined);
          setPending(false);
        }}
        confirmLabel="Suspend"
        confirmTone="red"
        pending={pending}
      />
    </Modal>
  );
}

function AssignHostelModal({
  hostels, onClose, onConfirm,
}: { hostels: any[]; onClose: () => void; onConfirm: (hostelId: string) => void }) {
  const [hostelId, setHostelId] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal title="Assign a hostel" subtitle="Only hostels with no active manager are shown." onClose={onClose}>
      <div className="px-5 py-4 sm:px-6">
        <Field label="Hostel">
          <select className={MODAL_INPUT} value={hostelId} onChange={(e) => setHostelId(e.target.value)}>
            <option value="">Choose a hostel…</option>
            {hostels.map((h: any) => (
              <option key={h.id} value={h.id}>
                {h.name} — {h.city ?? '—'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={async () => {
          if (!hostelId) return;
          setPending(true);
          await onConfirm(hostelId);
          setPending(false);
        }}
        confirmLabel="Assign"
        disabled={!hostelId}
        pending={pending}
      />
    </Modal>
  );
}

function ReassignModal({
  hostelName, managers, onClose, onConfirm,
}: { hostelName: string; managers: ManagerRow[]; onClose: () => void; onConfirm: (toManagerId: string) => void }) {
  const [toManagerId, setToManagerId] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal title={`Reassign ${hostelName}`} subtitle="Moves it to another manager. Past activity on this hostel stays attributed to whoever performed it." onClose={onClose}>
      <div className="px-5 py-4 sm:px-6">
        <Field label="New manager">
          <select className={MODAL_INPUT} value={toManagerId} onChange={(e) => setToManagerId(e.target.value)}>
            <option value="">Choose a manager…</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={async () => {
          if (!toManagerId) return;
          setPending(true);
          await onConfirm(toManagerId);
          setPending(false);
        }}
        confirmLabel="Reassign"
        disabled={!toManagerId}
        pending={pending}
      />
    </Modal>
  );
}
