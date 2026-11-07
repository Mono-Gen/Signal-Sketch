import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectBrowserLanguage, dictionaries, getLanguage, loadSavedLanguage, setLanguage, t } from '../../src/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n 辞書', () => {
  const jaKeys = Object.keys(dictionaries.ja).sort();
  const enKeys = Object.keys(dictionaries.en).sort();

  it('日本語と英語でキーが一致する', () => {
    expect(enKeys).toEqual(jaKeys);
  });

  it('空の文言がない', () => {
    for (const lang of ['ja', 'en'] as const) {
      for (const [k, v] of Object.entries(dictionaries[lang])) {
        expect(v.trim().length, `${lang}: ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('プレースホルダが言語間で一致する', () => {
    for (const k of jaKeys) {
      const key = k as keyof typeof dictionaries.ja;
      expect(placeholders(dictionaries.en[key]), k).toEqual(placeholders(dictionaries.ja[key]));
    }
  });
});

describe('t', () => {
  it('プレースホルダを置換する', () => {
    expect(t('status.loaded', { nodes: 3, edges: 2 }, 'en')).toBe('Loaded: 3 devices / 2 connections');
    expect(t('status.loaded', { nodes: 3, edges: 2 }, 'ja')).toContain('3');
  });

  it('値が渡されなかったプレースホルダは、そのまま残す(欠落に気づける)', () => {
    expect(t('status.loadFailed', {}, 'en')).toContain('{reason}');
  });

  it('同じ値でも言語によって文言が違う', () => {
    expect(t('toolbar.save', {}, 'ja')).not.toBe(t('toolbar.save', {}, 'en'));
  });
});

describe('detectBrowserLanguage(ブラウザの言語からの判定)', () => {
  it('先頭が日本語なら日本語(地域つき・大文字小文字・_区切りも)', () => {
    expect(detectBrowserLanguage(['ja'])).toBe('ja');
    expect(detectBrowserLanguage(['ja-JP', 'en-US'])).toBe('ja');
    expect(detectBrowserLanguage(['JA-jp'])).toBe('ja');
    expect(detectBrowserLanguage(['ja_JP'])).toBe('ja');
  });

  it('先頭が日本語以外なら英語(日本語が第二言語でも英語)', () => {
    expect(detectBrowserLanguage(['en-US', 'ja'])).toBe('en');
    expect(detectBrowserLanguage(['fr-FR'])).toBe('en');
    expect(detectBrowserLanguage(['jaz'])).toBe('en'); // 「ja」で始まるだけの別言語を日本語にしない
  });

  it('一覧が空・空文字だけなら null(既定に任せる)', () => {
    expect(detectBrowserLanguage([])).toBeNull();
    expect(detectBrowserLanguage(['', '  '])).toBeNull();
  });
});

describe('loadSavedLanguage(優先順位: 保存済み → ブラウザ → 既定)', () => {
  const store = new Map<string, string>();
  const stubStorage = () =>
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    store.clear();
    setLanguage('ja');
  });

  it('保存済みの言語が、ブラウザの言語より優先される', () => {
    stubStorage();
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
    setLanguage('ja'); // 手動で日本語を選んだ状態(保存される)
    loadSavedLanguage();
    expect(getLanguage()).toBe('ja');
  });

  it('保存が無ければブラウザの言語に従う', () => {
    stubStorage();
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
    loadSavedLanguage();
    expect(getLanguage()).toBe('en');
  });

  it('自動判定の結果は保存しない', () => {
    stubStorage();
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
    loadSavedLanguage();
    expect(store.size).toBe(0);
  });

  it('保存領域もブラウザ情報も使えなくても例外にならず、現在の言語のまま', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('navigator', undefined);
    setLanguage('ja');
    expect(() => loadSavedLanguage()).not.toThrow();
    expect(getLanguage()).toBe('ja');
  });
});
