import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import { PRESETS, isPresetTemplateId } from '../model/presets';
import { isCustomTemplateId } from '../model/templateActions';
import type { DiagramDocument } from '../model/types';
import { iconDataUri } from '../view/icons';
import { FLAT_THEME } from '../view/theme';
import type { Theme } from '../view/theme';
import { el } from './dom';

export interface PaletteItem {
  source: 'preset' | 'doc' | 'frame' | 'note';
  id: string;
}

/** ドラッグ&ドロップで運ぶデータの種類名 */
export const DRAG_MIME = 'application/x-diagram-palette-item';

/** 機器の一覧。クリックで空き位置へ追加、ドラッグで好きな位置へ配置する */
export class Palette {
  constructor(
    private readonly root: HTMLElement,
    private readonly getDoc: () => DiagramDocument,
    private readonly onAdd: (item: PaletteItem) => void,
    private readonly onRemoveTemplate: (templateId: string) => void,
    private readonly getTheme: () => Theme = () => FLAT_THEME,
  ) {}

  render(): void {
    const doc = this.getDoc();
    this.root.replaceChildren(el('h2', { text: t('palette.title') }), el('p', { className: 'hint', text: t('palette.hint') }));

    this.root.append(el('h3', { text: t('palette.frames') }), this.list([
      { item: { source: 'frame' as const, id: 'frame' }, name: t('frame.add'), kind: 'frame' },
      { item: { source: 'note' as const, id: 'note' }, name: t('palette.note'), kind: 'note' },
    ]));

    this.root.append(el('h3', { text: t('palette.standard') }), this.list(
      PRESETS.map((p) => ({ item: { source: 'preset' as const, id: p.id }, name: t(`preset.${p.id}` as MessageKey), kind: p.kind })),
    ));

    // 図の中にある、標準機器以外のテンプレート(読み込んだ図が持っていたもの)
    const custom = doc.deviceTemplates.filter((x) => !isPresetTemplateId(x.id));
    if (custom.length > 0) {
      this.root.append(el('h3', { text: t('palette.custom') }), this.list(
        custom.map((x) => ({ item: { source: 'doc' as const, id: x.id }, name: x.name, kind: x.kind, removable: isCustomTemplateId(x.id) })),
      ));
    }
  }

  private list(entries: { item: PaletteItem; name: string; kind: string; removable?: boolean }[]): HTMLElement {
    const ul = el('ul', { className: 'palette-list' });
    for (const e of entries) {
      const icon =
        e.kind === 'frame' || e.kind === 'note'
          ? el('span', { text: e.kind === 'note' ? 'T' : '⬚', attrs: { 'aria-hidden': 'true' }, className: 'palette-glyph' })
          : el('img', { attrs: { src: iconDataUri(e.kind, this.getTheme().nodeStroke), width: '20', height: '20', alt: '' } });
      const btn = el(
        'button',
        {
          className: 'palette-item',
          attrs: { type: 'button', draggable: 'true', 'data-palette-id': `${e.item.source}:${e.item.id}` },
          on: {
            click: () => this.onAdd(e.item),
            dragstart: (ev) => {
              const dt = (ev as DragEvent).dataTransfer;
              if (!dt) return;
              dt.setData(DRAG_MIME, JSON.stringify(e.item));
              dt.effectAllowed = 'copy';
            },
          },
        },
        [icon, el('span', { text: e.name })],
      );
      const remove = e.removable
        ? el('button', {
            className: 'palette-remove',
            text: '×',
            attrs: {
              type: 'button',
              'aria-label': t('palette.removeRegistration', { name: e.name }),
              title: t('palette.removeRegistration', { name: e.name }),
              'data-template-remove': e.item.id,
            },
            on: {
              click: (event) => {
                event.stopPropagation();
                this.onRemoveTemplate(e.item.id);
              },
            },
          })
        : undefined;
      ul.append(el('li', { className: 'palette-row' }, [btn, ...(remove ? [remove] : [])]));
    }
    return ul;
  }
}
