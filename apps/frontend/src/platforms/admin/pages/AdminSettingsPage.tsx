import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mail, MessageCircle } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';

const card = 'rounded-2xl border border-[#EFE6DA] bg-white p-6';
const cardTitle = 'font-display text-[15px] font-extrabold text-foreground';
const cardSubtitle = 'mb-[18px] mt-1 text-[12.5px] text-[#9C9186]';
const label = 'mb-1.5 block text-[12px] font-bold text-[#8A7F75]';
const input = 'h-10 w-full rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-[13px] text-[13px] text-foreground focus:border-primary focus:bg-white';
const inviteInput = 'h-10 w-full rounded-[10px] border border-[#E7DDD1] bg-white px-[13px] text-[13px] text-foreground focus:border-primary';
const fmtINR = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

const AVATAR_PALETTE = [
  { bg: 'bg-primary/10', fg: 'text-primary' },
  { bg: 'bg-success/10', fg: 'text-success' },
  { bg: 'bg-warning/10', fg: 'text-warning' },
  { bg: 'bg-info/10', fg: 'text-info' },
];
const avatarStyle = (name: string) => {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};
const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function GeneralSettingsCard() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => platformAdminService.getSettings() });
  const [form, setForm] = useState({ supportEmail: '', supportPhone: '', businessAddress: '' });

  useEffect(() => {
    if (settingsQuery.data) setForm({ supportEmail: settingsQuery.data.supportEmail ?? '', supportPhone: settingsQuery.data.supportPhone ?? '', businessAddress: settingsQuery.data.businessAddress ?? '' });
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => platformAdminService.updateSettings(form),
    onSuccess: () => {
      stayoToast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: () => stayoToast.error('Could not save settings'),
  });

  return (
    <div className={card}>
      <div className={cardTitle}>General</div>
      <p className={cardSubtitle}>Public business details shown to owners and students.</p>
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
        <div>
          <span className={label}>Support Email</span>
          <input value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} className={input} />
        </div>
        <div>
          <span className={label}>Support Phone</span>
          <input value={form.supportPhone} onChange={(e) => setForm({ ...form, supportPhone: e.target.value })} className={input} />
        </div>
        <div className="min-[560px]:col-span-2">
          <span className={label}>Business Address</span>
          <input value={form.businessAddress} onChange={(e) => setForm({ ...form, businessAddress: e.target.value })} className={input} />
        </div>
      </div>
      <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="mt-4 w-full rounded-xl bg-foreground py-2.5 text-[12.5px] font-bold text-background">
        {saveMutation.isPending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function PlansCard() {
  const queryClient = useQueryClient();
  const plansQuery = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => platformAdminService.getPlans() });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => platformAdminService.updatePlan(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] }),
    onError: () => stayoToast.error('Could not update plan'),
  });

  return (
    <div className={card}>
      <div className={cardTitle}>Subscription Plans</div>
      <p className={cardSubtitle}>Plans owners can subscribe to.</p>
      <div className="flex flex-col gap-2.5">
        {plansQuery.data?.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => toggleMutation.mutate({ id: p.id, isActive: !p.is_active })}
            className="flex items-center gap-3.5 rounded-xl border border-[#EFE6DA] px-4 py-3.5 text-left hover:border-[#E3D9CC]"
          >
            <span className={`h-2.5 w-2.5 flex-none rounded-full ${p.is_active ? 'bg-success' : 'bg-muted-foreground/40'}`} />
            <div className="flex-1">
              <div className="text-[13.5px] font-bold text-foreground">{p.name}</div>
              <div className="text-[12px] text-[#9C9186]">{p.description}</div>
            </div>
            <span className="text-[14px] font-extrabold text-foreground">{fmtINR(Number(p.price_amount))}</span>
            <span className="text-[12px] text-[#9C9186]">/ {p.billing_cycle === 'MONTHLY' ? 'mo' : 'yr'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminUsersCard() {
  const queryClient = useQueryClient();
  const adminsQuery = useQuery({ queryKey: ['admin', 'admins'], queryFn: () => platformAdminService.getAdmins() });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('SALES');

  const inviteMutation = useMutation({
    mutationFn: () => platformAdminService.inviteAdmin({ name, email, title }),
    onSuccess: (res) => {
      stayoToast.success(`Invited — temporary password: ${res.temporary_password}`);
      setInviteOpen(false);
      setName('');
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
    },
    onError: () => stayoToast.error('Could not invite admin'),
  });

  return (
    <div className={card}>
      <div className="mb-[18px] flex items-center justify-between">
        <div>
          <div className={cardTitle}>Admin Users</div>
          <div className="mt-1 text-[12.5px] text-[#9C9186]">People with access to this console.</div>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen((o) => !o)}
          className="h-9 flex-none rounded-[10px] border border-[#E7DDD1] bg-white px-3.5 text-[12.5px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary"
        >
          {inviteOpen ? 'Cancel' : 'Invite'}
        </button>
      </div>
      {inviteOpen && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-[#EFE6DA] p-3.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={inviteInput} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={inviteInput} />
          <select value={title} onChange={(e) => setTitle(e.target.value)} className={inviteInput}>
            <option value="SALES">Sales</option>
            <option value="VERIFICATION">Verification</option>
            <option value="OWNER">Owner</option>
          </select>
          <button type="button" disabled={!name.trim() || !email.trim() || inviteMutation.isPending} onClick={() => inviteMutation.mutate()} className="rounded-xl bg-foreground py-2.5 text-[12.5px] font-bold text-background disabled:opacity-50">
            {inviteMutation.isPending ? 'Inviting…' : 'Send invite'}
          </button>
        </div>
      )}
      <div className="flex flex-col">
        {adminsQuery.data?.map((a) => {
          const av = avatarStyle(a.profile.name);
          return (
            <div key={a.id} className="flex items-center gap-3.5 border-b border-[#F2ECE5] py-2.5 last:border-b-0">
              <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-[12.5px] font-bold ${av.bg} ${av.fg}`}>{initials(a.profile.name)}</span>
              <div className="flex-1">
                <div className="text-[13.5px] font-bold text-foreground">{a.profile.name}</div>
                <div className="text-[12px] text-[#9C9186]">{a.profile.email}</div>
              </div>
              <span className="rounded-full border border-[#EFE6DA] bg-[#F7F3EF] px-2.5 py-1 text-[11.5px] font-bold text-[#8A7F75]">{a.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TemplatesCard() {
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({ queryKey: ['admin', 'notification-templates'], queryFn: () => platformAdminService.getNotificationTemplates() });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => platformAdminService.toggleTemplateActive(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'notification-templates'] }),
    onError: () => stayoToast.error('Could not update template'),
  });

  return (
    <div className={card}>
      <div className={cardTitle}>Notification Templates</div>
      <p className={cardSubtitle}>Automated messages sent to owners.</p>
      {templatesQuery.data?.length === 0 ? (
        <p className="text-[12.5px] text-[#9C9186]">No templates yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {templatesQuery.data?.map((t) => {
            const isWhatsapp = t.channel === 'WHATSAPP';
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleMutation.mutate({ id: t.id, isActive: !t.is_active })}
                className="flex items-center gap-3.5 rounded-xl border border-[#EFE6DA] px-4 py-3.5 text-left hover:border-[#E3D9CC] hover:bg-[#F7F3EF]"
              >
                <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-[#FBF1DE] text-primary">
                  {isWhatsapp ? <MessageCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                </span>
                <div className="flex-1">
                  <div className="text-[13.5px] font-bold text-foreground">{t.name}</div>
                  <div className="text-[12px] text-[#9C9186]">{t.channel}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${t.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                  {t.is_active ? 'Active' : 'Draft'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AdminSettingsPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-[880px] px-7 py-6">
      <button type="button" onClick={() => navigate('/admin/more')} className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-[#8A7F75] hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to More
      </button>
      <div className="flex flex-col gap-[18px]">
        <GeneralSettingsCard />
        <PlansCard />
        <AdminUsersCard />
        <TemplatesCard />
      </div>
    </div>
  );
}
