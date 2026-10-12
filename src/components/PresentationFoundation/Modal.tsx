'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { backdropMotion, sheetMotion, useHeldWhileClosing, usePresence } from './motion';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  /** Sticky footer, usually the action buttons. */
  footer?: ReactNode;
  /** Prevent closing via backdrop, Escape and the X button (while saving). */
  locked?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Accessible name when there is no visible `title` (e.g. confirm dialogs render their own heading). */
  ariaLabelledBy?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Open dialogs, innermost last. Only the top dialog reacts to Escape and owns
 * the focus trap, so a confirm dialog or date picker opened over a form modal
 * closes on its own without discarding the form underneath.
 */
const modalStack: symbol[] = [];

export function isTopModal(id: symbol) {
  return modalStack[modalStack.length - 1] === id;
}

/** Registers a dialog layer for the lifetime of `open`; returns its stack id. */
export function useModalLayer(open: boolean) {
  const [id] = useState(() => Symbol('modal'));
  useEffect(() => {
    if (!open) return;
    modalStack.push(id);
    return () => {
      const index = modalStack.lastIndexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, [id, open]);
  return id;
}

function focusedElement(): HTMLElement | null {
  return typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
}

/**
 * The element that had focus when `open` became true, to give focus back to on
 * close. It is read while rendering, before React commits the dialog, because
 * an `autoFocus` control inside the dialog (the confirm button) takes focus
 * during the commit, before any effect could look.
 */
export function useFocusOrigin(open: boolean): HTMLElement | null {
  const [origin, setOrigin] = useState<HTMLElement | null>(() => (open ? focusedElement() : null));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOrigin(focusedElement());
  }
  return origin;
}

/** Keeps Tab / Shift+Tab inside `container` while it is the top dialog. */
export function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== 'Tab' || !container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Accessible dialog: bottom sheet on phones, centered card on larger screens.
 * Handles Escape, backdrop click, body scroll lock, and initial focus. It
 * slides up (phones) or fades and scales in, and plays the reverse on close
 * while still showing its last open content.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  locked = false,
  children,
  className,
  bodyClassName,
  ariaLabelledBy,
}: ModalProps) {
  const tc = useTranslations('common');
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const layerId = useModalLayer(open);
  const focusOrigin = useFocusOrigin(open);
  const { mounted, visible } = usePresence(open);
  const content = useHeldWhileClosing(open, { title, description, footer, children });
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTarget = panelRef.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-modal-close])',
    );
    (focusTarget ?? panelRef.current)?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
      focusOrigin?.focus?.({ preventScroll: true });
    };
  }, [focusOrigin, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!isTopModal(layerId)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!locked) onCloseRef.current();
        return;
      }
      trapFocus(event, panelRef.current);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [layerId, locked, open]);

  if (!mounted) return null;

  function requestClose() {
    if (open && !locked) onClose();
  }

  return (
    <div
      className={cn('fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4', !open && 'pointer-events-none')}
      aria-hidden={!open || undefined}
    >
      <div
        className={cn('absolute inset-0 bg-black/40 backdrop-blur-[2px]', backdropMotion(visible))}
        onMouseDown={requestClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={content.title ? titleId : ariaLabelledBy}
        aria-describedby={content.description ? descriptionId : undefined}
        aria-busy={locked || undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-pop outline-none sm:rounded-2xl',
          sizeClasses[size],
          sheetMotion(visible),
          className,
        )}
      >
        {(content.title || content.description) && (
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              {content.title && <h2 id={titleId} className="text-lg font-bold tracking-tight text-gray-950">{content.title}</h2>}
              {content.description && <p id={descriptionId} className="mt-1 text-sm text-gray-500">{content.description}</p>}
            </div>
            <button
              type="button"
              data-modal-close
              onClick={requestClose}
              disabled={locked}
              aria-label={tc('close')}
              className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6', bodyClassName)}>{content.children}</div>
        {content.footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50/80 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6">
            {content.footer}
          </div>
        )}
      </div>
    </div>
  );
}
