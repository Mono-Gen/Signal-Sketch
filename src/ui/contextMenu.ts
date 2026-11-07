import { t } from '../i18n';
import type { Action, ActionResult } from '../model/actions';
import { planAlign, planDistribute } from '../model/align';
import type { DocumentStore } from '../state/store';
import type { DiagramView } from '../view/diagramView';
import { applyAlignPlan } from './alignCommands';
import { buildMenuItems } from './contextMenuItems';
import type { MenuCommand, MenuItem } from './contextMenuItems';
import { el } from './dom';
import type { SetStatus } from './statusBar';

/**
 * 右クリックメニュー。表示・キーボード操作・閉じ方(この部品)と、対象に応じた項目の選択・実行(installContextMenu)を持つ。
 * 責任: 図の上の右クリックを受けて、既存のコマンドを呼ぶこと。対象外: 操作そのもの(各コマンドが持つ)、項目の決め方(contextMenuItems)。
 */

const EDGE_MARGIN = 4;

interface OpenMenu {
  root: HTMLElement;
  /** 閉じたときに戻すフォーカス */
  previousFocus: Element | null;
  cleanup: () => void;
}
let open: OpenMenu | null = null;

/** いま開いているメニューを閉じる(なければ何もしない) */
export function closeContextMenu(): void {
  if (!open) return;
  const { root, previousFocus, cleanup } = open;
  open = null;
  cleanup();
  root.remove();
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
}

export function isContextMenuOpen(): boolean {
  return open !== null;
}

interface ShowOptions {
  /** 画面上の位置(clientX / clientY) */
  x: number;
  y: number;
  items: readonly MenuItem[];
  onCommand(command: MenuCommand): void;
}

/** メニューを開く。すでに開いているものは閉じる。位置は、画面からはみ出さないよう内側へ寄せる */
export function showContextMenu(opts: ShowOptions): void {
  closeContextMenu();
  const buttons: HTMLButtonElement[] = [];
  let firstEnabled: number | null = null;
  const root = el('div', { className: 'context-menu', attrs: { role: 'menu', 'aria-label': t('menu.label') } });

  const run = (command: MenuCommand) => {
    closeContextMenu();
    opts.onCommand(command);
  };

  for (const item of opts.items) {
    if (item.kind === 'separator') {
      root.append(el('div', { className: 'context-menu-separator', attrs: { role: 'separator' } }));
      continue;
    }
    const disabled = item.disabled === true;
    const button = el(
      'button',
      {
        className: 'context-menu-item',
        attrs: {
          type: 'button',
          role: 'menuitem',
          tabindex: '-1',
          'data-command': item.command.type + (item.command.type === 'align' ? ':' + item.command.mode : item.command.type === 'distribute' ? ':' + item.command.axis : ''),
          ...(disabled ? { 'aria-disabled': 'true', ...(item.reasonKey ? { title: t(item.reasonKey) } : {}) } : {}),
        },
        on: { click: () => (disabled ? undefined : run(item.command)) },
      },
      [el('span', { text: t(item.labelKey) }), ...(item.shortcut ? [el('span', { className: 'context-menu-shortcut', text: item.shortcut })] : [])],
    );
    buttons.push(button);
    if (!disabled) firstEnabled = firstEnabled ?? buttons.length - 1;
    root.append(button);
  }

  const focusAt = (index: number) => {
    if (buttons.length === 0) return;
    buttons[(index + buttons.length) % buttons.length].focus({ preventScroll: true });
  };
  root.addEventListener('keydown', (ev) => {
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === 'ArrowDown') focusAt(current + 1);
    else if (ev.key === 'ArrowUp') focusAt(current < 0 ? -1 : current - 1);
    else if (ev.key === 'Home') focusAt(0);
    else if (ev.key === 'End') focusAt(-1);
    else if (ev.key === 'Escape') closeContextMenu();
    else if (ev.key === 'Tab') {
      closeContextMenu(); // 閉じるだけで、既定の移動は止めない(次の要素へ進める)
      return;
    }
    else if ((ev.key === 'Enter' || ev.key === ' ') && current >= 0) buttons[current].click(); // 無効な項目の click は何もしない
    else {
      closeContextMenu(); // ほかのキー(ショートカットなど)は、メニューを閉じたうえで、そのまま通す
      return;
    }
    ev.preventDefault();
    ev.stopPropagation(); // Esc などを、背後のショートカットに渡さない
  });

  // 外側の操作・スクロール・拡大縮小・ウィンドウの変化で閉じる(位置がずれたメニューを残さない)
  const onOutside = (ev: Event) => {
    if (!root.contains(ev.target as Node)) closeContextMenu();
  };
  const onDismiss = () => closeContextMenu();
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('scroll', onDismiss, true);
  window.addEventListener('wheel', onDismiss, { passive: true });
  window.addEventListener('resize', onDismiss);
  window.addEventListener('blur', onDismiss);
  const cleanup = () => {
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', onDismiss, true);
    window.removeEventListener('wheel', onDismiss);
    window.removeEventListener('resize', onDismiss);
    window.removeEventListener('blur', onDismiss);
  };

  open = { root, previousFocus: document.activeElement, cleanup };
  document.body.append(root);
  const rect = root.getBoundingClientRect();
  const left = Math.max(EDGE_MARGIN, Math.min(opts.x, window.innerWidth - rect.width - EDGE_MARGIN));
  const top = Math.max(EDGE_MARGIN, Math.min(opts.y, window.innerHeight - rect.height - EDGE_MARGIN));
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  focusAt(firstEnabled ?? 0);
}

export interface ContextMenuDeps {
  /** 右クリックを受ける要素(図の領域) */
  container: HTMLElement;
  view: DiagramView;
  store: DocumentStore;
  pageId: string;
  apply(action: Action): ActionResult;
  setStatus: SetStatus;
  clipboard: { copy(): void; paste(): void; duplicate(): void; deleteSelection(): void; canPaste(): boolean };
}

/**
 * 図の上の右クリックでメニューを出す。ブラウザ標準のメニューは、図の上でだけ止める。
 * 機器・枠・線の上で右クリックしたとき、それが選択に入っていなければ、その1つだけを選んでから開く
 * (すでに選択に入っていれば、複数選択のまま開く)。何もない場所では、選択を外してから開く。
 */
export function installContextMenu(deps: ContextMenuDeps): void {
  const { container, view, store, pageId, apply, setStatus, clipboard } = deps;
  const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  const execute = (command: MenuCommand): void => {
    const nodeIds = view.getSelection().nodeIds;
    const align = { pageId, apply, setStatus };
    switch (command.type) {
      case 'copy': return clipboard.copy();
      case 'duplicate': return clipboard.duplicate();
      case 'delete': return clipboard.deleteSelection();
      case 'paste': return clipboard.paste();
      case 'selectAll': return view.selectAll();
      case 'align': return applyAlignPlan(planAlign(store.doc, pageId, nodeIds, command.mode), align);
      case 'distribute': return applyAlignPlan(planDistribute(store.doc, pageId, nodeIds, command.axis), align);
    }
  };

  // 右ボタンを押した時点の選択。maxGraph は、選択できないセル(ポートなど)の上での右ボタンの押下で
  // 選択を1つに変えることがあるので、メニューを開くときにこの記録へ戻す(複数選択の上で右クリックしても選択が崩れない)。
  // Mac の Ctrl+クリックも、右クリックとして扱われる
  let atPress: ReturnType<DiagramView['getSelection']> | null = null;
  container.addEventListener(
    'pointerdown',
    (ev) => {
      atPress = ev.button === 2 || (ev.button === 0 && ev.ctrlKey && modKey === '⌘') ? view.getSelection() : null;
    },
    true,
  );

  container.addEventListener('contextmenu', (ev) => {
    if (document.querySelector('dialog[open]')) return; // ダイアログの上では、標準のまま
    ev.preventDefault();
    const target = view.targetAt(ev);
    const pressed = atPress;
    atPress = null;
    const inPressed = (t: NonNullable<typeof target>): boolean =>
      pressed !== null && (t.kind === 'node' ? pressed.nodeIds : t.kind === 'frame' ? pressed.frameIds : pressed.edgeIds).includes(t.id);
    // 押す前から選ばれていたものの上なら、その選択を戻す(複数のまま開く)
    if (target && pressed && inPressed(target)) view.setSelection(pressed);
    const before = view.getSelection();
    if (!target) {
      view.clearSelection();
    } else if (target.kind === 'node' && !before.nodeIds.includes(target.id)) {
      view.selectNode(target.id);
    } else if (target.kind === 'frame' && !before.frameIds.includes(target.id)) {
      view.selectFrame(target.id);
    } else if (target.kind === 'edge' && !before.edgeIds.includes(target.id)) {
      view.selectEdge(target.id);
    }
    const sel = view.getSelection();
    showContextMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: buildMenuItems({ selected: { nodes: sel.nodeIds.length, frames: sel.frameIds.length, edges: sel.edgeIds.length }, canPaste: clipboard.canPaste(), modKey }),
      onCommand: execute,
    });
  });
}
