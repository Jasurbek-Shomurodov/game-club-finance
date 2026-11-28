import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import messages from '@/messages/en.json';
import ru from '@/messages/ru.json';
import uz from '@/messages/uz.json';
import { OwnerTelegramCard, type OwnerTelegramCardProps } from './OwnerTelegramCard';

const noop = () => undefined;
const link = { user_id: 'u1', telegram_user_id: 111222333, telegram_username: 'pixel_owner', linked_at: '2026-11-28T08:00:00Z' };
const code = { code: 'ABCD2345', expiresAt: '2026-11-28T08:15:00Z' };

function render(props: Partial<OwnerTelegramCardProps> = {}) {
  return renderToStaticMarkup(
    <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => undefined }}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <OwnerTelegramCard
          botUsername="PixelOwnerBot"
          status="ready"
          link={null}
          code={null}
          busy={null}
          onGetCode={noop}
          onCheck={noop}
          onCopy={noop}
          onUnlink={noop}
          onRetry={noop}
          {...props}
        />
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>,
  );
}

describe('OwnerTelegramCard', () => {
  it('offers a link code when the account is not linked', () => {
    const html = render();
    expect(html).toContain('Owner bot');
    expect(html).toContain('@PixelOwnerBot sends you');
    expect(html).toContain('Get link code');
    expect(html).not.toContain('/link');
    expect(html).not.toContain('Unlink');
  });

  it('shows the /link message, the bot and how long the code works', () => {
    const html = render({ code });
    expect(html).toContain('/link ABCD2345');
    expect(html).toContain('Send this message to @PixelOwnerBot in Telegram:');
    expect(html).toContain('href="https://t.me/PixelOwnerBot"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('The code works once, until');
    expect(html).toContain('aria-label="Copy the message"');
    expect(html).toContain('Check link');
    expect(html).toContain('Get a new code');
    expect(html).not.toContain(messages.settings.ownerTelegram.notLinkedYet);
  });

  it('says when a check found no link yet', () => {
    expect(render({ code, notLinkedYet: true })).toContain(messages.settings.ownerTelegram.notLinkedYet);
  });

  it('shows the linked account and the way to unlink it', () => {
    const html = render({ link, code });
    expect(html).toContain('Linked to @pixel_owner since 28 November 2026.');
    expect(html).toContain('Unlink');
    expect(html).not.toContain('Get link code');
    expect(html).not.toContain('/link ABCD2345');
  });

  it('names an account without a username', () => {
    expect(render({ link: { ...link, telegram_username: null } })).toContain('Linked to a Telegram account since');
  });

  it('shows a skeleton while loading and a retry after a failed load', () => {
    const loading = render({ status: 'loading' });
    expect(loading).toContain('class="skeleton ');
    expect(loading).not.toContain('Owner bot');
    const failed = render({ status: 'error' });
    expect(failed).toContain(messages.settings.ownerTelegram.loadError);
    expect(failed).not.toContain('Get link code');
  });

  it('shows a save error under the row', () => {
    expect(render({ error: 'Could not save' })).toContain('Could not save');
  });

  it('has the same messages in every language', () => {
    const keys = Object.keys(messages.settings.ownerTelegram).sort();
    expect(Object.keys(ru.settings.ownerTelegram).sort()).toEqual(keys);
    expect(Object.keys(uz.settings.ownerTelegram).sort()).toEqual(keys);
  });
});
