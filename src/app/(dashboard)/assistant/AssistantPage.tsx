'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileSpreadsheet, MessageSquarePlus, SendHorizontal, Sparkles, Square } from 'lucide-react';
import { DEFAULT_LIMITS } from 'hoggish-assistant';
import { useAssistantChat, type ChatEntry } from 'hoggish-assistant/react';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import { AssistantMarkdown } from '@/components/assistant/AssistantMarkdown';
import { allowedDatasets, type AssistantDataset } from '@/lib/assistant/datasets';
import { formatNumber, intlLocaleFor } from '@/lib/formatters';
import { canAccessPath } from '@/lib/permissions';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  IconButton,
  InlineAlert,
  PageHeader,
  RollingText,
  Spinner,
  Textarea,
} from '@/components/PresentationFoundation';
import { scrollBehavior } from '@/lib/scroll';

const SUGGESTIONS = ['profit', 'compare', 'products', 'excel', 'stock', 'debts', 'checks', 'upcoming', 'review', 'afford'] as const;
/** Starters shown only to members who can read every dataset they need. */
const SUGGESTION_DATASETS: Partial<Record<(typeof SUGGESTIONS)[number], readonly AssistantDataset[]>> = {
  checks: ['checks'],
  upcoming: ['upcoming'],
  review: ['summary', 'categories', 'checks', 'upcoming'],
  // Affordability needs money left, which only members who can read the money dataset get.
  afford: ['outlook', 'money'],
};
const MAX_MESSAGE_CHARS = DEFAULT_LIMITS.maxMessageChars;
/** The question box grows with its text up to this height, then scrolls. */
const INPUT_MAX_HEIGHT_PX = 240;

/** Time until the quota resets, read when the badge renders. */
function msUntil(iso: string) {
  return Math.max(0, Date.parse(iso) - Date.now());
}

export default function AssistantPage() {
  const t = useTranslations('assistant');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { selectedClubId, role, featureAccess } = useClub();
  // The same rule the server uses to offer datasets: a starter needs its data.
  const suggestions = useMemo(() => {
    const readable = new Set(allowedDatasets(role, featureAccess));
    return SUGGESTIONS.filter((key) => (SUGGESTION_DATASETS[key] ?? []).every((dataset) => readable.has(dataset)));
  }, [featureAccess, role]);
  // Links in answers open only pages this member may open; the rest stay plain text.
  const canOpen = useCallback((path: string) => canAccessPath(role, featureAccess, path), [featureAccess, role]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chat = useAssistantChat({
    api: '/api/assistant',
    usageApi: '/api/assistant/usage',
    context: { clubId: selectedClubId, locale },
    maxMessageChars: MAX_MESSAGE_CHARS,
  });
  const { messages: entries, busy, newChat, quota, model, context } = chat;

  // A conversation belongs to one club; switching clubs starts a new one.
  useEffect(() => newChat(), [selectedClubId, newChat]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: scrollBehavior() });
  }, [entries]);

  // Multi-line question box: fit the text, capped so long drafts scroll.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, INPUT_MAX_HEIGHT_PX)}px`;
  }, [draft]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || !selectedClubId) return;
    setDraft('');
    await chat.send(text);
    inputRef.current?.focus();
  }

  /** The latest question asked, for retrying a failed answer. */
  const lastQuestion = [...entries].reverse().find((entry) => entry.role === 'user')?.content ?? '';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft);
    }
  }

  function statusLabel(entry: ChatEntry) {
    if (entry.activeTool === 'export_excel') return t('preparingExcel');
    if (entry.activeTool) return t('readingData');
    return t('thinking');
  }

  /** Free-tier quota is shared across the deployment; null when not tracked. */
  const resetIn = quota ? msUntil(quota.resetsAt) : 0;
  const resetLabel = t('quota.resetsIn', {
    hours: Math.floor(resetIn / 3_600_000),
    minutes: Math.floor((resetIn % 3_600_000) / 60_000),
  });
  const quotaDetail = quota && [
    !quota.currentModel
      ? t('quota.usedUp')
      : quota.usingFallback
        ? t('quota.lighterModels')
        : t('quota.bestModel', { remaining: quota.currentModel.remaining, limit: quota.currentModel.limit }),
    resetLabel,
  ].join(' · ');

  /** Context-window use of the latest answer; unknown windows show raw tokens. */
  const contextDetail = context && (
    context.usedShare !== null && context.messagesLeft !== null
      ? t('context', {
        percent: Math.max(1, Math.round(context.usedShare * 100)),
        count: formatNumber(context.messagesLeft, intlLocaleFor(locale)),
      })
      : t('contextUnknown', { tokens: formatNumber(context.usedTokens, intlLocaleFor(locale)) })
  );

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <PageHeader
        title={t('title')}
        meta={model || quota ? (
          <div className="flex flex-wrap items-center gap-2">
            {model && (
              <Badge variant="neutral" size="sm" title={model.provider}>
                <RollingText text={t('model', { model: model.model })} />
              </Badge>
            )}
            {quota && (
              <Badge
                variant={quota.questionsLeft === 0 ? 'danger' : quota.usingFallback ? 'warning' : 'success'}
                size="sm"
                title={`${quotaDetail}. ${t('quota.note')}`}
              >
                {t('quota.questionsLeft', { count: quota.questionsLeft })}
              </Badge>
            )}
          </div>
        ) : undefined}
        action={entries.length > 0 ? (
          <Button variant="outline" size="sm" onClick={newChat} icon={<MessageSquarePlus size={16} aria-hidden="true" />}>
            {t('newChat')}
          </Button>
        ) : undefined}
      />

      <div className="flex-1 space-y-4">
        {entries.length === 0 ? (
          <Card>
            <EmptyState
              icon={Sparkles}
              title={t('emptyTitle')}
              description={t('emptyDescription')}
              compact
              action={(
                <div className="mt-2 flex max-w-2xl flex-wrap justify-center gap-2">
                  {suggestions.map((key) => (
                    <Button key={key} variant="secondary" size="sm" className="whitespace-normal text-left" onClick={() => void ask(t(`suggestions.${key}`))}>
                      {t(`suggestions.${key}`)}
                    </Button>
                  ))}
                </div>
              )}
            />
          </Card>
        ) : entries.map((entry, index) => (
          entry.role === 'user' ? (
            <div key={entry.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary-600 px-4 py-2.5 text-sm text-on-accent">
                <span className="sr-only">{t('you')}: </span>
                {entry.content}
              </div>
            </div>
          ) : (
            // Only the newest answer is announced, and only once it has finished streaming.
            <Card
              key={entry.id}
              padding="sm"
              className="max-w-full space-y-3"
              aria-live={index === entries.length - 1 ? 'polite' : undefined}
              aria-busy={index === entries.length - 1 && entry.pending ? true : undefined}
            >
              {entry.content && <AssistantMarkdown source={entry.content} canOpen={canOpen} />}
              {entry.pending && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Spinner size={14} />
                  <span>{statusLabel(entry)}</span>
                </div>
              )}
              {entry.files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {entry.files.map((file) => (
                    <ButtonLink
                      key={file.url}
                      href={file.url}
                      download={file.fileName}
                      prefetch={false}
                      variant="outline"
                      size="sm"
                      className="max-w-full"
                      icon={<FileSpreadsheet size={18} className="shrink-0 text-success-600" aria-hidden="true" />}
                      iconRight={<Download size={15} className="shrink-0 text-gray-500" aria-hidden="true" />}
                    >
                      <span className="truncate">{file.fileName}</span>
                      <span className="sr-only">{t('download')}</span>
                    </ButtonLink>
                  ))}
                </div>
              )}
              {entry.stopped && <p className="text-sm text-gray-500">{t('stopped')}</p>}
              {entry.error && (
                <InlineAlert
                  variant="danger"
                  // Asks the question behind the failed answer again; offered on the newest answer only.
                  action={index === entries.length - 1 && lastQuestion && !busy ? (
                    <Button size="sm" variant="outline" onClick={() => void ask(lastQuestion)}>{tc('retry')}</Button>
                  ) : undefined}
                >
                  {t(`errors.${entry.error}`)}
                </InlineAlert>
              )}
            </Card>
          )
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-[var(--bottom-nav,0px)] -mx-1 space-y-2 bg-gray-50 px-1 pb-2 pt-1">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            maxLength={MAX_MESSAGE_CHARS}
            rows={3}
            className="min-h-20 flex-1 resize-none overflow-y-auto"
            disabled={!selectedClubId}
          />
          {busy ? (
            <IconButton
              variant="primary"
              size="lg"
              label={t('stop')}
              icon={<Square size={16} aria-hidden="true" />}
              onClick={chat.stop}
            />
          ) : (
            <IconButton
              type="submit"
              variant="primary"
              size="lg"
              label={t('send')}
              title={t('send')}
              icon={<SendHorizontal size={18} aria-hidden="true" />}
              disabled={!draft.trim() || !selectedClubId}
            />
          )}
        </div>
        {(quotaDetail || contextDetail) && (
          <p className="text-center text-xs text-gray-600">{[quotaDetail, contextDetail].filter(Boolean).join(' · ')}</p>
        )}
        <p className="text-center text-xs text-gray-500">{t('disclaimer')}</p>
      </form>
    </div>
  );
}
