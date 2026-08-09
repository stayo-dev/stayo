import { useState } from 'react';
import { X, PlusCircle, KeyRound, Calendar } from 'lucide-react';
import { identityService } from '@features/auth/api';
import { paymentService } from '@features/payments/api';
import { toast } from 'sonner';
import { hmsToast } from '@lib/toast';
import api from '@lib/api-client';
import { StayoLoader } from '@shared/ui/brand';

interface CreateObligationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  hostelId: string;
  onSuccess: () => void;
  /** Prefill for "Create Rent" quick action and "Duplicate Charge"/"Edit" obligation actions */
  initialValues?: { obligationType?: string; amount?: number; description?: string };
  /** Cosmetic only — changes title/copy; all modes POST a new obligation the same way */
  mode?: 'create' | 'duplicate' | 'edit';
}

const MODE_COPY: Record<NonNullable<CreateObligationModalProps['mode']>, { title: string; description: string }> = {
  create: { title: 'Create a Charge', description: 'Add a custom manual charge for this tenant' },
  duplicate: { title: 'Duplicate Charge', description: 'Create a new charge based on this one' },
  edit: { title: 'Edit Charge', description: 'Charges can\'t be edited directly once created — this creates a corrected replacement and cancels the original' },
};

const ALLOWED_TYPES = [
  { value: 'RENT', label: 'Rent Installment' },
  { value: 'SECURITY_DEPOSIT', label: 'Security Deposit' },
  { value: 'ADMISSION', label: 'Admission Fee' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'LATE_FEE', label: 'Late Fee' },
  { value: 'FINE', label: 'Fine / Penalty' },
  { value: 'EXTRA_CHARGE', label: 'Extra Charge' },
  { value: 'DAMAGE', label: 'Damage Charge' },
  { value: 'UTILITY', label: 'Utility (Electricity, Water, etc.)' },
  { value: 'ADDITIONAL_CHARGE', label: 'Additional Charge' },
  { value: 'OTHER', label: 'Other' },
];

export function CreateObligationModal({
  isOpen,
  onClose,
  tenantId,
  hostelId,
  onSuccess,
  initialValues,
  mode = 'create',
}: CreateObligationModalProps) {
  const copy = MODE_COPY[mode];
  const [type, setType] = useState(initialValues?.obligationType ?? 'RENT');
  const [amount, setAmount] = useState(initialValues?.amount ? String(initialValues.amount) : '');
  const [dueDate, setDueDate] = useState('');
  const [rentMonth, setRentMonth] = useState('');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [notes, setNotes] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error('Please enter a valid positive amount');
      return;
    }
    if (!dueDate) {
      toast.error('Please select a due date');
      return;
    }
    if (!password.trim()) {
      toast.error('Enter your password to authorize this action');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Confirm identity and fetch verification token
      const identity = await identityService.confirmIdentity(password);
      const identityToken = identity?.identity_token ?? identity?.data?.identity_token;
      if (!identityToken) {
        throw new Error('Identity verification failed. Invalid password.');
      }

      // 2. Compute rent_month — default to 1st of due date month if not specified
      const effectiveRentMonth = rentMonth
        ? new Date(rentMonth + '-02').toISOString()
        : new Date(new Date(dueDate).getFullYear(), new Date(dueDate).getMonth(), 1).toISOString();

      // 3. Submit creation request to backend (field names match API contract)
      await api.post('/payments/obligations', {
        tenant_id: tenantId,
        obligation_type: type,
        amount: numAmount,
        due_date: new Date(dueDate).toISOString(),
        rent_month: effectiveRentMonth,
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      toast.success('Charge created successfully');
      setType('RENT');
      setAmount('');
      setDueDate('');
      setRentMonth('');
      setDescription('');
      setNotes('');
      setPassword('');
      onSuccess();
      onClose();
    } catch (err: any) {
      hmsToast.error(err, 'Create Charge');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 border-b border-border pb-4 mb-4">
          <div className="p-2 rounded-xl bg-accent/10 text-accent">
            <PlusCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">{copy.title}</h3>
            <p className="text-xs text-muted-foreground">{copy.description}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Charge Type <span className="text-rose-500">*</span>
              </label>
              <select
                required
                disabled={isSubmitting}
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-xl border border-input bg-background h-10 px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ALLOWED_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Amount (₹) <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="number"
                min="1"
                step="any"
                placeholder="e.g. 500"
                disabled={isSubmitting}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl border border-input bg-background h-10 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Due Date <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="date"
                disabled={isSubmitting}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-input bg-background h-10 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Billing Month (Optional)
              </label>
              <input
                type="month"
                disabled={isSubmitting}
                value={rentMonth}
                onChange={(e) => setRentMonth(e.target.value)}
                className="w-full rounded-xl border border-input bg-background h-10 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Description
            </label>
            <input
              type="text"
              disabled={isSubmitting}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Electricity bill for June, Damage to Room 204..."
              className="w-full rounded-xl border border-input bg-background h-10 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Internal Notes
            </label>
            <textarea
              rows={2}
              disabled={isSubmitting}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — visible only to admins..."
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
              Confirm Password <span className="text-rose-500">*</span>
            </label>
            <input
              required
              type="password"
              disabled={isSubmitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your login password"
              className="w-full rounded-xl border border-input bg-background h-10 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 h-10 rounded-xl border border-input bg-background text-sm font-semibold hover:bg-accent hover:text-accent-foreground active:scale-98 transition-transform disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 h-10 rounded-xl bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 active:scale-98 transition-transform flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <StayoLoader size="sm" label={null} />
              ) : (
                <PlusCircle className="w-4 h-4" />
              )}
              <span>{mode === 'edit' ? 'Create Replacement' : 'Create Charge'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
