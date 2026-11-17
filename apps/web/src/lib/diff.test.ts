import { describe, expect, it } from 'vitest';
import { wordDiff } from './diff';

const join = (parts: ReturnType<typeof wordDiff>, keep: 'before' | 'after') =>
  parts.filter((p) => p.type === 'same' || p.type === (keep === 'after' ? 'added' : 'removed')).map((p) => p.text).join('');

describe('wordDiff', () => {
  it('marks removed and added words and rejoins both sides exactly', () => {
    const before = '- Responsible for building APIs in Node.js';
    const after = 'Built APIs in Node.js for the payments team';
    const parts = wordDiff(before, after);
    expect(join(parts, 'after')).toBe(after);
    expect(join(parts, 'before')).toBe('Responsible for building APIs in Node.js');
    expect(parts.find((p) => p.type === 'removed')!.text).toContain('Responsible');
    expect(parts.some((p) => p.type === 'added' && p.text.includes('payments'))).toBe(true);
  });

  it('treats a case-only change and the bullet as unchanged', () => {
    expect(wordDiff('- cut latency by 40%', 'Cut latency by 40%')).toEqual([{ type: 'same', text: 'Cut latency by 40%' }]);
  });
});
