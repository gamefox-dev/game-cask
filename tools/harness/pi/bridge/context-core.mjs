// Host estimates, never guessed from transcript size. Also usable without the reviewer service.
export function contextExtension(pi, Type, env = process.env) {
  const every = Number(env.PI_CONTEXT_EVERY_TURNS ?? 5);
  const threshold = env.PI_CHECKPOINT_TOKENS == null ? Infinity : Number(env.PI_CHECKPOINT_TOKENS);
  if (!Number.isInteger(every) || every < 1 || !(threshold > 0) ||
      (env.PI_CHECKPOINT_TOKENS != null && !Number.isFinite(threshold))) {
    throw new Error('invalid PI_CONTEXT_EVERY_TURNS or PI_CHECKPOINT_TOKENS');
  }
  let turns = 0, notedTurn = -1, crossed = false, checkpointSent = false;
  const report = ctx => {
    const usage = ctx?.getContextUsage?.();
    if (usage?.tokens != null && usage.tokens >= threshold) crossed = true;
    const count = n => n == null ? '?' : String(Math.round(n));
    const text = '[context: ' + count(usage?.tokens) + '/' + count(usage?.contextWindow) +
      ' tokens, ' + (usage?.percent == null ? '?' : usage.percent.toFixed(1)) + '%; host estimate]' +
      (crossed ? '\n[CHECKPOINT: PI_CHECKPOINT_TOKENS=' + threshold +
        ' crossed. Commit your work, write your handoff, and stop. Do not start new work.]' : '');
    return { text, usage: usage ?? null, checkpoint: crossed, threshold: Number.isFinite(threshold) ? threshold : null };
  };
  pi.on('session_start', () => { turns = 0; notedTurn = -1; crossed = false; checkpointSent = false; });
  pi.on('tool_result', (event, ctx) => {
    // Nested codemode calls may be filtered by their script. Annotate the outer result that reaches the model.
    if (event.parentToolCallId) return;
    const r = report(ctx);
    if (notedTurn === turns || (!r.checkpoint && turns % every !== 0)) return;
    notedTurn = turns;
    return { content: [...event.content, { type: 'text', text: r.text }],
      ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }) };
  });
  pi.on('turn_end', (_event, ctx) => {
    turns++;
    const r = report(ctx);
    // Covers a threshold crossing on a final text-only turn, too. Request only one continuation.
    if (r.checkpoint && !checkpointSent) {
      checkpointSent = true;
      pi.sendUserMessage(r.text, { deliverAs: 'steer' });
    }
  });
  pi.registerTool({ name: 'context_status', label: 'Context status',
    description: 'Read the real host-reported context tokens, window and percent (estimates; unknown stays unknown), and checkpoint instruction.',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const r = report(ctx);
      return { content: [{ type: 'text', text: r.text }], details: r };
    },
  });
}
