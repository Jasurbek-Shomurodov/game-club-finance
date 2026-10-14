/**
 * PresentationFoundation
 * ----------------------
 * Every reusable presentational building block lives here. Pages should
 * compose these instead of writing bespoke Tailwind class strings.
 *
 * Layout & surfaces: Card, CardHeader, CardBody, CardFooter, SectionHeading, PageHeader, TopBarSlotProvider
 * Actions:           Button, ButtonLink, IconButton, Stepper
 * Forms:             Field, Input, CurrencyInput, Textarea, Select, Checkbox, SearchInput,
 *                    SegmentedControl, DatePicker, DateRangePicker, MonthPicker
 * Feedback:          InlineAlert, Toast/useToast, Modal, Drawer, ConfirmDialog/useConfirm, EmptyState, Disclosure,
 *                    Badge, Spinner, skeletons
 * Data display:      MetricCard, AmountCard, StatTile, DataTable
 * Misc:              LanguageSwitcher, ThemeToggle
 */
export { Avatar, initialsOf } from './Avatar';
export { ClubLogo, DEFAULT_CLUB_LOGO } from './ClubLogo';
export { Badge, type BadgeVariant } from './Badge';
export { Button, ButtonLink, buttonClassName, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { DatePicker, DateRangePicker, MonthPicker } from './CalendarPicker';
export { Card, CardBody, CardFooter, CardHeader, SectionHeading } from './Card';
export { ConfirmDialog, useConfirm } from './ConfirmDialog';
export { DataTable, type DataTableColumn } from './DataTable';
export { Disclosure, type DisclosureProps } from './Disclosure';
export { Drawer, type DrawerProps } from './Drawer';
export { EmptyState } from './EmptyState';
export {
  Checkbox,
  CurrencyInput,
  Field,
  Input,
  Select,
  Textarea,
  controlClassName,
  labelClassName,
} from './Field';
export { IconButton } from './IconButton';
export { InlineAlert, type InlineAlertVariant } from './InlineAlert';
export { LanguageSwitcher } from './LanguageSwitcher';
export { ThemeToggle } from './ThemeToggle';
export { AmountCard, MetricCard, MetricMoney, StatTile, metricToneClassName, toneForAmount, type MetricTone } from './MetricCard';
export { Modal } from './Modal';
export { PageHeader } from './PageHeader';
export { TopBarSlotProvider, useTopBarSlot } from './TopBarSlot';
export { SearchInput } from './SearchInput';
export { SegmentedControl, type SegmentedOption } from './SegmentedControl';
export {
  ChartSkeleton,
  DetailListSkeleton,
  EmployeeCardGridSkeleton,
  FormSkeleton,
  MetricGridSkeleton,
  PageSkeleton,
  Skeleton,
  TableSkeleton,
} from './Skeleton';
export { Spinner } from './Spinner';
export { Stepper } from './Stepper';
export { Toast, useToast, type ToastType } from './Toast';
export { Money } from './Money';
export { RollingText, rollingColumns } from './RollingText';
