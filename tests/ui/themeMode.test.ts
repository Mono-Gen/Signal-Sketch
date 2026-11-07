import { describe, expect, it, vi } from 'vitest';
import {
  createThemeController,
  loadPreference,
  nextPreference,
  parsePreference,
  resolveTheme,
  savePreference,
} from '../../src/ui/themeMode';
import type { ThemeStorage } from '../../src/ui/themeMode';

const KEY = 'signal-sketch:theme';

function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** 最小の HTMLElement 代わり(属性の付け外しだけを使う) */
function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  } as unknown as HTMLElement & { attrs: Map<string, string> };
}

/** OSの設定(prefers-color-scheme)の代わり。set() で変更を通知できる */
function fakeSystem(dark: boolean) {
  let listener: (() => void) | undefined;
  const q = {
    matches: dark,
    addEventListener: (_: string, l: () => void) => {
      listener = l;
    },
  };
  return {
    query: q as unknown as MediaQueryList,
    set(next: boolean) {
      q.matches = next;
      listener?.();
    },
  };
}

describe('themeMode の純粋な判定', () => {
  it('保存値: light/dark以外(壊れた値・null・数値)は auto', () => {
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference('dark')).toBe('dark');
    for (const bad of ['auto', 'Dark', '', null, undefined, 1, {}]) expect(parsePreference(bad)).toBe('auto');
  });

  it('auto はOSに従い、手動の選択はOSより優先される', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('切り替えは 自動 → ライト → ダーク → 自動', () => {
    expect(nextPreference('auto')).toBe('light');
    expect(nextPreference('light')).toBe('dark');
    expect(nextPreference('dark')).toBe('auto');
  });
});

describe('保存', () => {
  it('手動の選択は保存し、auto は保存なし(キーを消す)', () => {
    const s = memoryStorage();
    savePreference(s, 'dark');
    expect(s.data.get(KEY)).toBe('dark');
    savePreference(s, 'auto');
    expect(s.data.has(KEY)).toBe(false);
  });

  it('保存領域が無い・例外を投げても、読み書きで落ちない', () => {
    const broken: ThemeStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadPreference(broken)).toBe('auto');
    expect(() => savePreference(broken, 'dark')).not.toThrow();
    expect(loadPreference(undefined)).toBe('auto');
    expect(() => savePreference(undefined, 'light')).not.toThrow();
  });

  it('保存済みの値を読み込む', () => {
    expect(loadPreference(memoryStorage({ [KEY]: 'light' }))).toBe('light');
  });
});

describe('createThemeController', () => {
  it('起動時に1回通知し、auto では data-theme を付けない(CSSのOS判定に任せる)', () => {
    const root = fakeRoot();
    const sys = fakeSystem(true);
    const onChange = vi.fn();
    const c = createThemeController({ root, storage: memoryStorage(), systemQuery: sys.query, onChange });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('dark', 'auto');
    expect(root.attrs.has('data-theme')).toBe(false);
    expect(c.effective).toBe('dark');
  });

  it('保存済みの手動選択で起動し、data-theme に反映する', () => {
    const root = fakeRoot();
    const onChange = vi.fn();
    createThemeController({ root, storage: memoryStorage({ [KEY]: 'light' }), systemQuery: fakeSystem(true).query, onChange });
    expect(root.attrs.get('data-theme')).toBe('light');
    expect(onChange).toHaveBeenLastCalledWith('light', 'light');
  });

  it('cycle: 順に切り替え、保存と data-theme と通知が揃う', () => {
    const root = fakeRoot();
    const store = memoryStorage();
    const onChange = vi.fn();
    const c = createThemeController({ root, storage: store, systemQuery: fakeSystem(false).query, onChange });
    c.cycle();
    expect([c.preference, root.attrs.get('data-theme'), store.data.get(KEY)]).toEqual(['light', 'light', 'light']);
    c.cycle();
    expect([c.preference, root.attrs.get('data-theme'), store.data.get(KEY)]).toEqual(['dark', 'dark', 'dark']);
    c.cycle();
    expect([c.preference, root.attrs.has('data-theme'), store.data.has(KEY)]).toEqual(['auto', false, false]);
    expect(onChange).toHaveBeenLastCalledWith('light', 'auto');
  });

  it('OSの設定変更に追従するのは auto のときだけ', () => {
    const root = fakeRoot();
    const sys = fakeSystem(false);
    const onChange = vi.fn();
    const c = createThemeController({ root, storage: memoryStorage(), systemQuery: sys.query, onChange });
    sys.set(true);
    expect(onChange).toHaveBeenLastCalledWith('dark', 'auto');
    c.cycle(); // light(手動)
    onChange.mockClear();
    sys.set(false);
    sys.set(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(c.effective).toBe('light');
  });

  it('OSの問い合わせが無い環境(systemQuery なし)でも、ライトで動く', () => {
    const c = createThemeController({ root: fakeRoot(), onChange: () => {} });
    expect(c.effective).toBe('light');
    expect(() => c.cycle()).not.toThrow();
  });
});
