import { describe, expect, it, vi } from 'vitest';
import { editTelegramMessage } from './editTelegramMessage';

const reply = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
));

describe('editTelegramMessage', () => {
  it('replaces the text of the exact chat message', async () => {
    const fetchImpl = reply({ ok: true, result: {} });
    await editTelegramMessage({ botToken: 'token', chatId: '-1001', messageId: 42, text: 'new', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken/editMessageText',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ chat_id: '-1001', message_id: 42, text: 'new' }) }),
    );
  });

  it('treats unchanged text as edited', async () => {
    const fetchImpl = reply({ ok: false, description: 'Bad Request: message is not modified' }, 400);
    await expect(editTelegramMessage({ botToken: 'token', chatId: '-1001', messageId: 42, text: 'same', fetchImpl })).resolves.toBeUndefined();
  });

  it('reports other refusals', async () => {
    const fetchImpl = reply({ ok: false, description: "Bad Request: message can't be edited" }, 400);
    await expect(editTelegramMessage({ botToken: 'token', chatId: '-1001', messageId: 42, text: 'x', fetchImpl })).rejects.toThrow("can't be edited");
  });
});
