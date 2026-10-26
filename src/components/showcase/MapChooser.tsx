'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, MapPinned } from 'lucide-react';
import type { MapLinks } from '@/lib/showcase';

interface MapChooserProps {
  address: string;
  links: MapLinks;
  labels: { title: string; yandex: string; google: string };
}

const MENU_WIDTH = 240;
const MENU_HEIGHT = 150;
const GAP = 8;

/** Fixed position beside the button: below it, or above when the viewport has no room below. */
function menuPosition(button: HTMLElement): CSSProperties {
  const rect = button.getBoundingClientRect();
  const left = Math.min(Math.max(rect.left, GAP), window.innerWidth - MENU_WIDTH - GAP);
  return rect.bottom + GAP + MENU_HEIGHT > window.innerHeight
    ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + GAP, width: MENU_WIDTH }
    : { position: 'fixed', left, top: rect.bottom + GAP, width: MENU_WIDTH };
}

/**
 * The club address as a button that asks which map to open it in. The menu
 * is portalled to <body> so the rounded, clipped cards around the address
 * never cut it off.
 */
export function MapChooser({ address, links, labels }: MapChooserProps) {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const open = position !== null;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    // A fixed menu would drift away from the address while the page moves.
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    menuRef.current?.querySelector('a')?.focus();
    return () => {
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const options = [
    { href: links.yandex, label: labels.yandex, dot: 'bg-[#fc3f1d]' },
    { href: links.google, label: labels.google, dot: 'bg-[#34a853]' },
  ];

  return (
    <span className="inline-block max-w-full">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => setPosition(open ? null : menuPosition(event.currentTarget))}
        className="text-left underline decoration-white/20 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
      >
        {address}
      </button>
      {position && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          style={position}
          className="sc-panel-in z-[60] rounded-2xl border border-white/10 bg-[#0d0d1a]/95 p-1.5 font-sans shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)] backdrop-blur-xl"
        >
          <span className="flex items-center gap-2 px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
            <MapPinned size={13} aria-hidden="true" /> {labels.title}
          </span>
          {options.map((option) => (
            <a
              key={option.href}
              role="menuitem"
              href={option.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPosition(null)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${option.dot}`} aria-hidden="true" />
              <span className="flex-1">{option.label}</span>
              <ExternalLink size={14} className="text-white/40" aria-hidden="true" />
            </a>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
