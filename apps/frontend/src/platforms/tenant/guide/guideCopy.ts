import type { GuideBeat, WelcomeStopId } from './tenantGuide';

interface Note {
  title: string;
  body: string;
}

/**
 * Written for someone who has just moved into a hostel and has never used
 * this app — plain sentences about their room and their money, not a feature
 * list. Each one says what the screen is, and names the one thing on it a
 * tenant would otherwise never find.
 */
export const WELCOME_COPY: Record<WelcomeStopId, Note> = {
  rent: {
    title: 'What you owe, and how to clear it',
    body: 'This card shows the rent that is due and how late it is. Tap Pay to settle it — the receipt appears under Payments straight away, and your owner sees it without you having to tell them.',
  },
  header: {
    title: 'Your hostel, and your room',
    body: 'Your hostel name, your room number, and the bell. Anything your owner announces — a water shutdown, a festival lunch, a rule change — arrives there.',
  },
  nav: {
    title: 'Everything else lives down here',
    body: 'Room is your bed, your roommates and where you report a problem. Food is this week menu and the kitchen polls. Payments is every month and every receipt. Explore is other Stayo hostels, for whenever you next need one.',
  },
};

/**
 * The per-tab notes. Each fires once, the first time that tab is opened with
 * real data on it — not up front, so nothing is explained before it is seen.
 */
export const TAB_COPY: Record<Exclude<GuideBeat, 'welcome'>, Note> = {
  room: {
    title: 'Your room, and how to get things fixed',
    body: 'Your bed and room number, who you share with, and what the room comes with. If something is broken — a fan, a geyser, the wifi — open Complaints further down this page. You can follow it here until it is closed.',
  },
  food: {
    title: 'This week at the kitchen',
    body: 'Today meals are at the top, each showing whether it is upcoming, being served, or done. Below that is the whole week — tap a day to open it. When the kitchen runs a poll on what to cook, it turns up here and on Home, and your vote counts.',
  },
  money: {
    title: 'Every month, and every receipt',
    body: 'One row per rent month, showing what is paid and what is still due. Each paid month has a receipt you can share.',
  },
};
