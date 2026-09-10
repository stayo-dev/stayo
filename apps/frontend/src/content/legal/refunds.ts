import { COMPANY, PAYMENT_PARTNER } from '../company';
import type { LegalDocument } from './types';

/**
 * Payments, Refunds & Cancellations — the highest-risk document in the set.
 *
 * The governing rule (spec §6.4) is that every sentence here must survive one
 * test: "can Stayo actually do this without holding the money?" Anything that
 * fails becomes an Owner obligation with a stated enforcement remedy, never a
 * Stayo guarantee. This document is the direct replacement for the retired
 * policy that promised refunds "credited back within 7 to 10 business days" —
 * a mechanism that never existed in the code. Two positions are load-bearing:
 *
 * 1. **Stayo is never in the flow of resident money.** Each hostel owner is
 *    onboarded as a sub-merchant of `PAYMENT_PARTNER.descriptor` and is the
 *    merchant of record; a resident's payment settles directly into the
 *    owner's own account. Stayo cannot refund what it never received, so the
 *    platform minimum floor is a condition of listing enforced by suspension
 *    and delisting — never a sum Stayo pays out of its own pocket.
 * 2. **No end-to-end refund date is promised.** Stayo commits only to the
 *    part it and the hostel actually control — the hostel approving and
 *    initiating a floor refund on the platform. What happens after that runs
 *    on the timelines of the payer's bank, card issuer or UPI provider, which
 *    no party on this side of the transaction controls.
 *
 * The payment aggregator is described, never named (D6) —
 * `PAYMENT_PARTNER.descriptor` is the only form allowed to reach published
 * copy.
 *
 * **Two figures below are this module's honest limits, not decisions:**
 *
 * - **Trial length** (clause `money-you-pay-stayo-2`) — the proprietor has
 *   not fixed a number. The clause is written to be true and complete
 *   whatever that number turns out to be, or whether a trial is offered at
 *   all: it defers to what is shown at the time, rather than stating a figure.
 * - **Mid-cycle subscription refundability** (clause `money-you-pay-stayo-4`)
 *   — also undecided. The clause states the conservative, commonly-used
 *   default (fees already charged are for the cycle already entered; cancelling
 *   stops the next charge, it does not itself entitle you to a refund of the
 *   current one) without foreclosing a discretionary exception, and
 *   deliberately avoids the absolute "non-refundable under all circumstances"
 *   framing flagged as an unfair-term risk in spec §2.2.
 * - **The floor-approval turnaround** (clause `money-you-pay-a-hostel-6`) is
 *   stated as a firm number of business days because the brief for this task
 *   requires a firm window to be stated; the design spec (§12) separately
 *   lists "the refund-floor turnaround Stayo commits to" as an item the
 *   proprietor has not yet confirmed. Treat the figure here as a proposal
 *   pending sign-off, not a settled fact — see the implementation report.
 */

export const refundsDocument: LegalDocument = {
  id: 'refunds',
  title: 'Payments, Refunds & Cancellations',
  route: '/legal/refunds',
  aliases: ['/refund-policy', '/legal/refund-policy'],
  version: '1.0',
  effectiveDate: '2026-09-10',
  audience: 'all',
  material: true,
  metaDescription:
    "Stayo's Payments, Refunds & Cancellations policy — how the owner subscription works, and the platform minimum floor for rent, deposit and booking-token payments that settle directly into a hostel's own merchant account, which Stayo never receives and never refunds.",
  summary: [
    'Two different kinds of money move through Stayo, and this policy treats them separately: what you pay us for the software, and what a resident pays a hostel through the platform.',
    'Your Stayo subscription is billed to you directly by us, and any refund of it is ours to decide.',
    'Rent, deposits and booking tokens never reach us. They settle straight into the hostel’s own merchant account, and any refund of them is issued by the hostel, never by Stayo.',
    'Every hostel must still honour a minimum refund floor as a condition of being listed: duplicate charges, failed-but-debited payments and charges of the wrong amount are always corrected, and a booking token is refunded in full if the hostel cancels or the room doesn’t match the listing.',
    'If a hostel won’t honour that floor, we cannot pay the refund ourselves — our remedies are to escalate, suspend and delist.',
    'We commit to a firm window for a hostel to act on a floor refund on the platform. After that, how quickly the money reaches your account depends on your bank, card issuer or UPI provider, not on us.',
    'Got a payment problem? Write to ' + COMPANY.emails.support + ' first; if it isn’t resolved, escalate to our Grievance Officer at ' + COMPANY.legal.grievanceOfficer.email + '.',
  ],
  content: [
    {
      type: 'notice',
      text: 'The “In short” summary above is not the policy. It is there to help you find your way around. Where the summary and a clause differ, the clause governs.',
    },
    {
      type: 'paragraph',
      text: 'This policy covers two different kinds of money, and keeps them apart on purpose because conflating them is what made an earlier version of this document unworkable. Part 1 covers the subscription a hostel owner pays Stayo for the software. Part 2 covers the rent, deposits and booking tokens a resident pays a hostel through the platform — money that never reaches Stayo at all.',
    },

    /* Part 1 — Money you pay Stayo */
    {
      type: 'subheading',
      id: 'money-you-pay-stayo',
      text: '1. Money you pay Stayo — your subscription',
    },
    {
      type: 'paragraph',
      text: 'This Part applies only to the fee a hostel owner pays Stayo for access to the software. It has nothing to do with rent, deposits or booking tokens a resident pays a hostel — that money is covered in Part 2, and none of it reaches us.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-stayo-1',
      number: '1.1',
      text: 'A subscription buys access to the Owner side of the Platform for the hostel or hostels on your account — admissions, rooms and beds, rent accounting, records, reminders and communication. It is a fee for software, charged by us, and any refund of it is ours to decide.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-stayo-2',
      number: '1.2',
      text: 'Where we offer a free trial, its length and what happens when it ends are shown to you before the trial starts. Unless you cancel before the trial ends, the subscription begins automatically as a paid subscription, at the price and billing cycle you were shown, charged to the payment instrument you authorised.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-stayo-3',
      number: '1.3',
      text: 'A subscription renews automatically at the start of each billing cycle, using the payment instrument you have authorised for autopay, until you cancel it. The plan, price and billing cycle that apply to you are shown before you subscribe and remain visible from your billing settings.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-stayo-4',
      number: '1.4',
      text: 'Fees already charged for a billing cycle pay for access during that cycle. Cancelling mid-cycle stops the next charge from being made; it does not, by itself, entitle you to a refund of the amount already charged for the cycle you are in. We may, at our discretion, make an exception in a particular case — for example a billing error on our part — but that is a discretion we exercise, not a standing entitlement.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-stayo-5',
      number: '1.5',
      text: 'If a subscription payment fails, we may retry it and we will tell you. While it stays unpaid, Owner features may be suspended, but your data — your rooms, residents, obligations and records — is retained; access is restored once the subscription is brought up to date. When you cancel, or a lapsed subscription is not revived, access continues until the end of the cycle already paid for, and after that we give you a window to export your data before it is deleted, as set out in our Data Deletion & Retention notice.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-stayo-6',
      number: '1.6',
      text: 'All subscription fees are stated in Indian Rupees and are exclusive of taxes. Trishul Solutions is not registered for Goods and Services Tax, does not charge GST, and does not claim a GST registration on any invoice or receipt. If and when we become liable to register, applicable tax will be added to the fees from the date the registration takes effect, and shown on our invoices from that date.',
    },

    /* Part 2 — Money you pay a hostel through Stayo */
    {
      type: 'subheading',
      id: 'money-you-pay-a-hostel',
      text: '2. Money you pay a hostel through Stayo',
    },
    {
      type: 'notice',
      text: `Stayo neither receives nor refunds the rent, deposit or booking token you pay a hostel through the platform. That money settles directly to the hostel's own merchant account, held with ${PAYMENT_PARTNER.descriptor} — it does not pass through, and is never held in, any account belonging to Stayo. Any refund of it is issued by the hostel, from that account, not by Stayo.`,
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-a-hostel-1',
      number: '2.1',
      text: 'Beyond the platform minimum floor set out below, this policy does not apply to rent, security deposit, maintenance charges, utility payments or any other amount collected between a hostel and its residents — those are governed by the hostel’s own terms, shown to you before you pay.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-a-hostel-2',
      number: '2.2',
      text: 'As a condition of being listed on Stayo, every hostel must honour the following minimum floor, whatever its own cancellation terms say:',
    },
    {
      type: 'list',
      ordered: true,
      items: [
        'Duplicate payments — if you are charged more than once for the same obligation, the hostel must correct it in full.',
        'Failed-but-debited transactions — if a payment shows as failed on the platform but the amount was debited from your account, the hostel must correct it in full.',
        'Charges of the wrong amount — if you are charged an amount that does not match what was actually due, the hostel must correct the difference in full.',
        'Booking tokens — a booking token is refunded in full if the hostel cancels the booking, or if the room you are allocated materially differs from what was listed.',
      ],
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-a-hostel-3',
      number: '2.3',
      text: 'We cannot pay a refund we never received, so we do not enforce this floor by paying it ourselves. What we do is: escalate an unresolved complaint through the grievance channel below; suspend or delist a hostel that will not honour the floor, as the condition of listing it agreed to; and, for a genuine gateway-level failure — for example a double capture on a single payment attempt — raise it directly with our payment partner. Those are the remedies we actually have, and residents should expect exactly those, not a payment from Stayo.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-a-hostel-4',
      number: '2.4',
      text: 'Anything beyond this floor — including deposit refunds, notice-period charges, and any other term of your stay — is decided by the hostel’s own house rules and cancellation terms, which are shown to you before you pay. Stayo is not a party to that agreement and cannot override it; it is your agreement with the hostel, not with us.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-a-hostel-5',
      number: '2.5',
      text: 'We commit only to the part of a refund that we and the hostel actually control: the hostel reviewing and, where the floor applies, initiating the refund on the platform. We do not promise a date for the refund to reach your account, because that step happens off the platform, in the banking system, and no party on this side of the transaction controls it.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-a-hostel-6',
      number: '2.6',
      text: 'We require a hostel to review a floor refund request and, where it qualifies, initiate the refund from their own account within 5 business days of the request being raised through the platform. Once the hostel has initiated it, the money reaches you on the timelines set by your bank, your card issuer, or your UPI app or provider — not by Stayo and not by the hostel. Those timelines vary, and we do not state one here because doing so would be a promise we could not keep.',
    },
    {
      type: 'clause',
      id: 'clause-money-you-pay-a-hostel-7',
      number: '2.7',
      text: 'If a payment did not go the way it should have, tell us. Start with support — most problems are fastest to fix there. If it is not resolved, or the hostel is refusing something the floor above entitles you to, escalate to our Grievance Officer.',
    },
    {
      type: 'contact_list',
      items: [
        { label: 'Support (start here)', value: COMPANY.emails.support },
        { label: 'Grievance Officer (escalation)', value: COMPANY.legal.grievanceOfficer.email },
      ],
    },
  ],
};
