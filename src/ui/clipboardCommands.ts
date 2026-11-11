import { t } from '../i18n';
import type { Action, ActionResult } from '../model/actions';
import { removeItems } from '../model/actions';
import { countRemovedPortEdges, removePorts } from '../model/portActions';
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
  /** 貼り付ける内容があるか(右クリックメニューで、貼り付けの有効・無効を決める) */
  canPaste(): boolean;
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
    view.selectItems(r.createdNodeIds ?? [], r.createdFrameIds ?? [], r.createdNoteIds ?? []);
    setStatus('ok', t('status.pasted', { count: (r.createdNodeIds?.length ?? 0) + (r.createdFrameIds?.length ?? 0) + (r.createdNoteIds?.length ?? 0) }));
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
    canPaste: () => clipboard !== null,
    duplicate() {
      const data = copyToClipboard();
      if (data) pasteData(data, 1);
    },
    deleteSelection() {
      // 枠で選んだポートがあるときは、機器や線より先に、そのポートを削除する(右クリックの「ポートを削除」と同じ)
      const ports = view.getPortSelection();
      if (ports.length > 0) {
        const byNode = new Map<string, string[]>();
        for (const p of ports) byNode.set(p.nodeId, [...(byNode.get(p.nodeId) ?? []), p.portId]);
        const edgeCount = [...byNode].reduce((sum, [nodeId, ids]) => sum + countRemovedPortEdges(store.doc, pageId, nodeId, ids), 0);
        if (edgeCount > 0 && !window.confirm(t('confirm.removePorts', { count: edgeCount }))) return;
        // 複数の機器にまたがっても、元に戻す操作は1回でまとめて戻る。途中で失敗したら、全体を適用しない
        apply((doc) => {
          for (const [nodeId, ids] of byNode) {
            const r = removePorts(pageId, nodeId, ids)(doc);
            if (!r.ok) return r;
          }
          return { ok: true };
        });
        return;
      }
      const sel = view.getSelection();
      if (sel.nodeIds.length === 0 && sel.edgeIds.length === 0 && sel.frameIds.length === 0 && sel.noteIds.length === 0) return;
      store.apply(removeItems(pageId, sel));
    },
  };
}
