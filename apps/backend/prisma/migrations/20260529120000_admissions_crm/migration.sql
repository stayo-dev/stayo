ALTER TABLE public.hostels
  ADD COLUMN IF NOT EXISTS public_slug TEXT,
  ADD COLUMN IF NOT EXISTS admissions_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admission_photos JSONB;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS admission_photos JSONB;

UPDATE public.hostels
SET public_slug = lower(
  regexp_replace(
    regexp_replace(coalesce(name, 'hostel'), '[^a-zA-Z0-9]+', '-', 'g'),
    '(^-|-$)', '', 'g'
  )
) || '-' || substring(id::text, 1, 8)
WHERE public_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hostels_public_slug_key
  ON public.hostels (public_slug);

CREATE TABLE IF NOT EXISTS public.visitor_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id UUID NOT NULL REFERENCES public.hostels(id),
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  student_name TEXT NOT NULL,
  student_phone TEXT NOT NULL,
  student_email TEXT,
  parent_name TEXT,
  parent_phone TEXT,
  decision_maker_type TEXT NOT NULL DEFAULT 'BOTH',
  source TEXT NOT NULL DEFAULT 'QR',
  status TEXT NOT NULL DEFAULT 'NEW',
  notes TEXT,
  lead_score INTEGER NOT NULL DEFAULT 0,
  first_visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  parent_contacted_at TIMESTAMPTZ,
  parent_follow_up_required BOOLEAN NOT NULL DEFAULT false,
  converted_at TIMESTAMPTZ,
  converted_tenant_id UUID REFERENCES public.tenants(id),
  lost_reason TEXT,
  lost_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.visitor_leads(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.room_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.visitor_leads(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id),
  hostel_id UUID NOT NULL REFERENCES public.hostels(id),
  reserved_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  approved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.lead_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.visitor_leads(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_leads_owner_status_activity
  ON public.visitor_leads (owner_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_leads_hostel_status_activity
  ON public.visitor_leads (hostel_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_leads_hostel_phone
  ON public.visitor_leads (hostel_id, student_phone);
CREATE INDEX IF NOT EXISTS idx_visitor_leads_owner_score
  ON public.visitor_leads (owner_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_leads_converted_tenant
  ON public.visitor_leads (converted_tenant_id);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_created
  ON public.lead_activities (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_type_created
  ON public.lead_activities (activity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_reservations_lead_status
  ON public.room_reservations (lead_id, status);
CREATE INDEX IF NOT EXISTS idx_room_reservations_room_status_expiry
  ON public.room_reservations (room_id, status, reserved_until);
CREATE INDEX IF NOT EXISTS idx_room_reservations_hostel_status_expiry
  ON public.room_reservations (hostel_id, status, reserved_until);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_created
  ON public.lead_notes (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_notes_owner_created
  ON public.lead_notes (owner_id, created_at DESC);
