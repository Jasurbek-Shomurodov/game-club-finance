'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { isTopModal, trapFocus, useFocusOrigin, useModalLayer } from './Modal';
import { backdropMotion, slideMotion, usePresence } from './motion';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Edge the panel slides in from. */
  side?: 'left' | 'right';
  title?: ReactNode;
  description?: ReactNode;
  /** Accessible name when there is no visible `title`. */
  ariaLabel?: string;
  /** Sticky footer, usually actions. */
  footer?: ReactNode;
  id?: string;
  /** Classes for the full-screen layer, e.g. `lg:hidden` for the navigation drawer. */
  className?: string;
  panelClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Off-canvas panel that slides in from a screen edge over a fading backdrop,
 * and slides back out before unmounting. A real modal dialog: focus moves in
 * and is trapped, Escape and the backdrop close it, the page behind does not
 * scroll, and focus returns where it was. Motion is skipped for users who
 * prefer reduced motion.
 */
export function Drawer({
  open,
  onClose,
  side = 'right',
  title,
  description,
  ariaLabel,
  footer,
  id,
  className,
  panelClassName,
  bodyClassName,
  children,
}: DrawerProps) {
  const tc = useTranslations('common');
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { mounted, visible } = usePresence(open);
  const layerId = useModalLayer(open);
  const focusOrigin = useFocusOrigin(open);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>('[data-autofocus], [aria-current="page"]') ?? panel)?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopModal(layerId)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      trapFocus(event, panelRef.current);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      focusOrigin?.focus?.({ preventScroll: true });
    };
  }, [focusOrigin, layerId, open]);

  if (!mounted) return null;

  return createPortal(
    <div className={cn('fixed inset-0 z-[60]', !open && 'pointer-events-none', className)}>
      <div
        className={cn('absolute inset-0 bg-black/40 backdrop-blur-[2px]', backdropMotion(visible))}
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 flex w-full max-w-md flex-col bg-surface shadow-pop outline-none',
          side === 'left' ? 'left-0' : 'right-0',
          slideMotion(visible, side),
          panelClassName,
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="min-w-0">
              {title && <h2 id={titleId} className="break-words text-lg font-bold tracking-tight text-gray-950">{title}</h2>}
              {description && <div id={descriptionId} className="mt-1 text-sm text-gray-500">{description}</div>}
            </div>
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              aria-label={tc('close')}
              className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', (title || description) && 'px-5 py-4', bodyClassName)}>{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50/80 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
