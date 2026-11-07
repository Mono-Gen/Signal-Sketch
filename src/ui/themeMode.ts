import { storageKey } from '../app/appInfo';
import type { ThemeName } from '../view/theme';

/** 利用者の選択。auto は「OS(ブラウザ)の設定に従う」 */
export type ThemePreference = 'auto' | 'light' | 'dark';

const STORAGE_NAME = 'theme';
const ORDER: readonly ThemePreference[] = ['auto', 'light', 'dark'];

/** 保存された値を解釈する。想定外の値(壊れた保存・別の版の値)は auto として扱う */
export function parsePreference(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

/** 実際に使うテーマを決める。auto のときだけ、OS の設定を見る */
export function resolveTheme(pref: ThemePreference, systemDark: boolean): ThemeName {
  if (pref === 'auto') return systemDark ? 'dark' : 'light';
  return pref;
}

/** ボタンを押したときの次の選択(自動 → ライト → ダーク → 自動) */
export function nextPreference(pref: ThemePreference): ThemePreference {
  return ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]!;
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 保存済みの選択を読む。無い・読めない場合は auto */
export function loadPreference(storage: ThemeStorage | undefined): ThemePreference {
  try {
    return parsePreference(storage?.getItem(storageKey(STORAGE_NAME)));
  } catch {
    return 'auto'; // 保存領域が使えない環境でも動作を続ける
  }
}

/** 選択を保存する。auto は「保存なし」で表す(後でOSの設定を変えても追従できるように) */
export function savePreference(storage: ThemeStorage | undefined, pref: ThemePreference): void {
  try {
    if (pref === 'auto') storage?.removeItem(storageKey(STORAGE_NAME));
    else storage?.setItem(storageKey(STORAGE_NAME), pref);
  } catch {
    // 保存できなくても、この画面の間は選択を保つ
  }
}

export interface ThemeController {
  readonly preference: ThemePreference;
  readonly effective: ThemeName;
  /** 自動 → ライト → ダーク の順に切り替える */
  cycle(): void;
}

export interface ThemeControllerDeps {
  root: HTMLElement;
  storage?: ThemeStorage;
  /** OSがダークかどうかの問い合わせ。無い環境ではライト扱い */
  systemQuery?: MediaQueryList;
  /** 有効なテーマまたは選択が変わったときに呼ぶ(起動時にも1回呼ぶ) */
  onChange(effective: ThemeName, preference: ThemePreference): void;
}

/**
 * テーマの選択を持ち、<html data-theme> に反映する。
 * auto のときは属性を付けず、CSS の prefers-color-scheme に任せる(起動直後のちらつきを避けるため)。
 * 責任: 選択・保存・OS設定への追従。対象外: 色の中身(CSS変数と view/theme.ts)。
 */
export function createThemeController(deps: ThemeControllerDeps): ThemeController {
  const { root, storage, systemQuery, onChange } = deps;
  let preference = loadPreference(storage);

  const effectiveNow = (): ThemeName => resolveTheme(preference, systemQuery?.matches ?? false);

  function apply(): void {
    if (preference === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
    onChange(effectiveNow(), preference);
  }

  // OSの設定が変わったら、auto のときだけ追従する
  systemQuery?.addEventListener('change', () => {
    if (preference === 'auto') apply();
  });

  apply();

  return {
    get preference() {
      return preference;
    },
    get effective() {
      return effectiveNow();
    },
    cycle() {
      preference = nextPreference(preference);
      savePreference(storage, preference);
      apply();
    },
  };
}
