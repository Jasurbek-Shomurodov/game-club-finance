'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  InlineAlert,
  LoadErrorAlert,
  SectionHeading,
  SkeletonStatus,
} from '@/components/PresentationFoundation';
import { formatDateTime } from '@/lib/formatters';
import type { ReviewReplyRecord } from '@/lib/googleBusiness/reviews';
import { useClubQuery } from '@/lib/useClubQuery';
import { ShowcaseRowsSkeleton } from '../ShowcaseSkeletons';
import { errorMessageKey, googleBusinessApi } from './googleBusinessApi';

interface ReviewRepliesState {
  autoReply: boolean;
  replies: ReviewReplyRecord[];
  failed: string | null;
}

const EMPTY: ReviewRepliesState = { autoReply: true, replies: [], failed: null };

/** The daily auto-reply switch and the replies already posted on Google. */
export function GoogleReviewRepliesCard({ clubId, isOwner }: { clubId: string; isOwner: boolean }) {
  const t = useTranslations('googleBusiness');
  const { locale } = useAppLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<ReviewRepliesState> => {
    try {
      return { ...(await googleBusinessApi.reviewReplies(clubId)), failed: null };
    } catch (failure) {
      return { ...EMPTY, failed: errorMessageKey(failure) };
    }
  }, [clubId]);
  const query = useClubQuery(load, EMPTY);
  const { autoReply, replies, failed } = query.data;

  async function toggle(next: boolean) {
    setSaving(true);
    setError('');
    try {
      await googleBusinessApi.setAutoReply(clubId, next);
      await query.reload({ silent: true });
    } catch (failure) {
      setError(t(errorMessageKey(failure)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeading title={t('reviewsTitle')} description={t('reviewsDescription')} />
      </CardHeader>
      <CardBody className="space-y-4">
        {query.loading ? (
          <SkeletonStatus><ShowcaseRowsSkeleton rows={3} thumbnail={false} /></SkeletonStatus>
        ) : failed ? (
          <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t(failed)}</LoadErrorAlert>
        ) : (
          <>
            {isOwner ? (
              <Checkbox
                checked={autoReply}
                disabled={saving}
                onChange={(event) => void toggle(event.target.checked)}
                label={t('autoReply')}
              />
            ) : (
              <p className="text-sm text-gray-700">
                {autoReply ? t('autoReplyOn') : t('autoReplyOff')}
                <span className="block text-xs text-gray-500">{t('autoReplyHint')}</span>
              </p>
            )}
            {error && <InlineAlert variant="danger">{error}</InlineAlert>}
            {replies.length === 0 ? (
              <EmptyState compact title={t('reviewsEmpty')} />
            ) : (
              <ul className="divide-y divide-gray-100">
                {replies.map((reply) => (
                  <li key={reply.reviewName} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-gray-900">{reply.reviewerName ?? '—'}</span>
                      {reply.starRating !== null && (
                        <span className="inline-flex items-center gap-0.5 text-warning-500" aria-label={`${reply.starRating}/5`}>
                          {Array.from({ length: reply.starRating }, (_, index) => (
                            <Star key={index} size={13} fill="currentColor" aria-hidden="true" />
                          ))}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">{formatDateTime(reply.repliedAt, locale)}</span>
                    </div>
                    <p className="line-clamp-3 whitespace-pre-line text-sm text-gray-700">
                      {reply.reviewComment ?? <span className="italic text-gray-500">{t('reviewNoText')}</span>}
                    </p>
                    <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
                      <span className="mb-0.5 block text-xs font-medium text-gray-500">{t('replyLabel')}</span>
                      <span className="whitespace-pre-line">{reply.replyComment}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
