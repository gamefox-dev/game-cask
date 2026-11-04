// Original CC0-1.0. Never let the deliberate scale byte-OOM mask missing/additional/unrelated errors.
import { expect, it } from 'vitest';
import { E_LIMIT, E_INVALID, GPU_OP } from '../../bgt/runtime/abi';
import { assertGlErrors } from '../support/gl-scale-contract';
import type { CommandError } from '../../bgt/runtime/commands';
const error: CommandError = { code: E_LIMIT, op: GPU_OP.BUFFER_CREATE, message: 'resource limit exceeded', offset: 16 };
const host = (errors: CommandError[]) => ({ commandErrors: errors, commandErrorCount: errors.length });
it.each(['x64-gl-scale', 'x64-gl-scale-interp'])('requires exactly one expected error on completion: %s', id => {
  expect(() => assertGlErrors(id, host([]))).not.toThrow(); // Before the deliberate failing operation.
  expect(() => assertGlErrors(id, host([]), true)).toThrow(/exactly one/);
  expect(() => assertGlErrors(id, host([error]), true)).not.toThrow();
  expect(() => assertGlErrors(id, host([error, error]), true)).toThrow(/exactly one/);
  expect(() => assertGlErrors(id, host([error, error]))).toThrow(/exactly one/);
  for (const other of [{ ...error, code: E_INVALID }, { ...error, op: GPU_OP.BUFFER_UPDATE }]) {
    expect(() => assertGlErrors(id, host([other]), true)).toThrow(/exactly one/);
    expect(() => assertGlErrors(id, host([other]))).toThrow(/exactly one/);
  }
  expect(() => assertGlErrors(id, { ...host([error]), commandErrorCount: 2 }, true)).toThrow(/exactly one/);
});
it.each(['x64-gl', 'x64-gl-capacity', 'x64-gl-feedback', 'fixture'])('retains the global zero-error rule: %s', id => {
  expect(() => assertGlErrors(id, host([]), true)).not.toThrow();
  expect(() => assertGlErrors(id, host([error]))).toThrow();
  expect(() => assertGlErrors(id, host([error]), true)).toThrow();
});
