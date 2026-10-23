import { formatCurrency, formatDateShort } from '../formatters';

export type KpiSettings = { basis: 'owner_profit' | 'overall_profit'; gameClub: boolean; bar: boolean };

export type SalaryNotificationInput = {
  addedBy: string;
  employee: string;
} & (
  | { event: 'employee_added'; role: string; salaryType: 'daily' | 'monthly'; amount: number; kpi: number; kpiSettings: KpiSettings; date: string }
  | { event: 'employee_updated'; role: string; salaryType: 'daily' | 'monthly'; amount: number; kpi: number; kpiSettings: KpiSettings; date: string }
  | { event: 'salary_changed'; salaryType: 'daily' | 'monthly'; amount: number }
  | { event: 'kpi_changed'; kpi: number; kpiSettings: KpiSettings }
  | { event: 'deactivated' }
  | { event: 'activated' }
  | { event: 'payment' | 'bonus' | 'fine'; amount: number; date: string; comment: string | null; paymentMethod?: string | null; paymentSource?: string | null }
  | { event: 'entry_deleted'; kind: 'payment' | 'bonus' | 'fine'; amount: number; date: string; reason: string }
  | { event: 'rate_deleted'; effectiveDate: string; reason: string }
);

const METHODS: Record<string, string> = { cash: 'Наличные', terminal: 'Терминал', card: 'Карта' };
const SOURCES: Record<string, string> = { game_club: 'Игровой клуб', bar: 'Бар' };
const ROLES: Record<string, string> = { Manager: 'Менеджер', Admin: 'Админ', Cleaner: 'Уборщик' };
const SALARY_TYPES = { daily: 'Дневная зарплата', monthly: 'Месячная зарплата' } as const;
const money = (value: number) => `${formatCurrency(value)} сум`;
const percent = (value: number) => `${Number(value)}%`;
const BASES = { owner_profit: 'Прибыль владельца (выведенные деньги)', overall_profit: 'Общая прибыль (ежедневно)' } as const;
const kpiLines = (kpi: number, settings: KpiSettings) => {
  const pools = [settings.gameClub && 'Игровой клуб', settings.bar && 'Бар'].filter(Boolean).join(' + ');
  return [`KPI: ${percent(kpi)}`, `База KPI: ${BASES[settings.basis]}`, `Источник прибыли: ${pools}`];
};

export function buildSalaryNotification(input: SalaryNotificationInput): string {
  const head = (title: string) => [title, '', `Сотрудник: ${input.employee}`];
  let lines: string[];

  switch (input.event) {
    case 'employee_added':
    case 'employee_updated':
      lines = head(input.event === 'employee_added' ? '👤 Добавлен сотрудник' : '✏️ Обновлён сотрудник');
      if (input.role) lines.push(`Должность: ${ROLES[input.role] ?? input.role}`);
      lines.push(`${SALARY_TYPES[input.salaryType]}: ${money(input.amount)}`, ...kpiLines(input.kpi, input.kpiSettings),
        `${input.event === 'employee_added' ? 'Начало работы' : 'Действует с'}: ${formatDateShort(input.date, 'ru')}`);
      break;
    case 'salary_changed':
      lines = [...head('💼 Изменена зарплата'), `${SALARY_TYPES[input.salaryType]}: ${money(input.amount)}`];
      break;
    case 'kpi_changed':
      lines = [...head('📈 Изменён KPI'), ...kpiLines(input.kpi, input.kpiSettings)];
      break;
    case 'deactivated':
      lines = head('⏸ Сотрудник деактивирован');
      break;
    case 'activated':
      lines = head('▶️ Сотрудник активирован');
      break;
    case 'entry_deleted': {
      const title = input.kind === 'payment' ? '🗑 Удалена выплата зарплаты' : input.kind === 'bonus' ? '🗑 Удалена премия' : '🗑 Удалён штраф';
      lines = [...head(title), `Сумма: ${money(input.amount)}`, `Дата: ${formatDateShort(input.date, 'ru')}`, `Причина: ${input.reason}`];
      break;
    }
    case 'rate_deleted':
      lines = [...head('🗑 Удалено изменение зарплаты'), `Действовало с: ${formatDateShort(input.effectiveDate, 'ru')}`, `Причина: ${input.reason}`];
      break;
    default: {
      const title = input.event === 'payment' ? '💵 Выплата зарплаты' : input.event === 'bonus' ? '🎁 Премия' : '⚠️ Штраф';
      lines = [...head(title), `Сумма: ${money(input.amount)}`];
      if (input.event === 'payment') {
        if (input.paymentSource) lines.push(`Источник: ${SOURCES[input.paymentSource] ?? input.paymentSource}`);
        if (input.paymentMethod) lines.push(`Способ оплаты: ${METHODS[input.paymentMethod] ?? input.paymentMethod}`);
      }
      lines.push(`Дата: ${formatDateShort(input.date, 'ru')}`);
      if (input.comment) lines.push(`Комментарий: ${input.comment}`);
    }
  }
  lines.push(`Добавил(а): ${input.addedBy}`);
  return lines.join('\n');
}
