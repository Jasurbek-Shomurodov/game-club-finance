'use client';

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** danger renders a red confirm button; use it for deletes. */
  tone?: 'danger' | 'primary';
  loading?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Replacement for `window.confirm`: consistent, translated, keyboard friendly. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const tc = useTranslations('common');
  const titleId = useId();

  return (
    <Modal
      ariaLabelledBy={titleId}
      open={open}
      onClose={onCancel}
      size="sm"
      locked={loading}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? tc('cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} loadingLabel={tc('saving')} autoFocus>
            {confirmLabel ?? tc('confirm')}
          </Button>
        </>
      )}
    >
      <div className="flex gap-3">
        {tone === 'danger' ? (
          <span className="mt-0.5 shrink-0 text-danger-500">
            <TriangleAlert size={22} aria-hidden="true" />
          </span>
        ) : (
          <span className="mt-0.5 shrink-0 text-primary-600">
            <Info size={22} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold text-gray-950">{title}</h2>
          {description && <div className="mt-1 text-sm leading-6 text-gray-600">{description}</div>}
          {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-600">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: 'danger' | 'primary';
}

/**
 * Promise-based confirmation, a drop-in for `window.confirm`:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title }))) return;
 *   ...render {confirmDialog} once in the tree.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={options !== null}
      title={options?.title ?? ''}
      description={options?.description}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      tone={options?.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}
