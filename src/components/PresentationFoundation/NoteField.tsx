'use client';

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CheckCircle2, PencilLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MIN_NOTE_WORDS, validateEntryNote } from '@/lib/entryNote';
import { Button } from './Button';
import { Field, Textarea } from './Field';
import { Modal } from './Modal';

const MAX_AUTO_HEIGHT_PX = 320;

export interface EntryNoteGuard {
  /** True once a save was refused, so the field shows its error. */
  attempted: boolean;
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** Shows the popup and returns false when the note is too short. */
  check: (note: string) => boolean;
  /** Shows the popup for a note the server refused. */
  reject: (note: string) => void;
  /** Forget the refused attempt, e.g. after a successful save. */
  reset: () => void;
  /** Render once in the form's tree. */
  dialog: ReactNode;
}

/**
 * The required-note rule for a spending form: `if (!note.check(form.comment)) return;`
 * before saving, `<NoteField guard={note} ... />` for the input and `{note.dialog}`.
 */
export function useEntryNoteGuard(): EntryNoteGuard {
  const [attempted, setAttempted] = useState(false);
  const [dialogWords, setDialogWords] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reject = useCallback((note: string) => {
    setAttempted(true);
    setDialogWords(validateEntryNote(note).words);
  }, []);

  const check = useCallback((note: string) => {
    if (validateEntryNote(note).valid) return true;
    reject(note);
    return false;
  }, [reject]);

  const reset = useCallback(() => setAttempted(false), []);

  const close = useCallback(() => {
    setDialogWords(null);
    // After the dialog has handed focus back, move it into the note.
    window.setTimeout(() => textareaRef.current?.focus(), 60);
  }, []);

  const dialog = <NoteRequiredDialog open={dialogWords !== null} words={dialogWords ?? 0} onClose={close} />;
  return { attempted, textareaRef, check, reject, reset, dialog };
}

function NoteRequiredDialog({ open, words, onClose }: { open: boolean; words: number; onClose: () => void }) {
  const t = useTranslations('common.entryNote');
  const titleId = useId();
  return (
    <Modal
      ariaLabelledBy={titleId}
      open={open}
      onClose={onClose}
      size="sm"
      footer={<Button onClick={onClose} autoFocus icon={<PencilLine size={16} aria-hidden="true" />}>{t('dialogButton')}</Button>}
    >
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-primary-600">
          <PencilLine size={22} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold text-gray-950">{t('dialogTitle')}</h2>
          <p className="mt-1 text-sm leading-6 text-gray-600">{t('dialogBody', { required: MIN_NOTE_WORDS })}</p>
          <p className="mt-2 text-sm font-semibold text-danger-600">{t('progress', { words, required: MIN_NOTE_WORDS })}</p>
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-600">{t('example')}</p>
        </div>
      </div>
    </Modal>
  );
}

export interface NoteFieldProps {
  guard: EntryNoteGuard;
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
}

/** Required, auto-growing note with a live "2 of 5 words" count. */
export function NoteField({ guard, id, label, value, onChange, placeholder, maxLength, disabled, className }: NoteFieldProps) {
  const t = useTranslations('common.entryNote');
  const { valid, words, required } = validateEntryNote(value);
  const { textareaRef } = guard;

  // Grow with the text up to a limit, then scroll.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight + 2, MAX_AUTO_HEIGHT_PX)}px`;
  }, [textareaRef, value]);

  const hint = valid ? (
    <span className="inline-flex items-center gap-1 text-success-700">
      <CheckCircle2 size={14} aria-hidden="true" />
      {t('enough', { words })}
    </span>
  ) : t('hint', { words, required });

  return (
    <Field
      label={label}
      htmlFor={id}
      required
      className={className}
      hint={hint}
      error={guard.attempted && !valid ? t('error', { words, required }) : undefined}
    >
      <Textarea
        ref={textareaRef}
        id={id}
        rows={3}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        invalid={guard.attempted && !valid}
        aria-required="true"
        onChange={(event) => onChange(event.target.value)}
        className="resize-none overflow-y-auto"
      />
    </Field>
  );
}
