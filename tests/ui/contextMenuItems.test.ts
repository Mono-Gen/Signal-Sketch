import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en';
import ja from '../../src/i18n/ja';
import { buildMenuItems } from '../../src/ui/contextMenuItems';
import type { MenuContext, MenuItem } from '../../src/ui/contextMenuItems';

// 期待値は計画書(.tasks/context_menu)の表から導く。

const ctx = (selected: Partial<MenuContext['selected']>, over: Partial<MenuContext> = {}): MenuContext => ({
  selected: { nodes: 0, frames: 0, edges: 0, ...selected },
  canPaste: true,
  modKey: 'Ctrl',
  ...over,
});
const items = (c: MenuContext) => buildMenuItems(c).filter((i): i is Extract<MenuItem, { kind: 'item' }> => i.kind === 'item');
const types = (c: MenuContext) => items(c).map((i) => (i.command.type === 'align' ? `align:${i.command.mode}` : i.command.type === 'distribute' ? `distribute:${i.command.axis}` : i.command.type));
const find = (c: MenuContext, type: string) => items(c).find((i) => i.command.type === type);

describe('buildMenuItems', () => {
  it('何も選んでいない: 貼り付けとすべて選択だけ', () => {
    expect(types(ctx({}))).toEqual(['paste', 'selectAll']);
  });

  it('何も選んでいない: コピー内容がなければ貼り付けは無効(理由つき)で、すべて選択は有効', () => {
    const c = ctx({}, { canPaste: false });
    const paste = find(c, 'paste')!;
    expect(paste.disabled).toBe(true);
    expect(paste.reasonKey).toBe('status.nothingToPaste');
    expect(find(c, 'selectAll')!.disabled).toBeFalsy();
  });

  it('機器を1台: コピー・複製・削除だけ(揃えは出ない)', () => {
    expect(types(ctx({ nodes: 1 }))).toEqual(['copy', 'duplicate', 'delete']);
  });

  it('枠だけ・機器と枠: コピー・複製は有効', () => {
    expect(find(ctx({ frames: 1 }), 'copy')!.disabled).toBeFalsy();
    expect(find(ctx({ nodes: 1, frames: 1 }), 'duplicate')!.disabled).toBeFalsy();
  });

  it('線だけを選択: コピー・複製は無効で、削除は有効', () => {
    const c = ctx({ edges: 2 });
    expect(find(c, 'copy')!.disabled).toBe(true);
    expect(find(c, 'duplicate')!.disabled).toBe(true);
    expect(find(c, 'delete')!.disabled).toBeFalsy();
  });

  it('機器を2台: 揃え6種が出て、等間隔は無効(理由は「3台以上」)', () => {
    const c = ctx({ nodes: 2 });
    expect(types(c)).toEqual([
      'copy', 'duplicate', 'delete',
      'align:left', 'align:hcenter', 'align:right', 'align:top', 'align:vcenter', 'align:bottom',
      'distribute:horizontal', 'distribute:vertical',
    ]);
    for (const i of items(c).filter((x) => x.command.type === 'distribute')) {
      expect(i.disabled).toBe(true);
      expect(i.reasonKey).toBe('align.needThree');
    }
    expect(items(c).filter((x) => x.command.type === 'align').every((x) => !x.disabled)).toBe(true);
  });

  it('機器を3台: 等間隔が有効', () => {
    const c = ctx({ nodes: 3 });
    expect(items(c).filter((x) => x.command.type === 'distribute').every((x) => !x.disabled)).toBe(true);
  });

  it('機器1台+枠1つ(機器は2台未満): 揃えは出ない(枠は揃えの対象外)', () => {
    expect(types(ctx({ nodes: 1, frames: 1 }))).toEqual(['copy', 'duplicate', 'delete']);
  });

  it('ショートカット表記は修飾キーに従う(Mac は ⌘)', () => {
    expect(find(ctx({ nodes: 1 }), 'copy')!.shortcut).toBe('Ctrl+C');
    expect(find(ctx({ nodes: 1 }, { modKey: '⌘' }), 'duplicate')!.shortcut).toBe('⌘+D');
    expect(find(ctx({ nodes: 1 }), 'delete')!.shortcut).toBe('Delete');
  });

  it('区切り線は、先頭・末尾・連続に出ない', () => {
    for (const c of [ctx({}), ctx({ nodes: 1 }), ctx({ nodes: 2 }), ctx({ nodes: 5, frames: 2 }), ctx({ edges: 1 })]) {
      const all = buildMenuItems(c);
      expect(all[0].kind).toBe('item');
      expect(all[all.length - 1].kind).toBe('item');
      all.forEach((x, i) => {
        if (x.kind === 'separator') expect(all[i + 1].kind).toBe('item');
      });
    }
  });

  it('使うラベルと理由の文言が、日英の辞書にそろっている', () => {
    for (const c of [ctx({}), ctx({ nodes: 2 }), ctx({ edges: 1 }), ctx({}, { canPaste: false })]) {
      for (const i of items(c)) {
        for (const key of [i.labelKey, i.reasonKey].filter((k): k is NonNullable<typeof k> => Boolean(k))) {
          expect(ja[key], `ja ${key}`).toBeTruthy();
          expect(en[key], `en ${key}`).toBeTruthy();
        }
      }
    }
  });
});
