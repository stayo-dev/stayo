import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hostelContentService } from '@features/hostel-content/api';
import { tenantRoomService } from '@features/tenant-room/api';
import { useTenantRoom } from '@features/tenant-room/hooks/useTenantRoom';
import { useTenantSession } from '@features/tenant-session/useTenantSession';
import { useTenantFinancials } from '@features/tenant-financials/hooks/useTenantFinancials';
import { useTenantProfile } from '@features/tenant-profile/hooks/useTenantProfile';
import { useTenantFoodSchedule, DAY_ORDER, type DayKey } from '@features/food/hooks/useTenantFoodSchedule';
import { useTenantFoodVoting } from '@features/food/hooks/useTenantFoodVoting';

const SLOT_ORDER = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;

function todayKey(): DayKey {
  const jsDay = new Date().getDay(); // 0=Sunday..6=Saturday
  const index = (jsDay + 6) % 7; // 0=Monday..6=Sunday
  return DAY_ORDER[index];
}

/** Composes everything the tenant Home tab shows — no new backend beyond announcements/events, everything else is already-real data. */
export function useTenantHome() {
  const session = useTenantSession();
  const financials = useTenantFinancials();
  const schedule = useTenantFoodSchedule();
  const voting = useTenantFoodVoting();
  const roomState = useTenantRoom();
  const profile = useTenantProfile();

  const announcementsQuery = useQuery({
    queryKey: ['tenant', 'announcements'],
    queryFn: () => hostelContentService.getTenantAnnouncements(),
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });
  const eventsQuery = useQuery({
    queryKey: ['tenant', 'events'],
    queryFn: () => hostelContentService.getTenantEvents(),
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });
  const roomQuery = useQuery({
    queryKey: ['tenant', 'room'],
    queryFn: () => tenantRoomService.getRoom(),
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const todaysMeals = useMemo(() => {
    const day = todayKey();
    return SLOT_ORDER.map((slot) => ({ slot, cell: schedule.grid[day]?.[slot] })).filter((m) => m.cell);
  }, [schedule.grid]);

  const pollPreview = useMemo(() => {
    const names: string[] = [];
    for (const slot of SLOT_ORDER) {
      for (const item of voting.itemsBySlot[slot] ?? []) {
        names.push(item.name);
        if (names.length >= 3) return names;
      }
    }
    return names;
  }, [voting.itemsBySlot]);

  return {
    isLoading: financials.isLoading || schedule.isLoading || voting.isLoading,
    name: session.name,
    hostelId: session.hostelId,
    hostelName: profile.hostel?.name ?? null,
    roomNo: roomQuery.data?.room?.room_no ?? null,
    financials,
    todaysMeals,
    pollAvailable: Boolean(voting.period && voting.isOpen),
    pollPreview,
    announcements: announcementsQuery.data ?? [],
    events: eventsQuery.data ?? [],
    hasComplaint: roomState.hasOpenComplaint,
    latestComplaint: roomState.latestOpenRequest,
  };
}
