import { COMPANY } from '../company';
import type { LegalDocument } from './types';

/**
 * Cookie & Tracking Notice — closes the footer link that has, until now,
 * pointed at the privacy page instead of a real cookie policy (spec §4,
 * "Policy contradicts the product").
 *
 * Verified before drafting (spec §6.6), not assumed:
 *
 * 1. `grep -rn -i "gtag\|googletagmanager\|google-analytics\|posthog\|mixpanel\|
 *    hotjar\|fbq(\|connect.facebook" apps/frontend/src apps/frontend/index.html`
 *    — zero matches. No analytics or advertising script of any kind is loaded.
 * 2. `grep -rn "document.cookie\|js-cookie\|Cookies.set" apps/frontend/src` —
 *    the only hit is the CSRF-token read in `src/lib/api-client.ts`. The
 *    frontend never sets a cookie itself; every cookie is set by the backend
 *    via `Set-Cookie`.
 * 3. `grep -rn "\.cookies\.set(\"" apps/backend/app apps/backend/lib
 *    apps/backend/src` — every cookie the backend ever sets is one of exactly
 *    three names, all in the auth routes (login, signup, tenant activation,
 *    logout, password reset): `hms_session`, `hms_refresh_token`, `hms_csrf`.
 *    Nothing else sets a cookie anywhere in the codebase.
 *
 * `hms_session` and `hms_refresh_token` are httpOnly. Per ADR-031, the
 * primary session mechanism is now the Supabase client SDK's own
 * (localStorage-backed) session store — these two cookies are kept as a
 * harmless fallback for the SSE/legacy-cookie token-extraction path in
 * `middleware.ts`. `hms_csrf` is not httpOnly by design (it has to be
 * JS-readable so `api-client.ts` can echo it back as a request header) and is
 * actively used on every state-changing request. All three exist solely to
 * keep a session working and secure — none is analytics, advertising or
 * behavioural tracking, so the "no consent banner" conclusion in spec §6.6
 * holds. See the implementation report for the exact commands and output.
 */

export const cookiesDocument: LegalDocument = {
  id: 'cookies',
  title: 'Cookie & Tracking Notice',
  route: '/legal/cookies',
  aliases: [],
  version: '1.0',
  effectiveDate: '2026-09-10',
  audience: 'all',
  material: false,
  metaDescription:
    "Stayo's Cookie & Tracking Notice — the small number of strictly necessary cookies we set to keep you signed in, why there is no cookie consent banner, and how to control cookies in your browser.",
  summary: [
    'A cookie is a small piece of text a website stores in your browser and reads back on later visits.',
    'We set a small number of cookies, and every one of them exists to keep you signed in and keep your session secure — nothing more.',
    'We do not set analytics, advertising or behavioural-tracking cookies, and we do not use any third-party tracking pixel.',
    'Because every cookie we set is strictly necessary, we do not show a cookie consent banner — see below for why.',
    'You can block or delete cookies in your browser, but doing so will prevent you from signing in.',
  ],
  content: [
    {
      type: 'notice',
      text: 'The “In short” summary above is not the notice. It is there to help you find your way around. Where the summary and a clause differ, the clause governs.',
    },
    {
      type: 'paragraph',
      text: 'A cookie is a small piece of text that a website asks your browser to store, and to send back to that website on later requests. This notice tells you exactly which cookies Stayo sets, why, and how to control them.',
    },

    /* 1 — The cookies we set */
    { type: 'subheading', id: 'cookies-we-set', text: '1. The cookies we set' },
    {
      type: 'clause',
      id: 'clause-cookies-we-set-1',
      number: '1.1',
      text: 'Stayo sets three cookies, all through our own servers when you sign in or start a session. Every one of them is strictly necessary — the Platform will not work correctly without it, and none of them is optional in the way a marketing or analytics cookie would be.',
    },
    {
      type: 'table',
      columns: ['Cookie', 'Purpose', 'Essential?'],
      rows: [
        [
          'hms_session',
          'Identifies you as signed in, so you are not asked to log in again on every page.',
          'Yes',
        ],
        [
          'hms_refresh_token',
          'Lets your session be renewed without interrupting you, and supports sign-in on some app surfaces as a fallback to our primary session mechanism.',
          'Yes',
        ],
        [
          'hms_csrf',
          'A security token that lets us confirm a request that changes your data actually came from you, not from another website acting on your behalf.',
          'Yes',
        ],
      ],
    },
    {
      type: 'clause',
      id: 'clause-cookies-we-set-2',
      number: '1.2',
      text: 'The hms_session and hms_refresh_token cookies cannot be read by scripts running on the page — only our servers can read them. The hms_csrf cookie is readable by the page, because that is what lets it do its job of confirming a request came from you.',
    },

    /* 2 — What we do not set */
    { type: 'subheading', id: 'what-we-do-not-set', text: '2. What we do not set' },
    {
      type: 'clause',
      id: 'clause-what-we-do-not-set-1',
      number: '2.1',
      text: 'We do not set analytics cookies, advertising cookies, or cookies that track your behaviour across sites. We do not load any third-party analytics tool, advertising network, or tracking pixel on the Platform. We do not build an advertising profile of you, and we do not sell or share cookie data with anyone for advertising.',
    },
    {
      type: 'clause',
      id: 'clause-what-we-do-not-set-2',
      number: '2.2',
      text: 'If that ever changes — for example, if we add a product analytics or advertising tool in future — we will update this notice first, and we will revisit whether a consent banner is required before any such cookie is set.',
    },

    /* 3 — Why there is no consent banner */
    { type: 'subheading', id: 'why-no-banner', text: '3. Why there is no consent banner' },
    {
      type: 'clause',
      id: 'clause-why-no-banner-1',
      number: '3.1',
      text: 'Cookie consent rules exist to give you a real choice about cookies you could reasonably decline — most often analytics and advertising cookies. Cookies that are strictly necessary for the service you have asked for, like staying signed in, are treated differently: the law requires that you be told about them, not that you be asked to agree to them, because there is no working alternative to offer if you say no.',
    },
    {
      type: 'clause',
      id: 'clause-why-no-banner-2',
      number: '3.2',
      text: 'Every cookie Stayo sets is in that strictly-necessary category. We have deliberately chosen not to show a cookie consent banner, because a banner asking your permission for a cookie you cannot actually decline is not a real choice — it is theatre, and it trains people to dismiss consent prompts without reading them, which makes consent worse everywhere, including on the sites where it does matter. This notice is how we give you notice instead.',
    },

    /* 4 — Controlling cookies */
    { type: 'subheading', id: 'controlling-cookies', text: '4. Controlling cookies' },
    {
      type: 'clause',
      id: 'clause-controlling-cookies-1',
      number: '4.1',
      text: 'Your browser lets you view, block or delete cookies, including cookies already stored from Stayo. The setting is usually under your browser’s privacy or site-settings menu; where to find it varies by browser and device.',
    },
    {
      type: 'notice',
      text: 'Because every cookie Stayo sets is required for signing in, blocking or deleting them will sign you out and prevent you from signing back in. There is no setting on the Platform to keep some of these cookies and drop others — they work together as one mechanism.',
    },
    {
      type: 'clause',
      id: 'clause-controlling-cookies-2',
      number: '4.2',
      text: 'We do not use any other browser storage — such as tracking-oriented use of local storage — as a workaround for a blocked cookie. If you block these cookies, you are simply signed out; we do not attempt to identify or track you by another means.',
    },

    /* 5 — Changes to this notice */
    { type: 'subheading', id: 'changes', text: '5. Changes to this notice' },
    {
      type: 'clause',
      id: 'clause-changes-1',
      number: '5.1',
      text: 'We may update this notice, most often because the cookies we set have changed. Each version is published on this page with a version number and the date it takes effect. Questions about this notice can be sent to our privacy contact.',
    },
    {
      type: 'contact_list',
      items: [
        { label: 'Privacy queries', value: COMPANY.emails.privacy },
        { label: 'Support', value: COMPANY.emails.support },
      ],
    },
  ],
};
