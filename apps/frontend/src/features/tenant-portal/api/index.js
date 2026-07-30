import api from '@lib/api-client';
import { tenantService } from '@features/tenants/api';
import { paymentService } from '@features/payments/api';
import { notificationService } from '@features/notifications/api';
import { moveOutService } from '@features/move-out/api';
import { agreementService } from '@features/agreements/api';

const unwrap = (response) => {
  if (response.data?.success === true && response.data.data !== undefined) {
    return response.data.data;
  }
  return response.data;
};

export const tenantPortalApi = {
  ...tenantService,
  getDuesBreakdown: async () => {
    const response = await api.get('/payments/tenant-dues');
    return unwrap(response);
  },
  getMoveOutStatus: async () => {
    const response = await api.get('/move-out/tenant');
    return unwrap(response);
  },
  getNotifications: async () => {
    const response = await api.get('/notifications');
    const data = unwrap(response);
    return Array.isArray(data) ? data : data?.notifications ?? [];
  },
  getAdvance: async () => tenantService.getMyFinancialLedger(),
  getFinancialReadModel: async () => {
    const response = await api.get('/tenants/me/financial-read-model');
    return unwrap(response);
  },
  uploadMyPhoto: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/tenants/me/photo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return unwrap(response);
  },
  uploadMyDocument: async (docType, file, docNumber = '') => {
    const formData = new FormData();
    formData.append('doc_type', docType);
    formData.append('file', file);
    if (docNumber) formData.append('doc_number', docNumber);
    const response = await api.post('/tenants/me/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return unwrap(response);
  },
  logout: async () => {
    const response = await api.post('/auth/logout');
    return response.data;
  },
  downloadReceipt: (paymentId) => paymentService.downloadReceipt(paymentId),
  createPaymentIntent: (data) => paymentService.createIntent(data),
  getAttempt: (attemptId) => paymentService.getAttempt(attemptId),
  submitUpiReference: (data) => paymentService.submitUpiReference(data),
  verifyPayment: (data) => paymentService.verifyPayment(data),
  settlementPreview: (tenantId, amount, hostelId, allowedObligationIds) => paymentService.settlementPreview(tenantId, amount, hostelId, allowedObligationIds),
  markNotificationRead: (id) => notificationService.markAsRead(id),
  getMoveOutTimeline: () => moveOutService.getTimeline(),
  getAgreementRenewal: () => agreementService.getTenantRenewal(),
  getTenantRenewalOffer: () => agreementService.getTenantRenewalOffer(),
  acceptRenewalOffer: (offerId) => agreementService.acceptRenewalOffer(offerId),
  declineRenewalOffer: (offerId, reason) => agreementService.declineRenewalOffer(offerId, reason),
  discussRenewalOffer: (offerId, message) => agreementService.discussRenewalOffer(offerId, message),
  createRenewalDraft: (agreementId) => agreementService.createRenewalDraft(agreementId),
  uploadRenewalSignature: (file, type) => agreementService.uploadRenewalSignature(file, type),
  signRenewalAgreement: (agreementId, data) => agreementService.signRenewalAgreement(agreementId, data),
};
