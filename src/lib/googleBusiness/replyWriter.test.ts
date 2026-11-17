import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createReviewReplyWriter } = await import('./replyWriter');

const REVIEW = { name: 'accounts/1/locations/2/reviews/r', reviewerName: 'Aziz', starRating: 5, comment: 'Zo‘r', createTime: null, hasReply: false };

describe('createReviewReplyWriter', () => {
  it('is off without a model key', () => {
    expect(createReviewReplyWriter({ ASSISTANT_PROVIDER: 'anthropic' })).toBeNull();
  });

  it('returns the cleaned model reply', async () => {
    const generate = vi.fn(async () => ({ text: ' "Rahmat, Aziz!" ' }));
    const write = createReviewReplyWriter({ ASSISTANT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test' }, generate)!;
    await expect(write(REVIEW, 'Pixel Gaming')).resolves.toBe('Rahmat, Aziz!');
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('Club: Pixel Gaming') }));
  });

  it('throws the model error when every model fails', async () => {
    const generate = vi.fn(async () => { throw new Error('overloaded'); });
    const write = createReviewReplyWriter({ ASSISTANT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test' }, generate)!;
    await expect(write(REVIEW, 'Pixel Gaming')).rejects.toThrow('overloaded');
  });
});
