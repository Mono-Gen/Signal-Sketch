import { t } from '../i18n';
import { MAX_ROW_COUNT, MAX_ROW_GAP } from '../model/actions';
import type { RowLayout } from '../model/actions';
import { el, field, select } from './dom';

/** 直前に確定した設定(メモリ内だけ。保存しない)。次に開くときの初期値になる */
let last: RowLayout | null = null;
/** 開いている間は true。Shift+ドロップが続けて起きても、ダイアログを重ねない */
let opened = false;

/** 入力欄の文字から、一列配置の設定を読む。不正なら null(個数は整数 1〜上限、間隔は 0〜上限) */
export function parseRowLayout(countText: string, directionText: string, gapText: string): RowLayout | null {
  const count = Number(countText);
  const gap = Number(gapText);
  if (countText.trim() === '' || gapText.trim() === '') return null;
  if (!Number.isInteger(count) || count < 1 || count > MAX_ROW_COUNT) return null;
  if (!Number.isFinite(gap) || gap < 0 || gap > MAX_ROW_GAP) return null;
  if (directionText !== 'horizontal' && directionText !== 'vertical') return null;
  return { count, direction: directionText, gap };
}

/**
 * 「一列に並べて追加」の設定ダイアログ。確定すると設定を、取り消す(Esc・キャンセル)と null を返す。
 * 責任: 設定の入力と検証。対象外: 配置そのもの(モデルの addNodesInRow)。
 * defaultGap はグリッドに合わせた初期の間隔(直前の設定があればそちらを使う)。
 */
export function askRowLayout(defaultGap: number): Promise<RowLayout | null> {
  if (opened) return Promise.resolve(null);
  opened = true;
  return new Promise((resolve) => {
    const init = last ?? { count: 3, direction: 'horizontal' as const, gap: defaultGap };
    const count = el('input', { attrs: { type: 'number', min: '1', max: String(MAX_ROW_COUNT), step: '1', value: String(init.count), 'data-row': 'count' } });
    const direction = select(
      [
        { value: 'horizontal', label: t('rowPlace.horizontal') },
        { value: 'vertical', label: t('rowPlace.vertical') },
      ],
      init.direction,
    );
    direction.setAttribute('data-row', 'direction');
    const gap = el('input', { attrs: { type: 'number', min: '0', max: String(MAX_ROW_GAP), step: '1', value: String(init.gap), 'data-row': 'gap' } });
    const error = el('p', { className: 'dialog-error', attrs: { role: 'alert' } });
    const ok = el('button', { text: t('rowPlace.ok'), attrs: { type: 'submit', 'data-row': 'ok' } });
    const cancel = el('button', { text: t('rowPlace.cancel'), attrs: { type: 'button', 'data-row': 'cancel' } });
    const form = el('form', { attrs: { method: 'dialog', novalidate: '' }, className: 'row-dialog-form' }, [
      el('h2', { text: t('rowPlace.title') }),
      field(t('rowPlace.count'), count),
      field(t('rowPlace.direction'), direction),
      field(t('rowPlace.gap'), gap),
      error,
      el('div', { className: 'dialog-actions' }, [cancel, ok]),
    ]);
    const dlg = el('dialog', { className: 'row-dialog', attrs: { 'aria-label': t('rowPlace.title') } }, [form]);

    let result: RowLayout | null = null;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const parsed = parseRowLayout(count.value, direction.value, gap.value);
      if (!parsed) {
        error.textContent = t('rowPlace.invalid', { maxCount: MAX_ROW_COUNT, maxGap: MAX_ROW_GAP });
        return;
      }
      result = parsed;
      last = parsed;
      dlg.close();
    });
    cancel.addEventListener('click', () => dlg.close());
    // Esc・キャンセル・確定のどれでも、閉じたときに1回だけ結果を返し、要素を片付ける
    dlg.addEventListener('close', () => {
      dlg.remove();
      opened = false;
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    count.focus();
    count.select();
  });
}
