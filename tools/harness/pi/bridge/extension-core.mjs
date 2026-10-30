// Workspace-only: run-pi.sh loads this with -e. Never install it in the user's agent directory.
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { request } from './client.mjs';
import { validLane } from './server.mjs';

export function bridgeExtension(pi, Type) {
  const lane = validLane(process.env.PI_LANE);
  let pending, unsentAnswer, commit = '', errors = [], tools = [], failed = false;
  const call = async (path, body) => {
    try {
      const result = await request(path, body, { timeout: 1500 });
      failed = false;
      return result;
    } catch (error) {
      if (!failed) console.error(`pi bridge unavailable: ${error.message}`);
      failed = true;
      return undefined;
    }
  };
  const status = async (ctx, event, phase = 'running') => {
    if (event !== 'tool_call') {
      try { commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ctx.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
      }).trim(); } catch { commit = ''; }
    }
    const entries = ctx.sessionManager.getEntries();
    let cost = 0, steps = 0;
    for (const entry of entries) {
      if (entry.type === 'message' && entry.message.role === 'assistant') steps++;
      cost += (entry.type === 'message' ? entry.message.usage : entry.usage)?.cost?.total ?? 0;
    }
    await call('/status', { lane, event, phase, steps, context: ctx.getContextUsage() ?? null, cost,
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null, tools, commit, errors,
      cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile(), leafId: ctx.sessionManager.getLeafId() });
    if (unsentAnswer) {
      if (await call('/answers', unsentAnswer)) unsentAnswer = undefined;
    }
  };
  const deliver = async () => {
    if (pending || unsentAnswer) return;
    const q = await call('/claim', { lane });
    if (!q) return;
    pending = q;
    pi.appendEntry('pi-bridge-live', { id: q.id });
    pi.sendUserMessage(`[Reviewer bridge question #${q.id}] Answer this question briefly in your NEXT ` +
      `assistant text, then continue your original task. Do not wait for confirmation. Question: ${q.question}`,
    { deliverAs: 'steer' });
  };
  pi.on('session_start', async (_event, ctx) => {
    pending = undefined; unsentAnswer = undefined; tools = []; errors = [];
    await status(ctx, 'session_start');
  });
  pi.on('agent_start', async (_event, ctx) => { await status(ctx, 'agent_start'); });
  pi.on('tool_call', async (event, ctx) => {
    tools = [...tools, { name: event.toolName, at: Date.now() }].slice(-5);
    await status(ctx, 'tool_call');
  });
  pi.on('tool_result', async event => {
    if (event.isError) {
      errors = [...errors, { at: Date.now(), message: `${event.toolName}: ` +
        event.content.filter(c => c.type === 'text').map(c => c.text).join(' ').slice(0, 1000) }].slice(-10);
    }
  });
  pi.on('turn_end', async (event, ctx) => {
    const message = event.message;
    if (message.role === 'assistant') {
      if (message.errorMessage || ['error', 'aborted'].includes(message.stopReason)) {
        errors = [...errors, { at: Date.now(), message: message.errorMessage ?? message.stopReason }].slice(-10);
      }
      const answer = message.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      if (pending && answer) {
        unsentAnswer = { id: pending.id, text: answer.slice(0, 32000) };
        pending = undefined;
      }
    }
    await status(ctx, 'turn_end');
    await deliver();
  });
  pi.on('agent_end', async (_event, ctx) => { await status(ctx, 'agent_end'); });
  // agent_end can precede retries/queued steering; only settled means finished.
  pi.on('agent_before_settle', async () => { await deliver(); });
  pi.on('agent_settled', async (event, ctx) => {
    const last = ctx.sessionManager.getBranch().filter(e => e.type === 'message' &&
      e.message.role === 'assistant').at(-1)?.message;
    await status(ctx, 'agent_settled', event.aborted || last?.stopReason === 'error' ? 'error' : 'finished');
  });
  pi.registerTool({
    name: 'ask_reviewer', label: 'Ask reviewer',
    description: 'Ask the coordinating reviewer about a real decision not settled by the brief. ' +
      'Never use for routine confirmations. Waits for an answer; on timeout returns the stated default explicitly.',
    parameters: Type.Object({
      question: Type.String(), options: Type.Optional(Type.Array(Type.String())),
      default: Type.Optional(Type.String()), timeout_s: Type.Optional(Type.Number({ minimum: 0, maximum: 86400 })),
    }),
    async execute(_id, params, signal) {
      const q = await request('/questions', { lane, to: 'reviewer', ...params }, { signal });
      const deadline = q.expiresAt;
      while (true) {
        signal?.throwIfAborted();
        const state = await call('/state');
        const answer = state?.answers.find(a => a.id === q.id);
        if (answer) return { content: [{ type: 'text', text: answer.timedOut ?
          `Reviewer timeout; using default: ${answer.text}` : answer.text }], details: answer };
        if (Date.now() >= deadline) {
          const result = await call('/answers', { id: q.id,
            text: params.default ?? '(no default supplied)', timedOut: true });
          const timedOut = result?.timedOut ?? true;
          const fallback = result?.text ?? params.default ?? '(no default supplied)';
          return { content: [{ type: 'text', text: timedOut ?
            `Reviewer timeout; using default: ${fallback}` : result.text }],
          details: result ?? { id: q.id, timedOut: true } };
        }
        await sleep(Math.min(500, Math.max(1, deadline - Date.now())), undefined, { signal });
      }
    },
  });
}
