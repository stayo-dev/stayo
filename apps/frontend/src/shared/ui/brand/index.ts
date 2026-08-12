/*
 * Stayo brand loading system. One gesture for every wait in the app: the
 * mark's four windows lighting up. Circular spinners are not used anywhere —
 * see stayo-loading.css and docs/obsidian/Frontend.md.
 *
 *   <StayoLoader />          inside a button or beside a label
 *   <StayoLoadingBlock />    a card / section body waiting on its own data
 *   <StayoLoadingScreen />   a whole surface: route fallback, auth gate, sheet
 *   <StayoErrorScreen />     the same surface when it failed — lights out
 */
export { StayoMark, type StayoMarkProps, type StayoMarkPanes } from './StayoMark';
export { StayoWordmark } from './StayoWordmark';
export { StayoLoader, StayoLoadingBlock, type StayoLoaderSize, type StayoLoaderProps } from './StayoLoader';
export { StayoLoadingScreen, STAYO_LOADING_LINES, type StayoLoadingScreenProps } from './StayoLoadingScreen';
export { StayoErrorScreen, type StayoErrorScreenProps, type StayoErrorTone } from './StayoErrorScreen';
export { HostelScene, MAX_DRAWN_FLOORS, type HostelSceneState } from './HostelScene';
