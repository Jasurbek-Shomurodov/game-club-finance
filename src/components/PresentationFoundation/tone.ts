/**
 * One vocabulary for "what does this colour mean", shared by icon chips,
 * tappable surfaces, meters and badges, so the same meaning is the same shade
 * on every page:
 *
 *   neutral   no meaning, structure only
 *   primary   the app's accent: actions, the current thing, debts repaid
 *   success   money in, profit, done
 *   danger    money out, loss, debt
 *   warning   needs attention
 *   bar       the bar's side of the business (orange)
 *   reserve   the owner's reserve and other set-aside money (purple)
 *
 * The game club's own identity colour is `primary`.
 */
export type Tone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning' | 'bar' | 'reserve';

export interface ToneClasses {
  /** Loud text on a plain surface (a figure, a link). */
  text: string;
  /** Tinted tile behind an icon. */
  chip: string;
  /** Faint fill + hairline for a whole surface. */
  surface: string;
  /** Solid fill for a meter or a dot. */
  solid: string;
  /** Border and glow a tappable surface takes on hover. */
  hover: string;
}

export const toneClasses: Record<Tone, ToneClasses> = {
  neutral: {
    text: 'text-gray-950',
    chip: 'bg-gray-100 text-gray-600',
    surface: 'border-gray-200 bg-gray-50',
    solid: 'bg-gray-400',
    hover: 'hover:border-gray-300',
  },
  primary: {
    text: 'text-primary-700',
    chip: 'bg-primary-50 text-primary-600',
    surface: 'border-primary-100 bg-primary-50/50',
    solid: 'bg-primary-500',
    hover: 'hover:border-primary-300',
  },
  success: {
    text: 'text-success-600',
    chip: 'bg-success-50 text-success-600',
    surface: 'border-success-100 bg-success-50/50',
    solid: 'bg-success-500',
    hover: 'hover:border-success-500/50',
  },
  danger: {
    text: 'text-danger-600',
    chip: 'bg-danger-50 text-danger-600',
    surface: 'border-danger-100 bg-danger-50/50',
    solid: 'bg-danger-500',
    hover: 'hover:border-danger-400/60',
  },
  warning: {
    text: 'text-warning-600',
    chip: 'bg-warning-50 text-warning-600',
    surface: 'border-warning-100 bg-warning-50/50',
    solid: 'bg-warning-500',
    hover: 'hover:border-warning-500/50',
  },
  bar: {
    text: 'text-orange-600',
    chip: 'bg-orange-50 text-orange-600',
    surface: 'border-orange-100 bg-orange-50/50',
    solid: 'bg-orange-500',
    hover: 'hover:border-orange-500/50',
  },
  reserve: {
    text: 'text-purple-600',
    chip: 'bg-purple-50 text-purple-600',
    surface: 'border-purple-100 bg-purple-50/50',
    solid: 'bg-purple-500',
    hover: 'hover:border-purple-500/50',
  },
};
