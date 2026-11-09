import type { MessageKey } from '../i18n';
import { MIN_ALIGN_COUNT, MIN_DISTRIBUTE_COUNT } from '../model/align';
import type { AlignMode, DistributeAxis } from '../model/align';

// 右クリックメニューの項目を、選択の状態から作る(DOM を持たない純関数。実行は contextMenu.ts が行う)。

export type MenuCommand =
  | { type: 'copy' }
  | { type: 'duplicate' }
  | { type: 'delete' }
  | { type: 'paste' }
  | { type: 'selectAll' }
  | { type: 'align'; mode: AlignMode }
  | { type: 'distribute'; axis: DistributeAxis };

export type MenuItem =
  | { kind: 'separator' }
  | {
      kind: 'item';
      command: MenuCommand;
      labelKey: MessageKey;
      /** 右端に出すショートカット(「Ctrl+C」など)。ないものは省略 */
      shortcut?: string;
      /** 押せない項目。理由は reasonKey で title に出す */
      disabled?: boolean;
      reasonKey?: MessageKey;
    };

export interface MenuContext {
  /** 選択中の数(機器・枠・線) */
  selected: { nodes: number; frames: number; edges: number; notes?: number };
  /** 貼り付ける内容があるか */
  canPaste: boolean;
  /** 修飾キーの表記(Windows は「Ctrl」、Mac は「⌘」) */
  modKey: string;
}

const ALIGN_MODES: readonly AlignMode[] = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
const DISTRIBUTE_AXES: readonly DistributeAxis[] = ['horizontal', 'vertical'];

const SEPARATOR: MenuItem = { kind: 'separator' };

/**
 * 項目の一覧を作る。
 * - 何も選んでいない(何もない場所で右クリック): 貼り付け・すべて選択。
 * - 何かを選んでいる: コピー・複製・削除。コピーと複製は機器か枠が要る(線だけの選択には使えない)。
 * - 機器を2台以上: 揃え6種。等間隔は3台以上で使える(3台未満は無効で表示し、理由を示す)。
 */
export function buildMenuItems(ctx: MenuContext): MenuItem[] {
  const { nodes, frames, edges } = ctx.selected;
  const notes = ctx.selected.notes ?? 0;
  const total = nodes + frames + edges + notes;
  const key = (letter: string) => `${ctx.modKey}+${letter}`;

  if (total === 0) {
    return [
      { kind: 'item', command: { type: 'paste' }, labelKey: 'menu.paste', shortcut: key('V'), disabled: !ctx.canPaste, reasonKey: 'status.nothingToPaste' },
      SEPARATOR,
      { kind: 'item', command: { type: 'selectAll' }, labelKey: 'menu.selectAll', shortcut: key('A') },
    ];
  }

  const copyable = nodes + frames + notes > 0;
  const items: MenuItem[] = [
    { kind: 'item', command: { type: 'copy' }, labelKey: 'menu.copy', shortcut: key('C'), disabled: !copyable, reasonKey: 'status.nothingToCopy' },
    { kind: 'item', command: { type: 'duplicate' }, labelKey: 'menu.duplicate', shortcut: key('D'), disabled: !copyable, reasonKey: 'status.nothingToCopy' },
    { kind: 'item', command: { type: 'delete' }, labelKey: 'menu.delete', shortcut: 'Delete' },
  ];

  if (nodes >= MIN_ALIGN_COUNT) {
    items.push(SEPARATOR);
    for (const mode of ALIGN_MODES) items.push({ kind: 'item', command: { type: 'align', mode }, labelKey: `align.${mode}` as MessageKey });
    items.push(SEPARATOR);
    for (const axis of DISTRIBUTE_AXES) {
      const enough = nodes >= MIN_DISTRIBUTE_COUNT;
      items.push({
        kind: 'item',
        command: { type: 'distribute', axis },
        labelKey: `align.distribute.${axis}` as MessageKey,
        disabled: !enough,
        reasonKey: enough ? undefined : 'align.needThree',
      });
    }
  }
  return items;
}
