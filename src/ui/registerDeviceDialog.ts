import { t } from '../i18n';
import { MAX_TEMPLATE_NAME_LENGTH } from '../model/templateActions';
import { el, field } from './dom';

/** 開いている間は true。選択変更などで要求が重なっても、ダイアログを複数出さない */
let opened = false;

/** 入力を登録名へ正規化する。前後の空白を除いた1〜上限文字だけを受け付ける */
export function parseRegistrationName(value: string): string | null {
  const name = value.trim();
  return name.length >= 1 && name.length <= MAX_TEMPLATE_NAME_LENGTH ? name : null;
}

/**
 * 「この機器を登録」の名前入力ダイアログ。確定すると整形済みの名前、取り消すと null を返す。
 * 責任: 名前の入力と検証。対象外: テンプレートの作成(registerTemplate)と重複名の採番。
 */
export function askRegistrationName(initialName: string): Promise<string | null> {
  if (opened) return Promise.resolve(null);
  opened = true;
  return new Promise((resolve) => {
    const input = el('input', {
      attrs: {
        type: 'text',
        value: initialName,
        'data-register': 'name',
      },
    });
    const error = el('p', { className: 'dialog-error', attrs: { role: 'alert' } });
    const ok = el('button', { text: t('registerDevice.ok'), attrs: { type: 'submit', 'data-register': 'ok' } });
    const cancel = el('button', { text: t('registerDevice.cancel'), attrs: { type: 'button', 'data-register': 'cancel' } });
    const form = el('form', { attrs: { method: 'dialog', novalidate: '' }, className: 'row-dialog-form' }, [
      el('h2', { text: t('registerDevice.title') }),
      field(t('registerDevice.name'), input),
      error,
      el('div', { className: 'dialog-actions' }, [cancel, ok]),
    ]);
    const dialog = el('dialog', { className: 'row-dialog', attrs: { 'aria-label': t('registerDevice.title') } }, [form]);

    let result: string | null = null;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const parsed = parseRegistrationName(input.value);
      if (!parsed) {
        error.textContent = t('registerDevice.invalid', { max: MAX_TEMPLATE_NAME_LENGTH });
        return;
      }
      result = parsed;
      dialog.close();
    });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      opened = false;
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
