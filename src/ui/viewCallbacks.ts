import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import { addEdge, addEdges, movePort } from '../model/actions';
import { resizeNodeRect } from '../model/imageActions';
import type { Action, ActionResult } from '../model/actions';
import { moveSelection, resizeFrame } from '../model/frames';
import { moveNotes, resizeNote } from '../model/noteActions';
import type { DiagramView, ViewCallbacks } from '../view/diagramView';
import type { PropertiesPanel } from './propertiesPanel';
import type { SetStatus } from './statusBar';

export interface ViewCallbacksDeps {
  pageId: string;
  apply(action: Action): ActionResult;
  setStatus: SetStatus;
  /** いま状態表示に出している文字(「ポートを選びました」のヒントが、まだ出ているかの確認に使う) */
  getStatusText(): string;
  /** ビューとパネルは、このコールバックを渡して作るので、あとから取り出せるようにする(作成順の循環を避ける) */
  getView(): DiagramView;
  getPanel(): PropertiesPanel;
}

/**
 * 画面からモデルへの要求(ViewCallbacks)の実装。画面は状態を持たず、操作はここ経由でモデルへ戻り、
 * 結果の通知は状態表示に出す。
 * 責任: 画面の操作を、モデルの操作と通知へ変えること。対象外: 描画・座標の扱い(DiagramView / PortInteractions)。
 */
export function createViewCallbacks(deps: ViewCallbacksDeps): ViewCallbacks {
  const { pageId, apply, setStatus } = deps;
  /** 右上に出した「N個のポートを選びました」の文。解除時に、それがまだ出ているときだけ消す(別の表示は消さない) */
  let portsHint: string | null = null;

  return {
    onMove(moves, frameMoves, noteMoves) {
      // 機器・枠とメモを1回の操作にする(元に戻すで一度に戻る)。どちらかが失敗したら全体を取り消す
      const action: Action = (doc) => {
        const r = moveSelection(pageId, moves, frameMoves)(doc);
        return r.ok && noteMoves.length > 0 ? moveNotes(pageId, noteMoves)(doc) : r;
      };
      if (!apply(action).ok) deps.getView().render(); // 失敗した場合は、画面の位置をモデルに合わせて戻す
    },
    onNodeResize(nodeId, rect, fitImage) {
      // 最小より小さい・ページの外などは、モデルが補正して反映する。失敗した場合は、画面の大きさをモデルに合わせて戻す
      if (!apply(resizeNodeRect(pageId, nodeId, rect, { fitImage })).ok) deps.getView().render();
    },
    onNoteResize(noteId, rect) {
      if (!apply(resizeNote(pageId, noteId, rect)).ok) deps.getView().render(); // 失敗時は元の大きさへ戻す
    },
    onFrameResize(frameId, rect) {
      if (!apply(resizeFrame(pageId, frameId, rect)).ok) deps.getView().render(); // 小さすぎる等は元の大きさへ戻す
    },
    onConnect(from, to) {
      const r = apply(addEdge(pageId, from, to));
      if (!r.ok) {
        deps.getView().render(); // ドラッグ中に画面へ仮に追加された線を取り除く
        return;
      }
      // 信号・方向の不一致は、右上には出さない。確認事項の件数・一覧と、線の破線/点線で伝える(重複を避ける)
      setStatus('ok', t('status.connected'));
    },
    onPortMove(nodeId, portId, side, pos) {
      if (!apply(movePort(pageId, nodeId, portId, side, pos)).ok) deps.getView().render(); // 失敗時は元の位置へ戻す
    },
    onPortsSelected(count) {
      if (count > 0) {
        portsHint = t('status.portsSelected', { count });
        setStatus('info', portsHint);
      } else if (portsHint !== null) {
        const stillShown = deps.getStatusText() === portsHint; // 情報の表示には記号が付かないので、文がそのまま一致する
        portsHint = null;
        if (stillShown) setStatus('info', t('status.ready')); // 選択を解除したら、選択中のヒントも消す(他のメッセージは消さない)
      }
    },
    onBulkConnect(plan) {
      if (plan.refused) {
        const text = plan.refused === 'mixed-direction' ? t('error.bulkMixedDirection') : plan.refused === 'unknown-target' ? t('error.bulkUnknownTarget') : t('error.unknownPort');
        setStatus('error', text); // 選択は残す(Esc で解除するか、別の落とし先を試せる)
        return;
      }
      const reasons = [...new Set(plan.skipped.map((s) => t(`bulk.skip.${s.reason}` as MessageKey)))].join(t('list.separator'));
      if (plan.pairs.length === 0) {
        setStatus('warn', t('status.bulkNothing', { reasons }));
        return;
      }
      if (!apply(addEdges(pageId, plan.pairs)).ok) return;
      if (plan.skipped.length === 0) setStatus('ok', t('status.bulkConnected', { count: plan.pairs.length }));
      else setStatus('warn', t('status.bulkConnectedSkipped', { count: plan.pairs.length, skipped: plan.skipped.length, reasons }));
    },
    onSelectionChange() {
      const view = deps.getView();
      const panel = deps.getPanel();
      const sel = view.getSelection();
      const total = sel.nodeIds.length + sel.edgeIds.length + sel.frameIds.length + sel.noteIds.length;
      const onlyOne = total === 1;
      if (sel.noteIds.length > 0 && sel.noteIds.length === total) panel.updateNotes(sel.noteIds);
      else if (total >= 2) panel.updateMulti(total, sel.nodeIds);
      else if (onlyOne && sel.frameIds.length === 1) panel.updateFrame(sel.frameIds[0]);
      else panel.update(onlyOne && sel.nodeIds.length === 1 ? sel.nodeIds[0] : null);
    },
  };
}
