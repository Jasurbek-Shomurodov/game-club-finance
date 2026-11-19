import type { ElementType } from 'react';
import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from './tone';

const SIZES = {
  xs: { box: 'h-6 w-6 rounded-md', icon: 13 },
  sm: { box: 'h-7 w-7 rounded-lg', icon: 14 },
  md: { box: 'h-9 w-9 rounded-xl', icon: 17 },
  lg: { box: 'h-11 w-11 rounded-2xl', icon: 20 },
} as const;

export type IconChipSize = keyof typeof SIZES;

/**
 * An icon on a tinted tile: the one way a card, a row or a heading shows what
 * it is about. The tone carries meaning (see `tone.ts`); inside a tappable
 * surface (`group`) the tile brightens a little on hover. Decorative: the text
 * beside it names the thing.
 */
export function IconChip({ icon: Icon, tone = 'neutral', size = 'md', className }: {
  icon: ElementType;
  tone?: Tone;
  size?: IconChipSize;
  className?: string;
}) {
  const { box, icon } = SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none',
        box,
        toneClasses[tone].chip,
        className,
      )}
    >
      <Icon size={icon} strokeWidth={2.1} />
    </span>
  );
}
