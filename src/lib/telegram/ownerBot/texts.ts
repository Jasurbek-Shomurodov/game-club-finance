import { formatDateOnly } from '../../formatters';
import { DAY_METHOD_LABELS, type DailyFinanceDayMethod, type DailyFinanceDayMethodKey } from '../dailyFinanceReport';
import { lines, sum } from '../messageParts';
import type { OwnerBotClub, OwnerBotLinkStatus } from './accounts';
import type { OwnerBotActionResult, OwnerBotChoiceAction, OwnerBotHandoverAction, OwnerBotRefusal } from './actions';
import type { OwnerBotDayView, OwnerBotLine, OwnerBotLineStatus } from './dayView';

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
  back: '⬅️ Назад',
  yes: '✅ Да',
  no: '✖️ Нет',
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
};

function lineText(line: OwnerBotLine): string {
  // The day's own figure when the till (or what was marked) differs from it.
  const dayFigure = line.amount === line.dayNet ? '' : ` (за день ${sum(line.dayNet)})`;
  return `${methodName(line.method)}: ${sum(line.amount)}${dayFigure} · ${LINE_STATUS[line.status]}`;
}

/** The /today message for one club: one line per Game Club method, the bar's sales and what the admin still holds. */
export function dayText(view: OwnerBotDayView): string {
  return lines(
    `🏢 ${view.clubName} · ${formatDateOnly(view.businessDate, 'ru')}`,
    ...(view.lines.length > 0 ? view.lines.map(lineText) : ['📭 В клубе за этот день оплат нет.']),
    `🍺 Бар (продажи): ${sum(view.barSales)}`,
    `👛 Осталось у администратора: ${sum(view.tillTotal)}`,
  );
}

/** The day message with a question under it (the submenu or the confirmation). */
function withQuestion(view: OwnerBotDayView, question: string): string {
  return `${dayText(view)}\n\n${question}`;
}

/** After a method's button: what happened to that money. */
export function methodMenuText(view: OwnerBotDayView, line: OwnerBotLine): string {
  return withQuestion(view, `👉 ${methodName(line.method)}: ${sum(line.amount)}. Что сделали с этими деньгами?`);
}

/** Before saving: the amount fixed when the owner chose. */
export function confirmText(
  view: OwnerBotDayView,
  choice: { method: DailyFinanceDayMethodKey; action: OwnerBotChoiceAction; amount: number },
): string {
  const what = `${sum(choice.amount)} · ${methodName(choice.method)} · ${view.clubName}`;
  return withQuestion(view, choice.action === 'reserve'
    ? `🏦 Переместить в резерв ${what}?`
    : `✅ Отметить, что вы забрали ${what}?`);
}

/** The undo button's label. */
export function undoButtonText(undo: { method: DailyFinanceDayMethodKey; action: OwnerBotHandoverAction }): string {
  const method = METHOD_IN_SENTENCE[undo.method];
  if (undo.action === 'reserve') return `↩️ Отменить: ${method} в резерв`;
  if (undo.action === 'withdrawn') return `↩️ Отменить: ${method} себе`;
  return `↩️ Отменить: забрал ${method}`;
}

/** The toast after a saved or undone press (a repeat of the same press says the same). */
export function resultToastText(result: OwnerBotActionResult): string {
  const what = `${DAY_METHOD_LABELS[result.method]} ${sum(result.amount)}`;
  if (result.status === 'undone') return `↩️ Отменено: ${what}`;
  // A repeated press (a resent ✅ Да or ↩️) after the mark was undone.
  if (result.status === 'already_undone') return `↩️ Уже отменено: ${what}`;
  if (result.action === 'reserve') return `🏦 В резерве: ${what}`;
  return `✅ Забрал: ${what}`;
}

const REFUSAL_TEXT: Record<OwnerBotRefusal, string> = {
  forbidden: '🚫 Нет доступа.',
  expired: '⌛ Кнопка устарела. Отправьте /today.',
  already_marked: '👌 Эти деньги уже отмечены.',
  nothing_in_till: '👌 В кассе по этому способу оплаты уже ничего нет.',
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
