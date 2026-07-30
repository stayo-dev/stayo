import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { hmsToast } from '@lib/toast';
import { tenantService } from '@features/tenants/api';
import { paymentService } from '@features/payments/api';
import { queryKeys } from '@lib/queryKeys';
import { sharePaymentLink as sharePaymentLinkViaWhatsApp } from '@lib/share';

export function useTenantActions(hostelId: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.tenants.all(hostelId) });
    qc.invalidateQueries({ queryKey: queryKeys.dashboard.all(hostelId) });
  };

  const updateInvite = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      tenantService.update(id, { invitation_edit: true, ...data }),
    onSuccess: () => {
      toast.success('Invitation updated');
      invalidate();
    },
    onError: (e: unknown) => hmsToast.error(e, 'Update invitation'),
  });

  const cancelInvite = useMutation({
    mutationFn: (id: string) => tenantService.cancelInvitation(id),
    onSuccess: () => {
      toast.success('Invitation cancelled');
      invalidate();
    },
    onError: (e: unknown) => hmsToast.error(e, 'Cancel invitation'),
  });

  const resendInvite = useMutation({
    mutationFn: async (identifier: string) => {
      const res = await tenantService.resendInvitation(identifier);
      if (res?.error) {
        const err = new Error(res.error.message || 'Failed to resend');
        (err as any).code = res.error.code;
        (err as any).identifier = identifier;
        throw err;
      }
      return res;
    },
    onSuccess: () => {
      toast.success('Invitation resent');
      invalidate();
    },
    onError: async (e: any) => {
      if (e?.code === 'EMAIL_FALLBACK_REQUIRED' || e?.response?.data?.error?.code === 'EMAIL_FALLBACK_REQUIRED') {
        const email = window.prompt(
          "WhatsApp delivery failed. Please enter the tenant's email address to resend via Email fallback:"
        );
        if (email && email.trim()) {
          try {
            const res = await tenantService.resendInvitation(e.identifier || '', { email: email.trim().toLowerCase() });
            if (res?.error) {
              toast.error(res.error.message || 'Failed to send fallback email');
            } else {
              toast.success('Invitation resent via Email');
              invalidate();
            }
          } catch (err: any) {
            hmsToast.error(err, 'Resend invitation fallback');
          }
        }
      } else {
        hmsToast.error(e, 'Resend invitation');
      }
    },
  });

  const reactivate = useMutation({
    mutationFn: ({ id, data }: { id: string; data?: Record<string, unknown> }) =>
      tenantService.reactivate(id, data ?? {}),
    onSuccess: () => {
      toast.success('Tenant reactivated');
      invalidate();
    },
    onError: (e: unknown) => hmsToast.error(e, 'Reactivate tenant'),
  });

  const markLeft = useMutation({
    mutationFn: (id: string) => tenantService.delete(id),
    onSuccess: () => {
      toast.success('Tenant marked as LEFT');
      invalidate();
    },
    onError: (e: unknown) => hmsToast.error(e, 'Mark tenant as left'),
  });

  const blockDirectLeft = () => {
    hmsToast.warning(
      'Use the Move-Out workflow',
      'Departures must go through the Move-Out process to settle dues and deposit correctly.',
    );
  };

  const callTenant = async (phone: string) => {
    if (!phone || phone === 'N/A') {
      hmsToast.warning('Phone number unavailable', 'No phone number is saved for this tenant.');
      return;
    }
    try {
      await navigator.clipboard.writeText(phone);
    } catch {
      /* ignore */
    }
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) window.open(`tel:${phone}`, '_self');
    else toast.success('Phone copied to clipboard');
  };

  const whatsAppTenant = (phone: string) => {
    if (!phone || phone === 'N/A') {
      hmsToast.warning('Phone number unavailable', 'No phone number is saved for this tenant.');
      return;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.startsWith('91') && cleanPhone.length === 12 ? cleanPhone : `91${cleanPhone}`;
    window.open(`https://wa.me/${formattedPhone}`, '_blank');
  };

  const copyPhone = async (phone: string) => {
    if (!phone || phone === 'N/A') {
      hmsToast.warning('Phone number unavailable', 'No phone number is saved for this tenant.');
      return;
    }
    try {
      await navigator.clipboard.writeText(phone);
      toast.success('Phone number copied to clipboard');
    } catch {
      hmsToast.error('Failed to copy', 'Could not copy phone number.');
    }
  };

  const sharePaymentLink = async (tenantId: string, phone?: string, amount?: number) => {
    try {
      const res = await paymentService.generatePayLink({ tenantId });
      const paymentLink = res.url;
      const message = `Hi, please use this link to make your outstanding payment${amount ? ` of ₹${Number(amount).toLocaleString('en-IN')}` : ''}: ${paymentLink}`;
      const copied = await sharePaymentLinkViaWhatsApp(message, paymentLink, phone);
      toast.success(copied ? 'Link copied — opening WhatsApp' : 'Opening WhatsApp');
    } catch (e: any) {
      hmsToast.error(e, 'Generate payment link');
    }
  };

  return {
    updateInvite,
    cancelInvite,
    resendInvite,
    reactivate,
    markLeft,
    blockDirectLeft,
    callTenant,
    whatsAppTenant,
    copyPhone,
    sharePaymentLink,
  };
}
