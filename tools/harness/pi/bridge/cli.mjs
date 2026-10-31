#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { clearTimeout } from 'node:timers';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request, waitFor, eventSummary } from './client.mjs';
import { validLane } from './server.mjs';

export function parseArgs(args) {
  const [command, ...rest] = args;
  const options = {}, words = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (['--live', '--fork'].includes(arg)) options[arg.slice(2)] = true;
    else if (['--lane', '--lanes', '--id', '--for', '--since', '--stalled-minutes', '--timeout-s'].includes(arg)) {
      if (rest[i + 1] === undefined) throw new Error(`missing value for ${arg}`);
      options[arg.slice(2)] = rest[++i];
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else words.push(arg);
  }
  if (options.live && options.fork) throw new Error('choose --live or --fork');
  return { command, options, words };
}
const compact = (text, max = 160) => String(text ?? '').replace(/\s+/g, ' ').slice(0, max);
export function formatStatus(status, now = Date.now()) {
  const ctx = status.context;
  const context = ctx?.tokens == null ? '?' : `${ctx.tokens}/${ctx.contextWindow}`;
  const percent = ctx?.percent == null ? '?' : ctx.percent.toFixed(1);
  const errors = status.errors ?? [];
  return `${status.lane} ${status.phase ?? 'starting'} steps=${status.steps ?? 0} ctx=${context} (${percent}%) ` +
    `cost=$${Number(status.cost ?? 0).toFixed(4)} model=${compact(status.model, 80)}` +
    `${status.driverExit == null ? '' : ` exit=${status.driverExit}`}\n` +
    `  idle=${Math.max(0, Math.floor((now - status.lastTurnAt) / 1000))}s ` +
    `commit=${compact(status.commit, 12)} tools=${compact((status.tools ?? []).map(t => t.name).join(','), 80)} ` +
    `errors=${errors.length}${errors.length ? ` ${compact(errors.at(-1)?.message ?? errors.at(-1), 100)}` : ''}`;
}

// Snapshot only complete JSONL records and the published active branch, never open the original for writing.
export function snapshotSession(source, leafId) {
  const raw = readFileSync(source, 'utf8');
  const records = raw.slice(0, raw.lastIndexOf('\n')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const header = records[0];
  if (header?.type !== 'session') throw new Error('invalid session header');
  const byId = new Map(records.slice(1).map(entry => [entry.id, entry]));
  const branch = [], seen = new Set();
  let id = leafId === undefined ? records.at(-1)?.id : leafId;
  while (id) {
    const entry = byId.get(id);
    if (!entry || seen.has(id)) throw new Error('published session branch is unavailable');
    seen.add(id); branch.push(entry); id = entry.parentId;
  }
  return [header, ...branch.reverse()].map(entry => JSON.stringify(entry)).join('\n') + '\n';
}
export async function forkQuestion(status, question, { env = process.env } = {}) {
  if (!status?.sessionFile) throw new Error('lane has not published a session file yet');
  const dir = mkdtempSync(join(env.PI_BRIDGE_TMP ?? tmpdir(), 'pi-bridge-fork-'));
  try {
    const snapshot = join(dir, 'snapshot.jsonl');
    writeFileSync(snapshot, snapshotSession(status.sessionFile, status.leafId), { mode: 0o600 });
    const args = ['-p', '--fork', snapshot, '--session-dir', dir, '--no-tools', '--no-extensions',
      '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-approve',
      '--model', status.model || env.PI_MODEL || 'cpa/gpt-6.1-sol', '--thinking', 'low'];
    if (env.PI_PROVIDER_EXTENSION) args.push('-e', env.PI_PROVIDER_EXTENSION);
    args.push('--', `Reviewer read-only question. Answer briefly from the copied session; do not continue ` +
      `the task. No tools are available. Question: ${question}`);
    return await new Promise((accept, reject) => {
      const child = spawn(env.PI_BIN ?? 'pi', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fork timeout')); }, 180000);
      child.stdout.on('data', chunk => {
        out += chunk;
        if (out.length > 262144) child.kill('SIGKILL');
      });
      child.stderr.on('data', chunk => { err = (err + chunk).slice(-4000); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) accept(out.trim().slice(0, 32000));
        else reject(new Error(`fork failed (${code}): ${compact(err, 500)}`));
      });
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function main(args, output = console.log) {
  const { command, options: opts, words } = parseArgs(args);
  if (opts.lane) validLane(opts.lane);
  switch (command) {
    case 'status': {
      const state = await request('/state');
      const statuses = Object.values(state.lanes).filter(s => !opts.lane || s.lane === opts.lane);
      if (!statuses.length) throw new Error('no matching lanes');
      statuses.forEach(s => output(formatStatus(s)));
      break;
    }
    case 'ask': {
      if (!opts.lane || !words.length) throw new Error('ask --lane X [--live|--fork] "question"');
      const state = await request('/state');
      const status = state.lanes[opts.lane];
      if (!status) throw new Error(`unknown lane ${opts.lane}`);
      if (!opts.fork && ['finished', 'error'].includes(status.phase)) {
        throw new Error('lane is not running; use --fork');
      }
      const q = await request('/questions', { lane: opts.lane, to: 'instance',
        question: words.join(' '), mode: opts.fork ? 'fork' : 'live' });
      if (opts.fork) {
        try {
          const answer = await forkQuestion(status, q.question);
          await request('/answers', { id: q.id, text: answer });
          output(`#${q.id} ${compact(answer, 2000)}`);
        } catch (error) {
          await request('/answers', { id: q.id, text: `Fork failed: ${error.message}`, timedOut: true });
          throw error;
        }
      } else output(`${opts.lane} queued #${q.id}`);
      break;
    }
    case 'answers':
    case 'questions': {
      const state = await request('/state');
      const items = command === 'answers' ? state.answers : state.questions.filter(q => q.to === 'reviewer' &&
        q.state === 'queued' && q.expiresAt > Date.now());
      items.filter(q => !opts.lane || q.lane === opts.lane).forEach(q => {
        const choices = q.options ? ` options=${JSON.stringify(q.options)} default=${JSON.stringify(q.default)}` : '';
        output(`#${q.id} ${q.lane} ${compact(q.text ?? q.question, 2000)}${choices}`);
      });
      break;
    }
    case 'answer': {
      if (!opts.id || !words.length) throw new Error('answer --id N "text"');
      const answer = await request('/answers', { id: Number(opts.id), text: words.join(' ') });
      output(`answered #${answer.id}`);
      break;
    }
    case 'wait': {
      const lanes = opts.lanes?.split(',') ?? (opts.lane ? [opts.lane] : []);
      lanes.forEach(validLane);
      const event = await waitFor({ spec: opts.for ?? 'question,finished,error,stalled,context:60', lanes,
        since: opts.since === undefined ? undefined : Number(opts.since),
        stalledMinutes: Number(opts['stalled-minutes'] ?? 10), timeout: Number(opts['timeout-s'] ?? 0) * 1000,
        poll: Number(process.env.PI_BRIDGE_POLL_MS ?? 500) });
      output(eventSummary(event));
      break;
    }
    // Only process owners report lifecycle, never agent hooks.
    case 'started':
    case 'ended':
    case 'supervisor-started':
    case 'supervisor-ended': {
      await request('/lifecycle', { action: command, lane: opts.lane,
        runId: process.env.PI_BRIDGE_RUN_ID, code: words.length ? Number(words[0]) : undefined });
      break;
    }
    default: throw new Error('usage: bridge status|ask|answers|questions|answer|wait');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`bridge: ${error.message}`); process.exitCode = 1; });
}
