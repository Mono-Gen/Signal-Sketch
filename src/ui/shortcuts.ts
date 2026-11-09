export interface ShortcutCommands {
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  undo(): void;
  redo(): void;
  copy(): void;
  paste(): void;
  duplicate(): void;
  save(): void;
  /** Ctrl+A: 機器・枠・線をすべて選ぶ */
  selectAll(): void;
  /** Esc: ポートの選択を解除する */
  escape(): void;
  deleteSelection(): void;
  /** 矢印キー: 選択中の機器・枠を、グリッド1つ分(dx, dy は -1/0/1)動かす */
  nudge(dx: number, dy: number): void;
}

/**
 * キーボードショートカット。入力欄・テキスト欄・選択欄に文字を打っている間は、何も奪わない。
 * 責任: キーの判定と、対応する操作の呼び出し。対象外: 操作そのもの(呼び出し側が渡す)。
 */
export function installShortcuts(c: ShortcutCommands): void {
  window.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    // モーダルのダイアログが開いている間は、背後の図を操作するキー(Ctrl+A・Delete・Ctrl+Z など)を奪わない
    if (document.querySelector('dialog[open]')) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (mod && (ev.key === '=' || ev.key === '+')) {
      ev.preventDefault();
      c.zoomIn();
    } else if (mod && ev.key === '-') {
      ev.preventDefault();
      c.zoomOut();
    } else if (mod && ev.key === '0') {
      ev.preventDefault();
      c.zoomReset();
    } else if (mod && key === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      c.undo();
    } else if (mod && (key === 'y' || (key === 'z' && ev.shiftKey))) {
      ev.preventDefault();
      c.redo();
    } else if (mod && key === 'c') {
      ev.preventDefault();
      c.copy();
    } else if (mod && key === 'v') {
      ev.preventDefault();
      c.paste();
    } else if (mod && key === 'd') {
      ev.preventDefault(); // ブラウザのブックマーク登録を起こさない
      c.duplicate();
    } else if (mod && key === 'a') {
      ev.preventDefault(); // ページ全体の文字選択を起こさない
      c.selectAll();
    } else if (mod && key === 's') {
      ev.preventDefault();
      c.save();
    } else if (ev.key === 'Escape') {
      c.escape();
    } else if (!mod && !ev.altKey && !target?.closest('[role="menu"]') && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault(); // ページのスクロールを起こさない
      c.nudge(ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0, ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0);
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      c.deleteSelection();
    }
  });
}
