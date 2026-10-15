import Anthropic from '@anthropic-ai/sdk';
import { MAX_ROUNDS, runToolCalls, type AssistantProvider, type AssistantRunInput } from './types';

const DEFAULT_MODEL = 'claude-opus-5-5';

async function run(input: AssistantRunInput) {
  const anthropic = new Anthropic();
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: input.systemPrompt, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: input.contextPrompt },
  ];
  const tools: Anthropic.Beta.BetaTool[] = input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
  // History is plain text from the browser; tool calls stay inside one request.
  const messages: Anthropic.Beta.BetaMessageParam[] = input.history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  for (let round = 0; ; round += 1) {
    if (round >= MAX_ROUNDS) {
      input.send({ type: 'error', code: 'TOO_LONG' });
      return;
    }

    const response = anthropic.beta.messages.stream({
      model: process.env.ASSISTANT_MODEL || DEFAULT_MODEL,
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system,
      tools,
      messages,
    }, { signal: input.signal });
    response.on('text', (text) => input.send({ type: 'text', text }));
    const message = await response.finalMessage();

    if (message.stop_reason === 'refusal') {
      input.send({ type: 'error', code: 'REFUSED' });
      return;
    }

    const toolUses = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
    );
    if (toolUses.length === 0) return;
    if (message.stop_reason === 'max_tokens') {
      // A tool input cut off by the token limit must not run.
      input.send({ type: 'error', code: 'TOO_LONG' });
      return;
    }

    messages.push({ role: 'assistant', content: message.content });
    const results = await runToolCalls(toolUses, input);
    messages.push({
      role: 'user',
      content: results.map(({ call, outcome }) => ({
        type: 'tool_result' as const,
        tool_use_id: call.id,
        content: JSON.stringify(outcome.result),
        ...(outcome.isError ? { is_error: true } : {}),
      })),
    });
  }
}

export function anthropicProvider(): AssistantProvider {
  return {
    name: 'anthropic',
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    run,
    errorCode: (error) => {
      if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) return 'BUSY';
      if (error instanceof Anthropic.APIError && error.status === 529) return 'BUSY';
      return 'SERVER_ERROR';
    },
  };
}
