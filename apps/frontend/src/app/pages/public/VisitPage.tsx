import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { admissionsPublicService } from '@features/admissions/api';
import {
  availableBeds,
  fallbackPhoto,
  HostelExplorer,
  InterestConfirmation,
  QuickRegistrationSheet,
  RoomDetail,
  RoomExplorer,
  roomPrice,
  ShareWithParents,
  type VisitorScreen,
  WelcomeLanding,
} from '@features/admissions/components/visitor';
import { queryKeys } from '@lib/queryKeys';

export function VisitPage() {
  const { hostelSlug = '' } = useParams();
  const [visitorScreen, setVisitorScreen] = useState<VisitorScreen>('welcome');
  const [showRegistration, setShowRegistration] = useState(false);
  const [pendingInterestRoomId, setPendingInterestRoomId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [successRoomId, setSuccessRoomId] = useState<string | null>(null);
  const [shareRoomId, setShareRoomId] = useState<string | null>(null);
  const [interestedRooms, setInterestedRooms] = useState<Set<string>>(new Set());
  const [lead, setLead] = useState<any>(() => {
    try {
      const savedId = sessionStorage.getItem(`visit-lead-id:${hostelSlug}`);
      return savedId ? { id: savedId } : null;
    } catch {
      return null;
    }
  });
  const [form, setForm] = useState({
    student_name: '',
    student_phone: '',
    student_email: '',
    parent_name: '',
    parent_phone: '',
    decision_maker_type: 'BOTH',
    website: '',
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.admissions.visit(hostelSlug),
    queryFn: () => admissionsPublicService.getVisitHostel(hostelSlug),
    staleTime: 3 * 60 * 1000,
  });

  useEffect(() => {
    localStorage.removeItem(`visit-lead:${hostelSlug}`);
  }, [hostelSlug]);

  const rooms = data?.rooms || [];
  const selectedRoom = rooms.find((room: any) => String(room.id) === String(selectedRoomId));
  const successRoom = rooms.find((room: any) => String(room.id) === String(successRoomId));
  const shareRoom = rooms.find((room: any) => String(room.id) === String(shareRoomId));
  const availableCount = rooms.reduce((sum: number, room: any) => sum + availableBeds(room), 0);
  const startingPrice = data?.hostel?.starting_price || rooms.map(roomPrice).filter(Boolean).sort((a: number, b: number) => a - b)[0] || null;
  const ownerHostels = useMemo(() => {
    if (Array.isArray(data?.owner_hostels) && data.owner_hostels.length > 0) return data.owner_hostels;
    return [
      {
        id: data?.hostel?.id,
        public_slug: data?.hostel?.public_slug,
        name: data?.hostel?.name,
        vacancy_count: availableCount,
        starting_price: startingPrice,
        is_current: true,
      },
      ...(data?.other_hostels || []).map((hostel: any) => ({ ...hostel, is_current: false })),
    ].filter((hostel: any) => hostel.id);
  }, [availableCount, data, startingPrice]);

  const heroPhoto = data?.hostel?.photos?.[0] || data?.hostel?.logo_url || fallbackPhoto;

  const recordActivity = (currentLeadId: string | undefined, type: string, metadata?: any) => {
    if (!currentLeadId) return;
    admissionsPublicService.recordActivity(hostelSlug, {
      lead_id: currentLeadId,
      activity_type: type,
      metadata: metadata || {},
    }).catch(() => undefined);
  };

  const createLead = useMutation({
    mutationFn: () => admissionsPublicService.createLead(hostelSlug, { ...form, source: 'QR' }),
    onSuccess: (created) => {
      setLead(created);
      setShowRegistration(false);
      sessionStorage.setItem(`visit-lead-id:${hostelSlug}`, String(created.id));
      if (pendingInterestRoomId) {
        const room = rooms.find((item: any) => String(item.id) === String(pendingInterestRoomId));
        setInterestedRooms((prev) => new Set([...prev, String(pendingInterestRoomId)]));
        recordActivity(created.id, 'MARK_INTEREST', { room_id: pendingInterestRoomId });
        setSuccessRoomId(pendingInterestRoomId);
        setSelectedRoomId(null);
        setVisitorScreen('rooms');
        setPendingInterestRoomId(null);
        if (!room) setVisitorScreen('hostel');
      } else {
        setVisitorScreen('hostel');
      }
    },
  });

  const requireLeadThen = (roomId: string, action: () => void) => {
    if (!lead?.id) {
      setPendingInterestRoomId(roomId);
      setShowRegistration(true);
      return;
    }
    action();
  };

  const markInterest = (room: any) => {
    requireLeadThen(room.id, () => {
      setInterestedRooms((prev) => new Set([...prev, String(room.id)]));
      recordActivity(lead?.id, 'MARK_INTEREST', { room_id: room.id });
      setSuccessRoomId(room.id);
      setSelectedRoomId(null);
    });
  };

  if (selectedRoom) {
    return <RoomDetail room={selectedRoom} onBack={() => setSelectedRoomId(null)} onInterest={() => markInterest(selectedRoom)} interested={interestedRooms.has(String(selectedRoom.id))} />;
  }

  if (successRoom) {
    return (
      <InterestConfirmation
        room={successRoom}
        hostel={data?.hostel}
        studentName={lead?.student_name || form.student_name}
        onExploreMore={() => {
          setSuccessRoomId(null);
          setVisitorScreen('rooms');
        }}
        onShare={() => {
          setShareRoomId(successRoom.id);
          setSuccessRoomId(null);
        }}
      />
    );
  }

  if (shareRoom) {
    return (
      <ShareWithParents
        room={shareRoom}
        hostel={data?.hostel}
        studentName={lead?.student_name || form.student_name}
        onBack={() => {
          setSuccessRoomId(shareRoom.id);
          setShareRoomId(null);
        }}
      />
    );
  }

  if (isLoading) return <div className="min-h-screen bg-[var(--warm-ivory)]" />;
  if (isError || !data) {
    return (
      <main className="min-h-screen bg-[var(--warm-ivory)] px-5 py-10">
        <div className="mx-auto max-w-md rounded-2xl border bg-white p-5">
          <h1 className="text-xl font-bold text-[var(--brand-navy)]">Admissions link unavailable</h1>
          <p className="mt-2 text-sm text-[var(--neutral-gray)]">Please ask the hostel owner for the latest QR link.</p>
        </div>
      </main>
    );
  }

  return (
    <>
      {visitorScreen === 'welcome' && (
        <WelcomeLanding
          hostel={data.hostel}
          heroPhoto={heroPhoto}
          startingPrice={startingPrice}
          availableCount={availableCount}
          onExplore={() => {
            if (lead?.id) setVisitorScreen('hostel');
            else setShowRegistration(true);
          }}
        />
      )}

      {visitorScreen === 'hostel' && (
        <HostelExplorer
          data={data}
          heroPhoto={heroPhoto}
          startingPrice={startingPrice}
          availableCount={availableCount}
          ownerHostels={ownerHostels}
          onViewRooms={() => setVisitorScreen('rooms')}
        />
      )}

      {visitorScreen === 'rooms' && (
        <RoomExplorer
          rooms={rooms}
          interestedRooms={interestedRooms}
          onBack={() => setVisitorScreen('hostel')}
          onView={(room) => {
            recordActivity(lead?.id, 'VIEW_ROOM', { room_id: room.id });
            setSelectedRoomId(room.id);
          }}
          onInterest={markInterest}
        />
      )}

      <QuickRegistrationSheet
        open={showRegistration}
        onClose={() => {
          setShowRegistration(false);
          setPendingInterestRoomId(null);
        }}
        form={form}
        setForm={setForm}
        onSubmit={() => createLead.mutate()}
        saving={createLead.isPending}
        error={createLead.isError}
      />
    </>
  );
}
