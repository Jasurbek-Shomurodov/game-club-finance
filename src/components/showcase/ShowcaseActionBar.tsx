import { getTranslations } from 'next-intl/server';
import { Navigation, Phone, Send, Tag } from 'lucide-react';

interface ShowcaseActionBarProps {
  /** Formatted "from" price, e.g. "11 000 UZS". Null hides the price chip. */
  fromPriceLabel: string | null;
  directionsHref: string | null;
  phoneHref: string | null;
  telegramHref: string | null;
}

/**
 * Fixed bottom bar on phones, like the Yandex Maps place card: directions,
 * the lowest price (jumps to the price list), and quick contact buttons.
 */
export async function ShowcaseActionBar({ fromPriceLabel, directionsHref, phoneHref, telegramHref }: ShowcaseActionBarProps) {
  const t = await getTranslations('publicShowcase');
  const barButton =
    'inline-flex h-12 items-center justify-center rounded-2xl text-white transition-colors hover:bg-white/15';

  return (
    <nav
      aria-label={t('actionBarLabel')}
      className="sc-glass fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-white/10 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 sm:hidden"
    >
      {directionsHref && (
        <a
          href={directionsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="sc-cta inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white"
        >
          <Navigation size={18} aria-hidden="true" />
          {t('directions')}
        </a>
      )}
      {fromPriceLabel && (
        <a href="#prices" className={`${barButton} min-w-0 flex-1 gap-1.5 bg-white/10 px-3 text-sm font-semibold`}>
          <Tag size={16} aria-hidden="true" className="shrink-0 text-lime-400" />
          <span className="truncate">{t('fromPriceChip', { price: fromPriceLabel })}</span>
        </a>
      )}
      {phoneHref && (
        <a href={phoneHref} aria-label={t('call')} className={`${barButton} w-12 shrink-0 bg-white/10`}>
          <Phone size={18} aria-hidden="true" />
        </a>
      )}
      {telegramHref && (
        <a
          href={telegramHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('bookTelegram')}
          className={`${barButton} w-12 shrink-0 bg-white/10`}
        >
          <Send size={18} aria-hidden="true" />
        </a>
      )}
    </nav>
  );
}
