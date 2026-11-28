import { formatDateOnly } from '../../formatters';
import { DAY_METHOD_LABELS, type DailyFinanceDayMethod, type DailyFinanceDayMethodKey } from '../dailyFinanceReport';
import { lines, sum } from '../messageParts';
import type { OwnerBotClub, OwnerBotLinkStatus } from './accounts';

/**
 * The owner money bot's Russian replies (docs/plans/owner-money-bot.md). Every
 * line starts with an emoji; amounts use the app's money format with spaces
 * between thousands ("1 200 000 сум"). Messages are plain text (no parse_mode).
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

/** One club's Game Club money per method and its bar sales on one business day. */
export interface OwnerBotDay {
  clubName: string;
  businessDate: string;
  /** The methods the daily report's payment section shows (selectDayPaymentMethods); empty when no method moved money. */
  methods: DailyFinanceDayMethod[];
  barSales: number;
}

function methodLine(item: DailyFinanceDayMethod): string {
  const base = `${DAY_METHOD_EMOJI[item.method]} ${DAY_METHOD_LABELS[item.method]}: ${sum(item.net)}`;
  // Expenses paid from this method that day: say what came in and what left, as the report does.
  return item.moneyOut === 0 ? base : `${base} (приход ${sum(item.moneyIn)}, расход ${sum(item.moneyOut)})`;
}

/** The read-only /today message for one club. */
export function dayText(day: OwnerBotDay): string {
  return lines(
    `🏢 ${day.clubName} · ${formatDateOnly(day.businessDate, 'ru')}`,
    ...(day.methods.length > 0 ? day.methods.map(methodLine) : ['📭 В клубе за этот день оплат нет.']),
    `🍺 Бар (продажи): ${sum(day.barSales)}`,
  );
}

/** One club whose day could not be read; the other clubs still get their message. */
export function dayUnavailableText(clubName: string): string {
  return `⚠️ ${clubName}: не удалось прочитать день. Попробуйте /today ещё раз через минуту.`;
}

export function errorText(): string {
  return '⚠️ Не получилось ответить. Попробуйте ещё раз через минуту.';
}
