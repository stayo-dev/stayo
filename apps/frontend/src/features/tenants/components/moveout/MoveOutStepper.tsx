import { 
  AlertCircle, 
  FileText, 
  Coins, 
  BadgeCheck, 
  DoorOpen, 
  CreditCard,
  Flag 
} from 'lucide-react';
import { canonicalMoveOutStatus } from '@/shared/types/moveout';

const STEP_LABELS = [
  { key: 'REQUESTED', label: 'Request', icon: FileText, desc: 'Request submitted for review' },
  { key: 'SETTLEMENT_PENDING', label: 'Settlement', icon: Coins, desc: 'Dues and refund calculation' },
  { key: 'SETTLEMENT_APPROVED', label: 'Approved', icon: BadgeCheck, desc: 'Settlement approved' },
  { key: 'PHYSICALLY_VACATED', label: 'Vacated', icon: DoorOpen, desc: 'Room released' },
  { key: 'SETTLEMENT_PENDING_PAYMENT', label: 'Payment', icon: CreditCard, desc: 'Settlement payment pending' },
  { key: 'COMPLETED', label: 'Completed', icon: Flag, desc: 'Financially closed' },
] as const;

const STEPS = ['REQUESTED', 'SETTLEMENT_PENDING', 'SETTLEMENT_APPROVED', 'PHYSICALLY_VACATED', 'SETTLEMENT_PENDING_PAYMENT', 'COMPLETED'] as const;

interface Props {
  request: Record<string, unknown>;
  hostelId: string;
}

export function MoveOutStepper({ request }: Props) {
  const current = canonicalMoveOutStatus(request.status ?? 'REQUESTED');
  const isRejected = current === 'REJECTED';
  const currentIdx = isRejected ? -1 : STEPS.indexOf(current as (typeof STEPS)[number]);
  const progressIdx = Math.max(0, currentIdx);

  return (
    <div className="space-y-6">
      {/* Horizontal Progress Bar */}
      {!isRejected && (
        <div className="p-5 rounded-2xl border border-border bg-card shadow-sm space-y-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-[#243A72]/5" />
          <div className="relative pt-2">
            {/* Background Line */}
            <div className="absolute top-[18px] left-[10%] right-[10%] h-1 bg-secondary rounded-full -translate-y-1/2" />
            
            {/* Active Progress Line */}
            <div 
              className="absolute top-[18px] left-[10%] h-1 bg-[#243A72] rounded-full -translate-y-1/2 transition-all duration-500 ease-out"
              style={{ width: `${(progressIdx / (STEPS.length - 1)) * 80}%` }}
            />

            {/* Steps Container */}
            <div className="relative flex justify-between z-10">
              {STEP_LABELS.map((step, idx) => {
                const isCompleted = currentIdx > idx || current === 'COMPLETED';
                const isActive = current === step.key;
                const Icon = step.icon;

                return (
                  <div key={step.key} className="flex flex-col items-center flex-1">
                    {/* Circle Indicator */}
                    <div 
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 relative ${
                        isCompleted 
                          ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20' 
                          : isActive 
                            ? 'bg-[#243A72] text-white shadow-md shadow-[#243A72]/20 ring-4 ring-[#243A72]/15' 
                            : 'bg-secondary border border-transparent text-muted-foreground'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-0 rounded-full animate-ping bg-[#243A72]/20 opacity-75" />
                      )}
                      
                      <span className="relative z-10">
                        <Icon className="w-4 h-4" />
                      </span>

                      {isCompleted && (
                        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-600 text-white border border-white flex items-center justify-center text-[9px] font-black">
                          ✓
                        </span>
                      )}
                    </div>

                    {/* Step Labels */}
                    <div className="mt-3.5 text-center px-1">
                      <p className={`text-[11px] font-bold tracking-tight transition-colors duration-300 ${
                        isActive ? 'text-[#243A72] font-extrabold' : isCompleted ? 'text-foreground font-semibold' : 'text-muted-foreground'
                      }`}>
                        {step.label}
                      </p>
                      <p className="hidden md:block text-[9px] text-muted-foreground mt-0.5 max-w-[85px] mx-auto leading-normal">
                        {step.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Planned exit banner */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border border-border bg-card shadow-sm">
          <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Planned Exit Date</p>
          <p className="font-bold text-sm text-foreground mt-1">
            {request.planned_exit_date
              ? new Date(String(request.planned_exit_date)).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : '—'}
          </p>
        </div>
        
        {request.refund_amount != null && (
          <div className="p-4 rounded-xl border border-border bg-card shadow-sm">
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Estimated Refund</p>
            <p className="font-bold text-sm text-emerald-600 mt-1">
              ₹{Number(request.refund_amount).toLocaleString('en-IN')}
            </p>
          </div>
        )}
      </div>

      {isRejected && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>This move-out request has been rejected by management.</span>
        </div>
      )}

      {/* Detailed Status Pipeline */}
      <div className="space-y-3">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Detailed Status Timeline
        </h3>
        <div className="space-y-2.5">
          {STEP_LABELS.map((step, idx) => {
            const isCompleted = currentIdx > idx || current === 'COMPLETED';
            const isActive = current === step.key;
            const Icon = step.icon;

            return (
              <div
                key={step.key}
                className={`flex items-start gap-4 p-3.5 rounded-xl border transition-all duration-300 ${
                  isActive
                    ? 'border-[#243A72]/20 bg-[#243A72]/5 shadow-sm'
                    : isCompleted
                      ? 'border-border bg-card/50'
                      : 'border-border/60 opacity-60 bg-card/10'
                }`}
              >
                <div 
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 relative ${
                    isCompleted 
                      ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' 
                      : isActive 
                        ? 'bg-[#243A72] text-white shadow-sm shadow-[#243A72]/20' 
                        : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {isCompleted && (
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 text-white border border-white flex items-center justify-center text-[7px] font-bold">
                      ✓
                    </span>
                  )}
                </div>
                
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm font-semibold ${
                      isActive ? 'text-[#243A72]' : 'text-foreground'
                    }`}>
                      {step.label}
                    </p>
                    {isActive && (
                      <span className="inline-flex items-center rounded-full bg-[#243A72]/15 px-1.5 py-0.5 text-[9px] font-bold text-[#243A72] uppercase animate-pulse">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {request.deduction_notes && (
        <div className="p-4 rounded-xl bg-secondary/40 border border-border/80">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Deduction Notes</p>
          <p className="text-xs text-foreground leading-relaxed">
            {String(request.deduction_notes)}
          </p>
        </div>
      )}
    </div>
  );
}
