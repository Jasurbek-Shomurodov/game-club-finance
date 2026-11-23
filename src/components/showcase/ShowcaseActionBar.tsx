import { getTranslations } from 'next-intl/server';
import { Navigation, Phone, Send } from 'lucide-react';
import { BookingButton, type BookingClub } from './BookingButton';

interface ShowcaseActionBarProps {
  /** Clubs a booking request can go to; none hides the booking button. */
  booking: BookingClub[];
  /** The club this bar acts for, preselected in the booking form. */
  clubSlug: string;
  directionsHref: string | null;
  phoneHref: string | null;
}

/**
 * Fixed bottom bar on phones: book, get directions, call. The three things a
 * visitor on the way to a club needs, always under the thumb.
 */
export async function ShowcaseActionBar({ booking, clubSlug, directionsHref, phoneHref }: ShowcaseActionBarProps) {
  // Nothing to offer: no empty bar over the page.
  if (booking.length === 0 && !directionsHref && !phoneHref) return null;
  const t = await getTranslations('publicShowcase');
  const primary = 'sc-cta inline-flex h-12 min-w-0 flex-[1.4] items-center justify-center gap-2 rounded-2xl px-3 text-sm font-semibold text-white';
  const secondary = 'inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#1c1c26] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#262631]';
  const canBook = booking.length > 0;

  return (
    <nav
      aria-label={t('actionBarLabel')}
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-white/10 bg-[#07070d] px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 sm:hidden"
    >
      {canBook && (
        <BookingButton clubs={booking} initialSlug={clubSlug} className={primary}>
          <Send size={17} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{t('bookTelegram')}</span>
        </BookingButton>
      )}
      {directionsHref && (
        <a href={directionsHref} target="_blank" rel="noopener noreferrer" className={canBook ? secondary : primary}>
          <Navigation size={17} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{t('directions')}</span>
        </a>
      )}
      {phoneHref && (
        <a href={phoneHref} aria-label={t('call')} className={canBook || directionsHref ? `${secondary} max-w-14 flex-none` : primary}>
          <Phone size={18} aria-hidden="true" className="shrink-0" />
          {!canBook && !directionsHref && <span className="truncate">{t('call')}</span>}
        </a>
      )}
    </nav>
  );
}
