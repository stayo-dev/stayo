import { COMPANY } from '../company';
import type { LegalDocument } from './types';

/**
 * Data Deletion & Retention — rewritten to describe what the code actually
 * does, because the previous notice promised erasure "within 30 business days"
 * and deletion of "billing records", neither of which happens.
 *
 * Verified against source before drafting:
 *
 * 1. `apps/backend/src/services/profile/account-closure-service.ts` — closing
 *    an account ANONYMISES the profile row immediately (name, phone, email,
 *    photo and free-text fields replaced, `is_active` false), deletes the
 *    authentication user and revokes live sessions. It never deletes the row:
 *    obligations, payments and agreements reference it, and a hostel's ledger
 *    is not solely the leaver's to rewrite. Closure is refused, in this order,
 *    while rent is owing, while a move-out is still settling, or while the
 *    person still has a live tenancy.
 * 2. Self-service closure is mounted only in the resident/Discover profile
 *    (`DiscoverProfilePage` → `CloseAccountSheet`). Owners have no self-service
 *    closure, so for them this notice points to privacy@.
 * 3. `apps/backend/app/api/cron/data-retention/route.ts` is FROZEN and
 *    unscheduled ("Do not schedule this route"), and if it ran it would only
 *    prune activity, event and reminder logs. So nothing deletes data on a
 *    timer today. The Terms and the Refunds policy previously promised an
 *    owner a "window to export your data before it is deleted" — a deletion
 *    that never occurs. Both now point here, and this notice says plainly that
 *    records are kept until the person asks, subject to legal retention.
 * 4. Owners can export their records at any time from the Money screen
 *    (`features/owner-money/export/ExportSheet.tsx`, `/api/owner/exports`).
 */

export const dataDeletionDocument: LegalDocument = {
  id: 'data-deletion',
  title: 'Data Deletion & Retention',
  route: '/legal/data-deletion',
  aliases: [],
  version: '1.0',
  effectiveDate: '2026-09-10',
  audience: 'all',
  material: true,
  metaDescription:
    'How to close your Stayo account, what happens to your personal data when you do, which records we keep and why, and how to ask us to delete your data.',
  summary: [
    'Residents can close their account themselves, from their profile. Owners, and anyone who prefers it, can write to us instead.',
    'Closing an account takes effect straight away. Your name, phone number, email, photo and anything you wrote about yourself are removed from it, and you are signed out everywhere.',
    'We cannot close an account while rent is still owing, while a move-out is still being settled, or while you still live at a hostel. These are not ways of keeping you — the hostel’s records depend on them.',
    'Records of money — charges, payments, receipts and agreements — are kept after you leave, with your identifying details removed, because they belong to the hostel’s accounts as much as to you and because the law requires them.',
    'We do not delete data automatically on a timer. If you want something deleted, ask us and we will delete what we no longer need to keep.',
  ],
  content: [
    {
      type: 'notice',
      text: 'The “In short” summary above is not the notice. It is there to help you find your way around. Where the summary and a clause differ, the clause governs.',
    },
    {
      type: 'paragraph',
      text: 'This notice explains how to close your Stayo account, exactly what happens to your data when you do, what we keep and why, and how to ask us to delete more. It forms part of our Privacy Policy.',
    },

    /* 1 — Closing your account */
    { type: 'subheading', id: 'closing', text: '1. Closing your account' },
    {
      type: 'clause',
      id: 'clause-closing-1',
      number: '1.1',
      text: 'If you are a resident or you use Stayo to look for a place to stay, you can close your account yourself from your profile, under “Close account”. The Platform explains what you will lose before you confirm.',
    },
    {
      type: 'clause',
      id: 'clause-closing-2',
      number: '1.2',
      text: `If you are a hostel owner, there is no self-service closure. Write to ${COMPANY.emails.privacy} from the email address on your account and we will close it for you. Before you do, you can download your records at any time from the Money screen — see section 4.`,
    },
    {
      type: 'clause',
      id: 'clause-closing-3',
      number: '1.3',
      text: 'We will not close an account while any of the following is true. We check them in this order, because each has to be resolved before the next makes sense:',
    },
    {
      type: 'list',
      ordered: true,
      items: [
        'Rent or another charge is still owing to your hostel. Your account is what your hostel bills against, so it has to stay open until the balance is settled.',
        'A move-out is still being settled. Closing now would leave the hostel’s final settlement half-finished — including the return of any deposit.',
        'You still have a live tenancy at a hostel. Move out first and let the settlement finish.',
      ],
    },
    {
      type: 'clause',
      id: 'clause-closing-4',
      number: '1.4',
      text: 'These are not ways of keeping you on Stayo. An account is the thing a hostel keeps its records against, and closing it mid-stay would break someone else’s accounts, not just yours. Once none of them applies, closing takes a minute.',
    },

    /* 2 — What happens when you close */
    { type: 'subheading', id: 'what-happens', text: '2. What happens when you close' },
    {
      type: 'clause',
      id: 'clause-what-happens-1',
      number: '2.1',
      text: 'Closing takes effect immediately — not after a waiting period. When you confirm:',
    },
    {
      type: 'list',
      ordered: false,
      items: [
        'your name, phone number, email address, photo and any free-text details you added about yourself are replaced, so the account no longer identifies you;',
        'the account is deactivated and your sign-in is deleted, so it cannot be used again; and',
        'every session you have open, on any device, is ended.',
      ],
    },
    {
      type: 'clause',
      id: 'clause-what-happens-2',
      number: '2.2',
      text: 'We anonymise your account rather than erasing it entirely. The account record itself stays, emptied of anything that identifies you, because a hostel’s charges, payments and agreements point to it. Deleting it outright would either fail or tear holes in a ledger that belongs to the hostel as much as to you.',
    },
    {
      type: 'clause',
      id: 'clause-what-happens-3',
      number: '2.3',
      text: 'Closing cannot be undone. If you want to use Stayo again later, you will need to create a new account.',
    },

    /* 3 — What we keep, and why */
    { type: 'subheading', id: 'what-we-keep', text: '3. What we keep, and why' },
    {
      type: 'clause',
      id: 'clause-what-we-keep-1',
      number: '3.1',
      text: 'Some records outlive an account, with your identifying details removed from it as described above:',
    },
    {
      type: 'table',
      columns: ['Record', 'Why we keep it', 'For how long'],
      rows: [
        [
          'Charges, payments, receipts and settlements',
          'They are part of the hostel’s financial records, and Indian tax and accounting law requires them to be kept.',
          'For as long as that law requires. For most financial records this runs for several years after the financial year they relate to.',
        ],
        [
          'Signed rental agreements and accepted house rules',
          'They are the record of what you and the hostel agreed, and either of you may need them in a dispute.',
          'For as long as a claim about them could still be brought, and at least as long as the related financial records.',
        ],
        [
          'Records of activity and security events',
          'They help us investigate problems, fraud and misuse, and show what happened if something is disputed.',
          'Until you ask us to delete them, or until we no longer need them for those purposes.',
        ],
      ],
    },
    {
      type: 'clause',
      id: 'clause-what-we-keep-2',
      number: '3.2',
      text: 'We do not currently delete data automatically after a fixed period. Rather than promise a timetable we do not run, we tell you plainly: data we are not required to keep stays in your account, or in the anonymised record, until you ask us to delete it.',
    },

    /* 4 — Owners: your records and cancellation */
    { type: 'subheading', id: 'owners', text: '4. Hostel owners: your records after cancelling', audience: 'owner' },
    {
      type: 'clause',
      id: 'clause-owners-1',
      number: '4.1',
      text: 'Cancelling your subscription does not delete your hostel’s records. Your rooms, residents, charges, payments and documents stay where they are, and you keep them if you subscribe again.',
    },
    {
      type: 'clause',
      id: 'clause-owners-2',
      number: '4.2',
      text: 'You can download your hostel’s financial records at any time — before or after cancelling — from the Money screen, as a spreadsheet or document for the period you choose.',
    },
    {
      type: 'clause',
      id: 'clause-owners-3',
      number: '4.3',
      text: `If you want your owner data deleted, write to ${COMPANY.emails.privacy}. We will delete what the law does not require us to keep. Records that involve your residents — their charges, payments and agreements — are part of their records too, so we keep those in anonymised form rather than deleting them.`,
    },

    /* 5 — Asking us to delete more */
    { type: 'subheading', id: 'asking', text: '5. Asking us to delete your data' },
    {
      type: 'clause',
      id: 'clause-asking-1',
      number: '5.1',
      text: `You can ask us to delete personal data we hold about you at any time, whether or not you close your account. Email ${COMPANY.emails.privacy} with the subject “Data deletion request”, and include the phone number or email address on your account so we can find it.`,
    },
    {
      type: 'clause',
      id: 'clause-asking-2',
      number: '5.2',
      text: 'We will confirm the request is really from you before acting on it, then tell you what we deleted and what we kept, and why. Where the law requires us to keep something, we will say which law.',
    },
    {
      type: 'clause',
      id: 'clause-asking-3',
      number: '5.3',
      text: `If you are not satisfied with how we handled your request, you can raise it with our Grievance Officer, ${COMPANY.legal.grievanceOfficer.name}, at ${COMPANY.legal.grievanceOfficer.email}. Our Contact & Grievance Redressal page sets out how that works and how long it takes.`,
    },

    /* 6 — Changes */
    { type: 'subheading', id: 'changes', text: '6. Changes to this notice' },
    {
      type: 'clause',
      id: 'clause-changes-1',
      number: '6.1',
      text: 'If we change how long we keep data or how deletion works, we will update this notice and its effective date. If the change reduces what we delete for you, we will tell you before it takes effect.',
    },
  ],
};
