'use client';

import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IconButton } from './IconButton';
import { Modal } from './Modal';

/**
 * A small "?" beside a heading. Tapping it opens a dialog that explains the
 * section; a blank line in `body` starts a new paragraph.
 */
export function HelpButton({ title, body, className }: { title: string; body: string; className?: string }) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        variant="ghost"
        size="sm"
        className={className}
        label={t('aboutSection', { title })}
        icon={<CircleHelp size={16} aria-hidden="true" />}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      />
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="md">
        <div className="space-y-3 text-sm leading-6 text-gray-700">
          {body.split(/\n\s*\n/).map((paragraph) => <p key={paragraph}>{paragraph.trim()}</p>)}
        </div>
      </Modal>
    </>
  );
}
