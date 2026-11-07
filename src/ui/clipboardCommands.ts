import { t } from '../i18n';
import type { Action, ActionResult } from '../model/actions';
import { removeItems } from '../model/actions';
import { copySelection, pasteClipboard, suggestPasteOffset } from '../model/clipboard';
import type { ClipboardData } from '../model/clipboard';
import type { DocumentStore } from '../state/store';
import type { DiagramView } from '../view/diagramView';
import type { SetStatus } from './statusBar';

export interface ClipboardCommandsDeps {
  store: DocumentStore;
  view: DiagramView;
  pageId: string;
  apply(action: Action): ActionResult;
  setStatus: SetStatus;
}

export interface ClipboardCommands {
  copy(): void;
  paste(): void;
  /** その場で複製する(コピー内容は変えない) */
  duplicate(): void;
  deleteSelection(): void;
}

/**
 * 選択した機器・枠のコピー・貼り付け・複製・削除。コピーした内容は、アプリの中だけで持つ
 * (新規・開くをまたいでも残る)。続けて貼り付けた回数を、ずらし量に使う。
 * 責任: 選択の取り出しと、結果の通知。対象外: 複製のデータ作り・貼り付け位置の計算(model/clipboard)。
 */
export function createClipboardCommands(deps: ClipboardCommandsDeps): ClipboardCommands {
  const { store, view, pageId, apply, setStatus } = deps;
  let clipboard: ClipboardData | null = null;
  let pasteCount = 0;

  function copyToClipboard(): ClipboardData | null {
    const data = copySelection(store.doc, pageId, view.getSelection());
    if (!data) {
      setStatus('warn', t('status.nothingToCopy'));
      return null;
    }
    return data;
  }

  /** 貼り付ける。続けて貼るたびに、少しずつずらす。貼り付けた機器・枠を選んだ状態にする */
  function pasteData(data: ClipboardData, step: number): void {
    const r = apply(pasteClipboard(pageId, data, suggestPasteOffset(store.doc, pageId, data, step)));
    if (!r.ok) return;
    view.selectItems(r.createdNodeIds ?? [], r.createdFrameIds ?? []);
    setStatus('ok', t('status.pasted', { count: (r.createdNodeIds?.length ?? 0) + (r.createdFrameIds?.length ?? 0) }));
  }

  return {
    copy() {
      const data = copyToClipboard();
      if (!data) return;
      clipboard = data;
      pasteCount = 0;
      setStatus('ok', t('status.copied', { count: data.nodes.length + data.frames.length }));
    },
    paste() {
      if (!clipboard) {
        setStatus('warn', t('status.nothingToPaste'));
        return;
      }
      pasteCount += 1;
      pasteData(clipboard, pasteCount);
    },
    duplicate() {
      const data = copyToClipboard();
      if (data) pasteData(data, 1);
    },
    deleteSelection() {
      const sel = view.getSelection();
      if (sel.nodeIds.length === 0 && sel.edgeIds.length === 0 && sel.frameIds.length === 0) return;
      store.apply(removeItems(pageId, sel));
    },
  };
}
