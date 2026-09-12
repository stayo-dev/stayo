/*
 * Stayo brand loading system. One gesture for every wait in the app: the
 * mark's four windows lighting up. Circular spinners are not used anywhere —
 * see stayo-loading.css and docs/obsidian/Frontend.md.
 *
 *   <StayoLoader />          inside a button or beside a label
 *   <StayoLoadingBlock />    a card / section body waiting on its own data
 *   <StayoLoadingScreen />   a whole surface: route fallback, auth gate, sheet
 *   <StayoErrorScreen />     the same surface when it failed — lights out
 *
 * The Stayo dog (./mascot) is the brand's companion, and it is NEVER a loader:
 * waits stay the four windows. It appears at human moments — login,
 * onboarding, empty/error/success states — per the presence policy in
 * docs/superpowers/specs/2026-09-12-stayo-dog-mascot-design.md.
 *
 *   <StayoDog companion={dog.companion} framing="rim" />   reacts to a form
 *   <StayoDog expression="waving" />                       holds one expression
 */
export { StayoMark, type StayoMarkProps, type StayoMarkPanes } from './StayoMark';
export { StayoWordmark } from './StayoWordmark';
export { StayoLoader, StayoLoadingBlock, type StayoLoaderSize, type StayoLoaderProps } from './StayoLoader';
export { StayoLoadingScreen, STAYO_LOADING_LINES, type StayoLoadingScreenProps } from './StayoLoadingScreen';
export { StayoErrorScreen, type StayoErrorScreenProps, type StayoErrorTone } from './StayoErrorScreen';
export { HostelScene, MAX_DRAWN_FLOORS, type HostelSceneState } from './HostelScene';
export {
  StayoDog,
  RIM_OVERLAP_PERCENT,
  useDogCompanion,
  DOG_EXPRESSIONS,
  type DogCompanion,
  type DogExpressionName,
  type DogFraming,
} from './mascot';
