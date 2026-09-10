import { COMPANY, PAYMENT_PARTNER, formatPostalAddress } from '../company';
import type { LegalDocument } from './types';

/**
 * The Privacy Policy — rebuilt to the shape the Digital Personal Data
 * Protection Act, 2023 (DPDP) expects, and to match what the code actually
 * does rather than what an older policy asserted.
 *
 * Two positions here are load-bearing and were verified against source, not
 * assumed from the brief:
 *
 * 1. **Closing an account anonymises; it does not erase, and it is immediate.**
 *    `apps/backend/src/services/profile/account-closure-service.ts` replaces
 *    name, email and phone and flips `is_active` in one synchronous call —
 *    there is no 30-day queue. Financial rows (obligations, payments,
 *    agreements) are left standing on purpose: a hostel's ledger is not
 *    solely the leaver's to rewrite. The previous policy's promise to
 *    "delete your data within 30 business days" was not true of the code and
 *    is not repeated here.
 * 2. **The identity-document vault is per-hostel, not global.** The
 *    `identity_documents` / `identity_document_shares` models in
 *    `apps/backend/prisma/schema.prisma` store the file once and the
 *    per-hostel share (and its own verification status) separately, by
 *    design — "verification state lives here, never on the document", per
 *    the schema's own doc comment — precisely so one owner approving a
 *    document can never silently verify it for every other hostel a resident
 *    applies to. Revocation sets `revoked_at`; the share row is not deleted,
 *    so revoking access does not destroy the audit trail of who saw what.
 *
 * The payment aggregator is described, never named (see `terms.ts` and D6 in
 * the design doc) — `PAYMENT_PARTNER.descriptor` only.
 */

const REGISTERED_ADDRESS = formatPostalAddress(COMPANY.legal.address);

export const privacyDocument: LegalDocument = {
  id: 'privacy',
  title: 'Privacy Policy',
  route: '/legal/privacy',
  aliases: ['/privacy'],
  version: '1.0',
  effectiveDate: '2026-09-10',
  audience: 'all',
  material: true,
  metaDescription:
    "Stayo's Privacy Policy — what Trishul Solutions collects about residents and hostel owners, why, who it is shared with, how long it is kept, and how to exercise your rights under the Digital Personal Data Protection Act, 2023.",
  summary: [
    'We collect what running a hostel stay actually needs — your identity, your tenancy, and payment references — never your card number, CVV or banking password.',
    'Your identity documents are held once, in one vault. Sharing a document with a specific hostel needs your consent, you can revoke that access, and a hostel that verifies your document only verifies it for itself, never for every hostel you apply to.',
    'Closing your account anonymises it immediately — your name, email and phone are replaced and the account is locked. It does not delete a hostel’s financial records of your stay, because those are not solely yours to erase.',
    'We do not build behavioural profiles or track preferences for anyone on the platform, and this is not a lighter promise for minors — DPDP law requires it for them, and we apply the same rule to every account.',
    'You have the rights the law gives a Data Principal — access, correction, erasure, grievance redressal and nomination — and each one has a real, working route below.',
    'Questions about your data go to ' + COMPANY.emails.privacy + '; complaints go to our Grievance Officer at ' + COMPANY.legal.grievanceOfficer.email + '.',
  ],
  content: [
    {
      type: 'notice',
      text: 'The "In short" summary above is not the policy. It is there to help you find your way around. Where the summary and a clause differ, the clause governs.',
    },
    {
      type: 'paragraph',
      text: 'This Privacy Policy explains what personal data Stayo collects when you use the platform, why, who we share it with, how long we keep it, and the rights you have over it. It applies to residents, hostel owners, guardians who hold an account on a minor’s behalf, and anyone who visits our public pages.',
    },

    /* 1 — Introduction and scope */
    { type: 'subheading', id: 'introduction', text: '1. Introduction and scope' },
    {
      type: 'clause',
      id: 'clause-introduction-1',
      number: '1.1',
      text: `Under the Digital Personal Data Protection Act, 2023, the "Data Fiduciary" that decides why and how your personal data is processed is Trishul Solutions, a ${COMPANY.legal.constitution} of ${COMPANY.legal.proprietor}, with its principal place of business at ${REGISTERED_ADDRESS}, India. "Stayo", "we", "us" and "our" in this policy refer to that party.`,
    },
    {
      type: 'clause',
      id: 'clause-introduction-2',
      number: '1.2',
      text: 'Stayo operates only in India, for hostels and paying-guest accommodation in India. We process personal data to provide the platform to people in India, and this policy is written to that scope — it does not describe, and does not need to describe, cross-border processing we do not do.',
    },
    {
      type: 'clause',
      id: 'clause-introduction-3',
      number: '1.3',
      text: 'By using the platform you agree to this policy. This policy forms part of our Terms of Use, and where a term used here is not defined here, it has the meaning given in the Terms.',
    },

    /* 2 — What we collect and why */
    { type: 'subheading', id: 'what-we-collect', text: '2. What we collect and why' },
    {
      type: 'clause',
      id: 'clause-what-we-collect-1',
      number: '2.1',
      text: 'We collect only what running an accommodation stay actually requires. The table below sets out each category, what we use it for, and why we need it — this is the itemised notice the law requires, not a general licence to collect anything we later think of a use for.',
    },
    {
      type: 'table',
      columns: ['Data', 'Purpose', 'Why we need it'],
      rows: [
        [
          'Identity and contact details — name, phone number, email address, profile photo',
          'To create and secure your account, and to let a hostel identify who is enquiring, applying, or staying',
          'An account cannot be opened or verified without knowing who holds it, and a hostel must know who it is admitting or billing',
        ],
        [
          'Date of birth and guardian details',
          'To confirm you meet the platform’s age eligibility, and, where the resident is under 18, to link the account to the guardian who holds it on their behalf',
          'Our Terms require every account holder to be 18 or older, or to be a guardian holding the account for a minor — we cannot apply that rule without this data',
        ],
        [
          'Identity documents — the government-issued ID you upload to your document vault',
          'To let a hostel verify who they are admitting, as Indian tenancy practice and local police-verification requirements typically call for',
          'Hostels routinely need proof of identity before admitting a resident, and cannot get it from us in any other reliable way',
        ],
        [
          'Tenancy and allocation data — room or bed assignment, move-in and move-out dates, rent obligations and their status',
          'To run the stay itself — allocating a bed, calculating what is due, and keeping the record of a tenancy',
          'This is the operational record a hostel needs to manage its property and its accounts, and that you need to see what you owe',
        ],
        [
          'Payment references — transaction id, payment method type, amount and status',
          'To reconcile what has been paid against what is owed, and to give both sides a record of the payment',
          'This is how the platform knows an obligation has been settled — never your card, UPI or bank credentials themselves, which we never receive',
        ],
        [
          'Device and log data — IP address, browser or device type, and access timestamps',
          'To keep the platform secure, diagnose faults, and detect abuse of accounts or the payment mechanism',
          'Needed to run a reliable, secure service and to investigate incidents when something goes wrong',
        ],
        [
          'Support correspondence — messages, tickets and attachments you send us',
          'To answer your query and keep a record of how it was resolved',
          'So we can act on a request, and show what happened if it is disputed later',
        ],
      ],
    },
    {
      type: 'clause',
      id: 'clause-what-we-collect-2',
      number: '2.2',
      text: 'We also use a small number of cookies, and your browser’s own storage, to keep you signed in and secure and to remember choices you make. None of them is used for analytics, advertising or tracking. Our Cookie & Tracking Notice lists each one and what it does.',
    },

    /* 3 — What we never collect */
    { type: 'subheading', id: 'what-we-never-collect', text: '3. What we never collect' },
    {
      type: 'notice',
      text: `Full card numbers, CVV, PINs and banking passwords never reach Stayo's servers. Every payment on the platform is handled inside ${PAYMENT_PARTNER.descriptor}'s own PCI-DSS compliant environment, not ours. What our systems keep is a payment reference — a transaction id, the method type, the amount and the status — which is enough to reconcile what has been paid without our ever holding the instrument you paid with.`,
    },

    /* 4 — Your identity documents */
    { type: 'subheading', id: 'identity-documents', text: '4. Your identity documents' },
    {
      type: 'clause',
      id: 'clause-identity-documents-1',
      number: '4.1',
      text: 'Your identity documents live in one vault tied to your profile, not to any one hostel. You upload a document once, and it stays available to you for as long as you keep it there.',
    },
    {
      type: 'clause',
      id: 'clause-identity-documents-2',
      number: '4.2',
      text: 'A document is not visible to a hostel by default. It is shared with a specific hostel only when you consent to that sharing — typically when you apply to or move into that hostel — and that sharing is revocable: you can withdraw a hostel’s access to your document, and we record when access was revoked.',
    },
    {
      type: 'clause',
      id: 'clause-identity-documents-3',
      number: '4.3',
      text: 'Verification is per hostel, not global. When a hostel owner verifies your document, that verification applies to that hostel’s share of it and to no other. If you apply to a second hostel, that hostel sees the same document but starts its own, separate verification — one owner’s approval never silently verifies your document everywhere you apply.',
    },

    /* 5 — Who we share with */
    { type: 'subheading', id: 'who-we-share-with', text: '5. Who we share with' },
    {
      type: 'clause',
      id: 'clause-who-we-share-with-1',
      number: '5.1',
      text: 'We do not sell personal data. We share it only with the categories of recipient below, and only what each of them needs to do its job.',
    },
    {
      type: 'list',
      ordered: false,
      items: [
        `Payments: ${PAYMENT_PARTNER.descriptor}, to process rent, deposit and booking-token payments you make to a hostel, and to reconcile the reference each payment generates. This partner’s specific identity is not published here; it is available on request from ${COMPANY.emails.privacy}.`,
        `Merchant onboarding and verification: to set a hostel owner up to receive payments directly, and to verify identity or bank-account details where the platform needs to, we share the details that check requires with the onboarding and verification service of ${PAYMENT_PARTNER.descriptor}. For an owner these are typically their name, PAN, bank-account and business details, which Indian payment regulations require the payment partner to verify before it can pay out to them.`,
        'Authentication: cloud identity providers that manage secure sign-in, session tokens and password resets, so we do not have to build or store password handling ourselves.',
        'Email delivery: a transactional email provider that sends invitations, account notifications, rent reminders and password-reset emails on our behalf.',
        'Media storage: a cloud storage and content-delivery provider that stores photographs, listing images and the documents you upload.',
        'Messaging: a WhatsApp Business messaging provider used for one-time passwords, payment reminders, receipts and the platform’s WhatsApp commands.',
        'Web fonts: a font-delivery service that supplies the typefaces the platform is shown in. Your browser fetches the fonts from it directly, so it receives your IP address and basic browser details, as any website you connect to does. We share nothing else with it.',
        'Hosting and caching: the cloud hosting and caching infrastructure that runs the platform and speeds up how quickly it responds — Postgres remains the source of truth, and a caching failure never changes what you are actually charged or owed.',
      ],
    },
    {
      type: 'clause',
      id: 'clause-who-we-share-with-2',
      number: '5.2',
      text: 'A hostel owner receives only what their own tenancy requires — the details of residents who have applied to, live at, or have stayed at their hostel, and the documents those residents have chosen to share with them. An owner does not see the data of residents at a different hostel.',
    },
    {
      type: 'clause',
      id: 'clause-who-we-share-with-3',
      number: '5.3',
      text: 'We may disclose personal data where the law requires it — to a court, a regulator, a law-enforcement authority, or another government body acting under a valid legal power — or where disclosure is necessary to establish, exercise or defend a legal claim, or to protect the safety of a person.',
    },

    /* 6 — Children */
    { type: 'subheading', id: 'children', text: '6. Children' },
    {
      type: 'clause',
      id: 'clause-children-1',
      number: '6.1',
      text: 'You must be 18 or older to hold a Stayo account in your own name. Where the person actually staying is under 18, a parent or legal guardian holds the account and is the one who deals with us.',
    },
    {
      type: 'clause',
      id: 'clause-children-2',
      number: '6.2',
      text: 'We do not build behavioural profiles of any account holder, and we do not track anyone’s preferences to target advertising at them. Section 9 of the DPDP Act requires this for children, and rather than build a rule that applies only where we can be certain an account belongs to a minor, we apply it as our practice for every account on the platform.',
    },

    /* 7 — Retention */
    { type: 'subheading', id: 'retention', text: '7. Retention' },
    {
      type: 'clause',
      id: 'clause-retention-1',
      number: '7.1',
      text: 'When you close your account, we anonymise it immediately. Your name, email and phone number are replaced with values that no longer identify you, and the account is locked — this happens at the moment you close it, not on a delay.',
    },
    {
      type: 'clause',
      id: 'clause-retention-2',
      number: '7.2',
      text: 'Anonymising is not the same as erasing every row that ever referenced you, and we do not promise the latter. Obligations, payments and agreement records tied to your stay are left standing, because a hostel’s financial ledger reflects money that moved between you and that hostel — it is not solely your record to rewrite by closing an account, and the hostel and the law both have a legitimate interest in it surviving. What is removed is what identifies you personally within that record, not the record of what happened.',
    },
    {
      type: 'clause',
      id: 'clause-retention-3',
      number: '7.3',
      text: 'What we keep after an account closes, why, and for how long, is set out in our Data Deletion & Retention notice, which this policy incorporates. We do not delete data automatically on a timer; we keep what the law requires and delete the rest when you ask.',
    },

    /* 8 — Your rights */
    { type: 'subheading', id: 'your-rights', text: '8. Your rights' },
    {
      type: 'clause',
      id: 'clause-your-rights-1',
      number: '8.1',
      text: 'As a Data Principal under the DPDP Act, you have the following rights, and this clause tells you the real route to exercise each one — not just the name of the right.',
    },
    {
      type: 'definitions',
      items: [
        {
          term: 'Right to access',
          definition:
            'View your profile, tenancy and uploaded documents from the Profile section of the app. If you want a copy of data that is not shown there, write to ' +
            COMPANY.emails.privacy +
            '.',
        },
        {
          term: 'Right to correction and completion',
          definition:
            'Update your name, contact details and other profile information yourself from the Profile section. For a document, replace it in your document vault; the earlier version is superseded, not silently kept in its place.',
        },
        {
          term: 'Right to erasure',
          definition:
            'Close your account from the Profile section. As set out in "Retention" above, this anonymises your account immediately; it does not erase a hostel’s financial records of your stay, because those are not solely yours to erase.',
        },
        {
          term: 'Right to grievance redressal',
          definition:
            'Raise a complaint with our Grievance Officer as set out in "Grievances and contact" below. We acknowledge it and work to resolve it within the timelines stated there.',
        },
        {
          term: 'Right of nomination',
          definition:
            'You may nominate another individual to exercise these rights on your behalf in the event of your death or incapacity. The platform does not yet have a self-service way to record a nomination; until it does, write to ' +
            COMPANY.emails.privacy +
            ' with the nominee’s details and we will record it manually.',
        },
      ],
    },

    /* 9 — Security */
    { type: 'subheading', id: 'security', text: '9. Security' },
    {
      type: 'clause',
      id: 'clause-security-1',
      number: '9.1',
      text: 'We take reasonable security practices and procedures, as the DPDP Act requires, to protect the personal data we hold — including encrypting data in transit between your device and our servers.',
    },
    {
      type: 'clause',
      id: 'clause-security-2',
      number: '9.2',
      text: 'No system is unbreakable, and part of keeping your account secure is in your hands. Keep your login credentials and one-time passwords to yourself, and tell us immediately if you think someone else has access to your account.',
    },

    /* 10 — Grievances and contact */
    { type: 'subheading', id: 'grievances-and-contact', text: '10. Grievances and contact' },
    {
      type: 'clause',
      id: 'clause-grievances-and-contact-1',
      number: '10.1',
      text: 'For a question about how your data is handled, write to our privacy contact. For a complaint — including one about this policy not being followed — write to our Grievance Officer, appointed under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021. We acknowledge a complaint within 24 hours and dispose of it within 15 days.',
    },
    {
      type: 'contact_list',
      items: [
        { label: 'Grievance Officer', value: COMPANY.legal.grievanceOfficer.name },
        { label: 'Grievance email', value: COMPANY.legal.grievanceOfficer.email },
        { label: 'Data rights and privacy queries', value: COMPANY.emails.privacy },
        { label: 'Postal address', value: `Trishul Solutions, ${REGISTERED_ADDRESS}` },
      ],
    },
    {
      type: 'clause',
      id: 'clause-grievances-and-contact-2',
      number: '10.2',
      text: 'We may update this policy from time to time. Each version is published on this page with a version number and the date it takes effect. Where a change is material, we will give you reasonable notice before it applies to you.',
    },
  ],
};
