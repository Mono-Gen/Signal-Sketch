export type StatusKind = 'info' | 'ok' | 'warn' | 'error';

/** 状態表示を出す関数 */
export type SetStatus = (kind: StatusKind, text: string) => void;

export interface StatusBar {
  set: SetStatus;
  /** いま表示している文字(記号を含む)。何も出していなければ空 */
  text(): string;
}

const ICON: Record<StatusKind, string> = { info: '', ok: '✓ ', warn: '⚠ ', error: '✕ ' };

/** 状態表示を自動で消すまでの時間(ms)。拒否の理由は読む時間が要るので長め。info は消さない */
const STATUS_TTL: Partial<Record<StatusKind, number>> = { ok: 4000, warn: 8000, error: 8000 };

/**
 * 画面右上の状態表示。色だけでなく記号も付ける(ui_ux: 色+アイコン)。
 * 操作の結果と拒否の理由は、一定時間で消える(次のメッセージが出れば置き換わる)。
 * 確認すべき内容は、消えずに残る「確認事項」の側に出す。
 * 責任: 1つの要素への表示と、自動で消すこと。対象外: 文言の決定(呼び出し側)。
 */
export function createStatusBar(el: HTMLElement): StatusBar {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set: SetStatus = (kind, text) => {
    clearTimeout(timer);
    el.dataset.kind = kind;
    el.textContent = ICON[kind] + text;
    el.title = el.textContent; // 省略表示になっても全文を読めるように
    const ttl = STATUS_TTL[kind];
    if (ttl !== undefined) {
      timer = setTimeout(() => {
        el.textContent = '';
        el.removeAttribute('title');
        el.dataset.kind = 'info';
      }, ttl);
    }
  };
  return { set, text: () => el.textContent ?? '' };
}
