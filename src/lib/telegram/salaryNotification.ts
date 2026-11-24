import { serverTodayIso } from '../utils';
import { authorLine, details, lines, method, noticeDate, source, sum } from './messageParts';

export type KpiSettings = { basis: 'owner_profit' | 'overall_profit' | 'game_club_income'; gameClub: boolean; bar: boolean };

export type SalaryNotificationInput = {
  addedBy: string;
  employee: string;
} & (
  | { event: 'employee_added'; role: string; salaryType: 'daily' | 'monthly'; amount: number; kpi: number; kpiSettings: KpiSettings; date: string }
  | { event: 'employee_updated'; role: string; salaryType: 'daily' | 'monthly'; amount: number; kpi: number; kpiSettings: KpiSettings; date: string }
  | { event: 'salary_changed'; salaryType: 'daily' | 'monthly'; amount: number; date?: string }
  | { event: 'kpi_changed'; kpi: number; kpiSettings: KpiSettings; date?: string }
  | { event: 'role_changed'; role: string; previousRole: string | null }
  | { event: 'deactivated'; date?: string }
  | { event: 'activated'; date?: string }
  | { event: 'payment' | 'bonus' | 'fine' | 'absence'; amount: number; date: string; comment: string | null; paymentMethod?: string | null; paymentSource?: string | null }
  | { event: 'entry_deleted'; kind: 'payment' | 'bonus' | 'fine' | 'absence'; amount: number; date: string; reason: string }
  | { event: 'rate_deleted'; effectiveDate: string; reason: string }
  | { event: 'employee_deleted'; reason: string }
);

const ROLES: Record<string, string> = { Manager: 'Менеджер', Admin: 'Админ', Cleaner: 'Уборщик' };
const PER = { daily: 'в день', monthly: 'в месяц' } as const;
const BASES = {
  owner_profit: 'от прибыли владельца (выведенные деньги)',
  overall_profit: 'от общей прибыли (ежедневно)',
  game_club_income: 'от дохода игрового клуба (ежедневно)',
} as const;
const ENTRY_TITLES = { payment: 'Зарплата', bonus: 'Премия', fine: 'Штраф' } as const;
const ENTRY_ICONS = { payment: '💵', bonus: '🎁', fine: '⚠️' } as const;
const DELETED_TITLES = { payment: 'Удалена зарплата', bonus: 'Удалена премия', fine: 'Удалён штраф', absence: 'Удалён невыход' } as const;

const salary = (amount: number, type: 'daily' | 'monthly') => `${sum(amount)} ${PER[type]}`;
const roleLabel = (role: string) => ROLES[role] ?? role;

/** "KPI 5% от прибыли владельца (выведенные деньги) · Игровой клуб + Бар", or "Без KPI". */
function kpiText(kpi: number, settings: KpiSettings) {
  if (!Number(kpi)) return 'Без KPI';
  // Game Club income KPI always draws from the Game Club alone, so its pools are implied.
  const pools = settings.basis === 'game_club_income'
    ? null
    : [settings.gameClub && 'Игровой клуб', settings.bar && 'Бар'].filter(Boolean).join(' + ');
  return details(`KPI ${Number(kpi)}% ${BASES[settings.basis]}`, pools);
}

/**
 * Line 1 names what happened, to whom and how much; line 2 holds the details
 * and always a date (the club's business date when the change gave none);
 * the last line is who did it, with their comment or reason.
 */
export function buildSalaryNotification(input: SalaryNotificationInput, today = serverTodayIso()): string {
  const by = input.addedBy;
  const from = (date: string | undefined) => `с ${noticeDate(date ?? today)}`;

  switch (input.event) {
    case 'employee_added':
    case 'employee_updated':
      return lines(
        `${input.event === 'employee_added' ? '👤 Новый сотрудник' : '✏️ Обновлён сотрудник'}: ${input.employee}`,
        details(input.role && (ROLES[input.role] ?? input.role), salary(input.amount, input.salaryType), from(input.date)),
        kpiText(input.kpi, input.kpiSettings),
        by,
      );
    case 'salary_changed':
      return lines(`💼 Новая зарплата: ${input.employee}`, details(salary(input.amount, input.salaryType), from(input.date)), by);
    case 'kpi_changed':
      return lines(`📈 Новый KPI: ${input.employee}`, details(kpiText(input.kpi, input.kpiSettings), from(input.date)), by);
    case 'role_changed':
      return lines(
        `🏷 Новая должность: ${input.employee}`,
        details(input.previousRole ? `${roleLabel(input.previousRole)} → ${roleLabel(input.role)}` : roleLabel(input.role), noticeDate(today)),
        by,
      );
    case 'deactivated':
      return lines(`⏸ Сотрудник деактивирован: ${input.employee}`, `С ${noticeDate(input.date ?? today)}`, by);
    case 'activated':
      return lines(`▶️ Сотрудник активирован: ${input.employee}`, `С ${noticeDate(input.date ?? today)}`, by);
    case 'absence':
      return lines(`🚫 Не пришёл(а) на работу: ${input.employee}`, `${noticeDate(input.date)} · без оплаты за день`, authorLine(by, input.comment));
    case 'entry_deleted':
      return lines(
        `🗑 ${DELETED_TITLES[input.kind]} ${input.employee}${input.kind === 'absence' ? '' : `: ${sum(input.amount)}`}`,
        details(noticeDate(input.date), `причина: ${input.reason}`),
        `Удалил(а) ${by}`,
      );
    case 'rate_deleted':
      return lines(
        `🗑 Удалено изменение зарплаты: ${input.employee}`,
        details(`Действовало с ${noticeDate(input.effectiveDate)}`, `причина: ${input.reason}`),
        `Удалил(а) ${by}`,
      );
    case 'employee_deleted':
      return lines(
        `🗑 Сотрудник удалён: ${input.employee}`,
        details(noticeDate(today), `причина: ${input.reason}`),
        `Удалил(а) ${by}`,
      );
    default:
      return lines(
        `${ENTRY_ICONS[input.event]} ${ENTRY_TITLES[input.event]} ${input.employee}: ${sum(input.amount)}`,
        input.event === 'payment'
          ? details(input.paymentSource && source(input.paymentSource), input.paymentMethod && method(input.paymentMethod), noticeDate(input.date))
          : noticeDate(input.date),
        authorLine(by, input.comment),
      );
  }
}
