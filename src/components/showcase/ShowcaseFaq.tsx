import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronDown } from 'lucide-react';
import { formatCurrency, formatPhone } from '@/lib/formatters';
import { faqPageJsonLd } from '@/lib/seo';
import type { PublicBrand, PublicShowcase } from '@/lib/showcase';
import { brandFaqFacts, clubFaqFacts, type ClubFaqFact } from '@/lib/showcaseFaq';
import { JsonLd } from './JsonLd';
import { SectionTitle } from './ShowcaseParts';

/**
 * "Questions and answers" on a club page (from the club's data) or the brand
 * page (comparing its clubs): prices, consoles, hours, booking, addresses and
 * games. The same text goes into FAQPage structured data, which search
 * engines can show as answers.
 */
export async function ShowcaseFaq({ club, brand, id }: { club?: PublicShowcase; brand?: PublicBrand; id?: string }) {
  const [t, tc, locale] = await Promise.all([getTranslations('publicShowcase'), getTranslations('common'), getLocale()]);
  const money = (amount: number) => `${formatCurrency(amount, locale)} ${tc('currency')}`;
  const name = { club: club?.club_name ?? brand?.name ?? '' };
  const brandName = { brand: brand?.name ?? '' };

  const answer = (fact: ClubFaqFact): { question: string; answer: string } => {
    switch (fact.kind) {
      case 'price':
        return {
          question: t('faq.priceQuestion', name),
          answer: [
            t('faq.priceAnswer', { price: money(fact.from) }),
            fact.zones.length > 1 ? t('faq.priceZones', { zones: fact.zones.map((zone) => `${zone.name} — ${money(zone.price)}`).join(', ') }) : null,
          ].filter(Boolean).join(' '),
        };
      case 'consoles':
        return {
          question: t('faq.consolesQuestion'),
          answer: [
            t(club ? 'faq.consolesAnswer' : 'faq.consolesAnswerBrand', { consoles: t('consoleCount', { count: fact.count }), names: fact.names.join(', ') }),
            fact.from !== null ? t('faq.consolesPrice', { price: money(fact.from) }) : null,
          ].filter(Boolean).join(' '),
        };
      case 'hours':
        return { question: t('faq.hoursQuestion', name), answer: fact.roundTheClock ? t('faq.hoursRoundTheClock') : t('faq.hoursAnswer', { hours: fact.text }) };
      case 'booking': {
        const phone = fact.phone ? formatPhone(fact.phone) : null;
        const text = fact.telegram && phone
          ? t('faq.bookingBoth', { phone })
          : fact.telegram ? t('faq.bookingTelegram', { button: t('bookTelegram') }) : t('faq.bookingPhone', { phone: phone ?? '' });
        return { question: t('faq.bookingQuestion'), answer: text };
      }
      case 'address':
        return { question: t('faq.addressQuestion', name), answer: t('faq.addressAnswer', { address: fact.address }) };
      case 'clubPrices':
        return {
          question: t('faq.clubPricesQuestion', brandName),
          answer: [
            t('faq.priceAnswer', { price: money(fact.from) }),
            fact.clubs.length > 1 ? t('faq.clubPrices', { clubs: fact.clubs.map((entry) => `${entry.name} — ${money(entry.from)}`).join(', ') }) : null,
          ].filter(Boolean).join(' '),
        };
      case 'locations':
        return {
          question: t('faq.locationsQuestion', brandName),
          answer: t('faq.locationsAnswer', { clubs: fact.clubs.map((entry) => `${entry.name}: ${entry.address}`).join('; ') }),
        };
      case 'clubBooking':
        return { question: t('faq.bookingQuestion'), answer: t('faq.bookingClub', { button: t('bookTelegram') }) };
      case 'games':
        return { question: t('faq.gamesQuestion'), answer: t('faq.gamesAnswer', { games: t('gameCount', { count: fact.count }), list: fact.sample.join(', ') }) };
    }
  };

  const facts = club ? clubFaqFacts(club) : brand ? brandFaqFacts(brand) : [];
  const items = facts.map(answer);
  if (items.length === 0) return null;

  return (
    <section id={id} className="relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
      <JsonLd data={faqPageJsonLd(items)} />
      <div className="relative mx-auto max-w-3xl">
        <SectionTitle eyebrow={t('faq.eyebrow')} title={t('faq.title')} description={t('faq.description')} />
        <div className="space-y-3">
          {items.map((item) => (
            <details key={item.question} className="sc-glass group rounded-2xl px-5 py-4 open:bg-white/[0.07]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold text-white [&::-webkit-details-marker]:hidden">
                <h3 className="text-base sm:text-lg">{item.question}</h3>
                <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-white/50 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 leading-7 text-white/70">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
