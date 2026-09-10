import { COMPANY, formatPostalAddress } from '../company';
import type { LegalDocument } from './types';

/**
 * Contact & Grievance Redressal.
 *
 * Publishes what the Consumer Protection (E-Commerce) Rules 2020 and the IT
 * Rules 2021 require — legal name, registered address, and a NAMED Grievance
 * Officer with contact details. Neither competitor reviewed in spec §2.2 names
 * one; this is the most common compliance gap in the category.
 *
 * Two deliberate choices:
 *
 * - Honesty about size. Stayo is run by a very small team, so first-line
 *   support and the Grievance Officer are, in practice, the same people
 *   reading the same inbox. This document does not imply a support department
 *   that does not exist. Escalating is still meaningful, and the copy says
 *   why: it starts a statutory clock and creates a formal record (spec §9.1).
 * - Only the four serviced addresses and the dedicated business phone are
 *   published. The proprietor's personal contacts are never published (spec
 *   §2, "Published contacts vs registration contacts").
 *
 * The first-response window for support ("one working day") is a drafting
 * default — spec §12 lists the Level 1 SLA as a decision still with the
 * proprietor. The statutory windows are not defaults; they are the law.
 *
 * Rendered at `/legal/contact`. `/contact` is still served by the existing
 * ContactPage until Phase 3 rebuilds it onto this document and a real ticket
 * intake.
 */

export const contactDocument: LegalDocument = {
  id: 'contact',
  title: 'Contact & Grievance Redressal',
  route: '/contact',
  aliases: ['/legal/contact'],
  version: '1.0',
  effectiveDate: '2026-09-10',
  audience: 'all',
  material: false,
  metaDescription:
    'How to contact Stayo, our registered business details, and how to raise a complaint with our Grievance Officer — including how quickly we must respond.',
  summary: [
    'For help with the app or your account, write to support first — most things are quickest to fix there.',
    'If something is not resolved, or you want to make a formal complaint, write to our Grievance Officer. We must acknowledge a complaint within 24 hours and resolve it within 15 days.',
    'For requests about your personal data, write to our privacy address.',
    'Problems with your room, food or a hostel payment are for the hostel — raise them with the hostel through the app.',
    'Stayo is run by a small team. Escalating a complaint does not send it to a different department; it starts a formal clock and a record, which is what the law gives you.',
  ],
  content: [
    {
      type: 'notice',
      text: 'The “In short” summary above is not the policy. It is there to help you find your way around. Where the summary and a clause differ, the clause governs.',
    },

    /* 1 — Who we are */
    { type: 'subheading', id: 'who-we-are', text: '1. Who we are' },
    {
      type: 'clause',
      id: 'clause-who-we-are-1',
      number: '1.1',
      text: `Stayo is a product of ${COMPANY.name}, a ${COMPANY.legal.constitution} of ${COMPANY.legal.proprietor}. A ${COMPANY.legal.constitution} is not a separate company: the business and its proprietor are, in law, the same person.`,
    },
    {
      type: 'contact_list',
      items: [
        { label: 'Business name', value: COMPANY.name },
        { label: 'Legal form', value: `${COMPANY.legal.constitution} of ${COMPANY.legal.proprietor}` },
        { label: 'Registered address', value: formatPostalAddress(COMPANY.legal.address) },
        { label: 'General enquiries', value: COMPANY.emails.contact },
        { label: 'Phone', value: COMPANY.phone },
      ],
    },

    /* 2 — Getting help */
    { type: 'subheading', id: 'getting-help', text: '2. Getting help' },
    {
      type: 'clause',
      id: 'clause-getting-help-1',
      number: '2.1',
      text: `For a problem with the app, your account, signing in, or a payment that did not go through as expected, write to ${COMPANY.emails.support}. Tell us the phone number or email on your account and what went wrong. We aim to reply within one working day.`,
    },
    {
      type: 'clause',
      id: 'clause-getting-help-2',
      number: '2.2',
      text: 'If your problem is with your room, the food, the facilities, your rent or your deposit, it is for your hostel, not for Stayo. Stayo provides the software; the hostel provides your stay. Raise it with the hostel through the app, where it is recorded and the hostel can respond.',
    },

    /* 3 — Grievance redressal */
    { type: 'subheading', id: 'grievances', text: '3. Making a complaint to our Grievance Officer' },
    {
      type: 'clause',
      id: 'clause-grievances-1',
      number: '3.1',
      text: `If a problem is not resolved through support, or you want to make a formal complaint about Stayo — including about content on the Platform, how we handled your data, or how we treated you — write to our Grievance Officer.`,
    },
    {
      type: 'contact_list',
      items: [
        { label: 'Grievance Officer', value: COMPANY.legal.grievanceOfficer.name },
        { label: 'Email', value: COMPANY.legal.grievanceOfficer.email },
        { label: 'Postal address', value: formatPostalAddress(COMPANY.legal.address) },
      ],
    },
    {
      type: 'clause',
      id: 'clause-grievances-2',
      number: '3.2',
      text: 'Please include your name, how to reach you, what the complaint is about, and anything that helps us understand it, such as screenshots or dates. If it is about something on the Platform, tell us where to find it.',
    },
    {
      type: 'clause',
      id: 'clause-grievances-3',
      number: '3.3',
      text: 'The law sets how quickly we must respond, and we are bound by it:',
    },
    {
      type: 'table',
      columns: ['Kind of complaint', 'We acknowledge it within', 'We resolve it within'],
      rows: [
        ['A complaint about the Platform or content on it (Information Technology Rules, 2021)', '24 hours', '15 days'],
        ['A complaint as a consumer (Consumer Protection (E-Commerce) Rules, 2020)', '48 hours', 'one month'],
      ],
    },
    {
      type: 'clause',
      id: 'clause-grievances-4',
      number: '3.4',
      text: 'Where a complaint is about content that impersonates someone or shows a person in a sexual or intimate way without their consent, we act to remove or disable access to it within 24 hours of receiving the complaint.',
    },

    /* 4 — What escalating changes */
    { type: 'subheading', id: 'escalation', text: '4. What escalating actually changes' },
    {
      type: 'clause',
      id: 'clause-escalation-1',
      number: '4.1',
      text: 'Stayo is run by a small team, and we would rather tell you that than pretend otherwise. Writing to the Grievance Officer does not pass your complaint to a separate department.',
    },
    {
      type: 'clause',
      id: 'clause-escalation-2',
      number: '4.2',
      text: 'What it does change is this: a complaint to the Grievance Officer is formally recorded, and the response times in clause 3.3 start to run. That gives you a dated record of what you raised and when, and a deadline we are legally required to meet.',
    },

    /* 5 — Your data */
    { type: 'subheading', id: 'your-data', text: '5. Requests about your personal data' },
    {
      type: 'clause',
      id: 'clause-your-data-1',
      number: '5.1',
      text: `To see, correct or delete personal data we hold about you, or to nominate someone to act for you, write to ${COMPANY.emails.privacy}. Our Privacy Policy and our Data Deletion & Retention notice explain your rights and what we do with each kind of request.`,
    },

    /* 6 — Changes */
    { type: 'subheading', id: 'changes', text: '6. Changes to these details' },
    {
      type: 'clause',
      id: 'clause-changes-1',
      number: '6.1',
      text: 'If any of these contact details change, we will update this page straight away and change its effective date.',
    },
  ],
};
