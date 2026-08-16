import { createContext, useContext } from 'react';
import type { ToastKind } from '../ui/Toast';

type FireToast = (message: string, kind?: ToastKind) => void;

/**
 * The shell owns the single toast instance; screens reach it through here
 * rather than each rendering their own, so two overlapping actions can never
 * stack two toasts on top of each other.
 */
export const AdminToastContext = createContext<FireToast>(() => {});

export function useToast(): FireToast {
  return useContext(AdminToastContext);
}
