import { createElement } from 'react';
import { Wifi, Receipt, UtensilsCrossed, FileText, CircleHelp, CreditCard, DoorOpen, Bell, Zap, Droplets, Armchair, Sparkles } from 'lucide-react';
import type { ServiceRequestType } from '@features/tenant-room/api';
import type { FormConfig } from '../types';

interface FormContext {
  createRequest: (data: { type: ServiceRequestType; category?: string; description?: string }) => Promise<unknown>;
}

const icon = (I: typeof Wifi) => createElement(I, { className: 'h-[17px] w-[17px]' });

/**
 * Single-decision request forms — Stayo Tenant.dc.html's FORM map, ported to
 * call the real `POST /tenants/me/service-requests` endpoint. The backend's
 * `ServiceRequestType` enum only has 6 values (MAINTENANCE/ROOM_CHANGE/
 * CLEANING/LOST_KEY/VISITOR_PASS/EXTRA_MATTRESS) — the design's generic
 * "Raise a ticket"/"Report a bug" flows (which offer categories with no
 * dedicated type) map onto `type: MAINTENANCE` with the picked option's label
 * carried in the free-text `category` field, since that's the closest real
 * bucket for "something needs staff attention" and the category is preserved
 * verbatim for whoever triages it.
 */
export function buildServiceRequestFormConfigs(ctx: FormContext): Record<string, FormConfig> {
  const submitWithCategory = (type: ServiceRequestType, categoryFromOptions?: Record<string, string>) =>
    async ({ optionId, inputs, note }: { optionId?: string; inputs: Record<string, string>; note: string }) => {
      const category = categoryFromOptions && optionId ? categoryFromOptions[optionId] : optionId;
      const structuredLines = Object.entries(inputs)
        .filter(([, v]) => v.trim().length > 0)
        .map(([k, v]) => `${k}: ${v}`);
      const description = [...structuredLines, note.trim()].filter(Boolean).join('\n');
      await ctx.createRequest({ type, category, description: description || undefined });
    };

  const raiseTicketOptions = {
    internet: 'Internet & Wi-Fi',
    billing: 'Billing & payments',
    food: 'Food & mess',
    admin: 'Documents & admin',
    other: 'Something else',
  };
  const maintOptions = {
    electrical: 'Electrical',
    water: 'Water',
    furniture: 'Furniture',
    cleaning: 'Cleaning',
    internet: 'Internet',
    other: 'Other',
  };

  return {
    raise_ticket: {
      title: 'Raise a complaint',
      sub: 'Goes straight to your hostel team',
      prompt: 'What do you need help with?',
      needsOption: true,
      hasIcon: true,
      options: [
        { id: 'internet', label: 'Internet & Wi-Fi', icon: icon(Wifi) },
        { id: 'billing', label: 'Billing & payments', icon: icon(Receipt) },
        { id: 'food', label: 'Food & mess', icon: icon(UtensilsCrossed) },
        { id: 'admin', label: 'Documents & admin', icon: icon(FileText) },
        { id: 'other', label: 'Something else', icon: icon(CircleHelp) },
      ],
      photos: true,
      note: { label: 'Describe your request', placeholder: 'Tell us what you need help with…' },
      submitLabel: 'Send to my hostel',
      successTitle: 'Sent to your hostel',
      successSub: 'Your hostel team can see it now. Follow it any time from Complaints.',
      refPrefix: 'T',
      onSubmit: submitWithCategory('MAINTENANCE', raiseTicketOptions),
    },
    svc_room_change: {
      title: 'Request room change',
      sub: 'One request · warden approval',
      prompt: 'Why do you want to change?',
      needsOption: true,
      options: [
        { id: 'roommate', label: 'Roommate issues' },
        { id: 'bath', label: 'Prefer attached bathroom' },
        { id: 'floor', label: 'Prefer a different floor' },
        { id: 'medical', label: 'Medical reason' },
        { id: 'other', label: 'Other' },
      ],
      inputs: [{ key: 'Preferred room (optional)', label: 'Preferred room (optional)', type: 'text', placeholder: 'e.g. F2, higher floor' }],
      note: { label: 'Anything else?', placeholder: 'Add details for the warden' },
      submitLabel: 'Submit request',
      successTitle: 'Request submitted',
      successSub: 'Your room change request is pending warden approval.',
      refPrefix: 'RC',
      onSubmit: submitWithCategory('ROOM_CHANGE', {
        roommate: 'Roommate issues', bath: 'Prefer attached bathroom', floor: 'Prefer a different floor', medical: 'Medical reason', other: 'Other',
      }),
    },
    svc_cleaning: {
      title: 'Cleaning request',
      sub: 'Extra housekeeping',
      prompt: 'When do you need cleaning?',
      needsOption: true,
      options: [
        { id: 'today', label: 'Today', sub: 'Before end of day' },
        { id: 'tomorrow', label: 'Tomorrow', sub: 'Morning slot' },
        { id: 'custom', label: 'Pick a date', sub: 'Choose a custom day' },
      ],
      note: { label: 'Reason (optional)', placeholder: 'e.g. spilled something' },
      submitLabel: 'Submit request',
      successTitle: 'Cleaning requested',
      successSub: 'Housekeeping will be assigned shortly.',
      refPrefix: 'CLN',
      onSubmit: submitWithCategory('CLEANING', { today: 'Today', tomorrow: 'Tomorrow', custom: 'Custom date' }),
    },
    svc_lostkey: {
      title: 'Lost key',
      sub: 'Report & replace',
      prompt: 'Report a lost room key',
      banner: 'A replacement fee may apply — the hostel will confirm the amount. A new key is usually ready within 24 hours.',
      submitLabel: 'Confirm request',
      successTitle: 'Report submitted',
      successSub: 'Your replacement key request is being processed.',
      refPrefix: 'KEY',
      onSubmit: submitWithCategory('LOST_KEY'),
    },
    svc_visitor: {
      title: 'Visitor pass',
      sub: 'Register a guest',
      prompt: 'Visitor details',
      needsName: true,
      inputs: [
        { key: 'name', label: 'Visitor name', type: 'text', placeholder: 'Full name' },
        { key: 'phone', label: 'Phone', type: 'tel', placeholder: '10-digit number' },
        { key: 'date', label: 'Visit date', type: 'text', placeholder: 'e.g. 27 Jul' },
        { key: 'time', label: 'Arrival time', type: 'text', placeholder: 'e.g. 4:00 PM' },
      ],
      submitLabel: 'Submit request',
      successTitle: 'Pass requested',
      successSub: 'Your visitor pass is pending approval from the front desk.',
      refPrefix: 'VIS',
      onSubmit: submitWithCategory('VISITOR_PASS'),
    },
    svc_mattress: {
      title: 'Extra mattress',
      sub: 'Bedding request',
      prompt: 'What do you need?',
      needsOption: true,
      options: [
        { id: 'temp', label: 'Temporary', sub: 'Up to 7 days' },
        { id: 'perm', label: 'Permanent', sub: 'Ongoing' },
      ],
      banner: 'Charges may apply — temporary use or one-time permanent bedding.',
      note: { label: 'Reason (optional)', placeholder: 'e.g. guest staying over' },
      submitLabel: 'Confirm request',
      successTitle: 'Request submitted',
      successSub: 'Your extra mattress request is pending approval.',
      refPrefix: 'MAT',
      onSubmit: submitWithCategory('EXTRA_MATTRESS', { temp: 'Temporary', perm: 'Permanent' }),
    },
    maint_new: {
      title: 'New maintenance request',
      sub: 'One issue · quick submit',
      prompt: 'What kind of issue?',
      needsOption: true,
      hasIcon: true,
      options: [
        { id: 'electrical', label: 'Electrical', icon: icon(Zap) },
        { id: 'water', label: 'Water', icon: icon(Droplets) },
        { id: 'furniture', label: 'Furniture', icon: icon(Armchair) },
        { id: 'cleaning', label: 'Cleaning', icon: icon(Sparkles) },
        { id: 'internet', label: 'Internet', icon: icon(Wifi) },
        { id: 'other', label: 'Other', icon: icon(CircleHelp) },
      ],
      photos: true,
      note: { label: 'Describe the issue', placeholder: "What's wrong and where?" },
      submitLabel: 'Submit request',
      successTitle: 'Request submitted',
      successSub: 'Your maintenance request has been logged and will be assigned soon.',
      refPrefix: 'C',
      onSubmit: submitWithCategory('MAINTENANCE', maintOptions),
    },
  };
}
