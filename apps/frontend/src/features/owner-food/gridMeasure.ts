import type { Rect } from './timetableDnd';

/**
 * Page coordinates (not viewport) — matches what motion's `PanInfo.point`
 * reports, and survives a mid-drag scroll. Shared by every drag surface in
 * this module (the retired `TimetablePage` had its own inline copy; the Meal
 * Plan grid/mobile/cell components all need the same measurement, so it's
 * lifted out here rather than re-duplicated — ADR-121).
 */
export function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left + window.scrollX, top: r.top + window.scrollY, right: r.right + window.scrollX, bottom: r.bottom + window.scrollY };
}
