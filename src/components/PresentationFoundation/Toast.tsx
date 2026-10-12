'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, X, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  durationMs?: number;
}

/**
 * Transient notification: top of the screen on phones (so it never covers a
 * bottom-sheet's Save button), bottom-right on larger screens. Errors stay
 * longer, and the timer pauses while hovered or focused.
 */
export function Toast({ message, type, onClose, durationMs }: ToastProps) {
  const tc = useTranslations('common');
  const [paused, setPaused] = useState(false);
  const duration = durationMs ?? (type === 'error' ? 8000 : 3500);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose, paused]);

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'fixed left-4 right-4 top-[max(1rem,env(safe-area-inset-top))] z-[90] flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-pop sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:left-auto sm:top-auto sm:max-w-sm',
        type === 'success' ? 'bg-gray-950 text-gray-50' : 'bg-danger-600 text-on-accent',
      )}
    >
      {type === 'success' ? <CheckCircle size={18} className="text-success-500" aria-hidden="true" /> : <XCircle size={18} aria-hidden="true" />}
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onClose} aria-label={tc('close')} className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
        <X size={16} />
      </button>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: ToastType; key: number } | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToast({ message, type, key: Date.now() });
  }, []);

  const hideToast = useCallback(() => setToast(null), []);

  /** Render once near the end of the page tree. */
  const toastElement = toast ? (
    <Toast key={toast.key} message={toast.message} type={toast.type} onClose={hideToast} />
  ) : null;

  return { toast, showToast, hideToast, toastElement };
}
