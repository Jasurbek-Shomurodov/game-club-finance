'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppTheme } from '@/components/theme/AppThemeContext';
import { IconButton } from './IconButton';

/**
 * One button that flips between light and dark, shown in the top-right corner
 * of every screen. Both icons render and CSS picks one, so the server markup
 * matches whatever theme (chosen or system) the browser ends up showing.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('common.theme');
  const { theme, setTheme } = useAppTheme();

  function toggle() {
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setTheme(dark ? 'light' : 'dark');
  }

  return (
    <IconButton
      variant="outline"
      label={t('toggle')}
      onClick={toggle}
      className={className}
      icon={
        <>
          <Sun size={17} className="hidden dark:block" aria-hidden="true" />
          <Moon size={17} className="dark:hidden" aria-hidden="true" />
        </>
      }
    />
  );
}
