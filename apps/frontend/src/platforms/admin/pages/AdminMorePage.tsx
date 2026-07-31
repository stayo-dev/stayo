import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Settings, User, Mail, Megaphone, LogOut, X, ChevronRight } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useAuth } from '@context/AuthContext';
import { useAdminSession } from '@features/admin-session/useAdminSession';
import { platformAdminService } from '@features/platform-admin/api';

const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function AdminMorePage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const session = useAdminSession();
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [message, setMessage] = useState('');

  const broadcastMutation = useMutation({
    mutationFn: () => platformAdminService.sendBroadcast(message),
    onSuccess: (res) => {
      stayoToast.success(`Sent to ${res.sent} of ${res.total} owners`);
      setBroadcastOpen(false);
      setMessage('');
    },
    onError: () => stayoToast.error('Could not send broadcast'),
  });

  const rows = [
    { key: 'settings', title: 'Settings', icon: Settings, onClick: () => navigate('/admin/settings') },
    { key: 'profile', title: 'Profile', icon: User, onClick: () => setProfileOpen(true) },
    { key: 'support', title: 'Support', icon: Mail, onClick: () => window.location.assign('mailto:support@yourstayo.com') },
    { key: 'broadcast', title: 'Broadcast Notice', icon: Megaphone, onClick: () => setBroadcastOpen(true) },
    { key: 'logout', title: 'Log Out', icon: LogOut, onClick: () => logout(), destructive: true },
  ];

  return (
    <div className="mx-auto max-w-[640px] px-7 py-6">
      <div className="mb-[18px] flex items-center gap-3.5 rounded-2xl border border-[#EFE6DA] bg-white p-[22px]">
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[13px] bg-foreground text-[15px] font-bold text-background">
          {initials(session.name)}
        </span>
        <div>
          <div className="font-display text-[15px] font-extrabold text-foreground">{session.name}</div>
          <div className="mt-0.5 text-[12.5px] text-[#9C9186]">{session.email} · Platform Admin</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#EFE6DA] bg-white">
        {rows.map(({ key, title, icon: Icon, onClick, destructive }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-3.5 border-b border-[#F2ECE5] px-5 py-4 text-left last:border-b-0 hover:bg-[#F7F3EF]"
          >
            <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-[#F7F3EF] text-[#8A7F75]">
              <Icon className="h-4 w-4" />
            </span>
            <span className={`flex-1 text-[13.5px] font-bold ${destructive ? 'text-destructive' : 'text-foreground'}`}>{title}</span>
            <ChevronRight className="h-4 w-4 text-[#9C9186]" />
          </button>
        ))}
      </div>

      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setProfileOpen(false)} />
          <div className="relative z-10 w-[380px] max-w-[90vw] rounded-2xl bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-[15px] font-bold text-foreground">Profile</span>
              <button type="button" onClick={() => setProfileOpen(false)}><X className="h-4 w-4 text-[#8A7F75]" /></button>
            </div>
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-13 w-13 flex-none items-center justify-center rounded-2xl bg-foreground font-display text-[15px] font-bold text-background">
                {initials(session.name)}
              </span>
              <div>
                <div className="font-display text-[15px] font-bold text-foreground">{session.name}</div>
                <div className="text-[12px] text-[#9C9186]">Platform Admin</div>
              </div>
            </div>
            <div className="flex flex-col gap-3 text-[13px]">
              <div><div className="text-[10.5px] font-bold uppercase text-[#9C9186]">Name</div><div className="font-semibold text-foreground">{session.name}</div></div>
              <div><div className="text-[10.5px] font-bold uppercase text-[#9C9186]">Email</div><div className="font-semibold text-foreground">{session.email}</div></div>
              <div><div className="text-[10.5px] font-bold uppercase text-[#9C9186]">Role</div><div className="font-semibold text-foreground">Platform Admin</div></div>
            </div>
          </div>
        </div>
      )}

      {broadcastOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setBroadcastOpen(false)} />
          <div className="relative z-10 w-[420px] max-w-[90vw] rounded-2xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-[15px] font-bold text-foreground">Broadcast Notice</span>
              <button type="button" onClick={() => setBroadcastOpen(false)}><X className="h-4 w-4 text-[#8A7F75]" /></button>
            </div>
            <p className="mb-3 text-[11.5px] text-[#9C9186]">Sent to all active hostel owners.</p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[100px] w-full rounded-xl border border-[#E7DDD1] bg-[#F7F3EF] px-3 py-2.5 text-[13px] outline-none"
              placeholder="Write a message…"
            />
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setBroadcastOpen(false)} className="flex-1 rounded-xl border border-[#E7DDD1] py-2.5 text-[12.5px] font-bold text-foreground">Cancel</button>
              <button
                type="button"
                disabled={!message.trim() || broadcastMutation.isPending}
                onClick={() => broadcastMutation.mutate()}
                className="flex-1 rounded-xl bg-foreground py-2.5 text-[12.5px] font-bold text-background disabled:opacity-50"
              >
                {broadcastMutation.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
