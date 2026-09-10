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
 * (localStorage-backed) session store. `middleware.ts` still reads
 * `hms_session` as a fallback when a request carries no Bearer header — which
 * is how direct document links authenticate (see clause 1's table). Nothing
 * reads `hms_refresh_token`. (SSE authenticates with a `?token=` query
 * parameter, not a cookie.) `hms_csrf` is not httpOnly by design (it has to be
 * JS-readable so `api-client.ts` can echo it back as a request header) and is
 * actively used on every state-changing request. All three exist solely to
 * keep a session working and secure — none is analytics, advertising or
 * behavioural tracking, so the "no consent banner" conclusion in spec §6.6
 * holds.
 *
 * 4. Re-verified after merging main (ADR-176, Clerk): a sign-in provider now
 *    mounts on /sign-in, /sign-up and inside ProtectedAppProviders (owner,
 *    admin, and the SeekerAppShell profile/resident app), never on the public
 *    route tree, and only when a publishable key is configured. Its SDK sets
 *    authentication cookies — `__session` (signed JWT, ~60s, app domain) and
 *    `__client_uat` (session timestamp), plus one linking cookie whose name
 *    depends on instance type (`__client` in production, a development cookie
 *    otherwise) — per the provider's own documentation. Clause 1.4 covers them.
 *    The vendor is not named, consistent with how every processor is described.
 *    Decision record: docs/obsidian/Decisions.md ADR-180.
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
    "Stayo's Cookie & Tracking Notice — the cookies and browser storage Stayo uses and what each is for, why there is no cookie consent banner, and what happens if you block or delete cookies.",
  summary: [
    'A cookie is a small piece of text a website stores in your browser and reads back on later visits.',
    'We set three cookies, all to do with signing in and security: a security token you need in order to save or change anything while signed in; a copy of your sign-in that lets you open documents directly from a link; and one left over from an earlier way of signing in, which nothing reads any more. When you open a sign-in screen or use the signed-in app, the sign-in provider we use also sets a few cookies of its own to keep you signed in securely.',
    'Your sign-in itself is kept in your browser’s storage, not in a cookie. We also use that storage to remember a few things on your device, such as the city you last searched. None of it is used for tracking.',
    'We do not set analytics, advertising or behavioural-tracking cookies, and we do not use any third-party tracking pixel.',
    'Everything we set is our own, and is used only for signing in, security or remembering your own choices. Nothing is used for tracking, analytics or advertising, and that is why we do not show a cookie consent banner — see below.',
    'You can block or delete cookies in your browser. Blocking them stops you saving or changing anything while signed in, and in many browsers also stops you staying signed in.',
  ],
  content: [
    {
      type: 'notice',
      text: 'The “In short” summary above is not the notice. It is there to help you find your way around. Where the summary and a clause differ, the clause governs.',
    },
    {
      type: 'paragraph',
      text: 'A cookie is a small piece of text that a website asks your browser to store, and to send back to that website on later requests. A website can also keep information in your browser’s own storage (called local storage and session storage), which is not sent along with every request the way a cookie is. This notice tells you exactly which cookies and browser storage Stayo uses, why, and how to control them.',
    },

    /* 1 — The cookies we set */
    { type: 'subheading', id: 'cookies-we-set', text: '1. The cookies we set' },
    {
      type: 'clause',
      id: 'clause-cookies-we-set-1',
      number: '1.1',
      text: 'Stayo sets three cookies of its own, all through our own servers — for example when you sign in, or create or activate an account. The security token is also issued on its own whenever the Platform needs a fresh one. Two of the three are strictly necessary; the table says which, and why. The sign-in provider we use sets further cookies, described in clause 1.4.',
    },
    {
      type: 'table',
      columns: ['Cookie', 'Purpose', 'Essential?'],
      rows: [
        [
          'hms_csrf',
          'A security token. Whenever you save or change something while signed in, the Platform sends this token back with the request, and our servers refuse the change unless the two match. This is how we confirm the request came from you on Stayo, and not from another website acting on your behalf. It is also checked when you ask to reset a forgotten password.',
          'Yes — without it you cannot save or change anything while signed in, or reset a forgotten password.',
        ],
        [
          'hms_session',
          'A copy of your sign-in credential. Most of the Platform now signs you in through your browser’s storage instead (see section 2). But when you open a document directly from a link — for example a Resident’s identity document in an Owner’s verification queue, or your own signed agreement on your profile — your browser sends only its cookies, and this cookie is how our servers know it is you. Our servers also accept it as a fallback if any other request arrives without the usual sign-in details.',
          'Yes — without it, documents opened directly from a link will not load until you next sign in.',
        ],
        [
          'hms_refresh_token',
          'Also left over from the earlier way of signing in, where it was used to renew your session. Your browser still sends it to our servers, but nothing on them reads it any more.',
          'No — kept for compatibility with an earlier sign-in method, and not read.',
        ],
      ],
    },
    {
      type: 'clause',
      id: 'clause-cookies-we-set-2',
      number: '1.2',
      text: 'The hms_session and hms_refresh_token cookies cannot be read by scripts running on the page — only our servers can read them. The hms_csrf cookie is readable by the page, because that is what lets it do its job of confirming a request came from you.',
    },
    {
      type: 'clause',
      id: 'clause-cookies-we-set-3',
      number: '1.3',
      text: 'All three of these cookies are Stayo’s own, and all three exist only for signing in and security. None of them is used for analytics, advertising or tracking, and when you sign out we ask your browser to delete all three.',
    },
    {
      type: 'clause',
      id: 'clause-cookies-we-set-4',
      number: '1.4',
      text: 'Signing in is handled by a specialist sign-in provider working on our behalf — our Privacy Policy lists it among the service providers we use. Its software runs on the sign-in and sign-up screens and inside the signed-in Stayo app: your profile, your resident dashboard, and the owner and admin apps. It is not loaded on Stayo’s public pages, such as the home page, the contact page or these policies. Where it runs, it sets these cookies:',
    },
    {
      type: 'table',
      columns: ['Cookie', 'Purpose', 'Essential?'],
      rows: [
        [
          '__session',
          'A short-lived, signed proof that you are signed in. It lasts about a minute and is renewed automatically while you use the app, so a copied value stops working almost at once.',
          'Yes — without it you cannot stay signed in through the sign-in provider.',
        ],
        [
          '__client_uat',
          'A timestamp of when your sign-in was last updated, so the app can tell quickly whether you are signed in, signed out, or due a refreshed session.',
          'Yes — it is part of how your session is kept current.',
        ],
        [
          'One further sign-in cookie',
          'Links your browser to your sign-in, so you are not asked to sign in again on every visit. Its name, and whether it is stored under Stayo’s web address or the address the provider uses for Stayo’s sign-in, depend on how the provider is configured.',
          'Yes — without it you would be signed out between visits.',
        ],
      ],
    },
    {
      type: 'clause',
      id: 'clause-cookies-we-set-5',
      number: '1.5',
      text: 'These cookies are set and read by the sign-in provider’s software on our behalf, and checked by our servers to confirm you are signed in. We use them only to sign you in securely; they are not analytics, advertising or tracking cookies. The provider may add a short suffix to their names.',
    },

    /* 2 — What we keep in your browser's storage */
    { type: 'subheading', id: 'browser-storage', text: '2. What we keep in your browser’s storage' },
    {
      type: 'clause',
      id: 'clause-browser-storage-1',
      number: '2.1',
      text: 'Your sign-in is kept in your browser’s local storage, not in a cookie. When you sign in, the sign-in software running on the page stores your session there, and the Platform sends it with each request to show that it is you. This is strictly necessary: without it you cannot stay signed in.',
    },
    {
      type: 'clause',
      id: 'clause-browser-storage-2',
      number: '2.2',
      text: 'We also use local storage for a few conveniences. Each one only remembers something about how you use the Platform on that device:',
    },
    {
      type: 'list',
      ordered: false,
      items: [
        'the city you last chose when searching for hostels;',
        'how you have chosen to sort your hostels on the Owner dashboard;',
        'a draft of the details you have entered while setting up as an Owner, or of your profile while activating a Resident account, so that you do not lose your work if the page reloads part-way through;',
        'which getting-started tips and guides you have dismissed, so they are not shown to you again;',
        'when you last turned down the offer to switch on notifications, so we do not keep asking.',
      ],
    },
    {
      type: 'clause',
      id: 'clause-browser-storage-3',
      number: '2.3',
      text: 'Session storage, which your browser clears when you close the tab, holds short-lived details that carry you from one step to the next — for example, where to return you after signing in with Google, whether you have already seen the welcome screen, or the reference for a request you have just sent us.',
    },
    {
      type: 'clause',
      id: 'clause-browser-storage-4',
      number: '2.4',
      text: 'None of this is used to track you. It is not used for analytics or advertising, and we do not use it to follow you across other websites or to build a profile of you. Clearing your browser’s site data removes all of it; apart from losing the conveniences above, the only effect is that you are signed out on that device.',
    },

    /* 3 — What we do not set */
    { type: 'subheading', id: 'what-we-do-not-set', text: '3. What we do not set' },
    {
      type: 'clause',
      id: 'clause-what-we-do-not-set-1',
      number: '3.1',
      text: 'We do not set analytics cookies, advertising cookies, or cookies that track your behaviour across sites. We do not load any third-party analytics tool, advertising network, or tracking pixel on the Platform. We do not build an advertising profile of you, and we do not sell or share cookie data with anyone for advertising.',
    },
    {
      type: 'clause',
      id: 'clause-what-we-do-not-set-2',
      number: '3.2',
      text: 'If that ever changes — for example, if we add a product analytics or advertising tool in future — we will update this notice first, and we will revisit whether a consent banner is required before any such cookie is set.',
    },

    /* 4 — Why there is no consent banner */
    { type: 'subheading', id: 'why-no-banner', text: '4. Why there is no consent banner' },
    {
      type: 'clause',
      id: 'clause-why-no-banner-1',
      number: '4.1',
      text: 'A cookie consent banner exists to let you say no to cookies and similar browser storage that are used for something other than the service you are using — above all, tracking you, measuring you for analytics, or advertising to you. Stayo uses nothing of that kind (see section 3).',
    },
    {
      type: 'clause',
      id: 'clause-why-no-banner-2',
      number: '4.2',
      text: 'Everything kept in your browser for Stayo is set for Stayo alone — by Stayo itself, or by the sign-in provider working on its behalf — and serves one of three purposes: signing you in (your sign-in session in browser storage, the hms_session cookie, and the sign-in provider’s cookies in clause 1.4), security (the hms_csrf cookie), or remembering your own choices and where you are in a task (the conveniences and short-lived details in section 2). Of these, your sign-in session, hms_session, the sign-in provider’s cookies and hms_csrf are strictly necessary: parts of the service you asked for do not work without them. The conveniences are not strictly necessary, but they only remember what you chose or what you were in the middle of, and are never used to track you. The one remaining cookie, hms_refresh_token, is not necessary either: it is left over from an earlier way of signing in, and nothing reads it. Deleting it has no effect on your account, although it will be set again the next time you sign in.',
    },
    {
      type: 'clause',
      id: 'clause-why-no-banner-3',
      number: '4.3',
      text: 'That is why we have deliberately chosen not to show a cookie consent banner: nothing we set is used for tracking, analytics or advertising, so a banner would have nothing real to ask you. A banner asking your permission anyway is not a real choice — it is theatre, and it trains people to dismiss consent prompts without reading them, which makes consent worse everywhere, including on the sites where it does matter. This notice is how we give you notice instead.',
    },

    /* 5 — Controlling cookies */
    { type: 'subheading', id: 'controlling-cookies', text: '5. Controlling cookies' },
    {
      type: 'clause',
      id: 'clause-controlling-cookies-1',
      number: '5.1',
      text: 'Your browser lets you view, block or delete cookies, including cookies already stored from Stayo. The setting is usually under your browser’s privacy or site-settings menu; where to find it varies by browser and device.',
    },
    {
      type: 'notice',
      text: 'If you block cookies for Stayo, you will not be able to save or change anything while you are signed in, because the security token cannot be stored and our servers will refuse the change. You will also not be able to reset a forgotten password, and documents opened directly from a link will not load. In many browsers, the setting that blocks all cookies also blocks the browser storage that holds your sign-in, so in practice you are also likely to find you cannot stay signed in.',
    },
    {
      type: 'clause',
      id: 'clause-controlling-cookies-2',
      number: '5.2',
      text: 'Deleting Stayo’s cookies, rather than blocking them, does not by itself sign you out: your sign-in is held in browser storage, and a fresh security token is fetched automatically the next time you need one. Documents opened directly from a link will not load until you next sign in, because that is when the hms_session cookie is set again. However, the option most browsers offer for clearing cookies also clears other site data, including that storage — if you use it, you will be signed out on that device and will need to sign in again.',
    },
    {
      type: 'clause',
      id: 'clause-controlling-cookies-3',
      number: '5.3',
      text: 'We do not use browser storage, or any other means, to identify or track you as a workaround for blocked cookies. The browser storage described in section 2 is all we keep in your browser besides the cookies in section 1, and it is used only for the purposes described there.',
    },

    /* 6 — Changes to this notice */
    { type: 'subheading', id: 'changes', text: '6. Changes to this notice' },
    {
      type: 'clause',
      id: 'clause-changes-1',
      number: '6.1',
      text: 'We may update this notice, most often because the cookies or browser storage we use have changed. Each version is published on this page with a version number and the date it takes effect. Questions about this notice can be sent to our privacy contact.',
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
