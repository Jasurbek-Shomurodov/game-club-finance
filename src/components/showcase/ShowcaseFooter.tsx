import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Clock, Gamepad2, Instagram, Mail, MapPin, Phone, Send, Youtube } from 'lucide-react';
import { formatPhone } from '@/lib/formatters';
import { mapLinks, telHref } from '@/lib/showcase';
import { MapChooser } from './MapChooser';

export interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

export interface FooterLocation {
  /** Shown above the address when the footer lists several clubs. */
  label: string | null;
  clubName: string;
  address: string;
  /** A chain lists each club's own phone and hours under its address. */
  phone?: string | null;
  hours?: string | null;
}

interface ShowcaseFooterProps {
  name: string;
  /** Club logo shown before the name; the gamepad badge when absent. */
  logoUrl?: string | null;
  description: string | null;
  hours: string | null;
  phone: string | null;
  email: string | null;
  socials: { telegram: string | null; instagram: string | null; youtube: string | null };
  pages: FooterLink[];
  help: FooterLink[];
  locations: FooterLocation[];
}

/** "Pixel Gaming" → PIXEL + gradient GAMING, like a wordmark. */
function Wordmark({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return (
    <span className="sc-display flex items-center gap-3 text-xl font-black uppercase tracking-tight text-white">
      {logoUrl ? (
        // Owner-supplied links may point at any host, so next/image's allow-list does not fit.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-[0_8px_24px_-8px_rgba(192,38,211,0.8)]">
          <Gamepad2 size={20} aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 break-words">
        {first}
        {rest.length > 0 && <span className="sc-gradient-text"> {rest.join(' ')}</span>}
      </span>
    </span>
  );
}

function SocialLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.07] text-white/80 ring-1 ring-white/10 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
    >
      {children}
    </a>
  );
}

function LinkColumn({ title, links }: { title: string; links: FooterLink[] }) {
  if (links.length === 0) return null;
  return (
    <div>
      <h2 className="sc-display text-sm font-bold uppercase tracking-[0.15em] text-white">{title}</h2>
      <ul className="mt-5 space-y-3">
        {links.map((link) => (
          <li key={`${link.href}-${link.label}`}>
            <a
              href={link.href}
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="text-sm text-white/60 transition-colors hover:text-white"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContactItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-6 text-white/70">
      <span className="mt-1 shrink-0 text-violet-400">{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

function LocationDetails({ phone, hours }: { phone: string | null; hours: string | null }) {
  const phoneLink = telHref(phone);
  if (!phone && !hours) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-white/55">
      {phone && (
        <span className="inline-flex items-center gap-1.5">
          <Phone size={13} aria-hidden="true" />
          {phoneLink ? <a href={phoneLink} className="transition-colors hover:text-white">{formatPhone(phone)}</a> : phone}
        </span>
      )}
      {hours && (
        <span className="inline-flex items-center gap-1.5">
          <Clock size={13} aria-hidden="true" /> {hours}
        </span>
      )}
    </span>
  );
}

/** Four-column site footer: brand and socials, pages, help, and contact details. */
export async function ShowcaseFooter({ name, logoUrl, description, hours, phone, email, socials, pages, help, locations }: ShowcaseFooterProps) {
  const t = await getTranslations('publicShowcase');
  const phoneLink = telHref(phone);
  const mapLabels = { title: t('mapChooserTitle'), yandex: t('mapYandex'), google: t('mapGoogle') };
  const hasContacts = locations.length > 0 || phone || email || hours;

  return (
    <footer className="relative border-t border-white/5 bg-[#0a0a14]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" aria-hidden="true" />
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.4fr] lg:px-8">
        <div>
          <Wordmark name={name} logoUrl={logoUrl} />
          {description && <p className="mt-5 max-w-sm text-sm leading-6 text-white/60">{description}</p>}
          {hours && <p className="mt-2 text-sm text-white/60">{t('footerOpen', { hours })}</p>}
          {(socials.telegram || socials.instagram || socials.youtube) && (
            <div className="mt-6 flex gap-3">
              {socials.telegram && <SocialLink href={socials.telegram} label="Telegram"><Send size={17} aria-hidden="true" /></SocialLink>}
              {socials.instagram && <SocialLink href={socials.instagram} label="Instagram"><Instagram size={17} aria-hidden="true" /></SocialLink>}
              {socials.youtube && <SocialLink href={socials.youtube} label="YouTube"><Youtube size={17} aria-hidden="true" /></SocialLink>}
            </div>
          )}
        </div>

        <LinkColumn title={t('footerPages')} links={pages} />
        <LinkColumn title={t('footerHelp')} links={help} />

        {hasContacts && (
          <div>
            <h2 className="sc-display text-sm font-bold uppercase tracking-[0.15em] text-white">{t('footerContact')}</h2>
            <ul className="mt-5 space-y-4">
              {locations.map((location) => {
                const links = mapLinks({ club_name: location.clubName, address: location.address });
                return (
                  <ContactItem key={`${location.clubName}-${location.address}`} icon={<MapPin size={16} aria-hidden="true" />}>
                    {location.label && <span className="block text-xs font-semibold uppercase tracking-wider text-white/40">{location.label}</span>}
                    {links ? <MapChooser address={location.address} links={links} labels={mapLabels} /> : location.address}
                    <LocationDetails phone={location.phone ?? null} hours={location.hours ?? null} />
                  </ContactItem>
                );
              })}
              {phone && (
                <ContactItem icon={<Phone size={16} aria-hidden="true" />}>
                  {phoneLink ? <a href={phoneLink} className="transition-colors hover:text-white">{formatPhone(phone)}</a> : phone}
                </ContactItem>
              )}
              {email && (
                <ContactItem icon={<Mail size={16} aria-hidden="true" />}>
                  <a href={`mailto:${email}`} className="transition-colors hover:text-white">{email}</a>
                </ContactItem>
              )}
              {hours && <ContactItem icon={<Clock size={16} aria-hidden="true" />}>{hours}</ContactItem>}
            </ul>
          </div>
        )}
      </div>
      <div className="border-t border-white/5 px-4 py-6 text-center text-xs text-white/35">
        © {new Date().getFullYear()} {name}. {t('footerRights')}{' '}
        <a href="/privacy" className="underline-offset-4 transition-colors hover:text-white hover:underline">{t('footerPrivacy')}</a>
      </div>
    </footer>
  );
}
