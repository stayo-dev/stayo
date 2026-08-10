import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { expenseService } from '@features/expenses/api';
import { queryKeys } from '@lib/queryKeys';
import { EMPTY_ADD_EXPENSE_DATA, type AddExpenseData } from '../types';

const STEP_LABELS = ['What', 'Amount', 'Confirm'] as const;

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * Step index + form data + navigation for the 3-step Add Expense wizard.
 *
 * Redesigned step gates:
 *   Step 0 ("What"):    needs title + category
 *   Step 1 ("Amount"):  needs amount > 0
 *   Step 2 ("Confirm"): needs all of the above (final isValid)
 *
 * `addAnother` resets to step 0 carrying forward category + paymentMethod
 * as editable context (not a silent assumption) so the owner can change
 * them if the next expense is different.
 */
export function useAddExpenseWizard(editingId?: string) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<AddExpenseData>(EMPTY_ADD_EXPENSE_DATA);

  const setD = (patch: Partial<AddExpenseData>) => setData((d) => ({ ...d, ...patch }));

  /**
   * Per-step minimum requirements. The "Continue" button disables until
   * these are met, so an owner cannot advance with an empty title or
   * zero amount.
   */
  const canAdvance = (s: number): boolean => {
    switch (s) {
      case 0:
        return Boolean(data.title.trim() && data.category);
      case 1:
        return Number(data.amount) > 0;
      default:
        return true;
    }
  };

  const next = () => {
    if (!canAdvance(step)) return;
    setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        title: data.title.trim(),
        amount: Number(data.amount) || 0,
        date: data.date,
        category: data.category,
        status: data.status.toLowerCase().replace(' ', '_'),
        vendor_name: data.vendor.trim() || undefined,
        payment_method: data.paymentMethod || undefined,
        notes: data.notes.trim() || undefined,
        is_recurring: data.recurring,
        // Attribute the cost to a property when the owner picked one.
        // `expense_scope` already models exactly this distinction, and the
        // schema defaults to HOSTEL — the client was overriding both.
        hostelId: data.hostelId || undefined,
        expense_scope: data.hostelId ? 'HOSTEL' : 'BUSINESS',
        // The API wrapper switches to multipart when this is a File.
        ...(data.receiptFile ? { receipt_image: data.receiptFile } : {}),
      };
      return editingId ? expenseService.update(editingId, body) : expenseService.create(data.hostelId || undefined, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'expenses'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
    },
  });

  const isValid = Boolean(data.title.trim() && Number(data.amount) > 0 && data.category && data.date);

  const submit = () => {
    if (!isValid) return;
    saveMutation.mutate();
  };

  const reset = (seed: AddExpenseData = EMPTY_ADD_EXPENSE_DATA) => {
    setStep(0);
    setData(seed);
    saveMutation.reset();
  };

  /**
   * "Save & add another" — resets to step 0 with category + paymentMethod
   * carried forward as editable context. Everything else (title, vendor,
   * amount, date, notes, receipt, status) resets to defaults so the next
   * expense starts fresh but in the same context.
   */
  const addAnother = () => {
    const carry = {
      ...EMPTY_ADD_EXPENSE_DATA,
      category: data.category,
      paymentMethod: data.paymentMethod,
      hostelId: data.hostelId,
    };
    setStep(0);
    setData(carry);
    saveMutation.reset();
  };

  /** Summary of the last-saved expense for the success toast. */
  const lastSavedSummary = saveMutation.isSuccess
    ? `₹${data.amount} ${data.title}${data.vendor ? ` · ${data.vendor}` : ''}`
    : null;

  return {
    step,
    stepLabels: STEP_LABELS,
    data,
    setD,
    isValid,
    canAdvance,
    isEditing: Boolean(editingId),
    submitted: saveMutation.isSuccess,
    isSubmitting: saveMutation.isPending,
    submitError: saveMutation.isError ? getErrorMessage(saveMutation.error, 'Could not save the expense. Please try again.') : null,
    lastSavedSummary,
    next,
    back,
    submit,
    reset,
    addAnother,
  };
}
