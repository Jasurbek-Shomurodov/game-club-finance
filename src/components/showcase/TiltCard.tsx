'use client';

import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const MAX_TILT_DEGREES = 8;

/** A card that tilts towards the pointer and carries a spotlight under it. */
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      node.style.setProperty('--rx', `${(0.5 - y) * MAX_TILT_DEGREES}deg`);
      node.style.setProperty('--ry', `${(x - 0.5) * MAX_TILT_DEGREES}deg`);
      node.style.setProperty('--mx', `${x * 100}%`);
      node.style.setProperty('--my', `${y * 100}%`);
    });
  }

  function handleLeave() {
    cancelAnimationFrame(frame.current);
    ref.current?.style.setProperty('--rx', '0deg');
    ref.current?.style.setProperty('--ry', '0deg');
  }

  return (
    <div ref={ref} onPointerMove={handleMove} onPointerLeave={handleLeave} className={cn('sc-game', className)}>
      {children}
    </div>
  );
}
