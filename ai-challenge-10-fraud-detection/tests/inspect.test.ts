import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runInspect, TELLS_TITLE } from '../src/inspect.js';

const root = join(import.meta.dirname, '..');

describe('npm run inspect', () => {
  it('runs to completion on the seed 42 dataset and prints every check', () => {
    const text = runInspect(join(root, 'data'), join(root, 'config'));
    expect(text.startsWith(TELLS_TITLE)).toBe(true);
    for (const column of ['Mean ID rank', 'Amount % 100 = 0', 'Weekend', 'Inpatient', 'Unseen (dx, procedures)']) {
      expect(text).toContain(column);
    }
    // Decisions 12 and 18: the clean data has none of these by construction.
    expect(text).toContain('Clean claims with amount in 47,500–49,999: 0');
    expect(text).toContain('Clean claim pairs, same member + diagnosis, 1–7 days apart: 0');
  });
});
