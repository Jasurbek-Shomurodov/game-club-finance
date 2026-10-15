'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCcw } from 'lucide-react';
import { Button } from './Button';
import { InlineAlert } from './InlineAlert';

export interface LoadErrorAlertProps {
  /** What failed to load, already translated. */
  children: ReactNode;
  onRetry: () => void;
  /** Disables the retry button while a load is in flight. */
  retrying?: boolean;
  title?: ReactNode;
  className?: string;
}

/** The one "could not load" banner: a danger alert with a Retry button. */
export function LoadErrorAlert({ children, onRetry, retrying = false, title, className }: LoadErrorAlertProps) {
  const tc = useTranslations('common');

  return (
    <InlineAlert
      variant="danger"
      title={title}
      className={className}
      action={(
        <Button
          size="sm"
          variant="outline"
          disabled={retrying}
          onClick={onRetry}
          icon={<RefreshCcw size={15} aria-hidden="true" />}
        >
          {tc('retry')}
        </Button>
      )}
    >
      {children}
    </InlineAlert>
  );
}
