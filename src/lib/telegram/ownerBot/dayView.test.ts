import { describe, expect, it } from 'vitest';
import type { OwnerBotDayState, OwnerBotHandover } from './actions';
import { buildOwnerBotDayView, ownerBotLine } from './dayView';
import type { OwnerBotDay } from './texts';

const NOW = new Date('2026-11-28T05:00:00Z');
const LINES = { cash: 'l-cash', terminal: 'l-terminal', card: 'l-card', playstation: 'l-ps' };

const day: OwnerBotDay = {
  clubName: 'Square',
  businessDate: '2026-11-27',
  methods: [
    { method: 'cash', moneyIn: 1_200_000, moneyOut: 0, net: 1_200_000 },
    { method: 'terminal', moneyIn: 900_000, moneyOut: 100_000, net: 800_000 },
    { method: 'card', moneyIn: 0, moneyOut: 0, net: 0 },
  ],
  barSales: 450_000,
};

const state = (overrides: Partial<OwnerBotDayState> = {}): OwnerBotDayState => ({
  clubId: 'c1',
  clubName: 'Square',
  businessDate: '2026-11-27',
  till: { cash: 1_200_000, terminal: 700_000, card: 0, playstation: 0 },
  handovers: [],
  lineIds: LINES,
  ...overrides,
});

const handover = (overrides: Partial<OwnerBotHandover>): OwnerBotHandover => ({
  id: 'h1',
  method: 'cash',
  action: 'collected',
  amount: 1_200_000,
  createdAt: '2026-11-28T04:55:00.000000+00:00',
  undoUntil: '2026-11-28T05:05:00.000000+00:00',
  mine: true,
  ...overrides,
});

describe('buildOwnerBotDayView', () => {
  it('shows the till as each line\'s amount, with the day\'s figure beside it, and a button only where money is left', () => {
    const view = buildOwnerBotDayView(day, state(), NOW);
    expect(view.lines).toEqual([
      { method: 'cash', status: 'open', amount: 1_200_000, dayNet: 1_200_000, buttonId: 'l-cash' },
      { method: 'terminal', status: 'open', amount: 700_000, dayNet: 800_000, buttonId: 'l-terminal' },
      { method: 'card', status: 'empty', amount: 0, dayNet: 0, buttonId: null },
    ]);
    expect(view.tillTotal).toBe(1_900_000);
    expect(view.barSales).toBe(450_000);
    expect(view.undo).toBeNull();
  });

  it('adds a method the day did not move when the till still holds it, in the report\'s order', () => {
    const view = buildOwnerBotDayView(day, state({ till: { cash: 0, terminal: 0, card: 0, playstation: 99_999.6 } }), NOW);
    expect(view.lines.map((line) => [line.method, line.status, line.amount])).toEqual([
      ['cash', 'empty', 0], ['terminal', 'empty', 0], ['card', 'empty', 0], ['playstation', 'open', 99_999],
    ]);
  });

  it('marks a line with its latest mark and the amount marked, without a button', () => {
    const view = buildOwnerBotDayView(day, state({
      till: { cash: 0, terminal: 0, card: 0, playstation: 0 },
      handovers: [
        handover({ id: 'h1', method: 'terminal', action: 'reserve', amount: 700_000, mine: false }),
        handover({ id: 'h2', method: 'cash', createdAt: '2026-11-28T04:58:00.000000+00:00', undoUntil: '2026-11-28T05:08:00.000000+00:00' }),
      ],
    }), NOW);
    expect(ownerBotLine(view, 'cash')).toMatchObject({ status: 'collected', amount: 1_200_000, buttonId: null });
    expect(ownerBotLine(view, 'terminal')).toMatchObject({ status: 'reserve', amount: 700_000, dayNet: 800_000, buttonId: null });
    // Only this owner's own last mark can be undone.
    expect(view.undo).toEqual({ handoverId: 'h2', method: 'cash', action: 'collected' });
  });

  it('drops the undo after 10 minutes and never offers another owner\'s mark', () => {
    const marked = state({ handovers: [handover({ undoUntil: '2026-11-28T04:59:59.000000+00:00' })] });
    expect(buildOwnerBotDayView(day, marked, NOW).undo).toBeNull();
    expect(buildOwnerBotDayView(day, state({ handovers: [handover({ mine: false })] }), NOW).undo).toBeNull();
  });

  it('keeps an open line without a button when its button row is missing', () => {
    const view = buildOwnerBotDayView(day, state({ lineIds: {} }), NOW);
    expect(ownerBotLine(view, 'cash')).toMatchObject({ status: 'open', amount: 1_200_000, buttonId: null });
  });
});
