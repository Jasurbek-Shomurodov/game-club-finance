import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  MIN_VIEWPORT_SPAN,
  TOUCH_DRAG_THRESHOLD_PX,
  clampViewport,
  createViewportGestures,
  dayTimestamp,
  panViewport,
  pickedDay,
  pointsInView,
  pointsWithin,
  showsAll,
  timestampDay,
  viewportExtent,
  zoomViewport,
  type Viewport,
} from './chartViewport';

const DAY = 86_400_000;
const extent: Viewport = { start: 0, end: 100 * DAY };

describe('zoomViewport', () => {
  it('keeps the day under the pointer in place', () => {
    const zoomed = zoomViewport(extent, extent, 0.25, 0.5);
    expect(zoomed).toEqual({ start: 12.5 * DAY, end: 62.5 * DAY });
    expect((25 * DAY - zoomed.start) / (zoomed.end - zoomed.start)).toBe(0.25);
  });

  it('never zooms past two days or out past every day the chart holds', () => {
    const tight = zoomViewport(extent, extent, 0.5, 0.0001);
    expect(tight.end - tight.start).toBe(MIN_VIEWPORT_SPAN);
    expect(zoomViewport({ start: 10 * DAY, end: 20 * DAY }, extent, 0.5, 50)).toEqual(extent);
    // An anchor off the plot (the pointer over an axis) counts as the nearest edge.
    expect(zoomViewport(extent, extent, -3, 0.5).start).toBe(0);
  });
});

describe('panViewport and clampViewport', () => {
  it('moves through the days and stops at both ends without changing the span', () => {
    const view = { start: 40 * DAY, end: 60 * DAY };
    expect(panViewport(view, extent, -10 * DAY)).toEqual({ start: 30 * DAY, end: 50 * DAY });
    expect(panViewport(view, extent, -500 * DAY)).toEqual({ start: 0, end: 20 * DAY });
    expect(panViewport(view, extent, 500 * DAY)).toEqual({ start: 80 * DAY, end: 100 * DAY });
  });

  it('keeps a view inside the extent, and shows a range shorter than two days whole', () => {
    expect(clampViewport({ start: -5 * DAY, end: 200 * DAY }, extent)).toEqual(extent);
    const short = { start: 0, end: DAY };
    expect(clampViewport({ start: 0, end: DAY / 4 }, short)).toEqual(short);
    expect(showsAll(extent, extent)).toBe(true);
    expect(showsAll({ start: DAY, end: 100 * DAY }, extent)).toBe(false);
  });
});

describe('pointsInView', () => {
  const points = [0, 10, 20, 30, 40].map((day) => ({ timestamp: day * DAY, day }));

  it('draws the points in view plus one on each side, so lines reach the edges', () => {
    expect(pointsInView(points, { start: 15 * DAY, end: 25 * DAY }).map((point) => point.day)).toEqual([10, 20, 30]);
    expect(pointsInView(points, { start: 21 * DAY, end: 29 * DAY }).map((point) => point.day)).toEqual([20, 30]);
    expect(pointsInView(points, { start: 0, end: 40 * DAY }).map((point) => point.day)).toEqual([0, 10, 20, 30, 40]);
    expect(pointsInView(points, { start: 50 * DAY, end: 60 * DAY }).map((point) => point.day)).toEqual([40]);
  });

  it('keeps only the points inside a view for bars and figures, and every point without one', () => {
    expect(pointsWithin(points, { start: 15 * DAY, end: 30 * DAY }).map((point) => point.day)).toEqual([20, 30]);
    expect(pointsWithin(points, { start: 21 * DAY, end: 29 * DAY })).toEqual([]);
    expect(pointsWithin(points, null)).toEqual(points);
  });

  it('has an extent only with two points or more', () => {
    expect(viewportExtent(points)).toEqual({ start: 0, end: 40 * DAY });
    expect(viewportExtent(points.slice(0, 1))).toBeNull();
  });
});

describe('day timestamps', () => {
  it('round-trips a stored ISO day through midnight UTC', () => {
    expect(dayTimestamp('2026-11-28') % DAY).toBe(0);
    expect(timestampDay(dayTimestamp('2026-11-28'))).toBe('2026-11-28');
    expect(timestampDay(dayTimestamp('2026-03-01') + DAY / 2)).toBe('2026-03-01');
  });
});

/** A chart 1000px wide at x = 0, holding 100 days, showing days 40 to 60. */
function gestureHarness(start: Viewport = { start: 40 * DAY, end: 60 * DAY }) {
  let view = start;
  const panning: boolean[] = [];
  const gestures = createViewportGestures({
    plot: () => ({ left: 0, width: 1000 }),
    view: () => view,
    extent: () => extent,
    setView: (next) => { view = next; },
    setPanning: (value) => panning.push(value),
  });
  return { gestures, panning, view: () => view };
}

describe('createViewportGestures', () => {
  it('treats a press that barely moves as a tap, so the day under it opens', () => {
    const { gestures, view } = gestureHarness();
    gestures.down({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500 });
    gestures.move({ pointerId: 1, pointerType: 'mouse', clientX: 502 });
    gestures.up({ pointerId: 1 });
    expect(gestures.consumeDrag()).toBe(false);
    expect(view()).toEqual({ start: 40 * DAY, end: 60 * DAY });
  });

  it('moves back in time on a drag to the right, and the click it ends in opens no day', () => {
    const { gestures, panning, view } = gestureHarness();
    gestures.down({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500 });
    // 250px of a 1000px plot showing 20 days is 5 days.
    gestures.move({ pointerId: 1, pointerType: 'mouse', clientX: 750 });
    gestures.up({ pointerId: 1 });
    expect(view()).toEqual({ start: 35 * DAY, end: 55 * DAY });
    expect(panning).toEqual([true, false]);
    expect(gestures.consumeDrag()).toBe(true);
    // Reading it clears it: the next tap opens its day again.
    expect(gestures.consumeDrag()).toBe(false);
  });

  it('ignores presses other than the main button', () => {
    const { gestures, view } = gestureHarness();
    gestures.down({ pointerId: 1, pointerType: 'mouse', button: 2, clientX: 500 });
    gestures.move({ pointerId: 1, pointerType: 'mouse', clientX: 900 });
    expect(view()).toEqual({ start: 40 * DAY, end: 60 * DAY });
    expect(gestures.consumeDrag()).toBe(false);
  });

  it('zooms with two fingers around their midpoint, and counts the pinch as a drag', () => {
    const { gestures, view } = gestureHarness();
    gestures.down({ pointerId: 1, pointerType: 'touch', clientX: 400 });
    gestures.down({ pointerId: 2, pointerType: 'touch', clientX: 600 });
    gestures.move({ pointerId: 2, pointerType: 'touch', clientX: 800 });
    // Fingers twice as far apart: half the span, centred where they started.
    expect(view()).toEqual({ start: 45 * DAY, end: 55 * DAY });
    gestures.up({ pointerId: 1 });
    gestures.up({ pointerId: 2 });
    expect(gestures.consumeDrag()).toBe(true);
  });

  it('pans on a sideways scroll and zooms on a vertical one', () => {
    const { gestures, view } = gestureHarness();
    expect(gestures.wheel({ deltaX: 100, deltaY: 0, ctrlKey: false, clientX: 500 })).toBe(true);
    expect(view()).toEqual({ start: 42 * DAY, end: 62 * DAY });
    expect(gestures.wheel({ deltaX: 0, deltaY: -200, ctrlKey: false, clientX: 500 })).toBe(true);
    const span = view().end - view().start;
    expect(span).toBeLessThan(20 * DAY);
    // No double-click gesture: its first click already opens a day, so "show all" is a button.
    expect('double' in gestures).toBe(false);
  });

  it('lets the page scroll when the wheel cannot move the chart', () => {
    // Every day in view: zooming out and scrolling sideways change nothing.
    const whole = gestureHarness(extent);
    expect(whole.gestures.wheel({ deltaX: 0, deltaY: 200, ctrlKey: false, clientX: 500 })).toBe(false);
    expect(whole.gestures.wheel({ deltaX: 100, deltaY: 0, ctrlKey: false, clientX: 500 })).toBe(false);
    expect(whole.view()).toEqual(extent);
    // At the latest day, scrolling further forward changes nothing either; back in time still moves.
    const end = gestureHarness({ start: 80 * DAY, end: 100 * DAY });
    expect(end.gestures.wheel({ deltaX: 100, deltaY: 0, ctrlKey: false, clientX: 500 })).toBe(false);
    expect(end.gestures.wheel({ deltaX: -100, deltaY: 0, ctrlKey: false, clientX: 500 })).toBe(true);
  });

  it('lets a finger wobble more than a mouse before a tap becomes a drag', () => {
    const touch = gestureHarness();
    touch.gestures.down({ pointerId: 1, pointerType: 'touch', clientX: 500 });
    touch.gestures.move({ pointerId: 1, pointerType: 'touch', clientX: 500 + TOUCH_DRAG_THRESHOLD_PX - 1 });
    touch.gestures.up({ pointerId: 1 });
    expect(touch.gestures.consumeDrag()).toBe(false);
    expect(touch.view()).toEqual({ start: 40 * DAY, end: 60 * DAY });

    touch.gestures.down({ pointerId: 1, pointerType: 'touch', clientX: 500 });
    touch.gestures.move({ pointerId: 1, pointerType: 'touch', clientX: 500 + TOUCH_DRAG_THRESHOLD_PX });
    touch.gestures.up({ pointerId: 1 });
    expect(touch.gestures.consumeDrag()).toBe(true);

    const mouse = gestureHarness();
    mouse.gestures.down({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500 });
    mouse.gestures.move({ pointerId: 1, pointerType: 'mouse', clientX: 500 + DRAG_THRESHOLD_PX });
    mouse.gestures.up({ pointerId: 1 });
    expect(mouse.gestures.consumeDrag()).toBe(true);
  });
});

describe('pickedDay', () => {
  const drawn = [
    { iso: '2026-11-09', timestamp: 9 * DAY },
    { iso: '2026-11-10', timestamp: 10 * DAY },
    { iso: '2026-11-11', timestamp: 11 * DAY },
    { iso: '2026-11-12', timestamp: 12 * DAY },
  ];

  it('opens the point pressed, by its index among the drawn points', () => {
    expect(pickedDay(drawn, 1, null)?.iso).toBe('2026-11-10');
    expect(pickedDay(drawn, '2', null)?.iso).toBe('2026-11-11');
    expect(pickedDay(drawn, 0, { start: 9 * DAY, end: 12 * DAY })?.iso).toBe('2026-11-09');
  });

  it('opens nothing for the neighbours drawn outside a zoomed view, or for no point', () => {
    const view = { start: 9.5 * DAY, end: 11.5 * DAY };
    expect(pickedDay(drawn, 0, view)).toBeUndefined();
    expect(pickedDay(drawn, 3, view)).toBeUndefined();
    expect(pickedDay(drawn, 2, view)?.iso).toBe('2026-11-11');
    expect(pickedDay(drawn, undefined, view)).toBeUndefined();
    expect(pickedDay(drawn, 9, null)).toBeUndefined();
  });
});
