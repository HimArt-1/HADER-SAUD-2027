import { describe, expect, it } from 'vitest';
import { parseClassSections } from '../components/admin/classStructure';

describe('class structure input', () => {
  it('accepts Arabic and English commas and removes duplicate sections', () => {
    expect(parseClassSections('أ، ب, ج، أ,  د  ')).toEqual(['أ', 'ب', 'ج', 'د']);
  });

  it('returns an empty list for blank separators', () => {
    expect(parseClassSections(' ، ,  ')).toEqual([]);
  });
});
