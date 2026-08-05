import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { expenseService } from '@features/expenses/api';
import { queryKeys } from '@lib/queryKeys';
import { EMPTY_ADD_EXPENSE_DATA, type AddExpenseData } from '../types';

const STEP_LABELS = ['Details', 'Financial', 'Review'] as const;

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * Step index + form data + navigation for the 3-step Add Expense wizard.
 * Submits to the real `POST /expenses` (create) or, when `editingId` is set,
 * `PUT /expenses/:id` (edit an existing expense) — mirrors `useInviteWizard`'s
 * shape. Also used pre-filled by "Duplicate" in `ExpenseDetailModal`, so
 * `reset` accepts optional seed data.
 */
export function useAddExpenseWizard(editingId?: string) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<AddExpenseData>(EMPTY_ADD_EXPENSE_DATA);

  const setD = (patch: Partial<AddExpenseData>) => setData((d) => ({ ...d, ...patch }));

  const next = () => setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1));
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

  return {
    step,
    stepLabels: STEP_LABELS,
    data,
    setD,
    isValid,
    isEditing: Boolean(editingId),
    submitted: saveMutation.isSuccess,
    isSubmitting: saveMutation.isPending,
    submitError: saveMutation.isError ? getErrorMessage(saveMutation.error, 'Could not save the expense. Please try again.') : null,
    next,
    back,
    submit,
    reset,
  };
}
