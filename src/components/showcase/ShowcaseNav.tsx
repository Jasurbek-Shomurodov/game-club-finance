'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';
import { LanguageSwitcher } from '@/components/PresentationFoundation';

interface ShowcaseNavProps {
  clubName: string;
  links: Array<{ href: string; label: string }>;
  cta?: { href: string; label: string } | null;
}

/**
 * Transparent over the hero, frosted glass once the page scrolls.
 *
 * The bar is 4rem tall at every width, and the page depends on that: the
 * sticky club tabs sit at `top-16`, sections use `scroll-mt-16`/`scroll-mt-20`
 * and the heroes start at `pt-24`/`pt-28`. On phones the section links live in
 * a menu that drops over the page, so the bar never grows.
 */
export function ShowcaseNav({ clubName, links, cta }: ShowcaseNavProps) {
  const t = useTranslations('publicShowcase');
  const menuId = useId();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    // The menu is for phones only; a wider window shows the links in the bar.
    const wide = window.matchMedia('(min-width: 768px)');
    const onWide = () => wide.matches && setMenuOpen(false);
    document.addEventListener('keydown', onKeyDown);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      wide.removeEventListener('change', onWide);
    };
  }, [menuOpen]);

  const hasMenu = links.length > 0 || Boolean(cta);

  return (
    <header data-scrolled={scrolled || menuOpen} className="sc-nav fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)]">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <a href="#top" className="sc-display min-w-0 truncate text-base font-bold tracking-tight text-white sm:text-lg">
          {clubName}
        </a>
        <div className="ml-auto hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white">
              {link.label}
            </a>
          ))}
        </div>
        <LanguageSwitcher variant="dark" className="ml-auto bg-white/10 md:ml-2" />
        {cta && (
          <a href={cta.href} target="_blank" rel="noopener noreferrer" className="sc-cta hidden rounded-xl px-4 py-2 text-sm font-semibold text-white sm:inline-flex">
            {cta.label}
          </a>
        )}
        {hasMenu && (
          <button
            type="button"
            aria-label={t('navMenu')}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 md:hidden"
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        )}
      </nav>
      {hasMenu && (
        <div id={menuId} hidden={!menuOpen} className="border-t border-white/10 px-4 pb-4 pt-2 md:hidden">
          <ul className="mx-auto max-w-7xl">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center rounded-xl px-3 text-base font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          {cta && (
            <a
              href={cta.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="sc-cta mt-2 flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white sm:hidden"
            >
              {cta.label}
            </a>
          )}
        </div>
      )}
    </header>
  );
}
