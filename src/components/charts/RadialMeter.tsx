import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A ring that fills to `value` (0-1, clamped) around a short label: margins,
 * month progress, share withdrawn. The figure in the middle is the reading,
 * so the ring is decoration for a number that is always printed.
 */
export function RadialMeter({ value, color, children, size = 64, stroke = 7, className, label }: {
  value: number | null;
  color: string;
  children?: ReactNode;
  size?: number;
  stroke?: number;
  className?: string;
  /** Accessible name, e.g. "Bar margin 16%". */
  label: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = value === null ? 0 : Math.min(1, Math.max(0, value));
  return (
    <div role="img" aria-label={label} className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--c-gray-200))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">{children}</div>
    </div>
  );
}
