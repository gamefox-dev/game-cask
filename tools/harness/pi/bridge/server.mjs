#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const lanePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export function validLane(lane) {
  if (typeof lane !== 'string' || !lanePattern.test(lane)) throw new Error('invalid lane');
  return lane;
}
function text(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 32000) throw new Error(`invalid ${name}`);
  return value;
}

// All mutations are synchronous: no request can interleave a read/modify/atomic-rename transaction.
export class BridgeStore {
  constructor(dir, now = Date.now) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, 'bridge-state.json');
    this.now = now;
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {
      version: 1, seq: 0, nextId: 1, lanes: {}, questions: [], answers: [], events: [],
    };
    if (this.state.version !== 1) throw new Error('unsupported bridge state version');
  }
  save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  event(type, lane, detail = {}) {
    const event = { seq: ++this.state.seq, type, lane, at: this.now(), ...detail };
    this.state.events.push(event);
    this.state.events = this.state.events.slice(-4096);
    return event;
  }
  status(body) {
    const lane = validLane(body.lane);
    const old = Object.hasOwn(this.state.lanes, lane) ? this.state.lanes[lane] : undefined;
    // Driver identity is independent of pi's session (forked on provider retries).
    // Reject late messages from an older driver, including inherited nested-lane environments.
    if (old?.runId && body.runId !== old.runId) throw new Error('stale driver status');
    if (old?.driverExitedAt != null) return old;
    const fresh = body.sessionId && body.sessionId !== old?.sessionId;
    const previous = fresh ? { runId: old?.runId, driverStartedAt: old?.driverStartedAt } : old ?? {};
    const allowed = ['steps', 'context', 'cost', 'model', 'tools', 'commit', 'errors', 'phase',
      'sessionFile', 'sessionId', 'leafId', 'cwd'];
    if (body.phase !== undefined && !['running', 'finished', 'error'].includes(body.phase)) {
      throw new Error('invalid phase');
    }
    for (const field of ['steps', 'cost']) {
      if (body[field] !== undefined && (!Number.isFinite(body[field]) || body[field] < 0)) {
        throw new Error(`invalid ${field}`);
      }
    }
    if (body.context != null && (typeof body.context !== 'object' ||
        ['tokens', 'contextWindow', 'percent'].some(k => body.context[k] != null &&
          (!Number.isFinite(body.context[k]) || body.context[k] < 0)))) throw new Error('invalid context');
    if (body.errors !== undefined && !Array.isArray(body.errors)) throw new Error('invalid errors');
    if (body.tools !== undefined && !Array.isArray(body.tools)) throw new Error('invalid tools');
    const patch = Object.fromEntries(allowed.filter(k => Object.hasOwn(body, k)).map(k => [k, body[k]]));
    const status = { ...previous, ...patch, agentPhase: body.phase ?? previous.agentPhase,
      phase: 'running', lane, updatedAt: this.now() };
    status.lastTurnAt = body.event === 'turn_end' ? this.now() : previous.lastTurnAt ?? this.now();
    this.state.lanes[lane] = status;
    this.event('status', lane, { context: status.context });
    const error = status.errors?.at(-1);
    if (error && JSON.stringify(error) !== JSON.stringify(previous.errors?.at(-1))) {
      this.event('error', lane, { message: typeof error === 'string' ? error : error.message });
    }
    this.save();
    return status;
  }
  lifecycle(body) {
    const { action, runId, code } = body;
    text(runId, 'runId');
    if (action === 'supervisor-started' || action === 'supervisor-ended') {
      const old = this.state.supervisor;
      if (action === 'supervisor-started') {
        if (old?.runId === runId) return old;
        if (old && old.exitedAt == null && old.runId !== runId) throw new Error('supervisor already running');
        this.state.supervisor = { runId, startedAt: this.now() };
      } else {
        if (old?.runId !== runId) throw new Error('stale supervisor exit');
        if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error('invalid exit code');
        if (old.exitedAt == null) {
          Object.assign(old, { code, exitedAt: this.now() });
          this.event('supervisor-exit', 'supervisor', { code, runId });
        }
      }
      this.save(); return this.state.supervisor;
    }
    const lane = validLane(body.lane);
    const old = this.state.lanes[lane];
    if (action === 'started') {
      if (old?.runId === runId) return old;
      if (old?.runId && old.driverExitedAt == null && old.runId !== runId) {
        throw new Error('lane driver already running');
      }
      this.state.lanes[lane] = { lane, runId, phase: 'running', driverStartedAt: this.now(),
        updatedAt: this.now(), lastTurnAt: this.now(), errors: [] };
    } else if (action === 'ended') {
      if (!old?.runId || old.runId !== runId) throw new Error('stale driver exit');
      if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error('invalid exit code');
      if (old.driverExitedAt == null) {
        Object.assign(old, { driverExit: code, driverExitedAt: this.now(), phase: code ? 'error' : 'finished' });
        this.event('finished', lane, { code, runId });
        if (code) this.event('error', lane, { code, runId, message: `pi driver exit ${code}` });
      }
    } else throw new Error('invalid lifecycle action');
    this.save(); return this.state.lanes[lane];
  }
  question(body) {
    const lane = validLane(body.lane);
    if (!['reviewer', 'instance'].includes(body.to)) throw new Error('invalid question destination');
    if (body.to === 'instance' && !Object.hasOwn(this.state.lanes, lane)) throw new Error(`unknown lane ${lane}`);
    const question = text(body.question, 'question');
    // CI commonly occupies a whole heavy-command slot for 15–45 minutes.
    const timeout = body.timeout_s ?? (body.to === 'reviewer' && /\brun\s+ci\b/i.test(question) ? 2700 : 900);
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 86400) throw new Error('invalid timeout_s');
    if (body.options !== undefined && (!Array.isArray(body.options) ||
        body.options.length > 50 || body.options.some(o => typeof o !== 'string' || o.length > 1000))) {
      throw new Error('invalid options');
    }
    if (body.default !== undefined && (typeof body.default !== 'string' || body.default.length > 32000)) {
      throw new Error('invalid default');
    }
    const q = { id: this.state.nextId++, lane, to: body.to, question,
      mode: body.mode === 'fork' ? 'fork' : 'live', options: body.options, default: body.default,
      createdAt: this.now(), expiresAt: this.now() + timeout * 1000, state: 'queued' };
    this.state.questions.push(q);
    this.event('question', lane, { id: q.id, to: q.to });
    this.save();
    return q;
  }
  claim(lane) {
    validLane(lane);
    const q = this.state.questions.find(q => q.lane === lane && q.to === 'instance' &&
      q.mode === 'live' && ['queued', 'delivered'].includes(q.state));
    if (q && q.state === 'queued') {
      q.state = 'delivered';
      q.deliveredAt = this.now();
      this.save();
    }
    return q ?? null;
  }
  answer(body) {
    const q = this.state.questions.find(q => q.id === Number(body.id));
    if (!q) throw new Error('unknown question id');
    const existing = this.state.answers.find(a => a.id === q.id);
    if (existing) return existing; // retries never duplicate or replace an answer
    const answer = { id: q.id, lane: q.lane, to: q.to, mode: q.mode,
      text: text(body.text, 'answer'), timedOut: body.timedOut === true, at: this.now() };
    q.state = answer.timedOut ? 'timed_out' : 'answered';
    this.state.answers.push(answer);
    this.event('answer', q.lane, { id: q.id });
    this.save();
    return answer;
  }
}

export function parseWait(value) {
  const specs = value.split(',');
  if (!specs.length || specs.some(s => !/^(question|finished|error|supervisor-exit|stalled(?::\d+(?:\.\d+)?)?|context:(100|\d{1,2})(\.\d+)?)$/.test(s))) {
    throw new Error('expected question,finished,error,supervisor-exit,stalled[:MINUTES],context:PERCENT');
  }
  if (specs.some(s => s.startsWith('context:') && Number(s.slice(8)) > 100)) {
    throw new Error('context threshold must be <= 100');
  }
  if (specs.some(s => s.startsWith('stalled:') && (!Number.isFinite(Number(s.slice(8))) || Number(s.slice(8)) <= 0))) {
    throw new Error('stalled minutes must be positive');
  }
  return specs;
}

// Level-trigger existing actionable state; also retain transient events after a caller's cursor.
export function matchWait(state, specs, lanes = [], since = state.seq, now = Date.now(), stalledMinutes = 10) {
  const selected = lane => !lanes.length || lanes.includes(lane);
  const matches = event => (event.type === 'supervisor-exit' || selected(event.lane)) &&
    (event.type !== 'supervisor-exit' || (state.supervisor?.runId === event.runId &&
      state.supervisor?.exitedAt != null)) &&
    (event.type !== 'finished' || (state.lanes[event.lane]?.runId === event.runId &&
      state.lanes[event.lane]?.driverExitedAt != null && event.code != null)) && specs.some(spec =>
    (spec === event.type && (spec !== 'question' || event.to === 'reviewer')) ||
    (spec.startsWith('context:') && event.type === 'status' &&
      event.context?.percent != null && event.context.percent >= Number(spec.slice(8))));
  const event = state.events.find(e => e.seq > since && matches(e));
  if (event) return { ...event, type: event.type === 'status' ? 'context' : event.type };
  if (specs.includes('supervisor-exit') && state.supervisor?.exitedAt != null) {
    return { type: 'supervisor-exit', lane: 'supervisor', code: state.supervisor.code };
  }
  if (specs.includes('question')) {
    const q = state.questions.find(q => selected(q.lane) && q.to === 'reviewer' && q.state === 'queued' &&
      q.expiresAt > now);
    if (q) return { type: 'question', lane: q.lane, id: q.id };
  }
  for (const status of Object.values(state.lanes)) {
    if (!selected(status.lane)) continue;
    if (specs.includes('finished') && status.driverExitedAt != null) {
      return { type: 'finished', lane: status.lane, code: status.driverExit };
    }
    if (specs.includes('error') && status.phase === 'error') return { type: 'error', lane: status.lane };
    if (status.phase === 'running' && specs.some(s => (s === 'stalled' || s.startsWith('stalled:')) &&
        now - status.lastTurnAt >= (s === 'stalled' ? stalledMinutes : Number(s.slice(8))) * 60000)) {
      return { type: 'stalled', lane: status.lane };
    }
    const threshold = specs.find(s => s.startsWith('context:') && status.context?.percent != null &&
      status.context.percent >= Number(s.slice(8)));
    if (threshold) return { type: 'context', lane: status.lane, percent: status.context.percent };
  }
  return null;
}

export function startBridge({ dir, port = 5190, now } = {}) {
  if (!dir) throw new Error('a private run directory is required');
  const store = new BridgeStore(resolve(dir), now);
  const server = createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // No browser-origin callers or DNS-rebinding hosts. This is a same-user localhost service, not authentication.
    if (req.headers.origin || !/^127\.0\.0\.1(:\d+)?$/.test(req.headers.host ?? '')) {
      send(403, { error: 'localhost clients only' }); return;
    }
    try {
      if (req.method === 'GET' && req.url === '/state') { send(200, store.state); return; }
      if (req.method !== 'POST') { send(404, { error: 'not found' }); return; }
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 262144) { send(413, { error: 'body too large' }); return; }
      }
      const body = JSON.parse(raw);
      let result;
      switch (req.url) {
        case '/status': result = store.status(body); break;
        case '/lifecycle': result = store.lifecycle(body); break;
        case '/questions': result = store.question(body); break;
        case '/claim': result = store.claim(body.lane); break;
        case '/answers': result = store.answer(body); break;
        default: send(404, { error: 'not found' }); return;
      }
      send(200, result);
    } catch (error) { send(400, { error: error.message }); }
  });
  server.requestTimeout = 10000;
  server.listen(port, '127.0.0.1');
  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = process.argv[2] ?? process.env.PI_BRIDGE_DIR;
  try {
    const { server } = startBridge({ dir, port: Number(process.env.PI_BRIDGE_PORT ?? 5190) });
    server.on('error', error => { console.error(`bridge: ${error.message}`); process.exitCode = 1; });
    server.on('listening', () => console.log(`bridge listening 127.0.0.1:${server.address().port}`));
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
  } catch (error) { console.error(`bridge: ${error.message}`); process.exitCode = 1; }
}
