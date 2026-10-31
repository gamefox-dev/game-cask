/* global AbortSignal */
import { setTimeout as sleep } from 'node:timers/promises';
import { matchWait, parseWait } from './server.mjs';

export function bridgeURL(env = process.env) {
  const port = Number(env.PI_BRIDGE_PORT ?? 5190);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid PI_BRIDGE_PORT');
  return `http://127.0.0.1:${port}`;
}
export async function request(path, body, { base = bridgeURL(), signal, timeout = 5000 } = {}) {
  const options = { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) :
    AbortSignal.timeout(timeout), headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) { options.method = 'POST'; options.body = JSON.stringify(body); }
  const response = await fetch(`${base}${path}`, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `bridge HTTP ${response.status}`);
  return result;
}
export async function waitFor({ spec, lanes = [], since, stalledMinutes = 10, timeout = 0,
  poll = 500, signal, base } = {}) {
  const specs = parseWait(spec);
  if (!Number.isFinite(stalledMinutes) || stalledMinutes <= 0) throw new Error('invalid stalled minutes');
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error('invalid timeout');
  if (!Number.isFinite(poll) || poll < 1) throw new Error('invalid poll interval');
  if (since !== undefined && (!Number.isSafeInteger(since) || since < 0)) throw new Error('invalid event cursor');
  const deadline = timeout ? Date.now() + timeout : Infinity;
  let cursor = since;
  while (true) {
    const state = await request('/state', undefined, { base, signal });
    cursor ??= state.seq;
    const event = matchWait(state, specs, lanes, cursor, Date.now(), stalledMinutes);
    if (event) return event;
    if (Date.now() >= deadline) throw new Error('wait timeout');
    await sleep(Math.min(poll, deadline - Date.now()), undefined, { signal });
  }
}
export function eventSummary(event) {
  return `${event.lane} ${event.type}${event.id ? ` #${event.id}` : ''}` +
    `${event.code == null ? '' : ` exit=${event.code}`}`;
}
