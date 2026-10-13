import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as evaluator from '../../scripts/retrieval-evaluation.js';

it('distinguishes absent denominators from misses and deduplicates expected records', () => {
  expect(evaluator.recall([], [])).toEqual({ hits: 0, expected: 0, ratio: null, missing: [] });
  expect(evaluator.recall(['a', 'a', 'b'], ['a', 'a'])).toEqual({ hits: 1, expected: 2, ratio: 0.5, missing: ['b'] });
  expect(evaluator.recall(['a'], [])).toMatchObject({ ratio: 0, missing: ['a'] });
});
it('finds denied metadata anywhere in an error or body envelope', () => {
  expect(evaluator.exposure({ ok: false, data: { error: { message: 'secret/source.ts' } } }, ['secret/source.ts', 'absent'])).toEqual(['secret/source.ts']);
});
it('rejects duplicate task IDs and unknown relevance annotations', async () => {
  const fixture = JSON.parse(await readFile(evaluator.defaultFixturePath, 'utf8'));
  const duplicate = structuredClone(fixture); duplicate.tasks[1].id = duplicate.tasks[0].id;
  expect(() => evaluator.fixtureSchema.parse(duplicate)).toThrow(/Duplicate tasks/);
  const unknown = structuredClone(fixture); unknown.tasks[0].expected = ['nonexistent'];
  expect(() => evaluator.fixtureSchema.parse(unknown)).toThrow(/Unknown expected/);
});
it('gates an unexpected lost strict-term match while retaining explicitly annotated baseline misses', () => {
  // Deliberate runtime RED: the initial evaluator has no per-case baseline regression gate.
  const baselineFailures = (evaluator as unknown as { baselineFailures: (expected: string[], knownMissing: string[], actual: string[]) => string[] }).baselineFailures;
  expect(typeof baselineFailures).toBe('function');
  expect(baselineFailures(['cache'], [], [])).toEqual(['Lost baseline record cache']);
  expect(baselineFailures(['retry'], ['retry'], [])).toEqual([]);
  expect(baselineFailures([], [], ['private'])).toEqual(['Unexpected baseline record private']);
});
