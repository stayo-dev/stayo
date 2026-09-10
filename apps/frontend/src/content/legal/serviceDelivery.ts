import { COMPANY, PAYMENT_PARTNER } from '../company';
import type { LegalDocument } from './types';

/**
 * Service Delivery & Access — the direct replacement for a "Shipping &
 * Delivery" page, kept alive under `/shipping-policy` and
 * `/legal/shipping-policy` because payment-aggregator onboarding checklists
 * look for exactly that phrase (spec §5).
 *
 * Content per spec §5: Stayo delivers software, not goods, so there is
 * nothing to ship. What is actually delivered — account access, generated
 * records, communications — is digital and delivered in-app or by email. A
 * hostel's physical amenities are provided by the hostel, not by Stayo,
 * consistent with the money model this whole document set is built on:
 * Stayo is never a party to the accommodation contract and never in the flow
 * of resident funds (see `terms.ts` §2, `refunds.ts`).
 */

export const serviceDeliveryDocument: LegalDocument = {
  id: 'service-delivery',
  title: 'Service Delivery & Access',
  route: '/legal/service-delivery',
  aliases: ['/shipping-policy', '/legal/shipping-policy'],
  version: '1.0',
  effectiveDate: '2026-09-10',
  audience: 'all',
  material: false,
  metaDescription:
    "Stayo's Service Delivery & Access policy — Stayo delivers software, not physical goods, so nothing is shipped; what you get is account access, generated records and communications, delivered digitally, while a hostel's physical amenities are provided by the hostel itself.",
  summary: [
    'Stayo is software. We deliver access to that software, not a physical product, so no physical goods are shipped to you at any point.',
    'What we deliver digitally: account access as soon as it is activated, and the receipts, agreements and confirmations the Platform generates, sent in-app and by email.',
    'A hostel’s rooms, beds, food and other physical amenities are provided by the hostel itself, following its own onboarding of you — not by Stayo.',
    'If something you were told to expect from Stayo was not delivered, tell support first.',
  ],
  content: [
    {
      type: 'notice',
      text: 'The “In short” summary above is not the policy. It is there to help you find your way around. Where the summary and a clause differ, the clause governs.',
    },
    {
      type: 'paragraph',
      text: 'This policy explains what Stayo delivers to you, and when. It exists because some reviewers look for a page under this name; the substance of it is that Stayo is a software platform, and everything it delivers is delivered digitally.',
    },

    /* 1 — No physical goods */
    { type: 'subheading', id: 'no-physical-goods', text: '1. No physical goods are shipped' },
    {
      type: 'clause',
      id: 'clause-no-physical-goods-1',
      number: '1.1',
      text: 'Stayo does not sell or ship any physical product. There is no physical goods delivery, no courier, no shipping address to give us, and no delivery timeline to track, because nothing physical ever moves through the Platform.',
    },
    {
      type: 'clause',
      id: 'clause-no-physical-goods-2',
      number: '1.2',
      text: 'What we deliver is access to software, and the digital records that software generates for you. The rest of this policy sets out what that means in practice.',
    },

    /* 2 — What is delivered, and when */
    { type: 'subheading', id: 'what-is-delivered', text: '2. What is delivered, and when' },
    {
      type: 'clause',
      id: 'clause-what-is-delivered-1',
      number: '2.1',
      text: 'Account access. An Owner’s access to the Owner side of the Platform is delivered as soon as their subscription is activated. A Resident’s access is delivered as soon as their account is created and, where activation involves the hostel confirming a room, as soon as that activation step is completed.',
    },
    {
      type: 'clause',
      id: 'clause-what-is-delivered-2',
      number: '2.2',
      text: 'Records the Platform generates. Payment receipts, rental agreements, obligation and rent-due records, and booking or enquiry confirmations are generated in-app at the time of the event they record, and are also sent to you by email where you have given us an address to send them to.',
    },
    {
      type: 'clause',
      id: 'clause-what-is-delivered-3',
      number: '2.3',
      text: `Payment confirmation. When you pay a hostel through the Platform, the receipt is generated as soon as ${PAYMENT_PARTNER.descriptor} confirms the payment succeeded — usually within moments, though this depends on the payment method and the aggregator, not on Stayo.`,
    },
    {
      type: 'clause',
      id: 'clause-what-is-delivered-4',
      number: '2.4',
      text: 'None of this is shipped, couriered or posted. It is delivered by making it available in your account and, where applicable, by email — there is no separate delivery step and no delivery fee.',
    },

    /* 3 — What the hostel delivers, not Stayo */
    {
      type: 'subheading',
      id: 'what-the-hostel-delivers',
      text: '3. What the hostel delivers, not Stayo',
    },
    {
      type: 'clause',
      id: 'clause-what-the-hostel-delivers-1',
      number: '3.1',
      text: 'Access to a room, a bed, food, common areas and any other physical amenity of a hostel is provided by that hostel, under its own onboarding and house rules, once you have completed whatever check-in or move-in process it requires. Stayo is not a party to that arrangement and does not provide, inspect or guarantee it.',
    },
    {
      type: 'clause',
      id: 'clause-what-the-hostel-delivers-2',
      number: '3.2',
      text: 'A successful payment through the Platform is proof that the payment reached the hostel — it is not, by itself, a guarantee of physical access to the room or amenity it relates to. That access is governed by your agreement with the hostel.',
    },

    /* 4 — If something was not delivered */
    { type: 'subheading', id: 'if-something-goes-wrong', text: '4. If something was not delivered' },
    {
      type: 'clause',
      id: 'clause-if-something-goes-wrong-1',
      number: '4.1',
      text: `If account access, a receipt, an agreement or a confirmation that the Platform should have given you did not arrive, write to us at ${COMPANY.emails.support} with what you were expecting and when. If the problem is with a hostel not giving you the physical access it owes you under your own agreement with it, raise it with the hostel first, then escalate to our Grievance Officer if it is not resolved — the same route our Payments, Refunds & Cancellations policy describes.`,
    },
    {
      type: 'contact_list',
      items: [
        { label: 'Support', value: COMPANY.emails.support },
        { label: 'Grievance Officer', value: COMPANY.legal.grievanceOfficer.email },
      ],
    },

    /* 5 — Changes to this policy */
    { type: 'subheading', id: 'changes', text: '5. Changes to this policy' },
    {
      type: 'clause',
      id: 'clause-changes-1',
      number: '5.1',
      text: 'We may update this policy, most often to reflect a change in what the Platform delivers. Each version is published on this page with a version number and the date it takes effect.',
    },
  ],
};
