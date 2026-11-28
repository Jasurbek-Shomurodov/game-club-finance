import { formatDateOnly } from '../../formatters';
import { DAY_METHOD_LABELS, type DailyFinanceDayMethod, type DailyFinanceDayMethodKey } from '../dailyFinanceReport';
import { lines, sum } from '../messageParts';
import type { OwnerBotClub, OwnerBotLinkStatus } from './accounts';
import type { OwnerBotActionResult, OwnerBotHandoverAction, OwnerBotRefusal } from './actions';
import type { OwnerBotBarLine, OwnerBotDayView, OwnerBotLine, OwnerBotLineStatus } from './dayView';

/**
 * The owner money bot's Russian replies (docs/plans/owner-money-bot.md). Every
 * line starts with an emoji; amounts use the app's money format with spaces
 * between thousands ("1 200 000 сум"). Messages are plain text (no parse_mode).
 * Toasts and alerts after a button press stay under Telegram's 200 characters.
 */

const SETTINGS_PATH = 'Настройки → Telegram';
const HOW_TO_LINK = `🔗 Откройте в приложении ${SETTINGS_PATH}, получите код и отправьте его сюда: /link КОД`;
const COMMANDS = [
  '📅 /today — деньги за последний закрытый день',
  '🏢 /clubs — ваши клубы',
];

export function startText(linked: boolean): string {
  return linked
    ? lines('👋 Здравствуйте! Telegram подключён к приложению.', ...COMMANDS)
    : lines('👋 Здравствуйте! Это бот владельца клуба: деньги каждого дня по способам оплаты.', HOW_TO_LINK);
}

export function helpText(linked: boolean): string {
  return linked ? lines('ℹ️ Команды:', ...COMMANDS) : notLinkedText();
}

export function notLinkedText(): string {
  return lines('🔒 Этот Telegram ещё не подключён.', HOW_TO_LINK);
}

export function linkUsageText(): string {
  return lines('✏️ Отправьте код из приложения так: /link КОД', `🔗 Код выдаётся в ${SETTINGS_PATH}.`);
}

export function linkResultText(status: OwnerBotLinkStatus): string {
  switch (status) {
    case 'linked':
      return lines('✅ Telegram подключён.', ...COMMANDS);
    case 'invalid':
      return lines('❌ Такого кода нет.', `🔁 Проверьте код или получите новый в ${SETTINGS_PATH}.`);
    case 'used':
      return lines('❌ Этот код уже использован.', `🔁 Получите новый в ${SETTINGS_PATH}.`);
    case 'expired':
      return lines('⌛ Код истёк: он действует 15 минут.', `🔁 Получите новый в ${SETTINGS_PATH}.`);
    case 'not_owner':
      return '🚫 Подключить бота может только владелец клуба.';
    case 'telegram_in_use':
      return lines(
        '⚠️ Этот Telegram уже подключён к другому пользователю приложения.',
        `🔓 Сначала отключите его там в ${SETTINGS_PATH}.`,
      );
    case 'rate_limited':
      return '⏳ Слишком много неверных кодов. Попробуйте снова через 15 минут.';
  }
}

export function clubsText(clubs: readonly OwnerBotClub[]): string {
  if (clubs.length === 0) return noClubsText();
  return lines(`📋 Ваши клубы (${clubs.length}):`, ...clubs.map((club) => `🏢 ${club.name}`));
}

export function noClubsText(): string {
  return '🤷 У вас нет активных клубов, где вы владелец.';
}

export const DAY_METHOD_EMOJI: Record<DailyFinanceDayMethodKey, string> = {
  cash: '💵',
  terminal: '💳',
  card: '🏧',
  playstation: '🎮',
};

const methodName = (method: DailyFinanceDayMethodKey) => `${DAY_METHOD_EMOJI[method]} ${DAY_METHOD_LABELS[method]}`;

/** One club's Game Club money per method and its bar sales on one business day. */
export interface OwnerBotDay {
  clubName: string;
  businessDate: string;
  /** The methods the daily report's payment section shows (selectDayPaymentMethods); empty when no method moved money. */
  methods: DailyFinanceDayMethod[];
  barSales: number;
}

export const BUTTON_TEXT = {
  collect: '✅ Забрал',
  reserve: '🏦 В резерв',
  left: '👌 Оставил в баре',
  amount: '✏️ Другая сумма',
  back: '⬅️ Назад',
  yes: '✅ Да',
  no: '✖️ Нет',
  bar: '🍺 Бар',
  allCollect: '✅ Всё забрал',
  allReserve: '🏦 Всё в резерв',
} as const;

/** A method's button on the day message. */
export function methodButtonText(method: DailyFinanceDayMethodKey): string {
  return methodName(method);
}

/** Method names inside a sentence, as its object ("Отменить: наличные в резерв", "забрал карту"). */
const METHOD_IN_SENTENCE: Record<DailyFinanceDayMethodKey, string> = {
  cash: 'наличные',
  terminal: 'терминал',
  card: 'карту',
  playstation: 'PlayStation',
};

const LINE_STATUS: Record<OwnerBotLineStatus, string> = {
  open: '⏳ не отмечено',
  empty: '👌 в кассе ничего нет',
  collected: '✅ забрал',
  reserve: '🏦 в резерве',
  withdrawn: '👤 взял себе',
  left: '👌 оставил в баре',
};

function lineText(line: OwnerBotLine): string {
  // The day's own figure when the till (or what was marked) differs from it.
  const dayFigure = line.amount === line.dayNet ? '' : ` (за день ${sum(line.dayNet)})`;
  return `${methodName(line.method)}: ${sum(line.amount)}${dayFigure} · ${LINE_STATUS[line.status]}`;
}

const BAR_NAME = '🍺 Бар';

/** The bar's sales; its state once there were any, with what was marked when it differs from the sales. */
function barLineText(bar: OwnerBotBarLine): string {
  const head = `${BAR_NAME} (продажи): ${sum(bar.sales)}`;
  if (bar.status === 'empty') return head;
  const moved = bar.status !== 'open' && bar.amount !== bar.sales ? ` ${sum(bar.amount)}` : '';
  return `${head} · ${LINE_STATUS[bar.status]}${moved}`;
}

/** The /today message for one club: one line per Game Club method, the bar and what the admin still holds. */
export function dayText(view: OwnerBotDayView): string {
  return lines(
    `🏢 ${view.clubName} · ${formatDateOnly(view.businessDate, 'ru')}`,
    ...(view.lines.length > 0 ? view.lines.map(lineText) : ['📭 В клубе за этот день оплат нет.']),
    barLineText(view.bar),
    `👛 Осталось у администратора: ${sum(view.tillTotal)}`,
  );
}

/** The day message with a question under it (a submenu or a confirmation). */
function withQuestion(view: OwnerBotDayView, ...question: Array<string | null>): string {
  return `${dayText(view)}\n\n${lines(...question)}`;
}

/** After a method's button: what happened to that money. */
export function methodMenuText(view: OwnerBotDayView, line: OwnerBotLine): string {
  return withQuestion(view, `👉 ${methodName(line.method)}: ${sum(line.amount)}. Что сделали с этими деньгами?`);
}

/** After the bar's button: what happened to the day's bar money. */
export function barMenuText(view: OwnerBotDayView): string {
  return withQuestion(view, `👉 ${BAR_NAME}: ${sum(view.bar.sales)}. Что сделали с этими деньгами?`);
}

/** After ✏️ Другая сумма on a method: what the part is for, before the bot asks how much. */
export function amountMenuText(view: OwnerBotDayView, line: OwnerBotLine): string {
  return withQuestion(view, `✏️ ${methodName(line.method)}: часть от ${sum(line.amount)}. Что сделали с этой частью?`);
}

/** A choice waiting for ✅ Да, with the amount fixed when it was made. */
export type OwnerBotConfirmChoice =
  | { kind: 'method'; method: DailyFinanceDayMethodKey; action: 'collected' | 'reserve'; amount: number }
  | { kind: 'bar'; action: 'reserve' | 'left'; amount: number; capped: boolean }
  | { kind: 'all'; action: 'collected' | 'reserve'; items: ReadonlyArray<{ method: DailyFinanceDayMethodKey; amount: number }> };

/** Before saving: what will be saved, with every amount. */
export function confirmText(view: OwnerBotDayView, choice: OwnerBotConfirmChoice): string {
  if (choice.kind === 'all') {
    const total = choice.items.reduce((sumOfItems, item) => sumOfItems + item.amount, 0);
    return withQuestion(
      view,
      choice.action === 'reserve' ? `🏦 Переместить всё в резерв · ${view.clubName}?` : `✅ Отметить, что вы забрали всё · ${view.clubName}?`,
      ...choice.items.map((item) => `${methodName(item.method)}: ${sum(item.amount)}`),
      `💰 Всего: ${sum(total)}`,
    );
  }
  if (choice.kind === 'bar') {
    const what = `${sum(choice.amount)} · ${BAR_NAME} · ${view.clubName}`;
    if (choice.action === 'left') return withQuestion(view, `👌 Отметить, что ${what} остались в баре?`);
    return withQuestion(
      view,
      `🏦 Переместить в резерв ${what}?`,
      choice.capped ? `ℹ️ Не больше прибыли бара за месяц, поэтому меньше продаж дня (${sum(view.bar.sales)}).` : null,
    );
  }
  const what = `${sum(choice.amount)} · ${methodName(choice.method)} · ${view.clubName}`;
  return withQuestion(view, choice.action === 'reserve'
    ? `🏦 Переместить в резерв ${what}?`
    : `✅ Отметить, что вы забрали ${what}?`);
}

/** The undo button's label. */
export function undoButtonText(undo: {
  side: 'game_club' | 'bar';
  method: DailyFinanceDayMethodKey | null;
  action: OwnerBotHandoverAction;
  group: boolean;
}): string {
  if (undo.group) return undo.action === 'reserve' ? '↩️ Отменить: всё в резерв' : '↩️ Отменить: всё забрал';
  if (undo.side === 'bar' || !undo.method) {
    return undo.action === 'left' ? '↩️ Отменить: оставил в баре' : '↩️ Отменить: бар в резерв';
  }
  const method = METHOD_IN_SENTENCE[undo.method];
  if (undo.action === 'reserve') return `↩️ Отменить: ${method} в резерв`;
  if (undo.action === 'withdrawn') return `↩️ Отменить: ${method} себе`;
  return `↩️ Отменить: забрал ${method}`;
}

/** The toast after a saved or undone press (a repeat of the same press says the same). */
export function resultToastText(result: OwnerBotActionResult): string {
  const amount = sum(result.amount);
  const what = result.group
    ? `всё ${amount}`
    : result.side === 'bar' || !result.method ? `Бар ${amount}` : `${DAY_METHOD_LABELS[result.method]} ${amount}`;
  if (result.status === 'undone') return `↩️ Отменено: ${what}`;
  // A repeated press (a resent ✅ Да or ↩️) after the mark was undone.
  if (result.status === 'already_undone') return `↩️ Уже отменено: ${what}`;
  if (result.group) return result.action === 'reserve' ? `🏦 Всё в резерве: ${amount}` : `✅ Забрал всё: ${amount}`;
  if (result.action === 'left') return `👌 Оставил в баре: ${amount}`;
  if (result.action === 'reserve') return `🏦 В резерве: ${what}`;
  return `✅ Забрал: ${what}`;
}

/** What a typed amount is for, as the question names it. */
export interface OwnerBotAmountQuestion {
  clubName: string;
  side: 'game_club' | 'bar';
  method: DailyFinanceDayMethodKey | null;
  action: 'collected' | 'reserve';
  maxAmount: number;
}

/**
 * The ForceReply question of ✏️ Другая сумма; asked again, with the reason,
 * after an answer that is not a sum or is more than may be taken.
 */
export function amountPromptText(question: OwnerBotAmountQuestion, problem: 'invalid' | 'too_large' | null = null): string {
  const what = question.side === 'bar' || !question.method ? BAR_NAME : methodName(question.method);
  const ask = question.action === 'reserve' ? 'сколько переместить в резерв?' : 'сколько забрали?';
  return lines(
    problem === 'invalid' ? '❌ Не понял сумму. Напишите целое число сум, например 500 000.' : null,
    problem === 'too_large' ? '⚠️ Это больше, чем можно.' : null,
    `✏️ ${question.clubName} · ${what}: ${ask}`,
    `👇 Ответьте на это сообщение суммой до ${sum(question.maxAmount)}.`,
  );
}

/** The toast when the question has been sent. */
export function amountPromptToastText(): string {
  return '✏️ Напишите сумму в ответ на вопрос ниже.';
}

/** A reply that looks like a sum but answers no open question (old, answered, or not one of the bot's). */
export function amountPromptExpiredText(): string {
  return '⌛ Этот вопрос о сумме уже не действует. Отправьте /today.';
}

const REFUSAL_TEXT: Record<OwnerBotRefusal, string> = {
  forbidden: '🚫 Нет доступа.',
  expired: '⌛ Кнопка устарела. Отправьте /today.',
  already_marked: '👌 Эти деньги уже отмечены.',
  nothing_in_till: '👌 В кассе по этому способу оплаты уже ничего нет.',
  nothing_in_bar: '👌 В баре за этот день продаж нет.',
  bar_reserve_unavailable: '⚠️ В резерв нельзя: прибыль бара за месяц уже выведена или в резерве.',
  undo_expired: '⌛ Отменить можно только в течение 10 минут. Исправьте в приложении.',
  cannot_undo: '⚠️ Это нельзя отменить из бота. Исправьте в приложении.',
  till_short: '⚠️ В кассе уже меньше денег. Отправьте /today, чтобы обновить сумму.',
  reserve_exceeds_available: '⚠️ В резерв нельзя: прибыли за месяц по этому способу оплаты меньше этой суммы.',
  day_closed: '🔒 Этот день закрыт: деньги за него уже собраны.',
  already_spent: '⚠️ Нельзя отменить: эти деньги уже потрачены, выведены или в резерве.',
};

/** The alert for a refused press. */
export function refusalText(refusal: OwnerBotRefusal): string {
  return REFUSAL_TEXT[refusal];
}

/** The alert when a press failed for another reason (the database or Telegram). */
export function pressFailedText(): string {
  return '⚠️ Не получилось. Попробуйте ещё раз через минуту.';
}

/** One club whose day could not be read; the other clubs still get their message. */
export function dayUnavailableText(clubName: string): string {
  return `⚠️ ${clubName}: не удалось прочитать день. Попробуйте /today ещё раз через минуту.`;
}

export function errorText(): string {
  return '⚠️ Не получилось ответить. Попробуйте ещё раз через минуту.';
}
