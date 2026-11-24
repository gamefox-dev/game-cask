// SPDX-License-Identifier: CC0-1.0. K73: classification behind the e2e/port-test `collector` fixture
// (tests/e2e/fixtures.ts). Pure, so the rules are unit-tested without a browser (tests/unit/browser-collector.test.ts).
//
// What fails a test: page errors, console errors, HTTP responses >= 400 and (K73) network-level request failures
// (Playwright `requestfailed`: aborted, DNS, connection refused/reset, blocked), unless explicitly allowed.
// - `allow(...)` covers page/console errors and HTTP >= 400 (as before). An entry is a RegExp (any number of matches)
//   or `{ pattern, max }` (K73): at most `max` matching entries are allowed in the whole test, every further one fails,
//   so a port can bound an authentic repeated guest error instead of allowing it without limit.
// - `allowRequestFailure(...)` is the only allowlist for request failures (an `allow(/guest:/)` never masks one).
//   Same entry forms. Use it for an intentional abort (e.g. a test that `route.abort()`s a request on purpose).
// - Navigation aborts are logged separately by the fixture. For early WebKit cancellations where the public
//   events cannot identify a navigation yet, use the fixture's explicit navigateAway(url, request).

export type AllowEntry = RegExp | { pattern: RegExp; max: number };

export interface Collected {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** `${errorText} ${method} ${url}` of requests that failed at the network level (not navigation aborts). */
  requestFailures: string[];
}

export interface Problems {
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
  requestFailures: string[];
}

/** Cancellation error texts: Chromium, Firefox, WebKit. Only these can be navigation aborts. */
export const isCancellation = (errorText: string | undefined): boolean =>
  !!errorText && /net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled|canceled/i.test(errorText);

function validEntry(e: AllowEntry): void {
  if (e instanceof RegExp) return;
  if (!e || !(e.pattern instanceof RegExp) || !Number.isInteger(e.max) || e.max < 0)
    throw new Error(`collector allow entry must be a RegExp or { pattern: RegExp, max: integer >= 0 }: ${String(e)}`);
}
export const validateAllow = (entries: AllowEntry[]): void => entries.forEach(validEntry);

/** Filter `items` (in order) through `allowed`: the first matching entry allows the item, while its cap lasts. */
function filter(items: string[][], allowed: AllowEntry[]): string[][] {
  const used = new Map<AllowEntry, number>();
  return items.map(list => list.filter((x) => {
    for (const e of allowed) {
      const pattern = e instanceof RegExp ? e : e.pattern;
      pattern.lastIndex = 0;
      if (!pattern.test(x)) continue;
      if (e instanceof RegExp) return false;
      const n = (used.get(e) ?? 0) + 1; used.set(e, n);
      if (n <= e.max) return false;
      // Over this entry's cap: a later entry may still allow it; otherwise it is unexpected.
    }
    return true;
  }));
}

/** The unexpected entries; a test passes only when every list is empty. Caps count across all lists of an allowlist. */
export function unexpected(c: Collected, allowed: AllowEntry[], allowedFailures: AllowEntry[] = []): Problems {
  validateAllow(allowed); validateAllow(allowedFailures);
  const [pageErrors, consoleErrors, failedRequests] = filter([c.pageErrors, c.consoleErrors, c.failedRequests], allowed);
  const [requestFailures] = filter([c.requestFailures], allowedFailures);
  return { pageErrors, consoleErrors, failedRequests, requestFailures };
}
