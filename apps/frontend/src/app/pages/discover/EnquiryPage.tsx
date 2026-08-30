import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Lock, Phone, ShieldCheck } from 'lucide-react';

import { useAuth } from '@context/AuthContext';
import { authApi } from '@lib/authApi';
import { useCreateEnquiry, useDiscoverListing, useIsSeeker } from '@features/discover/hooks/useDiscover';
import { groupRoomsByFloor, type SeatGridSourceRoom } from '@shared/ui-patterns/roomSeatGrid';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

import { useDiscoverAuth } from './DiscoverAuthContext';
import { PrimaryButton } from './components/DiscoverShell';
import { RoomPreferenceGrid } from './components/RoomPreferenceGrid';
import { C, FONT, PHOTO_FALLBACK, formatRupees } from './discoverTheme';
import MoveInDateField from './MoveInDateField';
import {
  needsPhoneVerification as computeNeedsPhoneVerification,
  resolveSendCodeOutcome,
  shouldUpdateName,
  validateOtpInput,
  validatePhoneInput,
} from './enquiryPhoneVerification';
import {
  detailsLabel,
  durationLabel,
  moveInLabel,
  sendAction,
} from './enquirySummary';

const DURATIONS = [3, 6, 12];

export function EnquiryPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isSeeker, loading: authLoading, user } = useIsSeeker();
  const { openSignIn } = useDiscoverAuth();
  const { updateUser } = useAuth();

  const seeded = (location.state ?? {}) as { roomCapacity?: number; hostelName?: string };

  const { data } = useDiscoverListing(slug);
  const createEnquiry = useCreateEnquiry();

  /**
   * `null` means "flexible" — the seeker never picked a date, and none is
   * sent. It used to default to today, which asserted a move-in on their
   * behalf; an owner reads "moving in today" very differently from
   * "flexible". See `enquirySummary.moveInLabel`.
   */
  const [moveIn, setMoveIn] = useState<string | null>(null);
  /** Which sheet is open. The page itself asks nothing. */
  const [sheet, setSheet] = useState<null | 'movein' | 'duration' | 'details' | 'phone'>(null);
  const [duration, setDuration] = useState(6);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Room preference — entirely optional. Picking a floor without a room
  // means "any available room on that floor"; clearing either resets both,
  // since a room only ever makes sense alongside the floor it's on.
  const [preferredFloorId, setPreferredFloorId] = useState<string | null>(null);
  const [preferredRoomId, setPreferredRoomId] = useState<string | null>(null);

  const seatGridRooms: SeatGridSourceRoom[] = useMemo(
    () =>
      (data?.rooms ?? []).map((room: any) => ({
        id: room.id,
        roomNo: room.room_no,
        floorId: room.floor_id ?? null,
        floorName: room.floor_name ?? null,
        available: Number(room.available_beds ?? 0),
      })),
    [data?.rooms],
  );
  const preferenceFloors = useMemo(
    () => groupRoomsByFloor(seatGridRooms, { selectedRoomId: preferredRoomId }),
    [seatGridRooms, preferredRoomId],
  );
  const preferredFloorName = preferenceFloors.find((f) => f.id === preferredFloorId)?.name ?? null;
  const preferredRoomNo = preferenceFloors.flatMap((f) => f.rooms).find((r) => r.id === preferredRoomId)?.roomNo ?? null;

  const selectPreferredFloor = (floorId: string) => {
    setPreferredFloorId(floorId);
    setPreferredRoomId(null);
  };
  const selectPreferredRoom = (roomId: string) => {
    setPreferredRoomId((current) => (current === roomId ? null : roomId));
  };
  const clearRoomPreference = () => {
    setPreferredFloorId(null);
    setPreferredRoomId(null);
  };

  // Phone verification — only asked once, and only when actually needed
  // (no verified phone on file yet). `phoneStep` starts at 'confirm' if the
  // account already has *some* phone on file (just needs re-confirming +
  // OTP), or empty if it's a fresh Google-provisioned account with none.
  const [phoneStep, setPhoneStep] = useState<'confirm' | 'otp'>('confirm');
  const [phoneInput, setPhoneInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.phone) setPhoneInput(user.phone);
    if (user?.name) setNameInput(user.name);
  }, [user?.phone, user?.name]);

  const needsPhoneVerification = computeNeedsPhoneVerification(isSeeker, user);

  const sendCode = async () => {
    setPhoneError(null);
    const phone = phoneInput.trim();
    const phoneCheck = validatePhoneInput(phone);
    if (!phoneCheck.valid) {
      setPhoneError(phoneCheck.error);
      return;
    }
    setPhoneSubmitting(true);
    try {
      if (shouldUpdateName(nameInput, user?.name)) await authApi.updateBasicProfile({ name: nameInput.trim() });
      // Phone must be saved to the profile BEFORE the OTP is verified —
      // verifyPhoneOtp marks `phone_verified: true` on whichever profile(s)
      // currently have this phone on file (lib/services/auth/auth-otp-service.ts).
      await authApi.updateBasicProfile({ phone });
      const result = await authApi.sendPhoneOtp(phone);
      const outcome = resolveSendCodeOutcome(result);
      if (outcome.kind === 'submit_immediately') {
        updateUser({ phone, phone_verified: false });
        submit();
        return;
      }
      updateUser({ phone });
      setOtpInput('');
      setPhoneStep('otp');
    } catch (err: any) {
      setPhoneError(err?.response?.data?.error?.message || 'Could not send the code. Please try again.');
    } finally {
      setPhoneSubmitting(false);
    }
  };

  const verifyCodeAndSubmit = async () => {
    setPhoneError(null);
    const otpCheck = validateOtpInput(otpInput);
    if (!otpCheck.valid) {
      setPhoneError(otpCheck.error);
      return;
    }
    setPhoneSubmitting(true);
    try {
      await authApi.verifyPhoneOtp(phoneInput.trim(), otpInput.trim());
      updateUser({ phone: phoneInput.trim(), phone_verified: true });
      submit();
    } catch (err: any) {
      setPhoneError(err?.response?.data?.error?.message || 'Verification failed. Check the code and try again.');
    } finally {
      setPhoneSubmitting(false);
    }
  };

  const detailsSummary = detailsLabel(
    { floorName: preferredFloorName, roomNo: preferredRoomNo },
    message,
  );
  const hasDetails = Boolean(preferredFloorId) || message.trim().length > 0;

  /**
   * One button, three destinations. The page no longer changes shape based on
   * whether a number has been verified — it changes what the button does.
   */
  const action = sendAction({ isSeeker, needsPhoneVerification });
  const handleSend = () => {
    if (action === 'sign_in') {
      openSignIn();
      return;
    }
    if (action === 'verify_phone') {
      setPhoneError(null);
      setSheet('phone');
      return;
    }
    submit();
  };

  const hostel = data?.hostel;
  const capacity = seeded.roomCapacity;

  useEffect(() => {
    document.title = 'Send an enquiry — Stayo';
  }, []);

  const submit = () => {
    setError(null);
    if (!slug) return;
    createEnquiry.mutate(
      {
        slug,
        roomCapacity: capacity,
        moveInDate: moveIn ?? undefined,
        durationMonths: duration,
        message: message.trim() || undefined,
        preferredFloorId: preferredFloorId ?? undefined,
        preferredRoomId: preferredRoomId ?? undefined,
      },
      {
        onSuccess: (enquiry) => navigate(`/profile/enquiries/${enquiry.id}`, { replace: true }),
        onError: (mutationError: any) =>
          setError(
            mutationError?.response?.data?.message ??
              'Could not send your enquiry. Please try again.',
          ),
      },
    );
  };

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header
        className="flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <div>
          <h1 className="text-[20px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
            Send an enquiry
          </h1>
          <p className="text-[11.5px]" style={{ color: C.textMuted }}>
            The owner replies to you directly
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-5 px-5 py-5">
        {/* What they're enquiring about */}
        <div
          className="flex gap-3.5 rounded-[18px] border bg-white p-4"
          style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
        >
          <div
            className="h-16 w-16 flex-none rounded-xl bg-cover bg-center"
            style={hostel?.photos?.[0] ? { backgroundImage: `url(${hostel.photos[0]})` } : PHOTO_FALLBACK}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
              {hostel?.name ?? seeded.hostelName ?? 'This hostel'}
            </p>
            <p className="mt-0.5 text-[11.5px]" style={{ color: C.textMuted }}>
              {capacity
                ? capacity === 1
                  ? 'Single room'
                  : `${capacity}-bed sharing`
                : 'Any available bed'}
              {hostel?.city ? ` · ${hostel.city}` : ''}
            </p>
            {hostel?.starting_price != null && (
              <p className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[16px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
                  ₹{formatRupees(hostel.starting_price)}
                </span>
                <span className="text-[11px]" style={{ color: C.textMuted }}>/mo onwards</span>
              </p>
            )}
          </div>
        </div>


        {/*
          The enquiry as a set of answers, not a set of questions. Both rows
          already have a value, so tapping one is a correction rather than a
          task — which is what lets a seeker who agrees with the defaults send
          in a single tap. See enquirySummary.
        */}
        <section className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: C.line }}>
          <SummaryRow
            label="Moving in"
            value={moveInLabel(moveIn)}
            muted={!moveIn}
            onClick={() => setSheet('movein')}
          />
          <div className="h-px" style={{ background: C.line }} />
          <SummaryRow
            label="Staying"
            value={durationLabel(duration)}
            onClick={() => setSheet('duration')}
          />
        </section>

        {/*
          Everything optional lives behind one line. The room grid — floor
          tabs, room chips and a three-state legend — was the loudest thing on
          the screen while being the least necessary, and it drowned the send
          button. Once something is chosen this line states it, so it never
          has to be opened just to check.
        */}
        <button
          type="button"
          onClick={() => setSheet('details')}
          className="flex w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-left"
          style={{ borderColor: C.lineInput, background: hasDetails ? C.chipBg : '#fff' }}
        >
          <span
            className="min-w-0 truncate text-[12.5px] font-semibold"
            style={{ color: hasDetails ? C.text : C.textMuted }}
          >
            {hasDetails ? detailsSummary : `+ ${detailsSummary}`}
          </span>
          <ChevronRight className="h-4 w-4 flex-none" style={{ color: C.textFaint }} />
        </button>

        {isSeeker ? (
          <p className="px-1 text-[11.5px] leading-[1.5]" style={{ color: C.textMuted }}>
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={2} style={{ color: C.green }} />
            Sending as {user?.name ?? 'your Stayo account'} — the owner sees your name, phone and email so
            they can reply.
          </p>
        ) : (
          <section className="rounded-2xl border p-4" style={{ background: '#F6F0E8', borderColor: '#EADFCF' }}>
            <div className="flex items-start gap-3">
              <Lock className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: C.clay }} />
              <div>
                <p className="text-[13px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
                  Sign in to send this
                </p>
                <p className="mt-1 text-[11.5px] leading-[1.55]" style={{ color: '#5A5147' }}>
                  A Stayo account keeps your enquiries in one place and lets owners reply. It's the same
                  account you'll use to move in — anywhere on Stayo.
                </p>
              </div>
            </div>
          </section>
        )}

        {error && (
          <p
            className="rounded-xl px-3.5 py-3 text-[12.5px] font-medium"
            style={{ background: '#F7E4DF', color: '#B3402F' }}
            role="alert"
          >
            {error}
          </p>
        )}
      </main>

      {/*
        One button, always. Phone verification used to render inline above it
        and own submission, so the page had two different ways to send
        depending on a state the seeker could not see. Now `sendAction`
        decides what this one button does.
      */}
      <div
        className="sticky bottom-0 flex-none border-t px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <PrimaryButton full disabled={authLoading || createEnquiry.isPending} onClick={handleSend}>
          {createEnquiry.isPending ? 'Sending…' : action === 'sign_in' ? 'Sign in to send' : 'Send enquiry'}
        </PrimaryButton>
        <p className="mt-2 text-center text-[11px]" style={{ color: C.textMuted }}>
          Free · no booking or payment
        </p>
      </div>

      <BottomSheet open={sheet === 'movein'} onOpenChange={(open) => !open && setSheet(null)} title="When are you moving in?">
        <div className="space-y-3 pb-2">
          <MoveInDateField value={moveIn ?? ''} onChange={(iso) => setMoveIn(iso)} />
          <button
            type="button"
            onClick={() => {
              setMoveIn(null);
              setSheet(null);
            }}
            className="w-full rounded-[13px] border py-3 text-[12.5px] font-semibold"
            style={{ borderColor: C.lineInput, color: C.textBody, background: '#fff' }}
          >
            I'm flexible
          </button>
          <PrimaryButton full onClick={() => setSheet(null)}>Done</PrimaryButton>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'duration'} onOpenChange={(open) => !open && setSheet(null)} title="How long will you stay?">
        <div className="flex flex-col gap-2 pb-2">
          {DURATIONS.map((months) => {
            const active = duration === months;
            return (
              <button
                key={months}
                type="button"
                onClick={() => {
                  setDuration(months);
                  setSheet(null);
                }}
                aria-pressed={active}
                className="rounded-[13px] py-3.5 text-center text-[13.5px] font-semibold"
                style={{
                  background: active ? C.clayPaleBg : '#fff',
                  border: active ? `1.5px solid ${C.clay}` : `1px solid ${C.lineInput}`,
                  color: active ? '#A4482F' : C.textBody,
                }}
              >
                {durationLabel(months)}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'details'} onOpenChange={(open) => !open && setSheet(null)} title="Room preference and note">
        <div className="space-y-5 pb-2">
          {preferenceFloors.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
                Preferred room{' '}
                <span style={{ color: C.textFaint, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal' }}>
                  (optional)
                </span>
              </h2>
              <RoomPreferenceGrid
                floors={preferenceFloors}
                activeFloorId={preferredFloorId}
                onSelectFloor={selectPreferredFloor}
                onSelectRoom={selectPreferredRoom}
              />
              {preferredFloorId && (
                <div
                  className="mt-3 flex items-center justify-between gap-2 rounded-[13px] px-3.5 py-2.5"
                  style={{ background: C.chipBg }}
                >
                  <p className="text-[12px] font-semibold" style={{ color: C.text }}>
                    {preferredFloorName}
                    {preferredRoomNo ? ` · ${preferredRoomNo}` : ' · Any available room'}
                  </p>
                  <button
                    type="button"
                    onClick={clearRoomPreference}
                    className="flex-none text-[11.5px] font-semibold underline"
                    style={{ color: C.textMuted }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </section>
          )}

          <section>
            <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
              Anything to add?
            </h2>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 1000))}
              rows={3}
              placeholder="Your college, when you can visit, questions about the room."
              className="w-full resize-none rounded-[13px] border bg-white px-3.5 py-3 text-[13.5px] outline-none"
              style={{ borderColor: C.lineInput, color: C.inkSoft }}
            />
          </section>

          <PrimaryButton full onClick={() => setSheet(null)}>Done</PrimaryButton>
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === 'phone'}
        onOpenChange={(open) => !open && setSheet(null)}
        title={phoneStep === 'otp' ? 'Enter the code we sent' : 'Confirm your phone number'}
      >
        <div className="pb-2">
          <div className="flex items-start gap-3">
            <Phone className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: C.clay }} />
            <p className="text-[11.5px] leading-[1.55]" style={{ color: '#5A5147' }}>
              {phoneStep === 'otp'
                ? `Sent to ${phoneInput.trim()}.`
                : "The owner needs a verified number to reach you — this only happens once."}
            </p>
          </div>

          {phoneStep === 'confirm' ? (
            <div className="mt-3.5 flex flex-col gap-2.5">
              {!user?.name && (
                <input
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-[11px] border bg-white px-3.5 py-2.5 text-[13.5px] outline-none"
                  style={{ borderColor: C.lineInput, color: C.inkSoft }}
                />
              )}
              <input
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                placeholder="+91 90000 00000"
                inputMode="tel"
                autoComplete="tel"
                className="w-full rounded-[11px] border bg-white px-3.5 py-2.5 text-[13.5px] outline-none"
                style={{ borderColor: C.lineInput, color: C.inkSoft }}
              />
              {phoneError && (
                <p className="text-[11.5px] font-semibold" style={{ color: '#B3402F' }}>{phoneError}</p>
              )}
              <PrimaryButton full disabled={phoneSubmitting} onClick={sendCode}>
                {phoneSubmitting ? 'Sending…' : 'Send code'}
              </PrimaryButton>
            </div>
          ) : (
            <div className="mt-3.5 flex flex-col gap-2.5">
              <input
                value={otpInput}
                onChange={(event) => setOtpInput(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoFocus
                placeholder="123456"
                className="w-full rounded-[11px] border bg-white px-3.5 py-2.5 text-center text-[13.5px] tracking-[0.3em] outline-none"
                style={{ borderColor: C.lineInput, color: C.inkSoft }}
              />
              {phoneError && (
                <p className="text-[11.5px] font-semibold" style={{ color: '#B3402F' }}>{phoneError}</p>
              )}
              <PrimaryButton full disabled={phoneSubmitting} onClick={verifyCodeAndSubmit}>
                {phoneSubmitting ? 'Verifying…' : 'Verify & send enquiry'}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => setPhoneStep('confirm')}
                className="text-center text-[11.5px] font-semibold"
                style={{ color: C.textMuted }}
              >
                Wrong number? Go back
              </button>
            </div>
          )}
        </div>
      </BottomSheet>

    </div>
  );
}

/**
 * One stated answer, tappable to change. Deliberately not a labelled form
 * field: the value is the point, and the label is only there to say what it
 * answers.
 */
function SummaryRow({
  label,
  value,
  muted,
  onClick,
}: {
  label: string;
  value: string;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
    >
      <span className="text-[12.5px]" style={{ color: C.textMuted }}>{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="truncate text-[13.5px] font-bold"
          style={{ fontFamily: FONT.display, color: muted ? C.textMuted : C.text }}
        >
          {value}
        </span>
        <ChevronRight className="h-4 w-4 flex-none" style={{ color: C.textFaint }} />
      </span>
    </button>
  );
}
