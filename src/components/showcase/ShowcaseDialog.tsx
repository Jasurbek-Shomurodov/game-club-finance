'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ShowcaseDialogProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  closeLabel: string;
  /** The control that opened it; focus returns there, and the dialog mounts in its page root. */
  triggerRef: RefObject<HTMLElement | null>;
  /** `sheet` rises from the bottom on phones and sits centred on wider screens; `viewer` fills the screen. */
  variant?: 'sheet' | 'viewer';
  children: ReactNode;
}

/**
 * A modal for the public pages. It mounts inside the page's `.sc-root`, so it
 * keeps the page's fonts, and outside the cards, whose blur and hover
 * transforms would otherwise trap a fixed layer inside them.
 */
export function ShowcaseDialog({ open, onClose, label, closeLabel, triggerRef, variant = 'sheet', children }: ShowcaseDialogProps) {
  const [host, setHost] = useState<Element | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    setHost(trigger?.closest('.sc-root') ?? document.body);
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      root.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [open, onClose, triggerRef]);

  useEffect(() => {
    if (open && host) closeRef.current?.focus();
  }, [open, host]);

  if (!open || !host) return null;

  return createPortal(
    <div
      className={cn('sc-dialog-backdrop fixed inset-0 z-[70] flex justify-center', variant === 'sheet' ? 'items-end sm:items-center sm:p-6' : 'items-center')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'sc-sheet relative flex max-h-[100dvh] w-full flex-col',
          variant === 'sheet'
            ? 'sc-card max-h-[92dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)] sm:max-w-lg sm:rounded-3xl'
            : 'h-full',
        )}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          <X size={20} aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>,
    host,
  );
}
