'use client';

import type { ReactNode } from 'react';
import { Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/PresentationFoundation';
import ExpenseRegistrationForm from './ExpenseRegistrationForm';
import { useModalForm } from './modalForm';

/** The expense form as a dialog: the form in the body, Cancel and Save in the footer. */
export function ExpenseModal({ open, onClose, onSaved, title, description, defaultFromReserve }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** Replaces "Register expense" (the Reserve page's "Pay from reserve"). */
  title?: ReactNode;
  description?: ReactNode;
  /** Opens already paying from the owner reserve. */
  defaultFromReserve?: boolean;
}) {
  const t = useTranslations('expenses');
  const tr = useTranslations('reports');
  const { formProps, footer, saving } = useModalForm({ submitLabel: t('submit'), icon: <Save size={18} aria-hidden="true" />, onCancel: onClose });
  return (
    <Modal open={open} onClose={onClose} locked={saving} title={title ?? tr('registerExpense')} description={description} size="xl" footer={footer}>
      <ExpenseRegistrationForm {...formProps} defaultFromReserve={defaultFromReserve} onSaved={onSaved} />
    </Modal>
  );
}
