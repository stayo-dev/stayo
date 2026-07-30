import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bed,
  Building2,
  CheckCircle,
  Copy,
  Dumbbell,
  Heart,
  Home,
  IndianRupee,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
  Shield,
  Tv,
  Users,
  Utensils,
  Wifi,
  Wind,
  X,
} from 'lucide-react';

export const fallbackPhoto = '/android-chrome-512x512.png';

export type VisitorScreen = 'welcome' | 'hostel' | 'rooms';

export function rupee(value: number | null | undefined) {
  if (!value) return 'Ask owner';
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

export function roomPrice(room: any) {
  return Number(room?.pricing?.monthly_rent || room?.monthly_rent || 0);
}

function phoneLink(phone?: string | null) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `tel:${digits}` : '#';
}

function waLink(phone?: string | null, text?: string) {
  const digits = String(phone || '').replace(/\D/g, '');
  const encoded = text ? `?text=${encodeURIComponent(text)}` : '';
  return digits ? `https://wa.me/${digits}${encoded}` : `https://wa.me/${encoded}`;
}

function roomPhoto(room: any) {
  return room?.photos?.[0] || fallbackPhoto;
}

export function availableBeds(room: any) {
  return Number(room?.available_beds || room?.vacant_count || 0);
}

function occupiedBeds(room: any) {
  return Number(room?.occupied_count || 0);
}

function capacity(room: any) {
  return Number(room?.capacity || room?.total_beds || 0);
}

export function WelcomeLanding({
  hostel,
  heroPhoto,
  startingPrice,
  availableCount,
  onExplore,
}: {
  hostel: any;
  heroPhoto: string;
  startingPrice: number | null;
  availableCount: number;
  onExplore: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--warm-ivory)]">
      <div className="pb-6 pt-10 text-center">
        <div className="inline-flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-saffron)]">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-[var(--brand-navy)]" style={{ fontFamily: 'var(--font-hero)' }}>
            {hostel?.name || 'StayO'}
          </h1>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center px-6 pb-8">
        <div className="mx-auto w-full max-w-lg">
          <div className="mb-8 aspect-[4/3] overflow-hidden rounded-3xl border-2 border-[var(--brand-saffron)]/20 bg-gradient-to-br from-[var(--brand-saffron)]/20 to-[var(--brand-navy)]/10">
            <img src={heroPhoto} alt={hostel?.name || 'Hostel'} className="h-full w-full object-cover" />
          </div>

          <div className="mb-8 text-center">
            <h2 className="mb-4 text-4xl font-bold text-[var(--brand-navy)] md:text-5xl" style={{ fontFamily: 'var(--font-hero)' }}>
              Your Home Near College
            </h2>
            <p className="mb-8 text-lg text-[var(--neutral-gray)]">
              {availableCount} beds open. Pricing starts from {rupee(startingPrice)} with food, safety, and room details ready to compare.
            </p>
          </div>

          <div className="mb-8 flex flex-wrap items-center justify-center gap-4 text-sm text-[var(--deep-charcoal)]">
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--brand-saffron)]" />
              {hostel?.city || 'Nearby colleges'}
            </span>
            <span className="text-[var(--neutral-gray)]">·</span>
            <span className="inline-flex items-center gap-2">
              <Utensils className="h-4 w-4 text-[var(--brand-saffron)]" />
              Meals Included
            </span>
            <span className="text-[var(--neutral-gray)]">·</span>
            <span className="inline-flex items-center gap-2">
              <Shield className="h-4 w-4 text-[var(--brand-saffron)]" />
              Safe Preview
            </span>
          </div>

          <button type="button" onClick={onExplore} className="h-14 w-full rounded-2xl bg-[var(--brand-saffron)] text-lg font-semibold text-white shadow-lg">
            Explore Hostel <ArrowRight className="ml-1 inline h-5 w-5" />
          </button>

          <a href={waLink(hostel?.phone)} target="_blank" rel="noreferrer" className="mt-4 block w-full text-center text-[var(--neutral-gray)]">
            Already visited? Contact us directly
          </a>
        </div>
      </div>
    </div>
  );
}

export function QuickRegistrationSheet({
  open,
  onClose,
  form,
  setForm,
  onSubmit,
  saving,
  error,
}: {
  open: boolean;
  onClose: () => void;
  form: any;
  setForm: (next: any) => void;
  onSubmit: () => void;
  saving: boolean;
  error: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <button className="absolute inset-0 bg-black/50" aria-label="Close registration" onClick={onClose} />
      <div className="relative w-full rounded-t-3xl bg-white p-6 shadow-2xl md:max-w-lg md:rounded-3xl">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-[var(--neutral-gray)] hover:bg-[var(--warm-ivory)]">
          <X className="h-5 w-5" />
        </button>

        <div className="mb-5">
          <h2 className="text-2xl font-bold text-[var(--brand-navy)]">Quick Registration</h2>
          <p className="mt-1 text-sm text-[var(--neutral-gray)]">Just your name and number. No account, OTP, or password.</p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input className="hidden" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          <input required placeholder="Student name" className="h-14 w-full rounded-2xl border-0 bg-[var(--warm-ivory)] px-4 text-base outline-none ring-1 ring-transparent focus:ring-[var(--brand-saffron)]" value={form.student_name} onChange={(e) => setForm({ ...form, student_name: e.target.value })} />
          <input required placeholder="Student mobile" inputMode="tel" className="h-14 w-full rounded-2xl border-0 bg-[var(--warm-ivory)] px-4 text-base outline-none ring-1 ring-transparent focus:ring-[var(--brand-saffron)]" value={form.student_phone} onChange={(e) => setForm({ ...form, student_phone: e.target.value })} />
          <input type="email" placeholder="Student email (optional now)" className="h-14 w-full rounded-2xl border-0 bg-[var(--warm-ivory)] px-4 text-base outline-none ring-1 ring-transparent focus:ring-[var(--brand-saffron)]" value={form.student_email} onChange={(e) => setForm({ ...form, student_email: e.target.value })} />
          <input placeholder="Parent name (optional)" className="h-14 w-full rounded-2xl border-0 bg-[var(--warm-ivory)] px-4 text-base outline-none ring-1 ring-transparent focus:ring-[var(--brand-saffron)]" value={form.parent_name} onChange={(e) => setForm({ ...form, parent_name: e.target.value })} />
          <input placeholder="Parent mobile (optional)" inputMode="tel" className="h-14 w-full rounded-2xl border-0 bg-[var(--warm-ivory)] px-4 text-base outline-none ring-1 ring-transparent focus:ring-[var(--brand-saffron)]" value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} />
          <select className="h-14 w-full rounded-2xl border-0 bg-[var(--warm-ivory)] px-4 text-base outline-none ring-1 ring-transparent focus:ring-[var(--brand-saffron)]" value={form.decision_maker_type} onChange={(e) => setForm({ ...form, decision_maker_type: e.target.value })}>
            <option value="BOTH">Student and parent decide</option>
            <option value="PARENT">Parent decides</option>
            <option value="STUDENT">Student decides</option>
          </select>
          {error && <p className="text-sm font-medium text-[var(--danger-red)]">Could not save details. Please check the phone number and try again.</p>}
          <button disabled={saving} className="h-14 w-full rounded-2xl bg-[var(--brand-saffron)] text-lg font-semibold text-white disabled:opacity-60">
            {saving ? 'Saving...' : 'Continue'}
          </button>
          <p className="text-center text-sm text-[var(--neutral-gray)]">No spam. The owner uses this only for admissions follow-up.</p>
        </form>
      </div>
    </div>
  );
}

export function HostelExplorer({
  data,
  heroPhoto,
  startingPrice,
  availableCount,
  ownerHostels,
  onViewRooms,
}: {
  data: any;
  heroPhoto: string;
  startingPrice: number | null;
  availableCount: number;
  ownerHostels: any[];
  onViewRooms: () => void;
}) {
  const hostel = data.hostel;
  const gallery = (hostel.photos || []).slice(0, 4);
  while (gallery.length < 4) gallery.push(heroPhoto);

  const facilities = [
    { icon: Wifi, label: 'WiFi', description: 'High-speed internet in rooms' },
    { icon: Utensils, label: 'Meals', description: 'Homely food and daily meals' },
    { icon: Shield, label: 'Security', description: 'Safety-first admission preview' },
    { icon: Tv, label: 'TV Room', description: 'Common entertainment area' },
    { icon: Dumbbell, label: 'Fitness', description: 'Basic fitness support' },
    { icon: Wind, label: 'Ventilation', description: 'Comfortable rooms' },
    { icon: Users, label: 'Study Space', description: 'Quiet shared study support' },
  ];

  const weekMenu = [
    ['Monday', 'Idli, Sambar', 'Rice, Dal, Curry', 'Chapati, Dal'],
    ['Tuesday', 'Dosa, Chutney', 'Rice, Sambar', 'Rice, Curry'],
    ['Wednesday', 'Upma', 'Rice, Dal', 'Chapati, Curry'],
    ['Thursday', 'Poha', 'Rice, Fry', 'Rice, Dal'],
    ['Friday', 'Idli', 'Special Rice', 'Chapati, Paneer'],
  ];

  const rules = [
    ['Entry and exit timings', hostel.curfew || 'Gate timings are shared by the owner during admission.'],
    ['Visitors policy', 'Visitors are allowed only in approved common areas.'],
    ['Room maintenance', 'Rooms must be kept clean. Maintenance support is available.'],
    ['Noise policy', 'Quiet hours protect student study time.'],
  ];

  return (
    <div className="min-h-screen bg-[var(--warm-ivory)] pb-24">
      <div className="relative h-64 bg-gradient-to-br from-[var(--brand-saffron)]/20 to-[var(--brand-navy)]/20">
        <img src={heroPhoto} alt={hostel.name} className="h-full w-full object-cover" />
      </div>

      <div className="-mt-8 px-6">
        <div className="rounded-2xl bg-white p-4 shadow-lg">
          <h1 className="mb-3 text-xl font-bold text-[var(--brand-navy)]">{hostel.name}</h1>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-[var(--brand-saffron)]/10 px-3 py-1 text-sm font-medium text-[var(--brand-saffron)]">{rupee(startingPrice)}/mo</span>
            <span className="rounded-full bg-[var(--brand-navy)]/10 px-3 py-1 text-sm text-[var(--brand-navy)]">{availableCount} beds open</span>
            <span className="rounded-full bg-[var(--success-green)]/10 px-3 py-1 text-sm text-[var(--success-green)]">Meals</span>
            <span className="rounded-full bg-[var(--brand-navy)]/10 px-3 py-1 text-sm text-[var(--brand-navy)]">WiFi</span>
            <span className="rounded-full bg-[var(--brand-saffron)]/10 px-3 py-1 text-sm text-[var(--brand-saffron)]">{hostel.city || 'Near college'}</span>
          </div>
        </div>
      </div>

      {ownerHostels.length > 1 && (
        <section className="mt-8 px-6">
          <h2 className="mb-4 text-2xl font-semibold text-[var(--brand-navy)]">Choose a Hostel</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {ownerHostels.map((hostelOption: any) => {
              const isCurrent = hostelOption.public_slug === hostel.public_slug || hostelOption.is_current;
              return (
                <a key={hostelOption.id} href={isCurrent ? '#current-hostel' : `/visit/${hostelOption.public_slug}`} className={`min-w-[260px] rounded-xl border bg-white p-4 ${isCurrent ? 'border-[var(--brand-saffron)]' : 'border-[var(--border)]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <b className="text-[var(--deep-charcoal)]">{hostelOption.name}</b>
                    {isCurrent ? <span className="rounded-full bg-[var(--brand-saffron)] px-2 py-1 text-[10px] font-bold text-white">Viewing</span> : <ArrowRight className="h-4 w-4" />}
                  </div>
                  <p className="mt-2 text-sm text-[var(--neutral-gray)]">{Number(hostelOption.vacancy_count || 0)} beds open · From {rupee(hostelOption.starting_price)}</p>
                </a>
              );
            })}
          </div>
        </section>
      )}

      <section id="current-hostel" className="mt-8 px-6">
        <h2 className="mb-4 text-2xl font-semibold text-[var(--brand-navy)]">About</h2>
        <p className="leading-relaxed text-[var(--neutral-gray)]">
          {hostel.name} has {availableCount} open beds with pricing from {rupee(startingPrice)}. Parents can review safety, food, rules, and roommate privacy before deciding.
        </p>
      </section>

      <section className="mt-8 px-6">
        <h2 className="mb-4 text-2xl font-semibold text-[var(--brand-navy)]">Gallery</h2>
        <div className="grid grid-cols-2 gap-3">
          {gallery.map((photo: string, index: number) => (
            <div key={`${photo}-${index}`} className="aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-[var(--brand-saffron)]/10 to-[var(--brand-navy)]/5">
              <img src={photo} alt={`${hostel.name} photo ${index + 1}`} loading="lazy" className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 px-6">
        <h2 className="mb-4 text-2xl font-semibold text-[var(--brand-navy)]">Facilities</h2>
        <div className="grid grid-cols-3 gap-4">
          {facilities.map((facility) => {
            const Icon = facility.icon;
            return (
              <div key={facility.label} className="flex flex-col items-center gap-2 rounded-xl bg-white p-4 text-center">
                <Icon className="h-8 w-8 text-[var(--brand-saffron)]" />
                <span className="text-xs text-[var(--deep-charcoal)]">{facility.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8 px-6">
        <h2 className="mb-4 text-2xl font-semibold text-[var(--brand-navy)]">Weekly Menu</h2>
        <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-2 scrollbar-hide">
          {weekMenu.map(([day, breakfast, lunch, dinner]) => (
            <div key={day} className="min-w-[280px] rounded-xl border border-[var(--brand-saffron)]/20 bg-[#FFFBF0] p-4">
              <h3 className="mb-3 font-semibold text-[var(--brand-navy)]">{day}</h3>
              <div className="space-y-2 text-sm">
                <div><span className="text-xs text-[var(--neutral-gray)]">Breakfast</span><p className="text-[var(--deep-charcoal)]">{breakfast}</p></div>
                <div><span className="text-xs text-[var(--neutral-gray)]">Lunch</span><p className="text-[var(--deep-charcoal)]">{lunch}</p></div>
                <div><span className="text-xs text-[var(--neutral-gray)]">Dinner</span><p className="text-[var(--deep-charcoal)]">{dinner}</p></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 mt-8 px-6">
        <h2 className="mb-4 text-2xl font-semibold text-[var(--brand-navy)]">Rules & Timings</h2>
        <div className="overflow-hidden rounded-xl bg-white">
          {rules.map(([title, content], index) => (
            <details key={title} className="border-b border-[var(--border)] last:border-0">
              <summary className="cursor-pointer px-4 py-4 text-[var(--deep-charcoal)]">{title}</summary>
              <p className="px-4 pb-4 text-sm text-[var(--neutral-gray)]">{content}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mb-8 px-6">
        <h2 className="mb-4 text-2xl font-semibold text-[var(--brand-navy)]">Location</h2>
        <div className="rounded-xl bg-white p-4">
          <div className="mb-3 flex aspect-video items-center justify-center rounded-lg bg-gradient-to-br from-[var(--success-green)]/10 to-[var(--brand-navy)]/10">
            <MapPin className="h-12 w-12 text-[var(--brand-saffron)]" />
          </div>
          <p className="rounded-full bg-[var(--success-green)]/10 px-3 py-1 text-center text-sm font-medium text-[var(--success-green)]">{hostel.city || 'Location shared by owner'}</p>
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-white p-4 shadow-lg">
        <div className="mx-auto flex max-w-lg gap-3">
          <a href={phoneLink(hostel.phone)} className="flex items-center gap-2 rounded-xl bg-[var(--warm-ivory)] px-4 py-3 font-medium text-[var(--brand-navy)]">
            <Phone className="h-5 w-5" /> Call
          </a>
          <a href={waLink(hostel.phone)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-[var(--warm-ivory)] px-4 py-3 font-medium text-[var(--success-green)]">
            <MessageCircle className="h-5 w-5" /> WhatsApp
          </a>
          <button type="button" onClick={onViewRooms} className="flex flex-1 items-center justify-center rounded-xl bg-[var(--brand-saffron)] px-4 py-3 font-semibold text-white">
            View Rooms <ArrowRight className="ml-1 h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function RoomCard({
  room,
  onView,
  onInterest,
  interested,
}: {
  room: any;
  onView: () => void;
  onInterest: () => void;
  interested: boolean;
}) {
  const available = availableBeds(room);
  const isFull = available <= 0;
  const status = isFull ? 'Full' : `${available} Bed${available === 1 ? '' : 's'} Available`;

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <button type="button" onClick={onView} className="block w-full text-left">
        <div className="relative h-48 bg-gradient-to-br from-[var(--brand-navy)]/10 to-[var(--brand-saffron)]/10">
          <img src={roomPhoto(room)} alt={`Room ${room.room_no}`} loading="lazy" className="h-full w-full object-cover" />
          <span className="absolute left-3 top-3 rounded-lg bg-[var(--brand-navy)] px-3 py-1 font-semibold text-white">Room {room.room_no}</span>
          <span className={`absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-semibold text-white ${isFull ? 'bg-[var(--danger-red)]' : 'bg-[var(--success-green)]'}`}>{status}</span>
        </div>
      </button>

      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-[var(--neutral-gray)]">
          <span className="inline-flex items-center gap-1"><Bed className="h-4 w-4" /> {capacity(room)} Beds</span>
          <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {occupiedBeds(room)} Occupied</span>
          <span className="inline-flex items-center gap-1 text-[var(--success-green)]"><CheckCircle className="h-4 w-4" /> {available} Available</span>
        </div>
        <div className="mb-3">
          <span className="text-2xl font-bold text-[var(--brand-saffron)]">{rupee(roomPrice(room))}</span>
          <span className="text-[var(--neutral-gray)]">/month</span>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-[var(--neutral-gray)]">
          {['Maintenance', 'Meals', 'WiFi'].map((item) => (
            <span key={item} className="inline-flex items-center gap-1"><CheckCircle className="h-3 w-3 text-[var(--success-green)]" /> {item}</span>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onView} className="h-11 flex-1 rounded-xl border border-[var(--border)] font-semibold text-[var(--brand-navy)]">
            View Details
          </button>
          <button type="button" disabled={isFull || interested} onClick={onInterest} className={`h-11 flex-1 rounded-xl font-semibold text-white disabled:opacity-60 ${interested ? 'bg-[var(--success-green)]' : 'bg-[var(--brand-saffron)]'}`}>
            {interested ? <><CheckCircle className="mr-1 inline h-4 w-4" /> Interested</> : <><Heart className="mr-1 inline h-4 w-4" /> Interested</>}
          </button>
        </div>
      </div>
    </article>
  );
}

export function RoomExplorer({
  rooms,
  interestedRooms,
  onBack,
  onView,
  onInterest,
}: {
  rooms: any[];
  interestedRooms: Set<string>;
  onBack: () => void;
  onView: (room: any) => void;
  onInterest: (room: any) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'available' | '4-sharing'>('all');
  const filteredRooms = rooms.filter((room: any) => {
    if (filter === 'available') return availableBeds(room) > 0;
    if (filter === '4-sharing') return capacity(room) === 4;
    return true;
  });

  return (
    <div className="min-h-screen bg-[var(--warm-ivory)] pb-6">
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-white">
        <div className="px-6 py-4">
          <div className="mb-4 flex items-center gap-3">
            <button type="button" onClick={onBack} className="-ml-2 grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--warm-ivory)]">
              <ArrowLeft className="h-5 w-5 text-[var(--brand-navy)]" />
            </button>
            <h1 className="text-2xl font-bold text-[var(--brand-navy)]">Available Rooms</h1>
          </div>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {[
              ['all', 'All'],
              ['available', 'Available'],
              ['4-sharing', '4-Sharing'],
            ].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key as any)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${filter === key ? 'bg-[var(--brand-saffron)] text-white' : 'bg-[var(--warm-ivory)] text-[var(--deep-charcoal)]'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4 px-6">
        {filteredRooms.map((room: any) => (
          <RoomCard key={room.id} room={room} interested={interestedRooms.has(String(room.id))} onView={() => onView(room)} onInterest={() => onInterest(room)} />
        ))}
        {filteredRooms.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border)] bg-white p-4 text-center text-sm text-[var(--neutral-gray)]">No rooms match this filter.</p>}
      </div>
    </div>
  );
}

export function RoomDetail({
  room,
  onBack,
  onInterest,
  interested,
}: {
  room: any;
  onBack: () => void;
  onInterest: () => void;
  interested: boolean;
}) {
  const available = availableBeds(room);
  const roommates = (room.roommate_preview || []).slice(0, 4);

  return (
    <div className="min-h-screen bg-[var(--warm-ivory)] pb-24">
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-white">
        <div className="flex items-center gap-3 px-6 py-4">
          <button type="button" onClick={onBack} className="-ml-2 grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--warm-ivory)]">
            <ArrowLeft className="h-5 w-5 text-[var(--brand-navy)]" />
          </button>
          <h1 className="text-xl font-bold text-[var(--brand-navy)]">Room {room.room_no}</h1>
        </div>
      </div>

      <div className="relative h-72 bg-gradient-to-br from-[var(--brand-navy)]/10 to-[var(--brand-saffron)]/10">
        <img src={roomPhoto(room)} alt={`Room ${room.room_no}`} className="h-full w-full object-cover" />
        <span className="absolute right-4 top-4 rounded-full bg-[var(--success-green)] px-3 py-1 text-sm font-semibold text-white">{available} Bed{available === 1 ? '' : 's'} Available</span>
      </div>

      <div className="mt-6 px-6">
        <div className="mb-6">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[var(--brand-saffron)]">{rupee(roomPrice(room))}</span>
            <span className="text-[var(--neutral-gray)]">/month</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--neutral-gray)]">
            <span className="inline-flex items-center gap-1"><Bed className="h-4 w-4" /> {capacity(room)} Beds</span>
            <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {occupiedBeds(room)} Occupied</span>
            <span className="inline-flex items-center gap-1 text-[var(--success-green)]"><CheckCircle className="h-4 w-4" /> {available} Available</span>
          </div>
        </div>

        <section className="mb-6">
          <h2 className="mb-4 text-xl font-semibold text-[var(--brand-navy)]">Who you'd be living with</h2>
          <div className="space-y-3">
            {roommates.map((mate: any, index: number) => (
              <div key={index} className="flex items-center gap-4 rounded-xl bg-white p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand-saffron)]/20 to-[var(--brand-navy)]/20 text-lg font-semibold text-[var(--brand-navy)]">R{index + 1}</div>
                <div>
                  <p className="font-medium text-[var(--deep-charcoal)]">{mate.college || 'College not shared'}</p>
                  <p className="text-sm text-[var(--neutral-gray)]">{[mate.year ? `Year ${mate.year}` : null, mate.course].filter(Boolean).join(' · ') || 'Student details private'}</p>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-4 rounded-xl border-2 border-dashed border-[var(--success-green)]/30 bg-[var(--success-green)]/5 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--success-green)]/10">
                <Bed className="h-6 w-6 text-[var(--success-green)]" />
              </div>
              <div>
                <p className="font-medium text-[var(--success-green)]">Available for you!</p>
                <p className="text-sm text-[var(--neutral-gray)]">Names and phones are never shown here.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-6">
          <h2 className="mb-4 text-xl font-semibold text-[var(--brand-navy)]">Room Facilities</h2>
          <div className="space-y-3 rounded-xl bg-white p-4">
            {[
              [Wifi, 'High-speed WiFi'],
              [Wind, 'Ventilated room'],
              [Tv, 'Study table and chair'],
              [Bed, 'Comfortable beds'],
            ].map(([Icon, label]: any) => (
              <div key={label} className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-saffron)]/10">
                  <Icon className="h-5 w-5 text-[var(--brand-saffron)]" />
                </div>
                <span className="text-[var(--deep-charcoal)]">{label}</span>
                <CheckCircle className="ml-auto h-4 w-4 text-[var(--success-green)]" />
              </div>
            ))}
          </div>
        </section>

        <section className="mb-6">
          <h2 className="mb-4 text-xl font-semibold text-[var(--brand-navy)]">What's Included</h2>
          <div className="space-y-2 rounded-xl bg-white p-4 text-sm">
            {['3 meals daily', 'High-speed WiFi', 'Room maintenance and cleaning', 'Security', 'Electricity and water'].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-[var(--success-green)]" />
                <span className="text-[var(--deep-charcoal)]">{item}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-white p-4 shadow-lg">
        <div className="mx-auto max-w-lg">
          <button type="button" onClick={onInterest} disabled={interested || available <= 0} className={`h-14 w-full rounded-xl text-lg font-semibold text-white disabled:opacity-60 ${interested ? 'bg-[var(--success-green)]' : 'bg-[var(--brand-saffron)]'}`}>
            {interested ? <><CheckCircle className="mr-2 inline h-5 w-5" /> Interested</> : <><Heart className="mr-2 inline h-5 w-5" /> Mark as Interested</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InterestConfirmation({
  room,
  hostel,
  studentName,
  onExploreMore,
  onShare,
}: {
  room: any;
  hostel: any;
  studentName: string;
  onExploreMore: () => void;
  onShare: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--warm-ivory)] p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--brand-saffron)]">
            <CheckCircle className="h-14 w-14 text-white" strokeWidth={2.5} />
          </div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="mb-3 text-3xl font-bold text-[var(--brand-navy)]" style={{ fontFamily: 'var(--font-hero)' }}>
            Great choice, {studentName || 'there'}!
          </h1>
          <p className="text-lg text-[var(--neutral-gray)]">
            We noted your interest in <b className="text-[var(--deep-charcoal)]">Room {room?.room_no}</b>. {hostel?.name} can follow up faster now.
          </p>
        </div>

        <div className="mb-6 rounded-2xl border border-[var(--brand-saffron)]/20 bg-white p-6">
          <div className="flex items-start gap-3">
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--success-green)]/10">
              <CheckCircle className="h-5 w-5 text-[var(--success-green)]" />
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-[var(--brand-navy)]">What happens next?</h3>
              <ul className="space-y-1 text-sm text-[var(--neutral-gray)]">
                <li>Owner sees your selected room and parent contact.</li>
                <li>You can schedule a visit or ask questions.</li>
                <li>Your interest is saved, no commitment required.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <button type="button" onClick={onShare} className="h-14 w-full rounded-xl border-2 border-[var(--brand-navy)] font-semibold text-[var(--brand-navy)]">
            <Share2 className="mr-2 inline h-5 w-5" /> Share with Parents
          </button>
          <button type="button" onClick={onExploreMore} className="h-14 w-full rounded-xl border border-[var(--border)] font-semibold">
            Explore more rooms
          </button>
          <a href={waLink(hostel?.phone)} target="_blank" rel="noreferrer" className="flex h-14 w-full items-center justify-center rounded-xl bg-[var(--success-green)] font-semibold text-white">
            <MessageCircle className="mr-2 h-5 w-5" /> Chat on WhatsApp
          </a>
        </div>

        <p className="mt-6 text-center text-sm text-[var(--neutral-gray)]">You can mark multiple rooms as interested.</p>
      </div>
    </div>
  );
}

export function ShareWithParents({ room, hostel, studentName, onBack }: { room: any; hostel: any; studentName: string; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const message = `Hi! I am interested in Room ${room?.room_no} at ${hostel?.name}.

${capacity(room)}-sharing · ${rupee(roomPrice(room))}/month
Meals, WiFi, safety, and room details are here:
${shareUrl}

- ${studentName}`;

  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const nativeShare = async () => {
    if (!navigator.share) return;
    await navigator.share({ title: `${hostel?.name} - Room ${room?.room_no}`, text: message, url: shareUrl });
  };

  return (
    <div className="min-h-screen bg-[var(--warm-ivory)]">
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-white">
        <div className="flex items-center gap-3 px-6 py-4">
          <button type="button" onClick={onBack} className="-ml-2 grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--warm-ivory)]">
            <ArrowLeft className="h-5 w-5 text-[var(--brand-navy)]" />
          </button>
          <h1 className="text-xl font-bold text-[var(--brand-navy)]">Share with Parents</h1>
        </div>
      </div>

      <div className="mx-auto max-w-lg px-6 py-8">
        <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand-saffron)]/20 to-[var(--brand-navy)]/20">
              <Share2 className="h-8 w-8 text-[var(--brand-saffron)]" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-[var(--brand-navy)]">Share Room Details</h2>
            <p className="text-sm text-[var(--neutral-gray)]">Let your parents know about your choice.</p>
          </div>

          <div className="mb-4 rounded-xl bg-[var(--warm-ivory)] p-4">
            <p className="whitespace-pre-line font-mono text-sm text-[var(--deep-charcoal)]">{message}</p>
          </div>
        </div>

        <div className="space-y-3">
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="flex h-14 items-center justify-center rounded-xl bg-[var(--success-green)] text-base font-semibold text-white">
            <MessageCircle className="mr-2 h-5 w-5" /> Share via WhatsApp
          </a>
          <button type="button" onClick={copy} className="h-14 w-full rounded-xl border border-[var(--border)] bg-white text-base font-semibold">
            <Copy className="mr-2 inline h-5 w-5" /> {copied ? 'Copied!' : 'Copy Link'}
          </button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <button type="button" onClick={nativeShare} className="h-14 w-full rounded-xl border border-[var(--border)] bg-white text-base font-semibold">
              <Share2 className="mr-2 inline h-5 w-5" /> More Share Options
            </button>
          )}
        </div>

        <div className="mt-8 rounded-xl border border-[var(--success-green)]/20 bg-[var(--success-green)]/5 p-4">
          <p className="text-center text-sm text-[var(--neutral-gray)]">Parents can review room, facilities, location, and pricing.</p>
        </div>
      </div>
    </div>
  );
}
