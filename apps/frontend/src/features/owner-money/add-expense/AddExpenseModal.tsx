import { useEffect } from 'react';
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

/** 3-step Add Expense wizard, per Stayo App.dc.html. Submits to the real `POST /expenses`, or `PUT /expenses/:id` when `editingId` is set (Edit/Duplicate from `ExpenseDetailModal`). */
export function AddExpenseModal({ open, onClose, seed, editingId }: AddExpenseModalProps) {
  const wizard = useAddExpenseWizard(editingId);

  useEffect(() => {
    if (open) wizard.reset(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (wizard.submitted) {
      stayoToast.success(wizard.isEditing ? 'Expense updated' : 'Expense saved');
      onClose();
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

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex flex-col gap-1.5">
          <span>{wizard.isEditing ? 'Edit expense' : 'Add expense'}</span>
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-primary">
              Step {wizard.step + 1} of {wizard.stepLabels.length}
            </span>
            <span className="flex flex-1 gap-1">
              {wizard.stepLabels.map((label, i) => (
                <span key={label} className={`h-1 flex-1 rounded-full ${i <= wizard.step ? 'bg-primary' : 'bg-muted'}`} />
              ))}
            </span>
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
            disabled={(isLast && (!wizard.isValid || wizard.isSubmitting))}
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
      {wizard.step === 0 && <DetailsStep data={wizard.data} setD={wizard.setD} />}
      {wizard.step === 1 && <FinancialStep data={wizard.data} setD={wizard.setD} />}
      {wizard.step === 2 && <ReviewStep data={wizard.data} setD={wizard.setD} />}
    </BottomSheet>
  );
}
