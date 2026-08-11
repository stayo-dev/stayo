import { useState } from 'react';
import { X, User, Phone } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';

interface EditTenantModalProps {
  open: boolean;
  onClose: () => void;
  initialName: string;
  initialPhone: string;
  onSave: (data: { name: string; phone: string }) => Promise<void>;
}

export function EditTenantModal({ open, onClose, initialName, initialPhone, onSave }: EditTenantModalProps) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setIsSubmitting(true);
    try {
      await onSave({ name: name.trim(), phone: phone.trim() });
      onClose();
    } catch {
      // Error handled in parent
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card rounded-t-2xl sm:rounded-2xl border border-border p-6 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div>
            <h3 className="font-display text-base font-extrabold text-foreground">Edit Tenant Details</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Pre-activation updates do not alter financial records.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Full Name *</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground">
                <User className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Full Name"
                className="w-full rounded-xl border border-border bg-muted/50 pl-9 pr-3.5 py-2.5 text-[13.5px] font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Phone Number *</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground">
                <Phone className="h-4 w-4" />
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                placeholder="+91 90080 46952"
                className="w-full rounded-xl border border-border bg-muted/50 pl-9 pr-3.5 py-2.5 text-[13.5px] font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-card py-3 font-display text-xs font-bold text-foreground active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-xl bg-primary py-3 font-display text-xs font-bold text-primary-foreground active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm"
            >
              {isSubmitting ? <StayoLoader size="sm" label={null} /> : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
