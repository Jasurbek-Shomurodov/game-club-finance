'use client';

// Route: /showcase/games

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, CheckCheck, Gamepad2, Plus, X } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  LoadErrorAlert,
  PageHeader,
  PageSkeleton,
  SearchInput,
  SegmentedControl,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { canAccessFeature } from '@/lib/permissions';
import { nextSortOrder } from '@/lib/showcase';
import { buildGameLibrary, diffGameSelection, filterLibrary, gameKey, libraryGenres, type LibraryGame } from '@/lib/showcaseGameLibrary';
import { createClient } from '@/lib/supabase/client';
import { fetchShowcaseGamesForClubs } from '@/lib/supabase/showcase';
import { useClubQuery } from '@/lib/useClubQuery';
import { cn } from '@/lib/utils';
import type { ShowcaseGame } from '@/types';
import { ShowcaseTabs } from '../ShowcaseTabs';
import { NewGameModal } from './NewGameModal';

interface LibraryData {
  games: ShowcaseGame[];
}

const EMPTY: LibraryData = { games: [] };
const ALL_GENRES = '__all__';

export default function GameLibraryPage() {
  const t = useTranslations('showcase');
  const tc = useTranslations('common');
  const { selectedClubId, memberships, role, featureAccess } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const canEdit = canAccessFeature(role, featureAccess, 'showcase');

  // Every club whose public page this person may edit feeds the library.
  const editableClubIds = useMemo(
    () => memberships.filter((membership) => canAccessFeature(membership.role, membership.featureAccess, 'showcase')).map((membership) => membership.club.id),
    [memberships],
  );
  const editableKey = editableClubIds.join(',');

  const load = useCallback(async (): Promise<LibraryData> => {
    if (!selectedClubId) return EMPTY;
    const ids = editableKey ? editableKey.split(',') : [selectedClubId];
    const { data, error } = await fetchShowcaseGamesForClubs(createClient(), ids.includes(selectedClubId) ? ids : [...ids, selectedClubId]);
    if (error) throw new Error('Game library load failed');
    return { games: data ?? [] };
  }, [selectedClubId, editableKey]);
  const query = useClubQuery(load, EMPTY);
  const { games } = query.data;

  const library = useMemo(() => buildGameLibrary(games), [games]);
  const clubGames = useMemo(() => games.filter((game) => game.club_id === selectedClubId), [games, selectedClubId]);
  const savedKeys = useMemo(() => new Set(clubGames.map((game) => gameKey(game.title))), [clubGames]);
  const genres = useMemo(() => libraryGenres(library), [library]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState<string>(ALL_GENRES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newGameOpen, setNewGameOpen] = useState(false);

  // The selection starts as what the club already lists, and resets with the club.
  useEffect(() => {
    setSelected(new Set(savedKeys));
    setError('');
  }, [savedKeys]);
  useEffect(() => {
    setSearch('');
    setGenre(ALL_GENRES);
  }, [selectedClubId]);

  const visible = useMemo(() => filterLibrary(library, search, genre === ALL_GENRES ? null : genre), [library, search, genre]);
  const diff = useMemo(() => diffGameSelection(clubGames, selected, library), [clubGames, selected, library]);
  const dirty = diff.toAdd.length > 0 || diff.toRemove.length > 0;
  const allVisibleSelected = visible.length > 0 && visible.every((game) => selected.has(game.key));

  function toggle(game: LibraryGame) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(game.key)) next.delete(game.key);
      else next.add(game.key);
      return next;
    });
  }

  function toggleVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const game of visible) {
        if (allVisibleSelected) next.delete(game.key);
        else next.add(game.key);
      }
      return next;
    });
  }

  async function save() {
    if (!canEdit || !selectedClubId || !dirty) return;
    if (diff.toRemove.length > 0) {
      const confirmed = await confirm({
        title: t('libraryRemoveTitle', { count: diff.toRemove.length }),
        description: t('libraryRemoveDescription'),
        confirmLabel: tc('save'),
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    setSaving(true);
    setError('');
    const supabase = createClient();
    try {
      if (diff.toAdd.length > 0) {
        const { error: insertError } = await supabase
          .from('showcase_games')
          .insert(diff.toAdd.map((game) => ({ ...game, club_id: selectedClubId })));
        if (insertError) throw insertError;
      }
      if (diff.toRemove.length > 0) {
        const { data, error: deleteError } = await supabase
          .from('showcase_games')
          .delete()
          .eq('club_id', selectedClubId)
          .in('id', diff.toRemove)
          .select('id');
        if (deleteError) throw deleteError;
        // RLS silently skips rows this person may not delete.
        if ((data?.length ?? 0) !== diff.toRemove.length) throw new Error('Not every game was removed');
      }
      showToast(t('librarySaved', { added: diff.toAdd.length, removed: diff.toRemove.length }));
    } catch (saveError) {
      console.error('Failed to save game selection', saveError);
      setError(t('saveFailed'));
    } finally {
      setSaving(false);
      await query.reload({ silent: true });
    }
  }

  async function createGame(game: { title: string; genre: string | null; image_url: string | null; sort_order: number }) {
    if (!canEdit || !selectedClubId) return t('saveFailed');
    if (library.some((item) => item.key === gameKey(game.title))) return t('libraryDuplicate');
    const { error: insertError } = await createClient().from('showcase_games').insert({ ...game, club_id: selectedClubId });
    if (insertError) return t('saveFailed');
    showToast(t('saved'));
    await query.reload({ silent: true });
    return null;
  }

  if (!canEdit) {
    return (
      <Card>
        <EmptyState icon={Gamepad2} title={t('ownerOnly')} />
      </Card>
    );
  }

  return (
    <div className="w-full space-y-5 pb-24">
      <PageHeader
        title={t('title')}
        tabs={<ShowcaseTabs current="/showcase/games" />}
        action={<Button variant="outline" onClick={() => setNewGameOpen(true)} icon={<Plus size={16} aria-hidden="true" />}>{t('libraryNewGame')}</Button>}
      />

      {query.loading ? (
        <PageSkeleton />
      ) : query.error ? (
        <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t('loadFailed')}</LoadErrorAlert>
      ) : library.length === 0 ? (
        <Card>
          <EmptyState
            icon={Gamepad2}
            title={t('libraryEmpty')}
            description={t('libraryEmptyDescription')}
            action={<Button onClick={() => setNewGameOpen(true)} icon={<Plus size={16} aria-hidden="true" />}>{t('libraryNewGame')}</Button>}
          />
        </Card>
      ) : (
        <Card padding="none">
          <div className="space-y-3 border-b border-gray-100 p-4 sm:p-5">
            <p className="text-sm text-gray-500">{t('libraryDescription')}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={t('librarySearch')}
                label={t('librarySearch')}
                className="sm:max-w-xs sm:flex-1"
              />
              <div className="flex items-center gap-2 sm:ml-auto">
                <span className="text-sm text-gray-500">{t('librarySelectedCount', { selected: selected.size, total: library.length })}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleVisible}
                  disabled={visible.length === 0}
                  icon={allVisibleSelected ? <X size={15} aria-hidden="true" /> : <CheckCheck size={15} aria-hidden="true" />}
                >
                  {allVisibleSelected ? t('libraryClearShown') : t('librarySelectShown')}
                </Button>
              </div>
            </div>
            {genres.length > 1 && (
              <SegmentedControl<string>
                label={t('genre')}
                variant="chips"
                size="sm"
                value={genre}
                onChange={setGenre}
                options={[{ value: ALL_GENRES, label: t('libraryAllGenres') }, ...genres.map((value) => ({ value, label: value }))]}
              />
            )}
          </div>

          <div className="p-4 sm:p-5">
            {visible.length === 0 ? (
              <EmptyState compact icon={Gamepad2} title={t('libraryNoMatches')} />
            ) : (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
                {visible.map((game) => {
                  const isSelected = selected.has(game.key);
                  const change = isSelected !== savedKeys.has(game.key);
                  return (
                    <li key={game.key}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggle(game)}
                        className="group block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        <span
                          className={cn(
                            'relative block aspect-[3/4] overflow-hidden rounded-xl bg-gray-100 ring-2 transition-[box-shadow,opacity]',
                            isSelected ? 'ring-primary-600' : 'ring-transparent',
                          )}
                        >
                          {game.image_url ? (
                            // Owner-supplied links may point at any host, so next/image's allow-list does not fit.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={game.image_url}
                              alt=""
                              loading="lazy"
                              className={cn('h-full w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-105', !isSelected && 'opacity-45 grayscale-[60%]')}
                            />
                          ) : (
                            <span className="flex h-full items-center justify-center text-gray-400"><Gamepad2 size={24} aria-hidden="true" /></span>
                          )}
                          <span
                            className={cn(
                              'absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm transition-colors',
                              isSelected ? 'border-primary-600 bg-primary-600 text-on-accent' : 'border-white bg-surface/80 text-transparent',
                            )}
                            aria-hidden="true"
                          >
                            <Check size={14} strokeWidth={3} />
                          </span>
                          {change && (
                            <span className="absolute bottom-2 left-2 rounded-md bg-surface/90 px-1.5 py-0.5 text-[10px] font-semibold text-gray-900 shadow-sm">
                              {isSelected ? t('libraryWillAdd') : t('libraryWillRemove')}
                            </span>
                          )}
                        </span>
                        <span className="mt-1.5 block truncate text-sm font-semibold text-gray-900">{game.title}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {[game.genre, t('libraryClubCount', { count: game.clubCount })].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      )}

      {error && <InlineAlert variant="danger">{error}</InlineAlert>}

      {dirty && (
        <div className="sticky bottom-4 z-20">
          <Card padding="sm" className="flex flex-col gap-3 shadow-pop sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-700">{t('libraryPending', { added: diff.toAdd.length, removed: diff.toRemove.length })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelected(new Set(savedKeys))} disabled={saving}>{t('libraryReset')}</Button>
              <Button onClick={() => void save()} loading={saving} loadingLabel={tc('saving')}>{t('librarySave')}</Button>
            </div>
          </Card>
        </div>
      )}

      <NewGameModal
        open={newGameOpen}
        clubId={selectedClubId}
        nextSortOrder={nextSortOrder(clubGames)}
        onClose={() => setNewGameOpen(false)}
        onCreate={createGame}
      />

      {toastElement}
      {confirmDialog}
    </div>
  );
}
