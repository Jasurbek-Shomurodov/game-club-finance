'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileSpreadsheet, MessageSquarePlus, SendHorizontal, Sparkles, Square } from 'lucide-react';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import { AssistantMarkdown } from '@/components/assistant/AssistantMarkdown';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  InlineAlert,
  PageHeader,
  Spinner,
  Textarea,
} from '@/components/PresentationFoundation';
import { isAssistantErrorCode, parseEventChunk, type AssistantEvent } from '@/lib/assistant/events';
import type { GeminiQuotaSummary } from '@/lib/assistant/geminiQuota';
import { MAX_MESSAGE_CHARS, trimHistory } from '@/lib/assistant/request';

type ErrorKey = Parameters<ReturnType<typeof useTranslations<'assistant.errors'>>>[0];

interface ChatFile {
  fileName: string;
  url: string;
}

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  files: ChatFile[];
  pending?: boolean;
  activeTool?: string;
  error?: ErrorKey;
  stopped?: boolean;
}

const SUGGESTIONS = ['profit', 'compare', 'products', 'excel', 'stock', 'debts'] as const;

function base64ToBlob(data: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

export default function AssistantPage() {
  const t = useTranslations('assistant');
  const { locale } = useAppLocale();
  const { selectedClubId } = useClub();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<GeminiQuotaSummary | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileUrlsRef = useRef<string[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    fileUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    fileUrlsRef.current = [];
    setEntries([]);
    setBusy(false);
  }, []);

  // A conversation belongs to one club; switching clubs starts a new one.
  useEffect(() => resetChat, [selectedClubId, resetChat]);

  /** Free-tier quota is shared across the deployment; null when not tracked. */
  const loadQuota = useCallback(async (clubId: string) => {
    try {
      const response = await fetch(`/api/assistant/usage?clubId=${encodeURIComponent(clubId)}`, { cache: 'no-store' });
      const payload = response.ok ? await response.json() as { quota: GeminiQuotaSummary | null } : null;
      setQuota(payload?.quota ?? null);
    } catch {
      setQuota(null);
    }
  }, []);

  useEffect(() => {
    setQuota(null);
    if (selectedClubId) void loadQuota(selectedClubId);
  }, [selectedClubId, loadQuota]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [entries]);

  const updateAssistant = useCallback((id: string, update: (entry: ChatEntry) => ChatEntry) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? update(entry) : entry)));
  }, []);

  const applyEvent = useCallback((id: string, event: AssistantEvent) => {
    switch (event.type) {
      case 'text':
        updateAssistant(id, (entry) => ({ ...entry, content: entry.content + event.text, activeTool: undefined }));
        break;
      case 'tool':
        updateAssistant(id, (entry) => ({ ...entry, activeTool: event.name }));
        break;
      case 'file': {
        const url = URL.createObjectURL(base64ToBlob(event.data, event.mimeType));
        fileUrlsRef.current.push(url);
        updateAssistant(id, (entry) => ({ ...entry, files: [...entry.files, { fileName: event.fileName, url }] }));
        break;
      }
      case 'error':
        updateAssistant(id, (entry) => ({ ...entry, error: event.code }));
        break;
      case 'done':
        break;
    }
  }, [updateAssistant]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || !selectedClubId) return;

    const history = trimHistory([
      ...entries
        .filter((entry) => entry.content.trim())
        .map((entry) => ({ role: entry.role, content: entry.content.slice(0, MAX_MESSAGE_CHARS) })),
      { role: 'user' as const, content: text },
    ]);
    const assistantId = crypto.randomUUID();
    setEntries((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content: text, files: [] },
      { id: assistantId, role: 'assistant', content: '', files: [], pending: true },
    ]);
    setDraft('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubId: selectedClubId, locale, messages: history }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        updateAssistant(assistantId, (entry) => ({
          ...entry,
          error: isAssistantErrorCode(payload?.error) ? payload.error : 'SERVER_ERROR',
        }));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const { events, rest } = parseEventChunk(done ? `${buffer}\n` : buffer);
        buffer = rest;
        events.forEach((event) => applyEvent(assistantId, event));
        if (done) break;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        updateAssistant(assistantId, (entry) => ({ ...entry, stopped: true }));
      } else {
        console.error('[assistant] request failed', error);
        updateAssistant(assistantId, (entry) => ({ ...entry, error: 'NETWORK' }));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
      updateAssistant(assistantId, (entry) => ({ ...entry, pending: false, activeTool: undefined }));
      inputRef.current?.focus();
      void loadQuota(selectedClubId);
    }
  }

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

  const resetIn = quota ? Math.max(0, Date.parse(quota.resetsAt) - Date.now()) : 0;
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

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <PageHeader
        title={t('title')}
        meta={quota ? (
          <Badge
            variant={quota.questionsLeft === 0 ? 'danger' : quota.usingFallback ? 'warning' : 'success'}
            size="sm"
            title={`${quotaDetail}. ${t('quota.note')}`}
          >
            {t('quota.questionsLeft', { count: quota.questionsLeft })}
          </Badge>
        ) : undefined}
        action={entries.length > 0 ? (
          <Button variant="outline" size="sm" onClick={resetChat} icon={<MessageSquarePlus size={16} aria-hidden="true" />}>
            {t('newChat')}
          </Button>
        ) : undefined}
      />

      <div className="flex-1 space-y-4" aria-live="polite">
        {entries.length === 0 ? (
          <Card>
            <EmptyState
              icon={Sparkles}
              title={t('emptyTitle')}
              description={t('emptyDescription')}
              compact
              action={(
                <div className="mt-2 flex max-w-2xl flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((key) => (
                    <Button key={key} variant="secondary" size="sm" className="whitespace-normal text-left" onClick={() => void ask(t(`suggestions.${key}`))}>
                      {t(`suggestions.${key}`)}
                    </Button>
                  ))}
                </div>
              )}
            />
          </Card>
        ) : entries.map((entry) => (
          entry.role === 'user' ? (
            <div key={entry.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary-600 px-4 py-2.5 text-sm text-on-accent">
                <span className="sr-only">{t('you')}: </span>
                {entry.content}
              </div>
            </div>
          ) : (
            <Card key={entry.id} padding="sm" className="max-w-full space-y-3">
              {entry.content && <AssistantMarkdown source={entry.content} />}
              {entry.pending && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Spinner size={14} />
                  <span>{statusLabel(entry)}</span>
                </div>
              )}
              {entry.files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {entry.files.map((file) => (
                    <a
                      key={file.url}
                      href={file.url}
                      download={file.fileName}
                      className="inline-flex max-w-full items-center gap-2 rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <FileSpreadsheet size={18} className="shrink-0 text-emerald-600" aria-hidden="true" />
                      <span className="truncate">{file.fileName}</span>
                      <Download size={15} className="shrink-0 text-gray-500" aria-hidden="true" />
                      <span className="sr-only">{t('download')}</span>
                    </a>
                  ))}
                </div>
              )}
              {entry.stopped && <p className="text-sm text-gray-500">{t('stopped')}</p>}
              {entry.error && <InlineAlert variant="danger">{t(`errors.${entry.error}`)}</InlineAlert>}
            </Card>
          )
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 -mx-1 space-y-2 bg-gray-50 px-1 pb-2 pt-1">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            maxLength={MAX_MESSAGE_CHARS}
            rows={1}
            className="min-h-11 flex-1 resize-none"
            disabled={!selectedClubId}
          />
          {busy ? (
            <IconButton
              label={t('stop')}
              icon={<Square size={16} aria-hidden="true" />}
              onClick={() => abortRef.current?.abort()}
              className="h-11 w-11"
            />
          ) : (
            <Button
              type="submit"
              aria-label={t('send')}
              title={t('send')}
              icon={<SendHorizontal size={18} aria-hidden="true" />}
              disabled={!draft.trim() || !selectedClubId}
              className="h-11 w-11 px-0"
            />
          )}
        </div>
        {quotaDetail && <p className="text-center text-xs text-gray-600">{quotaDetail}</p>}
        <p className="text-center text-xs text-gray-500">{t('disclaimer')}</p>
      </form>
    </div>
  );
}
