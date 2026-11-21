'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/PresentationFoundation';

/** What a form tells the dialog that hosts it, so the footer's Save button mirrors it. */
export interface ModalFormState {
  saving: boolean;
  /** Saving is not possible right now (nothing to save, a closed day, no balance). */
  disabled: boolean;
}

/**
 * Props a recording form accepts so it can sit in a `Modal` with Cancel and
 * Save in the footer. Without `formId` the form keeps its own submit button
 * (when it is a section of a page, not a dialog).
 */
export interface ModalFormProps {
  formId?: string;
  onFormState?: (state: ModalFormState) => void;
}

/** Reports the form's state to its dialog whenever it changes. */
export function useReportFormState(onFormState: ModalFormProps['onFormState'], saving: boolean, disabled: boolean) {
  useEffect(() => {
    onFormState?.({ saving, disabled });
  }, [onFormState, saving, disabled]);
}

/**
 * The dialog's side: `formProps` go to the form, `footer` to `Modal footer`
 * (Cancel, then the form's submit button), and `saving` to `Modal locked`.
 */
export function useModalForm({ submitLabel, icon, onCancel }: { submitLabel: ReactNode; icon?: ReactNode; onCancel: () => void }) {
  const tc = useTranslations('common');
  const formId = useId();
  const [state, setState] = useState<ModalFormState>({ saving: false, disabled: false });
  const onFormState = useCallback((next: ModalFormState) => {
    setState((current) => (current.saving === next.saving && current.disabled === next.disabled ? current : next));
  }, []);
  const footer = (
    <>
      <Button variant="secondary" onClick={onCancel} disabled={state.saving}>{tc('cancel')}</Button>
      <Button type="submit" form={formId} disabled={state.disabled} loading={state.saving} loadingLabel={tc('saving')} icon={icon}>{submitLabel}</Button>
    </>
  );
  return { formProps: { formId, onFormState } satisfies ModalFormProps, footer, saving: state.saving };
}
