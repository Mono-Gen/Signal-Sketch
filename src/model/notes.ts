// メモ(図の上に置く、文字だけの部品)の上限と既定値。モデル・検査・画面で共有する。

/** 1ページに置けるメモの数 */
export const MAX_NOTES_PER_PAGE = 100;
/** メモ1つの文字数 */
export const MAX_NOTE_LENGTH = 1000;
/** 文字の大きさ(px)の範囲と既定 */
export const MIN_NOTE_FONT = 8;
export const MAX_NOTE_FONT = 48;
export const DEFAULT_NOTE_FONT = 14;
/** メモの箱の大きさ(折り返しと、つかめる範囲を決める) */
export const MIN_NOTE_SIZE = { w: 40, h: 20 };
export const DEFAULT_NOTE_SIZE = { w: 200, h: 60 };
/** 置いた直後の本文(空だと見えず、見つけにくいため) */
export const DEFAULT_NOTE_TEXT = 'メモ';
