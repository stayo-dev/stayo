import { useNavigate } from 'react-router-dom';
import { ChevronRight, User, FileText, DoorOpen, LifeBuoy, LogOut, ScrollText } from 'lucide-react';
import { useAuth } from '@context/AuthContext';
import { useTenantSession } from '@features/tenant-session/useTenantSession';
import { tenantRoomService } from '@features/tenant-room/api';
import { useQuery } from '@tanstack/react-query';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

const ROWS = [
  { key: 'details', title: 'Personal details', meta: 'Contact, emergency & KYC', icon: User, to: '/tenant/profile/details' },
  { key: 'documents', title: 'Documents', meta: 'View & upload verification docs', icon: FileText, to: '/tenant/profile/details#documents' },
  { key: 'renewal', title: 'Agreement & renewal', meta: 'View offers, accept or discuss', icon: ScrollText, to: '/tenant/renewal' },
  { key: 'move-out', title: 'Plan move-out', meta: 'Notice period & exit checklist', icon: DoorOpen, to: '/tenant/move-out' },
  { key: 'help', title: 'Help & support', meta: 'Chat with your hostel team', icon: LifeBuoy, to: '/tenant/profile/help' },
];

/** Tenant Profile tab, per Stayo Tenant.dc.html (a stub in the design source itself) — each row here is a real destination, not a placeholder. */
export function TenantProfilePage() {
  const navigate = useNavigate();
  const session = useTenantSession();
  const { logout } = useAuth();

  const roomQuery = useQuery({
    queryKey: ['tenant', 'room'],
    queryFn: () => tenantRoomService.getRoom(),
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Profile</h1>
      </div>

      <div className={`${card} bg-foreground p-5 text-background`}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-background/15 font-display text-lg font-bold">
          {session.name?.[0]?.toUpperCase() ?? 'T'}
        </span>
        <div className="mt-3 font-display text-[18px] font-bold">{session.name}</div>
        {roomQuery.data?.room?.room_no && (
          <div className="mt-0.5 text-[12px] text-background/60">Room {roomQuery.data.room.room_no}</div>
        )}
      </div>

      <div className={card}>
        {ROWS.map(({ key, title, meta, icon: Icon, to }) => (
          <button
            key={key}
            type="button"
            onClick={() => navigate(to)}
            className="flex w-full items-center gap-3 border-t border-border px-4 py-3.5 text-left first:border-t-0"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-secondary text-primary">
              <Icon className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
              <div className="text-[11.5px] text-muted-foreground">{meta}</div>
            </div>
            <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => logout()}
        className={`${card} flex items-center justify-center gap-2 py-3.5 text-destructive`}
      >
        <LogOut className="h-4 w-4" />
        <span className="text-[13.5px] font-semibold">Sign out</span>
      </button>
    </div>
  );
}
