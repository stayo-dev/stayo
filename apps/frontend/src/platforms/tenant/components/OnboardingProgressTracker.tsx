import { useState } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Sparkles, ShieldCheck } from 'lucide-react';

interface OnboardingProgressTrackerProps {
  profile: any;
}

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

export function OnboardingProgressTracker({ profile }: OnboardingProgressTrackerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!profile) return null;

  const reservationStatus = profile.reservation_status ?? {};
  const threshold = Number(reservationStatus.threshold ?? 0);
  const paidDeposit = Number(reservationStatus.paidDeposit ?? 0);
  const requiredMaintenance = Number(reservationStatus.requiredMaintenance ?? 0);
  const paidMaintenance = Number(reservationStatus.paidMaintenance ?? 0);

  const steps = [
    {
      id: 'credentials',
      label: 'Credentials Created',
      description: 'Account password set up',
      weight: 15,
      completed: true,
    },
    {
      id: 'agreement',
      label: 'Agreement Signed',
      description: 'Hostel residency agreement signed',
      weight: 15,
      completed: profile.documents?.some((d: any) => d.doc_type === 'RENTAL_AGREEMENT') ?? false,
    },
    {
      id: 'identity',
      label: 'Identity Verified',
      description: 'Required identity documents uploaded and verified',
      weight: 15,
      completed: profile.verification?.document_verified ?? false,
    },
    {
      id: 'guardian',
      label: 'Guardian Details',
      description: 'Emergency/guardian phone number registered',
      weight: 15,
      completed: !!(profile.tenant?.phone_2 || profile.contacts?.guardian_phone?.value),
    },
    {
      id: 'deposit',
      label: 'Financial Deposit',
      description: `Reservation deposit of ${fmt(threshold)} paid`,
      weight: 20,
      completed: paidDeposit >= threshold,
    },
    {
      id: 'maintenance',
      label: 'Financial Maintenance',
      description: `Onboarding maintenance fee of ${fmt(requiredMaintenance)} paid`,
      weight: 20,
      completed: paidMaintenance >= requiredMaintenance,
    },
  ];

  const totalProgress = steps.reduce((acc, step) => acc + (step.completed ? step.weight : 0), 0);
  const isComplete = totalProgress === 100;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-300">
      {/* Tracker Header */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-muted/10 transition-colors"
      >
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2 mb-1.5">
            {isComplete ? (
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <ShieldCheck className="w-3.5 h-3.5" />
                Ready to Move-in
              </div>
            ) : (
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#243A72]/10 text-[#243A72] border border-[#243A72]/20">
                <Sparkles className="w-3.5 h-3.5 text-accent animate-pulse" />
                Onboarding Setup
              </div>
            )}
            <span className="text-xs font-bold text-muted-foreground">{totalProgress}% Complete</span>
          </div>
          <h3 className="text-sm font-bold text-foreground">Onboarding Progress</h3>
          
          {/* Progress Bar */}
          <div className="mt-2.5 h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#1B2D5B] to-[#243A72] rounded-full transition-all duration-500"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
        </div>
        <div className="text-muted-foreground shrink-0 p-1 hover:bg-muted rounded-lg transition-colors">
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded Checklist */}
      {isExpanded && (
        <div className="px-5 pb-5 pt-1 border-t border-border/40 divide-y divide-border/40 bg-muted/5">
          {steps.map((step) => (
            <div key={step.id} className="py-3 flex items-start gap-3">
              {step.completed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm font-bold ${step.completed ? 'text-foreground/90' : 'text-foreground'}`}>
                    {step.label}
                  </p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                    step.completed 
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' 
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                  }`}>
                    +{step.weight}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
