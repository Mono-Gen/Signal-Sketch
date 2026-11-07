import { LEGACY_APP_IDS, storageKey } from '../app/appInfo';
import type { Language } from '../model/types';
import en from './en';
import ja from './ja';
import type { MessageKey } from './ja';

const dictionaries: Record<Language, Record<MessageKey, string>> = { ja, en };

let current: Language = 'ja';

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  current = lang;
  try {
    localStorage.setItem(storageKey('language'), lang);
  } catch {
    // 保存領域が使えない環境(プライベートウィンドウ等)でも動作を続ける
  }
}

/**
 * ブラウザの言語設定(優先順の一覧)から言語を決める。
 * 先頭の言語が日本語なら日本語、それ以外は英語。一覧が空なら null(呼び出し側の既定に任せる)。
 * 先頭だけを見るのは、「英語が第一言語で日本語は第二」という利用者に英語を出すため。
 */
export function detectBrowserLanguage(languages: readonly string[]): Language | null {
  const first = languages.find((l) => typeof l === 'string' && l.trim() !== '');
  if (first === undefined) return null;
  return first.trim().toLowerCase().split(/[-_]/)[0] === 'ja' ? 'ja' : 'en';
}

/**
 * 起動時の言語を決める。優先順位: 保存済みの設定(手動で選んだ言語) → ブラウザの言語 → 既定(日本語)。
 * 自動判定の結果は保存しない(保存すると、後でブラウザの言語を変えても追従できなくなるため)。
 */
export function loadSavedLanguage(): void {
  try {
    // 名前を変える前の版で保存された設定も、引き継いで読む(現在のキーが優先)
    const keys = [storageKey('language'), ...LEGACY_APP_IDS.map((id) => storageKey('language', id))];
    for (const key of keys) {
      const saved = localStorage.getItem(key);
      if (saved === 'ja' || saved === 'en') {
        current = saved;
        return;
      }
    }
  } catch {
    // 読めない場合は、ブラウザの言語→既定の順で決める
  }
  try {
    const languages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
    const detected = detectBrowserLanguage(languages);
    if (detected !== null) current = detected;
  } catch {
    // 取得できない環境では既定の言語(日本語)のまま
  }
}

/** 文言を取得する。`{name}` 形式のプレースホルダを params で置換する */
export function t(key: MessageKey, params: Record<string, string | number> = {}, lang: Language = current): string {
  return dictionaries[lang][key].replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export { dictionaries };
export type { MessageKey };
