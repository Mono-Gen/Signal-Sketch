import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '../../src/i18n';
import type { ActionError } from '../../src/model/actions';
import { MAX_EDGES_PER_PAGE, MAX_NODES_PER_PAGE, MAX_PORTS_PER_PAGE } from '../../src/model/docLimits';
import { errorText } from '../../src/ui/errorText';

let saved: ReturnType<typeof getLanguage>;
beforeEach(() => {
  saved = getLanguage();
  setLanguage('ja');
});
afterEach(() => setLanguage(saved));

/** ActionError の全コード。ここに無いコードが増えたら、型(Record)が文言の追加を要求する */
const ALL_ERRORS: ActionError[] = [
  'unknown-page',
  'unknown-node',
  'unknown-port',
  'unknown-template',
  'self-connection',
  'duplicate-edge',
  'port-occupied',
  'invalid-value',
  'invalid-port-groups',
  'ports-in-use',
  'position-occupied',
  'unknown-frame',
  'unknown-signal',
  'signal-in-use',
  'page-too-small',
  'import-no-space',
  'document-too-large',
];

describe('errorText', () => {
  it.each(ALL_ERRORS)('%s は、日本語・英語とも、空でない文言になる', (error) => {
    for (const lang of ['ja', 'en'] as const) {
      setLanguage(lang);
      const text = errorText({ ok: false, error, blockers: ['A'] });
      expect(text.trim().length, `${lang}: ${error}`).toBeGreaterThan(0);
      expect(text, `${lang}: ${error}`).not.toMatch(/\{\w+\}/); // 置換されないプレースホルダが残らない
    }
  });

  it('置けない機器・小さくできないページは、名称を先頭3件まで示し、残りは件数にする', () => {
    const text = errorText({ ok: false, error: 'import-no-space', blockers: ['a', 'b', 'c', 'd', 'e'] });
    expect(text).toContain('a、b、c');
    expect(text).toContain('ほか2件');
    expect(text).not.toContain('d、');
    expect(errorText({ ok: false, error: 'page-too-small', blockers: ['x'] })).toContain('x');
  });

  it('図が大きすぎる場合は、上限の数値を示す', () => {
    const text = errorText({ ok: false, error: 'document-too-large' });
    for (const n of [MAX_NODES_PER_PAGE, MAX_PORTS_PER_PAGE, MAX_EDGES_PER_PAGE]) expect(text).toContain(String(n));
  });
});
