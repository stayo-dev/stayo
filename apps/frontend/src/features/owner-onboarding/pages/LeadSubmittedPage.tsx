import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowRight } from 'lucide-react';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { useMockOwnerJourney } from '../context/MockOwnerJourneyContext';
import { JourneyShell } from '../components/JourneyShell';

const inputStyle =
  'w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors focus:border-primary focus:outline-none';
const labelStyle = 'mb-1.5 block font-display text-[10.5px] font-bold tracking-wider text-primary';

/**
 * Composed screen — no equivalent in the design source (which goes straight
 * from the login modal to onboarding). Reuses the established StayO visual
 * language (eyebrow pill, EmptyState pattern) rather than inventing a new
 * style. Two states: first collects the lead details the Google sign-in step
 * doesn't provide (hostel name, owner name, phone), then shows the
 * activation-email confirmation. See the phase-2 plan for why this and the
 * Activation screen exist.
 */
export function LeadSubmittedPage() {
  const navigate = useNavigate();
  const journey = useMockOwnerJourney();
  const [submitted, setSubmitted] = useState(false);
  const [hostelName, setHostelName] = useState('');
  const [ownerName, setOwnerName] = useState(journey.lead?.name ?? '');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const email = journey.lead?.email || 'your inbox';
  const mockToken = `mock-${Math.random().toString(36).slice(2, 10)}`;

  const submitDetails = () => {
    if (!hostelName.trim() || !ownerName.trim() || !phone.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    journey.updateLead({ hostelName: hostelName.trim(), ownerName: ownerName.trim(), phone: phone.trim() });
    setSubmitted(true);
  };

  if (!submitted) {
    return (
      <JourneyShell>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5 font-display text-[11px] font-bold tracking-wider text-success">
          SIGNED IN
        </div>
        <h1 className="mb-2.5 font-display text-[clamp(26px,3.6vw,34px)] font-extrabold leading-[1.1] tracking-tight text-foreground">
          Tell us about your hostel.
        </h1>
        <p className="mb-7 text-[15.5px] leading-relaxed text-muted-foreground">
          A few details so our team can review your listing request.
        </p>
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
          <label className="block">
            <span className={labelStyle}>HOSTEL NAME</span>
            <input value={hostelName} onChange={(e) => setHostelName(e.target.value)} placeholder="e.g. Green Nest Hostel" className={inputStyle} />
          </label>
          <label className="block">
            <span className={labelStyle}>OWNER NAME</span>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Your name" className={inputStyle} />
          </label>
          <label className="block">
            <span className={labelStyle}>PHONE NUMBER</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 90000 00000"
              inputMode="tel"
              className={inputStyle}
            />
          </label>
          {error && (
            <div className="rounded-[9px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">{error}</div>
          )}
          <button
            type="button"
            onClick={submitDetails}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-display text-sm font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)]"
          >
            Submit
            <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
      </JourneyShell>
    );
  }

  return (
    <JourneyShell>
      <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5 font-display text-[11px] font-bold tracking-wider text-success">
        REQUEST RECEIVED
      </div>
      <h1 className="mb-2.5 font-display text-[clamp(26px,3.6vw,34px)] font-extrabold leading-[1.1] tracking-tight text-foreground">
        Thanks, {journey.lead?.ownerName || journey.lead?.name || 'there'}.
      </h1>
      <p className="mb-8 text-[15.5px] leading-relaxed text-muted-foreground">
        We&apos;ve received your request. Our team will review it and reach out to you shortly.
      </p>

      <EmptyState
        className="rounded-2xl border border-border bg-card px-6 py-8"
        icon={<Mail className="h-5 w-5" strokeWidth={2} />}
        title="Your invitation is on its way"
        description={`Once approved, we'll send an invitation to activate your account to ${email}.`}
        action={
          <button
            type="button"
            onClick={() => navigate(`/get-started/activate/${mockToken}`)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-display text-sm font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)]"
          >
            Simulate receiving the invitation
            <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
          </button>
        }
      />
    </JourneyShell>
  );
}
