import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useAddExpenseWizard } from '../hooks/useAddExpenseWizard';
import type { AddExpenseData } from '../types';
import { DetailsStep } from './steps/DetailsStep';
import { FinancialStep } from './steps/FinancialStep';
import { ReviewStep } from './steps/ReviewStep';

interface AddExpenseModalProps {
  open: boolean;
  onClose: () => void;
  seed?: AddExpenseData;
  editingId?: string;
}

/**
 * 3-step Add Expense wizard — redesigned around the "What → Amount → Confirm"
 * mental model.
 *
 * Key differences from the original:
 * - Step indicator is subtler (progress dots only, no "Step N of 3")
 * - "Continue" disables until per-step requirements are met
 * - Success state offers "Save & add another" alongside "Done"
 * - "Use this setup" shortcuts in step 1 jump straight to Amount
 */
export function AddExpenseModal({ open, onClose, seed, editingId }: AddExpenseModalProps) {
  const wizard = useAddExpenseWizard(editingId);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (open) {
      wizard.reset(seed);
      setShowSuccess(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (wizard.submitted) {
      setShowSuccess(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.submitted]);

  const isLast = wizard.step === wizard.stepLabels.length - 1;

  const handlePrimary = () => {
    if (!isLast) {
      wizard.next();
      return;
    }
    wizard.submit();
  };

  const handleAddAnother = () => {
    stayoToast.success('Expense saved');
    setShowSuccess(false);
    wizard.addAnother();
  };

  const handleDone = () => {
    stayoToast.success(wizard.isEditing ? 'Expense updated' : 'Expense saved');
    onClose();
  };

  // ── Success state ────────────────────────────────────────────
  if (showSuccess) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={(v) => !v && handleDone()}
        title="Expense saved"
        footer={
          <div className="flex gap-2.5">
            {!wizard.isEditing && (
              <button
                type="button"
                onClick={handleAddAnother}
                className="flex items-center gap-2 rounded-xl border border-border px-4 py-3.5 font-display text-sm font-bold text-foreground"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                Add another
              </button>
            )}
            <button
              type="button"
              onClick={handleDone}
              className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground"
            >
              Done
            </button>
          </div>
        }
      >
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
            <Check className="h-7 w-7 text-success" strokeWidth={2.5} />
          </div>
          <span className="text-center font-display text-base font-bold text-foreground">
            {wizard.lastSavedSummary}
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            {wizard.isEditing ? 'Expense updated successfully.' : 'Expense recorded successfully.'}
          </span>
        </div>
      </BottomSheet>
    );
  }

  // ── Wizard state ─────────────────────────────────────────────
  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex flex-col gap-1.5">
          <span>{wizard.isEditing ? 'Edit expense' : 'Add expense'}</span>
          <span className="flex items-center gap-1.5">
            {wizard.stepLabels.map((label, i) => (
              <span
                key={label}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= wizard.step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </span>
        </span>
      }
      footer={
        <div className="flex gap-2.5">
          {wizard.step > 0 && (
            <button type="button" onClick={wizard.back} className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground">
              Back
            </button>
          )}
          <button
            type="button"
            onClick={handlePrimary}
            disabled={isLast ? (!wizard.isValid || wizard.isSubmitting) : !wizard.canAdvance(wizard.step)}
            className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {isLast ? (wizard.isSubmitting ? 'Saving…' : wizard.isEditing ? 'Save changes' : 'Save expense') : 'Continue'}
          </button>
        </div>
      }
    >
      {wizard.submitError && (
        <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          {wizard.submitError}
        </p>
      )}
      {wizard.step === 0 && (
        <DetailsStep
          data={wizard.data}
          setD={wizard.setD}
          // Reusing a remembered expense fills everything the owner supplied
          // last time, so the only thing left to check is the amount — go
          // straight there. That is the three-tap target: reuse, edit, save.
          onReused={wizard.next}
        />
      )}
      {wizard.step === 1 && <FinancialStep data={wizard.data} setD={wizard.setD} />}
      {wizard.step === 2 && <ReviewStep data={wizard.data} setD={wizard.setD} />}
    </BottomSheet>
  );
}
