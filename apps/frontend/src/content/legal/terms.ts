import { COMPANY, PAYMENT_PARTNER, formatPostalAddress } from '../company';
import type { LegalDocument } from './types';

/**
 * The Terms of Use — the anchor document of the published set.
 *
 * Structure follows D4: one shared core that binds everyone, then Schedule A
 * for hostel owners (who buy software) and Schedule B for residents (who get a
 * free account and pay a hostel directly). Two fully separate documents would
 * duplicate the boilerplate and drift apart — which is exactly how the repo
 * ended up with two divergent copies of the old `legal.ts`.
 *
 * Two positions here are load-bearing and should not be "tidied":
 *
 * 1. **Stayo is never in the flow of funds.** Each owner is onboarded as a
 *    sub-merchant and is the merchant of record; resident payments settle to
 *    the owner's own account. Every clause about money is written from that
 *    fact, and the document says affirmatively that Stayo earns nothing from
 *    resident rent.
 * 2. **Jurisdiction is non-exclusive.** The registered place of business is
 *    Vikarabad District, so an exclusive clause naming Hyderabad would be void
 *    as ousting jurisdiction under s.20 CPC. It can be tightened only once
 *    there is a real Hyderabad place of business.
 *
 * The payment aggregator is described, never named (D6) — `PAYMENT_PARTNER.descriptor`
 * is the only form allowed to reach published copy.
 */

const REGISTERED_ADDRESS = formatPostalAddress(COMPANY.legal.address);

export const termsDocument: LegalDocument = {
  id: 'terms',
  title: 'Terms of Use',
  route: '/legal/terms',
  aliases: ['/terms'],
  version: '1.0',
  effectiveDate: '2026-09-10',
  audience: 'all',
  material: true,
  metaDescription:
    'The Terms of Use for Stayo, the hostel and PG platform operated by Trishul Solutions — what the platform does, who may use it, how money moves between residents and hostels, and how to raise a grievance.',
  summary: [
    'Stayo is software. Your stay is an agreement between you and the hostel, and we are not a party to it.',
    'Residents pay us nothing. Rent, deposits and booking tokens paid through Stayo settle straight into the hostel’s own merchant account — Stayo earns nothing from your rent.',
    'Hostel owners pay a subscription for the software, and are the merchant of record for every payment their residents make.',
    'You must be 18 or over to hold an account. For anyone younger, a guardian holds the account.',
    'Our liability to you is capped at the greater of the fees you paid us in the previous three months or ₹5,000.',
    'Indian law applies. Most disputes go to arbitration seated in Hyderabad; the courts at Hyderabad have jurisdiction, but not to the exclusion of any other court you may lawfully approach.',
    'Something wrong? Write to our Grievance Officer at ' + COMPANY.legal.grievanceOfficer.email + '.',
  ],
  content: [
    {
      type: 'notice',
      text: 'The “In short” summary above is not the agreement. It is there to help you find your way around. Where the summary and a clause differ, the clause governs.',
    },
    {
      type: 'paragraph',
      text: 'These Terms of Use govern your use of Stayo — the website, the apps and everything we provide through them. Please read them before you create an account. By creating an account, listing accommodation, enquiring about a hostel, or otherwise using Stayo, you agree to these Terms. If you do not agree, please do not use the platform.',
    },

    /* 1 — Interpretation and who we are */
    { type: 'subheading', id: 'interpretation', text: '1. Interpretation and who we are' },
    {
      type: 'clause',
      id: 'clause-interpretation-1',
      number: '1.1',
      text: `Stayo is a product of Trishul Solutions, a ${COMPANY.legal.constitution} of ${COMPANY.legal.proprietor}, with its principal place of business at ${REGISTERED_ADDRESS}, India.`,
    },
    {
      type: 'clause',
      id: 'clause-interpretation-2',
      number: '1.2',
      text: 'A sole proprietorship has no legal personality separate from its proprietor. The party contracting with you under these Terms is therefore Chidiri Shiva Prakash, trading as Trishul Solutions. “Stayo”, “we”, “us” and “our” refer to that party.',
    },
    {
      type: 'definitions',
      items: [
        {
          term: 'Platform',
          definition:
            'The Stayo website, applications and related services, in every form we make them available.',
        },
        {
          term: 'Owner',
          definition:
            'A person or business that lists, offers or manages hostel or paying-guest accommodation through the Platform. Schedule A applies to you.',
        },
        {
          term: 'Resident',
          definition:
            'A person who uses the Platform to find accommodation, or who stays in accommodation managed through it. Schedule B applies to you.',
        },
        {
          term: 'Hostel',
          definition:
            'The accommodation an Owner lists — a hostel, a paying-guest property, or any similar shared accommodation.',
        },
        {
          term: 'You',
          definition: 'Whoever is using the Platform — an Owner, a Resident, or anyone else.',
        },
      ],
    },
    {
      type: 'clause',
      id: 'clause-interpretation-3',
      number: '1.3',
      text: 'This document is an electronic record in terms of the Information Technology Act, 2000 and the rules made under it, and the amended provisions pertaining to electronic records in various statutes as amended by that Act. It is generated by a computer system and does not require any physical or digital signature.',
    },
    {
      type: 'clause',
      id: 'clause-interpretation-4',
      number: '1.4',
      text: 'These Terms have three parts. The core — clauses 1 to 15 — binds everyone. Schedule A binds Owners in addition to the core. Schedule B binds Residents in addition to the core. If a Schedule conflicts with the core, the Schedule prevails for the person it applies to, and only to the extent of the conflict.',
    },
    {
      type: 'clause',
      id: 'clause-interpretation-5',
      number: '1.5',
      text: 'Our Privacy Policy, our Payments, Refunds & Cancellations policy, and the other policies published in our legal section form part of these Terms. Where a policy addresses a subject in more detail than these Terms do, that policy governs that subject.',
    },

    /* 2 — What Stayo is, and what it is not */
    { type: 'subheading', id: 'what-stayo-is', text: '2. What Stayo is, and what it is not' },
    {
      type: 'clause',
      id: 'clause-what-stayo-is-1',
      number: '2.1',
      text: 'Stayo is a technology platform. We provide software that lets Owners list and run their accommodation — admissions, rooms and beds, rent accounting, records, reminders and communication — and lets Residents discover accommodation, enquire, keep their documents in one place and pay their hostel.',
    },
    {
      type: 'clause',
      id: 'clause-what-stayo-is-2',
      number: '2.2',
      text: 'The accommodation contract is between the Resident and the Owner. We are not a party to it. We do not own, operate, manage, inspect, licence or control any Hostel, and listing a Hostel on Stayo is not an endorsement of it.',
    },
    {
      type: 'clause',
      id: 'clause-what-stayo-is-3',
      number: '2.3',
      text: 'Where the Platform generates, stores or helps sign a rental agreement, it does so as a convenience for the Resident and the Owner. The agreement is theirs; its terms are theirs; we are not a party to it and we do not give legal advice on it.',
    },
    {
      type: 'clause',
      id: 'clause-what-stayo-is-4',
      number: '2.4',
      text: `We are never in the flow of your money. Each Owner is onboarded as a sub-merchant of ${PAYMENT_PARTNER.descriptor} and holds their own merchant account with that partner. Money a Resident pays through the Platform settles directly into the Owner's account. It does not pass through, and is not held in, any account belonging to Stayo or Trishul Solutions.`,
    },
    {
      type: 'clause',
      id: 'clause-what-stayo-is-5',
      number: '2.5',
      text: 'Because we never receive that money, we cannot refund or reverse it. Refunds of rent, deposits and booking tokens are issued by the Hostel from its own account. What we can do, and what every listed Hostel must agree to, is set out in our Payments, Refunds & Cancellations policy.',
    },
    {
      type: 'clause',
      id: 'clause-what-stayo-is-6',
      number: '2.6',
      text: 'Our only revenue is the subscription Owners pay us for the software. We take no commission on rent, no share of any deposit and no share of any transaction fee.',
    },

    /* 3 — Eligibility */
    { type: 'subheading', id: 'eligibility', text: '3. Who may use Stayo' },
    {
      type: 'clause',
      id: 'clause-eligibility-1',
      number: '3.1',
      text: 'You must be 18 years of age or older, and competent to contract under the Indian Contract Act, 1872, to hold a Stayo account.',
    },
    {
      type: 'clause',
      id: 'clause-eligibility-2',
      number: '3.2',
      text: 'Where the person staying in the accommodation is under 18, a parent or legal guardian must hold the account in their own name. That guardian is the account holder for the purposes of these Terms, accepts them on the minor’s behalf, and is responsible for the minor’s obligations to the Hostel.',
    },
    {
      type: 'clause',
      id: 'clause-eligibility-3',
      number: '3.3',
      text: 'We may ask you to verify your age or identity. If we find that an account is held by someone under 18, we may suspend or close it and ask a guardian to take it over.',
    },

    /* 4 — Your account */
    { type: 'subheading', id: 'your-account', text: '4. Your account' },
    {
      type: 'clause',
      id: 'clause-your-account-1',
      number: '4.1',
      text: 'The information you give us — your name, contact details, identification and, if you are an Owner, your business and property details — must be accurate, current and complete, and you must keep it up to date.',
    },
    {
      type: 'clause',
      id: 'clause-your-account-2',
      number: '4.2',
      text: `Keep your login credentials and one-time passwords to yourself. You are responsible for everything done through your account. If you think someone else has access to it, tell us at once at ${COMPANY.emails.support}.`,
    },
    {
      type: 'clause',
      id: 'clause-your-account-3',
      number: '4.3',
      text: 'One person, one account. Do not share, transfer or sell your account, and do not create an account for someone else except as a guardian under clause 3.2.',
    },
    {
      type: 'clause',
      id: 'clause-your-account-4',
      number: '4.4',
      text: 'Some features — signing an agreement, accepting payments, verifying a listing — require us or our partners to verify identity or documents. We may withhold those features until that verification is complete.',
    },

    /* 5 — Acceptable use */
    { type: 'subheading', id: 'acceptable-use', text: '5. Acceptable use' },
    {
      type: 'clause',
      id: 'clause-acceptable-use-1',
      number: '5.1',
      text: 'You agree not to use the Platform for any purpose that is unlawful, illegal or forbidden by these Terms or by any law that applies to you. In particular, you must not:',
    },
    {
      type: 'list',
      ordered: false,
      items: [
        'bypass, or attempt to bypass, the payment mechanisms on the Platform — including taking a payment off-platform to avoid the record it creates, or inducing another user to do so;',
        'submit false, forged or altered identification, whether your own or another person’s, or misstate who is actually staying in a room;',
        'impersonate any person, or misrepresent your association with a Hostel, a business or with us;',
        'list accommodation you have no lawful right to let, or advertise anything other than genuinely available accommodation;',
        'post content that is unlawful, defamatory, obscene, hateful, misleading, or that infringes someone else’s rights;',
        'harass, threaten, stalk or intimidate another user, or use contact details obtained through the Platform for anything other than the stay they relate to;',
        'scrape, crawl, harvest or copy listings, contact details or other data from the Platform by automated means;',
        'probe, scan, hack or otherwise attempt to breach the security of the Platform, or access data you are not authorised to see;',
        'reverse engineer, decompile or attempt to derive the source code of the Platform, except where the law expressly allows it; or',
        'introduce malware, or do anything that interferes with the operation of the Platform or the experience of other users.',
      ],
    },
    {
      type: 'clause',
      id: 'clause-acceptable-use-2',
      number: '5.2',
      text: 'If you breach this clause we may remove the content concerned, restrict or suspend your access, close your account, and where the conduct appears to be criminal, report it to the appropriate authority and give them the records we hold.',
    },

    /* 6 — Your content and reviews */
    { type: 'subheading', id: 'user-content', text: '6. Your content and reviews' },
    {
      type: 'clause',
      id: 'clause-user-content-1',
      number: '6.1',
      text: 'You keep ownership of what you post — listings, photographs, reviews, messages and documents. You give us a non-exclusive, royalty-free, worldwide licence to host, store, reproduce, resize and display that content for the purpose of operating, promoting and improving the Platform, for as long as you keep it posted and for a reasonable period afterwards for backups and legal records.',
    },
    {
      type: 'clause',
      id: 'clause-user-content-2',
      number: '6.2',
      text: 'You confirm that you have the rights to everything you post, that it is accurate, and that a review you write reflects your own genuine, first-hand experience of the Hostel. Reviews are the reviewer’s opinion and not ours.',
    },
    {
      type: 'clause',
      id: 'clause-user-content-3',
      number: '6.3',
      text: 'Moderation is ours. We may review, refuse to publish, reformat or remove content that breaches these Terms or the law, and we may do so at our discretion. We will tell you why where it is practical to do so. We are not obliged to monitor content, and we do not pre-approve everything that is posted.',
    },
    {
      type: 'clause',
      id: 'clause-user-content-4',
      number: '6.4',
      text: `If you believe content on the Platform is unlawful, infringes your rights or breaches these Terms, write to our Grievance Officer at ${COMPANY.legal.grievanceOfficer.email} with a link to or description of the content, what is wrong with it, and how we can reach you. We will acknowledge your complaint within 24 hours and dispose of it within 15 days. Content of the kinds listed in rule 3(2)(b) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 — including impersonation and non-consensual or artificially morphed intimate imagery — will be removed within 24 hours of a valid complaint.`,
    },

    /* 7 — Fees and taxes */
    { type: 'subheading', id: 'fees-and-taxes', text: '7. Fees and taxes' },
    {
      type: 'clause',
      id: 'clause-fees-and-taxes-1',
      number: '7.1',
      text: 'A Resident account is free. We do not charge Residents to search, to enquire, to hold an account, or to pay a Hostel through the Platform.',
    },
    {
      type: 'clause',
      id: 'clause-fees-and-taxes-2',
      number: '7.2',
      text: 'Owners pay a subscription for the software. The plan, price and billing cycle are shown before you buy, and are dealt with in Schedule A and in our Payments, Refunds & Cancellations policy.',
    },
    {
      type: 'clause',
      id: 'clause-fees-and-taxes-3',
      number: '7.3',
      text: 'All fees are stated in Indian Rupees and are exclusive of taxes. Trishul Solutions is not registered for Goods and Services Tax, does not charge GST, and does not claim a GST registration on any invoice or receipt. If and when we become liable to register, applicable tax will be charged in addition to the fees, from the date the registration takes effect, and our invoices will show it.',
    },

    /* 8 — Intellectual property */
    { type: 'subheading', id: 'intellectual-property', text: '8. Intellectual property' },
    {
      type: 'clause',
      id: 'clause-intellectual-property-1',
      number: '8.1',
      text: 'The Platform and its contents are proprietary to us or are licensed to us. That includes the design, layout, look and feel, graphics, text, software and the names and marks “Stayo” and “Trishul Solutions”. You do not acquire any intellectual property right, title or interest in them.',
    },
    {
      type: 'clause',
      id: 'clause-intellectual-property-2',
      number: '8.2',
      text: 'We give you a limited, personal, revocable, non-transferable right to use the Platform for the purposes these Terms allow, and no more.',
    },
    {
      type: 'clause',
      id: 'clause-intellectual-property-3',
      number: '8.3',
      text: 'You must not copy, modify, distribute, sell, licence or create derivative works from any part of the Platform, or use our names or marks, without our written permission.',
    },

    /* 9 — Disclaimers and limitation of liability */
    {
      type: 'subheading',
      id: 'liability',
      text: '9. Disclaimers and limitation of liability',
    },
    {
      type: 'clause',
      id: 'clause-liability-1',
      number: '9.1',
      text: 'The Platform is provided on an “as is” and “as available” basis. We work to keep it running and accurate, but we do not warrant that it will be uninterrupted or error-free, and we do not warrant the accuracy of information that users give us — listings, photographs, prices, reviews or documents.',
    },
    {
      type: 'clause',
      id: 'clause-liability-2',
      number: '9.2',
      text: 'We are not responsible for the acts or omissions of any Hostel, Owner or Resident, or for the condition, safety, legality or suitability of any accommodation, its food or its services. Those are matters between the Resident and the Owner under their own agreement.',
    },
    {
      type: 'clause',
      id: 'clause-liability-3',
      number: '9.3',
      text: 'We are not liable for indirect, incidental, special, consequential or punitive loss, or for loss of profit, goodwill, opportunity or data, however it arises.',
    },
    {
      type: 'clause',
      id: 'clause-liability-4',
      number: '9.4',
      text: 'Our total aggregate liability to you for all claims arising out of or in connection with these Terms or your use of the Platform, whether in contract, tort (including negligence), under statute or otherwise, will not exceed the greater of (a) the total fees you actually paid us in the three months immediately before the event giving rise to the claim, and (b) ₹5,000.',
    },
    {
      type: 'notice',
      text: 'The ₹5,000 floor in clause 9.4 is deliberate. Residents pay us nothing, so a cap expressed only as “the fees you paid us” would come to zero — which is no cap at all, and not something we think should be put to a Resident as a fair bargain.',
    },
    {
      type: 'clause',
      id: 'clause-liability-5',
      number: '9.5',
      text: 'Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited — including liability for death or personal injury caused by our negligence, for fraud, and any right you have as a consumer under the Consumer Protection Act, 2019.',
    },

    /* 10 — Indemnity */
    { type: 'subheading', id: 'indemnity', text: '10. Indemnity' },
    {
      type: 'clause',
      id: 'clause-indemnity-1',
      number: '10.1',
      text: 'You agree to indemnify and hold harmless Trishul Solutions, its proprietor, employees and agents against any claim, demand, action, proceeding or penalty brought by a third party, including reasonable legal costs, arising out of your breach of these Terms or of a policy referred to in them, your breach of any law or of a third party’s rights (including intellectual property rights), or content you submitted.',
    },
    {
      type: 'clause',
      id: 'clause-indemnity-2',
      number: '10.2',
      text: 'This indemnity does not extend to loss caused by our own breach of these Terms, our negligence or our wilful misconduct.',
    },
    {
      type: 'clause',
      id: 'clause-indemnity-3',
      number: '10.3',
      text: 'If we want to rely on this indemnity we will tell you about the claim promptly, let you take part in defending it, and not settle it without your consent, which you must not unreasonably withhold.',
    },

    /* 11 — Suspension and termination */
    {
      type: 'subheading',
      id: 'suspension-and-termination',
      text: '11. Suspension and termination',
    },
    {
      type: 'clause',
      id: 'clause-suspension-and-termination-1',
      number: '11.1',
      text: `You may close your account at any time, from the account settings in the app or by writing to ${COMPANY.emails.support}.`,
    },
    {
      type: 'clause',
      id: 'clause-suspension-and-termination-2',
      number: '11.2',
      text: 'We may restrict, suspend or terminate your access — with notice where it is practical to give it — if you breach these Terms, if we reasonably suspect fraud, unlawful use or a risk to other users, if we are required to by law or by a regulator or by our payment partner, or, for an Owner, if a subscription payment is not made.',
    },
    {
      type: 'clause',
      id: 'clause-suspension-and-termination-3',
      number: '11.3',
      text: 'Closing an account does not end obligations that have already accrued — rent or charges you owe a Hostel, or subscription fees you owe us. The clauses on intellectual property, liability, indemnity, governing law and arbitration survive termination.',
    },
    {
      type: 'clause',
      id: 'clause-suspension-and-termination-4',
      number: '11.4',
      text: 'What happens to your data after your account closes is set out in our Privacy Policy and our Data Deletion & Retention notice. Some records are kept for as long as the law requires us to keep them.',
    },

    /* 12 — Changes to these Terms */
    { type: 'subheading', id: 'changes', text: '12. Changes to these Terms' },
    {
      type: 'clause',
      id: 'clause-changes-1',
      number: '12.1',
      text: 'We may update these Terms. Each version is published on this page with a version number and the date it takes effect, and we keep a record of the versions we have published.',
    },
    {
      type: 'clause',
      id: 'clause-changes-2',
      number: '12.2',
      text: 'Where a change is material, we will give you reasonable notice — in the app or by email — before it takes effect, and we may ask you to accept the new version before you carry on using the Platform.',
    },
    {
      type: 'clause',
      id: 'clause-changes-3',
      number: '12.3',
      text: 'For changes that are not material, continuing to use the Platform after the effective date means you accept them. If you do not accept a change, you may close your account.',
    },

    /* 13 — Governing law and jurisdiction */
    { type: 'subheading', id: 'governing-law', text: '13. Governing law and jurisdiction' },
    {
      type: 'clause',
      id: 'clause-governing-law-1',
      number: '13.1',
      text: 'These Terms are governed by, and are to be construed in accordance with, the laws of India.',
    },
    {
      type: 'clause',
      id: 'clause-governing-law-2',
      number: '13.2',
      text: 'Subject to clause 14, the courts at Hyderabad, Telangana shall have jurisdiction over any dispute arising out of or in connection with these Terms or your use of the Platform.',
    },
    {
      type: 'clause',
      id: 'clause-governing-law-3',
      number: '13.3',
      text: 'Clause 13.2 is non-exclusive, and deliberately so. It does not take away any right you have to bring proceedings before another court that has jurisdiction under the law — including, if you are a consumer, the consumer commission for the place where you live or work.',
    },

    /* 14 — Arbitration */
    { type: 'subheading', id: 'arbitration', text: '14. Arbitration' },
    {
      type: 'clause',
      id: 'clause-arbitration-1',
      number: '14.1',
      text: 'If a dispute arises, please raise it with us first through the grievance channel in clause 15. Most things are settled far faster that way, and we ask for 30 days to try.',
    },
    {
      type: 'clause',
      id: 'clause-arbitration-2',
      number: '14.2',
      text: 'A dispute that is not resolved that way shall be referred to arbitration by a sole arbitrator under the Arbitration and Conciliation Act, 1996. The seat and venue of the arbitration is Hyderabad, Telangana, the language is English, and the award is final and binding on both of us.',
    },
    {
      type: 'clause',
      id: 'clause-arbitration-3',
      number: '14.3',
      text: 'The sole arbitrator is appointed by agreement between us. If we cannot agree within 30 days of one of us asking for arbitration, the arbitrator is appointed under the Act. Each of us bears our own costs unless the arbitrator directs otherwise.',
    },
    {
      type: 'clause',
      id: 'clause-arbitration-4',
      number: '14.4',
      text: 'This clause does not stop either of us from asking a court for urgent interim relief, and it does not take away your right, as a consumer, to approach a consumer commission instead.',
    },

    /* 15 — Grievance redressal */
    { type: 'subheading', id: 'grievance', text: '15. Grievance redressal' },
    {
      type: 'clause',
      id: 'clause-grievance-1',
      number: '15.1',
      text: `Start with support — most problems are quickest to fix there. If support has not resolved it, or your complaint is about content, privacy or conduct, write to our Grievance Officer, appointed under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Consumer Protection (E-Commerce) Rules, 2020.`,
    },
    {
      type: 'contact_list',
      items: [
        { label: 'Grievance Officer', value: COMPANY.legal.grievanceOfficer.name },
        { label: 'Email', value: COMPANY.legal.grievanceOfficer.email },
        { label: 'Support', value: COMPANY.emails.support },
        { label: 'Postal address', value: `Trishul Solutions, ${REGISTERED_ADDRESS}` },
      ],
    },
    {
      type: 'clause',
      id: 'clause-grievance-2',
      number: '15.2',
      text: 'We acknowledge a complaint made under the Information Technology Rules within 24 hours and dispose of it within 15 days. We acknowledge a consumer complaint within 48 hours and redress it within one month. You will get a reference number when you raise a complaint, and we keep a record of it.',
    },

    /* Schedule A — Owners */
    {
      type: 'subheading',
      id: 'schedule-a',
      text: 'Schedule A — Additional terms for hostel owners',
      audience: 'owner',
    },
    {
      type: 'paragraph',
      text: 'This Schedule applies to you if you list, offer or manage accommodation through Stayo. It applies in addition to clauses 1 to 15.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-1',
      number: 'A.1',
      text: `What you are buying from us is software: access to the Owner side of the Platform, on a subscription. To subscribe, contact the Stayo team at ${COMPANY.emails.contact}. We onboard your hostel with you and agree your plan, price and billing cycle in writing before you are billed.`,
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-2',
      number: 'A.2',
      text: 'There is no free trial. Your subscription starts once your onboarding is complete and your plan has been agreed.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-3',
      number: 'A.3',
      text: 'Your subscription continues from one billing cycle to the next until you cancel it. We invoice you for each cycle, and you pay as agreed with the Stayo team.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-4',
      number: 'A.4',
      text: 'If a subscription invoice is not paid when it is due, we will remind you. If it stays unpaid, Owner features may be suspended. Suspension is not deletion: your data — your rooms, residents, obligations and records — is retained while the account is suspended, and access is restored when the subscription is brought up to date.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-5',
      number: 'A.5',
      text: 'You may cancel at any time. Access continues until the end of the cycle you have already paid for, except where our Payments, Refunds & Cancellations policy says otherwise. Cancelling does not delete your hostel’s records: you can download them at any time, before or after cancelling, and they stay in place if you subscribe again. How to have them deleted, and what must be kept, is set out in our Data Deletion & Retention notice.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-6',
      number: 'A.6',
      text: 'You warrant that you own the accommodation you list or are lawfully entitled to let it, and that you hold the registrations, permissions and consents that letting it requires.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-7',
      number: 'A.7',
      text: 'You warrant that your listings are accurate and current — the photographs, the rooms actually available, the rent and charges, the deposit, the notice period and the house rules — and that they describe the accommodation a Resident will actually receive.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-8',
      number: 'A.8',
      text: 'In addition to clause 10, you indemnify us against any claim brought by a Resident, a guardian, a neighbour or an authority concerning the premises, their condition, safety or legality, your conduct as an Owner, or the accommodation contract between you and a Resident.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-9',
      number: 'A.9',
      text: `To accept payments from Residents through the Platform you are onboarded as a sub-merchant of ${PAYMENT_PARTNER.descriptor}, and you are the merchant of record for every payment a Resident makes to you. You enter into a direct relationship with that payment partner and accept its own merchant terms, which apply to you alongside these Terms.`,
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-10',
      number: 'A.10',
      text: 'Settlement timing, holds and reserves, chargebacks and transaction fees are governed by that relationship, not by us. We do not set them, we cannot vary them, and we are not responsible for them. Payments settle into your account, never into ours.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-11',
      number: 'A.11',
      text: 'You warrant that every piece of Know Your Customer and business information you submit through Stayo for sub-merchant onboarding is true, complete and current, and that you will update it promptly if it changes. You indemnify us against any loss, penalty or claim arising from information that is not.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-12',
      number: 'A.12',
      text: 'If the payment partner suspends, restricts or withdraws your sub-merchant account, or instructs us to restrict your access, we may suspend or withdraw your access to payment features or to the Platform. This is an obligation we owe our payment partner, and we may have to act on it without being able to give you notice first.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-13',
      number: 'A.13',
      text: 'Refunds are yours to issue. Because Resident money never reaches us, we can never refund it. Any refund — of rent, a deposit, a booking token or an amount charged in error — is issued by you, from your own merchant account. You are also responsible for holding and accounting for security deposits under your agreement with the Resident.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-14',
      number: 'A.14',
      text: 'As a condition of being listed, you agree to honour the minimum refund standard set out in our Payments, Refunds & Cancellations policy. If you do not, our remedies are to escalate through the grievance channel, to suspend your account and to delist your accommodation.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-a-15',
      number: 'A.15',
      text: 'Your tax position is your own. You are responsible for any tax on the money you receive from Residents, and for issuing your own receipts and invoices where the law requires them. The records the Platform generates are for your convenience and are not a substitute for the statutory records you must keep.',
    },

    /* Schedule B — Residents */
    {
      type: 'subheading',
      id: 'schedule-b',
      text: 'Schedule B — Additional terms for residents',
      audience: 'resident',
    },
    {
      type: 'paragraph',
      text: 'This Schedule applies to you if you use Stayo to find accommodation, or if you stay in accommodation managed through it. It applies in addition to clauses 1 to 15.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-b-1',
      number: 'B.1',
      text: 'Your account is free. We do not charge you to search, to enquire, to keep your documents on the Platform, or to pay your Hostel through it.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-b-2',
      number: 'B.2',
      text: `When you pay rent, a deposit or a booking token through Stayo, that money settles directly into the Hostel's own merchant account with ${PAYMENT_PARTNER.descriptor}. It does not pass through an account belonging to Stayo or Trishul Solutions at any point.`,
    },
    {
      type: 'clause',
      id: 'clause-schedule-b-3',
      number: 'B.3',
      text: 'A successful payment discharges your obligation to the Hostel, for the amount paid, at the moment the payment succeeds. Because we are never holding your money, there is nothing for us to delay, lose or fail to pass on — you carry no settlement risk from us. Keep the receipt the Platform issues you; it is your proof of payment.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-b-4',
      number: 'B.4',
      text: 'Stayo earns nothing from your rent. We take no commission on it, no share of your deposit and no share of any transaction fee. Our only revenue is the subscription hostel owners pay us for the software.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-b-5',
      number: 'B.5',
      text: 'Because we never receive your money, we cannot refund it. Any refund is issued by the Hostel from its own account. Our Payments, Refunds & Cancellations policy sets out the minimum standard every listed Hostel must honour, and what we will do — escalate, suspend, delist — if one does not.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-b-6',
      number: 'B.6',
      text: 'The Hostel’s own terms bind you separately. Its house rules, notice period, lock-in, deposit terms and charges are set by the Hostel, form part of your agreement with it, and are shown to you before you pay. Please read them.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-b-7',
      number: 'B.7',
      text: 'We are not responsible for the condition, cleanliness or safety of a room or building; for the food a Hostel serves, its quality, quantity or timing; or for the conduct of a Hostel, its staff or the people who stay there. Those are matters between you and the Hostel under your agreement with it.',
    },
    {
      type: 'clause',
      id: 'clause-schedule-b-8',
      number: 'B.8',
      text: 'If something goes wrong, tell us through the grievance channel in clause 15. We will take it up with the Hostel and we can suspend or delist a Hostel that will not put things right — but we are not a party to your agreement with it, and we cannot decide a dispute between you.',
    },
  ],
};
