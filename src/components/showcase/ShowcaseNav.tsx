'use client';

import { useEffect, useState } from 'react';
import { LanguageSwitcher } from '@/components/PresentationFoundation';

interface ShowcaseNavProps {
  clubName: string;
  links: Array<{ href: string; label: string }>;
  cta?: { href: string; label: string } | null;
}

/** Transparent over the hero, frosted glass once the page scrolls. */
export function ShowcaseNav({ clubName, links, cta }: ShowcaseNavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <header data-scrolled={scrolled} className="sc-nav fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)]">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
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
      </nav>
    </header>
  );
}
