import type { ReactNode } from 'react';

/** Semantic tone used for notice dots, pills, and timeline states — matches Stayo Tenant.dc.html's `tone()` helper. */
export type OverlayTone = 'green' | 'yellow' | 'orange' | 'red' | 'grey';

export const TONE_COLOR: Record<OverlayTone, { c: string; bg: string }> = {
  green: { c: '#1F7A52', bg: '#EAF3EE' },
  yellow: { c: '#B8792B', bg: '#FBF1DE' },
  orange: { c: '#C2591F', bg: '#FBEBDF' },
  red: { c: '#C0392B', bg: '#FBE9E7' },
  grey: { c: '#8A7F75', bg: '#F2ECE5' },
};

export interface StatusSection {
  kind: 'status';
  title?: string;
  icon: ReactNode;
  big: string;
  sub: string;
  tone: OverlayTone;
}
export interface ChipsSection {
  kind: 'chips';
  title?: string;
  chips: { k: string; v: string }[];
}
export interface RowsSection {
  kind: 'rows';
  title?: string;
  rows: { label: string; value: string; mono?: boolean }[];
}
export interface TimelineSection {
  kind: 'timeline';
  title?: string;
  steps: { label: string; meta: string; state: 'done' | 'active' | 'todo' }[];
}
export interface NoticesSection {
  kind: 'notices';
  title?: string;
  notices: { title: string; meta: string; tone: OverlayTone }[];
}
export interface PhotosSection {
  kind: 'photos';
  title?: string;
  count: number;
}
export interface PersonSection {
  kind: 'person';
  initial: string;
  name: string;
  role: string;
  tag1: string;
  tag2: string;
}
export interface EmptySection {
  kind: 'empty';
  title: string;
  body: string;
}
export interface DetailAction {
  label: string;
  style: 'primary' | 'dark' | 'ghost';
  onClick: () => void;
}
export interface ActionsSection {
  kind: 'actions';
  actions: DetailAction[];
}

export type DetailSection =
  | StatusSection
  | ChipsSection
  | RowsSection
  | TimelineSection
  | NoticesSection
  | PhotosSection
  | PersonSection
  | EmptySection
  | ActionsSection;

/** One drill-in / read-only destination — Room details, per-utility screens, roommate cards, ticket detail, profile detail cards, etc. */
export interface DetailConfig {
  title: string;
  sub: string;
  headPill?: string;
  pillTone?: OverlayTone;
  sections: DetailSection[];
}

export interface FormOption {
  id: string;
  label: string;
  sub?: string;
  icon?: ReactNode;
}
export interface FormInputField {
  key: string;
  label: string;
  type: string;
  placeholder: string;
}
export interface FormNote {
  label: string;
  placeholder: string;
}

/** One single-decision request/ticket flow — Room services, "Raise a ticket"/"Report a bug", maintenance. */
export interface FormConfig {
  title: string;
  sub: string;
  prompt: string;
  needsOption?: boolean;
  needsName?: boolean;
  hasIcon?: boolean;
  options?: FormOption[];
  inputs?: FormInputField[];
  banner?: string;
  note?: FormNote;
  photos?: boolean;
  submitLabel: string;
  successTitle: string;
  successSub: string;
  refPrefix: string;
  /** Called on submit with the collected option id + free-text inputs/note. Throwing aborts the submit (stays on the form). */
  onSubmit: (data: { optionId?: string; inputs: Record<string, string>; note: string }) => Promise<void>;
}
