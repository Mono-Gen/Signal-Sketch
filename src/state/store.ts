import type { Action, ActionResult } from '../model/actions';
import { documentLimitIssue } from '../model/docLimits';
import { usedAssets } from '../model/imageActions';
import type { DiagramDocument } from '../model/types';
import { reconcileWaypoints } from '../model/waypoints';

type Listener = () => void;

/**
 * ドキュメントの唯一の保持者(SSOT)。操作は Action として適用し、
 * 適用前の状態を履歴に積む。失敗した操作は何も変えず、履歴にも残さない。
 */
export class DocumentStore {
  private current: DiagramDocument;
  private undoStack: DiagramDocument[] = [];
  private redoStack: DiagramDocument[] = [];
  private listeners = new Set<Listener>();
  private revision = 0;
  private savedRevision = 0;
  private replaceCount = 0;

  constructor(initial: DiagramDocument, private readonly historyLimit = 100) {
    this.current = structuredClone(initial);
  }

  get doc(): DiagramDocument {
    return this.current;
  }

  /** 図が丸ごと入れ替わった(新規・読込)回数。時間のかかる処理(画像の取り込みなど)が、始めた図のままかの確認に使う */
  get epoch(): number {
    return this.replaceCount;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 最後に保存(または読込)してから変更があるか */
  get isDirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(action: Action): ActionResult {
    // 複製に対して実行し、失敗時は現在の状態をそのまま保つ
    // 画像(assets)は大きく(最大5MB)、操作のたびに複製して履歴に積むとメモリを使い切るので、複製せず共有する。
    // 画像は書き換えず、変えるときは新しいオブジェクトに差し替える決まり(setNodeImage)なので、共有しても履歴は壊れない
    const { assets, ...rest } = this.current;
    const draft = { ...structuredClone(rest), assets } as DiagramDocument;
    const result = action(draft);
    if (!result.ok) return result;
    // 機器やポートが動いたとき、手動で引き直した線の経路を追従させる(または捨てる)
    reconcileWaypoints(this.current, draft);
    // どの機器・登録テンプレートからも使われなくなった画像は、図から外す(外す・差し替える・機器を消すたびに、枚数の上限へ近づかないよう)
    if (draft.assets && Object.keys(draft.assets).length > 0) {
      const used = usedAssets(draft);
      if (Object.keys(used).length !== Object.keys(draft.assets).length) draft.assets = used;
    }
    // 図全体の上限(機器・ポート・接続の数)。追加・貼り付け・台数の変更などのどの操作でも、超える結果は適用しない
    if (documentLimitIssue(draft)) return { ok: false, error: 'document-too-large' };
    this.undoStack.push(this.current);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
    this.current = draft;
    this.revision++;
    this.emit();
    return result;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.current);
    this.current = prev;
    this.revision++;
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.current);
    this.current = next;
    this.revision++;
    this.emit();
    return true;
  }

  /** ドキュメントを丸ごと差し替える(新規・読込)。履歴は破棄し、保存済みの状態とみなす */
  replace(doc: DiagramDocument): void {
    this.current = structuredClone(doc);
    this.replaceCount++;
    this.undoStack = [];
    this.redoStack = [];
    this.revision++;
    this.savedRevision = this.revision;
    this.emit();
  }

  markSaved(): void {
    this.savedRevision = this.revision;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
