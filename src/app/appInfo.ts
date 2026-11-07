// アプリ名の唯一の定義場所(設計書 D12)。
// 名前は変わりうるため、表示名・内部ID・保存キーの接頭辞はここだけで決め、
// 他のコードや文言に名前を直書きしない。

/** 画面に表示する名前 */
export const APP_NAME = 'Signal-Sketch';

/** 内部ID(保存キーの接頭辞などに使う。表示名とは独立に変えられる) */
export const APP_ID = 'signal-sketch';

/**
 * ブラウザの保存領域(localStorage)のキーを作る。
 * アプリ名を変えたときは、旧IDを LEGACY_APP_IDS に追加して旧キーから引き継ぐ。
 */
export function storageKey(name: string, appId: string = APP_ID): string {
  return `${appId}:${name}`;
}

/** 過去に使った内部ID。名前変更時に追加し、設定の引き継ぎに使う */
export const LEGACY_APP_IDS: readonly string[] = ['diagram-maker'];
