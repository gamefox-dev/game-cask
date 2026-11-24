// SPDX-License-Identifier: CC0-1.0
// K73: the e2e/port collector's classification. Breakage caught: (1) a network-level request failure (aborted, DNS,
// connection refused) passing a test silently (before K73 the collector never saw `requestfailed`); (2) a broad
// `allow(/guest:/)` masking a request failure; (3) an allowed authentic guest error repeating without bound.
import { describe, expect, it } from 'vitest';
import { isCancellation, unexpected, type Collected } from '../support/browser-collector';

const empty = (): Collected => ({ consoleErrors: [], pageErrors: [], failedRequests: [], requestFailures: [] });

describe('K73 browser collector', () => {
  it('reports a network-level request failure', () => {
    const c = { ...empty(), requestFailures: ['net::ERR_CONNECTION_REFUSED GET http://127.0.0.1:1/x'] };
    expect(unexpected(c, []).requestFailures).toEqual(c.requestFailures);
  });
  it('only allowRequestFailure entries allow request failures (allow() never does)', () => {
    const c = { ...empty(), requestFailures: ['net::ERR_FAILED GET http://h/guest:x', 'net::ERR_ABORTED GET http://h/stream/a.bin'] };
    expect(unexpected(c, [/guest:/, /.*/]).requestFailures).toHaveLength(2);
    expect(unexpected(c, [], [/\/stream\/a\.bin$/]).requestFailures).toEqual(['net::ERR_FAILED GET http://h/guest:x']);
  });
  it('caps an allowed entry with { pattern, max } across all lists', () => {
    const c = { ...empty(), consoleErrors: ['[game] guest: E1', '[game] guest: E1', '[game] guest: E1'], pageErrors: ['guest: E1 page'] };
    expect(unexpected(c, [{ pattern: /guest: E1/, max: 4 }])).toEqual({ pageErrors: [], consoleErrors: [], failedRequests: [], requestFailures: [] });
    const over = unexpected(c, [{ pattern: /guest: E1/, max: 2 }]);
    expect(over.pageErrors).toEqual([]); // page errors are counted first
    expect(over.consoleErrors).toEqual(['[game] guest: E1', '[game] guest: E1']);
    expect(unexpected(c, [{ pattern: /guest: E1/, max: 0 }]).consoleErrors).toHaveLength(3);
    // An uncapped later entry still allows what a capped one no longer does; a plain RegExp is unbounded.
    expect(unexpected(c, [{ pattern: /guest: E1/, max: 1 }, /guest:/]).consoleErrors).toEqual([]);
    expect(unexpected(c, [/guest: E1/]).consoleErrors).toEqual([]);
    // Global (g) patterns keep working on every entry (lastIndex is reset).
    expect(unexpected(c, [/guest: E1/g]).consoleErrors).toEqual([]);
  });
  it('caps request-failure allowances too and rejects malformed entries', () => {
    const c = { ...empty(), requestFailures: ['net::ERR_ABORTED GET http://h/a', 'net::ERR_ABORTED GET http://h/a'] };
    expect(unexpected(c, [], [{ pattern: /\/a$/, max: 1 }]).requestFailures).toHaveLength(1);
    expect(() => unexpected(c, [{ pattern: /x/, max: -1 }])).toThrow(/max: integer/);
    expect(() => unexpected(c, [{ pattern: 'x' as unknown as RegExp, max: 1 }])).toThrow(/RegExp/);
  });
  it('recognizes cancellation error texts of all three engines (navigation-abort candidates)', () => {
    for (const t of ['net::ERR_ABORTED', 'NS_BINDING_ABORTED', 'Load request cancelled', 'cancelled']) expect(isCancellation(t)).toBe(true);
    for (const t of ['net::ERR_CONNECTION_REFUSED', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_FAILED', 'Blocked by Web Inspector', undefined]) expect(isCancellation(t)).toBe(false);
  });
});
