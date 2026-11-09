import { Cell, CellState, ConnectionHandler, EventObject, Graph, InternalEvent, PopupMenuHandler, RubberBandHandler, SelectionCellsHandler, TooltipHandler, VertexHandler, getDefaultPlugins } from '@maxgraph/core';
import { t } from '../i18n';
import { findPortByRef, getNodePorts, layoutNodePorts } from '../model/query';
import { markerSpec } from '../model/portMarker';
import { connectionIssues } from '../model/diagnostics';
import type { BulkPlan } from '../model/bulkConnect';
import type { Port } from '../model/ports';
import type { PortRef, Side } from '../model/types';
import type { DocumentStore } from '../state/store';
import { DEFAULT_NOTE_FONT } from '../model/notes';
import { escapeHtml } from '../util/escapeHtml';
import { imageBox, isImageDataUri } from '../model/images';
import { iconDataUri } from './icons';
import { PortInteractions } from './portInteractions';
import { portTooltipHtml } from './portTooltip';
import { FLAT_THEME, signalColor } from './theme';
import type { Theme } from './theme';
import { anchorScrollDelta, clampZoom } from './zoom';

/** 画面からモデルへの要求。画面は状態を持たず、操作はすべてここ経由でモデルへ戻す */
export interface ViewCallbacks {
  /** 機器と枠の移動(枠を動かすと、中の機器も連れて動く。反映はモデル側) */
  onMove(moves: { id: string; x: number; y: number }[], frameMoves: { id: string; x: number; y: number }[], noteMoves: { id: string; x: number; y: number }[]): void;
  /** 枠の変形(ハンドル操作)。位置とサイズ */
  onFrameResize(frameId: string, rect: { x: number; y: number; w: number; h: number }): void;
  /** メモの変形(ハンドル操作)。位置とサイズ */
  onNoteResize(noteId: string, rect: { x: number; y: number; w: number; h: number }): void;
  /** 機器の変形(ハンドル操作)。位置とサイズ。fitImage は Shift を押していたか(画像の縦横比に合わせる) */
  onNodeResize(nodeId: string, rect: { x: number; y: number; w: number; h: number }, fitImage: boolean): void;
  onConnect(from: PortRef, to: PortRef): void;
  /** ポートを別の辺・位置へ動かす要求(位置は辺に沿った座標。丸めと吸着はモデル側) */
  onPortMove(nodeId: string, portId: string, side: Side, pos: number): void;
  /** 利用者が選択を変えたとき(描き直しに伴う一時的な解除では呼ばない) */
  onSelectionChange(): void;
  /** 枠でポートを選んだとき(選んだ数。0 は解除) */
  onPortsSelected(count: number): void;
  /** 選んだポートを、別のポートへまとめてつなぐ操作(割り当ては計画済み。反映はモデル側) */
  onBulkConnect(plan: BulkPlan): void;
}

let nodeConstrainPatched = false;

/**
 * 機器(セルID が n: で始まる)の変形だけ、maxGraph 標準の「Shift で縦横比を固定する」を無効にする。
 * VertexHandler は枠などと共通なので、プロトタイプ全体を書き換えずに、機器のときだけ false を返す関数へ差し替える(一度だけ)。
 */
function patchNodeConstrainedEvent(): void {
  if (nodeConstrainPatched) return;
  nodeConstrainPatched = true;
  const original = VertexHandler.prototype.isConstrainedEvent;
  VertexHandler.prototype.isConstrainedEvent = function (this: VertexHandler, me) {
    const id = this.state.cell?.getId();
    return typeof id === 'string' && id.startsWith('n:') ? false : original.call(this, me);
  };
}

const SIDE_TO_CONSTRAINT = { left: 'west', right: 'east', top: 'north', bottom: 'south' } as const;

/**
 * モデル(DocumentStore)を maxGraph で描く。モデルが正本で、画面の変更はモデルへ反映してから描き直す。
 * セルIDは種類ごとの接頭辞を付け、機器ID・ポートIDと衝突しないようにする。
 */
export class DiagramView {
  private readonly graph: Graph;
  private readonly portInfo = new Map<string, PortRef>();
  private readonly nodeByCell = new Map<string, string>();
  /** 直前のポインタ操作を離したとき、Shift が押されていたか(機器の変形で、画像の縦横比に合わせるかの判定) */
  private shiftAtRelease = false;
  private readonly edgeByCell = new Map<string, string>();
  private readonly frameByCell = new Map<string, string>();
  private readonly noteByCell = new Map<string, string>();
  private readonly portLabels = new Map<string, string>();
  private rendering = false;
  private zoom = 1;
  /** ポートへの操作(移動・枠選択・一括接続・候補の強調・ホバー)と、その重ね描き */
  private readonly ports: PortInteractions;

  constructor(
    private readonly container: HTMLElement,
    private readonly store: DocumentStore,
    private readonly callbacks: ViewCallbacks,
    private theme: Theme = FLAT_THEME,
  ) {
    // 範囲選択(何もない場所のドラッグで、完全に囲んだ機器・枠・線を選ぶ)は標準では無効なので、プラグインとして足す
    this.graph = new Graph(container, undefined, [...getDefaultPlugins(), RubberBandHandler]);
    this.configure();
    this.restrictRubberBandToPrimaryButton();
    this.ports = new PortInteractions(
      {
        container,
        store,
        getTheme: () => this.theme,
        getZoom: () => this.zoom,
        clientToGraph: (x, y) => this.clientToGraph(x, y),
        graphToScreen: (p) => this.graphToScreen(p),
        cellIdAt: (ev) => this.cellIdAt(ev),
        portRefOfCell: (id) => this.portInfo.get(id),
        isFrameCell: (id) => this.frameByCell.has(id),
        clearGraphSelection: () => this.graph.clearSelection(),
        cancelConnection: () => (this.graph.getPlugin('ConnectionHandler') as ConnectionHandler).reset(),
      },
      callbacks,
    );
  }

  /** 選択中の機器・接続のID(モデル側のID) */
  getSelection(): { nodeIds: string[]; edgeIds: string[]; frameIds: string[]; noteIds: string[] } {
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    const frameIds: string[] = [];
    const noteIds: string[] = [];
    for (const c of this.graph.getSelectionCells()) {
      const id = c.getId() as string;
      const n = this.nodeByCell.get(id);
      const e = this.edgeByCell.get(id);
      const f = this.frameByCell.get(id);
      if (n) nodeIds.push(n);
      if (e) edgeIds.push(e);
      if (f) frameIds.push(f);
      const m = this.noteByCell.get(id);
      if (m) noteIds.push(m);
    }
    return { nodeIds, edgeIds, frameIds, noteIds };
  }

  /** 画面の自動配線が決めた各接続の経路(端点を含む。SVG出力で使う)。接続ID → 点列 */
  getEdgePoints(): Map<string, { x: number; y: number }[]> {
    const result = new Map<string, { x: number; y: number }[]>();
    const view = this.graph.getView();
    const scale = view.getScale();
    const tr = view.getTranslate();
    // 状態の座標は「(図の座標+平行移動)×拡大率」。拡大していても図の座標へ戻す(小数の誤差は丸める)
    const back = (v: number, t: number) => Math.round((v / scale - t) * 1000) / 1000;
    for (const [cellId, edgeId] of this.edgeByCell) {
      const cell = this.graph.getDataModel().getCell(cellId);
      const state = cell ? view.getState(cell) : null;
      const pts = state?.absolutePoints.filter((p): p is NonNullable<typeof p> => p != null);
      if (pts && pts.length >= 2) result.set(edgeId, pts.map((p) => ({ x: back(p.x, tr.x), y: back(p.y, tr.y) })));
    }
    return result;
  }

  /** 現在の拡大率(1 = 100%) */
  getZoom(): number {
    return this.zoom;
  }

  /**
   * 拡大率を変える。画面(コンテナ)の大きさも拡大率に合わせるので、はみ出した分は外側のスクロールで見る。
   * 図のデータ(座標)は変えない。anchor(画面上の位置)を与えると、その下の図の点を動かさない。
   */
  setZoom(zoom: number, anchor?: { clientX: number; clientY: number }, scroller?: HTMLElement): void {
    const next = clampZoom(zoom);
    if (next === this.zoom) return;
    const old = this.zoom;
    const at = anchor ? this.clientToGraph(anchor.clientX, anchor.clientY) : null;
    this.zoom = next;
    this.applySize();
    this.graph.getView().setScale(next);
    if (at && scroller) {
      const d = anchorScrollDelta(at, old, next);
      scroller.scrollLeft += d.dx;
      scroller.scrollTop += d.dy;
    }
    this.ports.onZoomChanged();
    this.onZoomChange?.(next);
  }

  /** コンテナの大きさを「ページの大きさ × 拡大率」に合わせる(ページの大きさはモデルが正本) */
  private applySize(): void {
    const size = this.store.doc.pages[0].size;
    this.container.style.width = `${size.w * this.zoom}px`;
    this.container.style.height = `${size.h * this.zoom}px`;
  }

  /** 拡大率が変わったときの通知(ツールバーの表示更新など) */
  onZoomChange?: (zoom: number) => void;

  /** 選択をすべて外す(パネルを、確認事項と凡例の表示に戻す) */
  clearSelection(): void {
    this.graph.clearSelection();
  }

  /** 機器・枠・接続の選択を、まとめて置き換える(右クリックの前の選択を戻すのに使う。存在しないIDは無視する) */
  setSelection(sel: { nodeIds: readonly string[]; edgeIds: readonly string[]; frameIds: readonly string[]; noteIds?: readonly string[] }): void {
    const model = this.graph.getDataModel();
    const ids = [...sel.nodeIds.map((id) => `n:${id}`), ...sel.frameIds.map((id) => `g:${id}`), ...(sel.noteIds ?? []).map((id) => `t:${id}`), ...sel.edgeIds.map((id) => `e:${id}`)];
    this.graph.setSelectionCells(ids.map((id) => model.getCell(id)).filter((c): c is Cell => c != null));
  }

  /** 指定した機器・枠をまとめて選択する(貼り付けた直後の選択に使う) */
  selectItems(nodeIds: readonly string[], frameIds: readonly string[], noteIds: readonly string[] = []): void {
    const model = this.graph.getDataModel();
    const cells = [...nodeIds.map((id) => model.getCell(`n:${id}`)), ...frameIds.map((id) => model.getCell(`g:${id}`)), ...noteIds.map((id) => model.getCell(`t:${id}`))].filter((c): c is Cell => Boolean(c));
    this.graph.setSelectionCells(cells);
  }

  /** 指定した接続を選択する(モデル側のID)。確認事項の一覧から該当の線へ移るために使う */
  selectEdge(edgeId: string): void {
    const cell = this.graph.getDataModel().getCell(`e:${edgeId}`);
    if (cell) this.graph.setSelectionCell(cell);
  }

  /** 指定した枠を選択する(モデル側のID) */
  selectFrame(frameId: string): void {
    const cell = this.graph.getDataModel().getCell(`g:${frameId}`);
    if (cell) this.graph.setSelectionCell(cell);
  }

  /** 指定したメモを選択する(モデル側のID) */
  selectNote(noteId: string): void {
    const cell = this.graph.getDataModel().getCell(`t:${noteId}`);
    if (cell) this.graph.setSelectionCell(cell);
  }

  /** 指定した機器を選択する(モデル側のID) */
  selectNode(nodeId: string): void {
    const cell = this.graph.getDataModel().getCell(`n:${nodeId}`);
    if (cell) this.graph.setSelectionCell(cell);
  }

  /** 指定した機器を、まとめて選択する(モデル側のID) */
  selectNodes(nodeIds: readonly string[]): void {
    const model = this.graph.getDataModel();
    const cells = nodeIds.map((id) => model.getCell(`n:${id}`)).filter((c): c is Cell => c != null);
    this.graph.setSelectionCells(cells);
  }

  /** 機器・枠・線をすべて選択する */
  selectAll(): void {
    const model = this.graph.getDataModel();
    const ids = [...this.nodeByCell.keys(), ...this.frameByCell.keys(), ...this.noteByCell.keys(), ...this.edgeByCell.keys()];
    this.graph.setSelectionCells(ids.map((id) => model.getCell(id)).filter((c): c is Cell => c != null));
  }

  /** 画面上の座標(clientX/Y)を、図の座標へ変換する */
  clientToGraph(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.container.getBoundingClientRect();
    const tr = this.graph.getView().getTranslate();
    return {
      x: (clientX - r.left - this.container.clientLeft + this.container.scrollLeft) / this.zoom - tr.x,
      y: (clientY - r.top - this.container.clientTop + this.container.scrollTop) / this.zoom - tr.y,
    };
  }

  /**
   * 範囲選択は、主ボタン(左)のドラッグだけで始める。maxGraph の既定はボタンを問わないので、
   * 中ボタンの画面移動(zoomControls)や右ボタンまで範囲選択を始めてしまい、離した位置で選択が置き換わる。
   */
  private restrictRubberBandToPrimaryButton(): void {
    const rb = this.graph.getPlugin('RubberBandHandler') as RubberBandHandler;
    const original = rb.mouseDown.bind(rb);
    rb.mouseDown = (sender, me) => {
      if (me.getEvent().button !== 0) return;
      original(sender, me);
    };
  }

  private configure(): void {
    const g = this.graph;
    g.setConnectable(true);
    // maxGraph のパン(右ドラッグ等)は表示の平行移動を変え、座標変換を狂わせるので使わない。
    // 移動は外側のスクロール(スクロールバー・ホイール・中ボタンドラッグ)で行う。
    g.setPanning(false);
    g.setCellsResizable(true); // 変形できるのは枠だけ(下の isCellResizable)
    // 標準の Ctrl+ドラッグ複製は、アプリのデータに入らず、選択も削除もできない幽霊を作る。使わない
    // (複製は Ctrl+C / Ctrl+V / Ctrl+D で、データとして行う)。
    g.setCellsCloneable(false);
    g.isCloneEvent = () => false;
    // クリックで選択に足す/外す操作は、Ctrl(Mac は Cmd)に加えて Shift でも行えるようにする
    g.isToggleEvent = (evt: MouseEvent) => evt.ctrlKey || evt.metaKey || evt.shiftKey;
    g.setHtmlLabels(true);
    g.setTooltips(true);
    // ポートは機器の辺の上に中心を置く(半分は機器の外へはみ出す)ため、
    // 子セルを親の枠内へ押し込む補正を切る。入れたままだと左辺・上辺のポートだけが
    // 4px内側へずれ、辺の中央にあるはずの頂点が当たり判定から外れる(実ブラウザの検証で判明)。
    g.setConstrainChildren(false);
    g.setAllowDanglingEdges(false); // 何もない所へ離した線を残さない
    g.setCellsDisconnectable(false); // 線の端を勝手に外せないようにする
    // 折りたたみは使わない(isCellFoldable)。有効のままだと、子(ポート・アイコン)を持つ機器ごとに、折りたたみの印の画像
    // (./expanded.gif)を読みに行く。画像ファイルは同梱していないため、存在しないファイルへの読み込みが機器の数だけ起きる。
    g.isCellFoldable = () => false;

    const edgeStyle = g.getStylesheet().getDefaultEdgeStyle();
    edgeStyle.edgeStyle = 'orthogonalEdgeStyle';
    edgeStyle.endArrow = 'none';
    edgeStyle.rounded = true;

    // 動かせる・選べるのは機器と枠。ポート・アイコンは機器と一緒に扱う。変形できるのは枠だけ
    g.isCellMovable = (cell: Cell) => {
      const id = cell.getId() as string;
      return this.nodeByCell.has(id) || this.frameByCell.has(id) || this.noteByCell.has(id);
    };
    // 枠は常に変形できる。機器は、1つだけ選んでいるときに変形できる(複数選択では、動かすだけ)。ポートやアイコンは変形しない
    g.isCellResizable = (cell: Cell) => {
      const id = cell.getId() as string;
      return this.frameByCell.has(id) || ((this.nodeByCell.has(id) || this.noteByCell.has(id)) && g.getSelectionCount() <= 1);
    };
    // maxGraph 標準は、Shift を押した変形で、最初の縦横比を固定する。機器では「画像の縦横比に合わせる」(名前の行と余白が固定なので、
    // 一定の比率にはならない)をモデルが決めるので、機器だけは標準の固定を使わない(Shift でも、ドラッグした大きさをそのまま渡す)。
    // 枠は従来どおり(Shift で縦横比を固定)
    patchNodeConstrainedEvent();
    this.applyDragPreviewColor();
    // 複数選択のときは、変形のハンドルを出さない(標準の設定: 選択が maxCells 個未満のときだけハンドルを作る)。
    // ハンドルは、選択が変わっても、すでに選ばれていたセルのものが使い回されるので、1つだけの選択から複数選択に変わったときは作り直す
    const handlers = g.getPlugin('SelectionCellsHandler') as SelectionCellsHandler | undefined;
    if (handlers) {
      (handlers as unknown as { maxCells: number }).maxCells = 2;
      handlers.maxHandlers = 2;
    }
    let wasSingle = true;
    g.getSelectionModel().addListener(InternalEvent.CHANGE, () => {
      const single = g.getSelectionCount() <= 1;
      if (single === wasSingle) return;
      wasSingle = single;
      handlers?.reset();
      handlers?.refresh();
    });
    // 変形のドラッグを離したとき、Shift を押していたか(ハンドルのドラッグ中は押し続けているので、離す時点の状態で足りる)
    this.container.addEventListener('pointerup', (ev) => (this.shiftAtRelease = ev.shiftKey), true);
    g.isCellSelectable = (cell: Cell) => {
      const id = cell.getId() as string;
      return this.nodeByCell.has(id) || this.edgeByCell.has(id) || this.frameByCell.has(id) || this.noteByCell.has(id);
    };
    // maxGraph 標準のポップアップメニュー処理は、右ボタンを離したときに選択を変えてしまう(複数選択が子セル1つになる)。
    // 右クリックのメニューはアプリ側(ui/contextMenu)が出すので、標準の処理は止める
    (g.getPlugin('PopupMenuHandler') as PopupMenuHandler | undefined)?.setEnabled(false);
    const tooltip = g.getPlugin('TooltipHandler') as TooltipHandler;
    tooltip.getTooltipForCell = (cell: Cell) => this.portLabels.get(cell.getId() as string) ?? '';

    g.addListener(InternalEvent.CELLS_MOVED, (_sender: unknown, evt: EventObject) => {
      const cells = (evt.getProperty('cells') ?? []) as Cell[];
      const moves: { id: string; x: number; y: number }[] = [];
      const frameMoves: { id: string; x: number; y: number }[] = [];
      const noteMoves: { id: string; x: number; y: number }[] = [];
      for (const c of cells) {
        const cellId = c.getId() as string;
        const geo = c.getGeometry();
        if (!geo) continue;
        const nodeId = this.nodeByCell.get(cellId);
        const frameId = this.frameByCell.get(cellId);
        if (nodeId) moves.push({ id: nodeId, x: geo.x, y: geo.y });
        if (frameId) frameMoves.push({ id: frameId, x: geo.x, y: geo.y });
        const noteId = this.noteByCell.get(cellId);
        if (noteId) noteMoves.push({ id: noteId, x: geo.x, y: geo.y });
      }
      // イベント処理中に描き直さないよう、次のタスクでモデルへ反映する
      if (moves.length > 0 || frameMoves.length > 0 || noteMoves.length > 0) setTimeout(() => this.callbacks.onMove(moves, frameMoves, noteMoves), 0);
    });

    g.addListener(InternalEvent.CELLS_RESIZED, (_sender: unknown, evt: EventObject) => {
      // 描き直しの最中の通知(子のセルを足したときの、親の大きさの補正など)は、利用者の変形ではない。
      // 反映すると、モデルの更新 → 描き直し → 通知 … と繰り返して止まらなくなる
      if (this.rendering) return;
      const cells = (evt.getProperty('cells') ?? []) as Cell[];
      for (const c of cells) {
        const id = c.getId() as string;
        const frameId = this.frameByCell.get(id);
        const nodeId = this.nodeByCell.get(id);
        const geo = c.getGeometry();
        const noteId = this.noteByCell.get(id);
        if (noteId && geo) setTimeout(() => this.callbacks.onNoteResize(noteId, { x: geo.x, y: geo.y, w: geo.width, h: geo.height }), 0);
        if (frameId && geo) setTimeout(() => this.callbacks.onFrameResize(frameId, { x: geo.x, y: geo.y, w: geo.width, h: geo.height }), 0);
        const model = nodeId ? this.store.doc.pages[0].nodes.find((n) => n.id === nodeId) : undefined;
        const unchanged = model && geo && model.x === geo.x && model.y === geo.y && model.w === geo.width && model.h === geo.height;
        if (unchanged) {
          // ハンドルを押しただけで動かさなかった。何も変えない(元に戻すの履歴に、変化のない操作を積まない)
        } else if (nodeId && geo && g.getSelectionCount() > 1) {
          setTimeout(() => this.render(), 0); // 複数選択の変形は受け付けない(ハンドルは出ないが、念のため。画面を元の大きさに戻す)
        } else if (nodeId && geo) {
          const fit = this.shiftAtRelease;
          setTimeout(() => this.callbacks.onNodeResize(nodeId, { x: geo.x, y: geo.y, w: geo.width, h: geo.height }, fit), 0);
        }
      }
    });

    g.getSelectionModel().addListener(InternalEvent.CHANGE, () => {
      if (!this.rendering) this.callbacks.onSelectionChange();
    });

    const ch = g.getPlugin('ConnectionHandler') as ConnectionHandler;
    // 接続のドラッグが始まったら、つなぎ先の候補を強調し、終わったら消す(ポートのセルのスタイルは変えない)
    ch.addListener(InternalEvent.START, (_sender: unknown, evt: EventObject) => {
      const state = evt.getProperty('state') as CellState | undefined;
      this.ports.beginCandidates(state?.cell ? this.portInfo.get(state.cell.getId() as string) : undefined);
    });
    ch.addListener(InternalEvent.RESET, () => this.ports.endCandidates());
    ch.addListener(InternalEvent.CONNECT, (_sender: unknown, evt: EventObject) => {
      const edge = evt.getProperty('cell') as Cell;
      const from = edge.source ? this.portInfo.get(edge.source.getId() as string) : undefined;
      const to = edge.target ? this.portInfo.get(edge.target.getId() as string) : undefined;
      if (from && to) setTimeout(() => this.callbacks.onConnect(from, to), 0);
    });
  }

  /** 表示のテーマ(ライト/ダーク)を切り替えて描き直す。図のデータは変わらない */
  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.applyDragPreviewColor();
    this.render();
  }

  /** ドラッグ中の移動先の枠線(maxGraph 標準は黒)を、テーマに合わせる。ダークでは黒が背景に埋もれるため */
  private applyDragPreviewColor(): void {
    const handler = this.graph.getPlugin('SelectionHandler') as unknown as { previewColor: string } | undefined;
    if (handler) handler.previewColor = this.theme.dragPreview;
  }

  /**
   * モデルの現在の状態で描き直す。描き直しで選択が一度外れても、利用者の選択は保つ
   * (プロパティパネルが消えないように)。途中で失敗しても、選択イベントの抑止は必ず解く。
   */
  render(): void {
    this.ports.onRender(); // 描き直しで位置や接続が変わるため、ポートの選択とホバーは持ち越さない
    const previous = this.getSelection();
    this.rendering = true;
    try {
      this.draw();
      const model = this.graph.getDataModel();
      const restore = [
        ...previous.nodeIds.map((id) => model.getCell(`n:${id}`)),
        ...previous.edgeIds.map((id) => model.getCell(`e:${id}`)),
        ...previous.frameIds.map((id) => model.getCell(`g:${id}`)),
        ...previous.noteIds.map((id) => model.getCell(`t:${id}`)),
      ].filter((c): c is Cell => Boolean(c));
      this.graph.setSelectionCells(restore);
    } finally {
      this.rendering = false;
    }
    this.callbacks.onSelectionChange();
  }

  private draw(): void {
    const doc = this.store.doc;
    const page = doc.pages[0];
    const g = this.graph;
    const parent = g.getDefaultParent();
    const th = this.theme;
    const signals = new Map(doc.signalTypes.map((s) => [s.id, s]));
    const connected = new Set<string>();
    for (const e of page.edges) {
      connected.add(`${e.from.nodeId}/${e.from.portId}`);
      connected.add(`${e.to.nodeId}/${e.to.portId}`);
    }

    this.applySize(); // ページの大きさが変わった場合に追随する
    g.setGridEnabled(doc.grid.enabled);
    g.setGridSize(doc.grid.size);

    g.batchUpdate(() => {
      g.removeCells(g.getChildCells(parent, true, true), true);
      this.portInfo.clear();
      this.nodeByCell.clear();
      this.edgeByCell.clear();
      this.frameByCell.clear();
      this.noteByCell.clear();
      this.portLabels.clear();

      const groupCells: Cell[] = [];
      for (const grp of page.groups) {
        const cell = g.insertVertex({
          parent,
          id: `g:${grp.id}`,
          value: escapeHtml(grp.label),
          position: [grp.x, grp.y],
          size: [grp.w, grp.h],
          style: {
            shape: 'rectangle',
            rounded: true,
            absoluteArcSize: true,
            arcSize: 14,
            dashed: true,
            fillColor: 'none',
            strokeColor: th.groupStroke,
            fontColor: th.groupStroke,
            fontStyle: 1,
            verticalAlign: 'top',
            align: 'left',
            spacingLeft: 14,
            spacingTop: 4,
          },
        });
        cell.setConnectable(false);
        this.frameByCell.set(`g:${grp.id}`, grp.id);
        groupCells.push(cell);
      }

      // メモ: 文字だけ(枠も背景もない)。つかめる範囲は、透明な塗りで確保する(塗りが無いと、文字のない所を押しても選べない)
      for (const note of page.notes ?? []) {
        const cell = g.insertVertex({
          parent,
          id: `t:${note.id}`,
          value: escapeHtml(note.text).replace(/\n/g, '<br>'),
          position: [note.x, note.y],
          size: [note.w, note.h],
          style: {
            shape: 'rectangle',
            fillColor: '#ffffff',
            fillOpacity: 0,
            strokeColor: 'none',
            fontColor: note.color ?? th.nodeText,
            fontSize: note.fontSize ?? DEFAULT_NOTE_FONT,
            whiteSpace: 'wrap',
            overflow: 'hidden',
            align: 'left',
            verticalAlign: 'top',
            spacingLeft: 2,
            spacingTop: 2,
          },
        });
        cell.setConnectable(false);
        this.noteByCell.set(`t:${note.id}`, note.id);
      }

      const markerSize = doc.grid.size * th.markerRatio;
      const portCells = new Map<string, Cell>();
      for (const n of page.nodes) {
        const tpl = doc.deviceTemplates.find((x) => x.id === n.templateId);
        const kind = tpl?.kind ?? 'generic';
        const shape = tpl?.shape ?? 'roundRect';
        // 画像のある機器は、小さなアイコンの代わりに画像を出す(画像が壊れている・無いときは、アイコンのまま)
        const imageUri = n.imageId ? doc.assets?.[n.imageId] : undefined;
        const image = isImageDataUri(imageUri) ? imageUri : undefined;
        const countText = n.count ? ` ${t('node.count', { count: n.count })}` : '';
        const modelLine = n.model || countText ? `<br><span style="font-size:11px;font-weight:normal;color:${th.modelText}">${escapeHtml(n.model)}${escapeHtml(countText)}</span>` : '';
        const nodeCell = g.insertVertex({
          parent,
          id: `n:${n.id}`,
          value: `<b>${escapeHtml(n.label)}</b>${modelLine}`,
          position: [n.x, n.y],
          size: [n.w, n.h],
          style: {
            shape: shape === 'ellipse' ? 'ellipse' : 'rectangle',
            rounded: shape === 'roundRect',
            absoluteArcSize: true,
            arcSize: 6,
            fillColor: th.nodeFill,
            strokeColor: th.nodeStroke,
            strokeWidth: th.nodeStrokeWidth,
            fontColor: th.nodeText,
            fontSize: 12,
            whiteSpace: 'wrap',
            overflow: 'hidden',
            verticalAlign: 'top',
            align: 'left',
            spacingLeft: image ? 14 : th.iconSize + 14,
            spacingTop: 6,
          },
        });
        nodeCell.setConnectable(false);
        this.nodeByCell.set(`n:${n.id}`, n.id);

        if (image) {
          const box = imageBox(n);
          const pic = g.insertVertex({
            parent: nodeCell,
            id: `i:${n.id}`,
            position: [box.x, box.y],
            size: [box.w, box.h],
            style: { shape: 'image', image, imageAspect: true },
          });
          pic.setConnectable(false);
        } else {
          const icon = g.insertVertex({
            parent: nodeCell,
            id: `i:${n.id}`,
            position: [8, 8],
            size: [th.iconSize, th.iconSize],
            style: { shape: 'image', image: iconDataUri(kind, th.nodeStroke) },
          });
          icon.setConnectable(false);
        }

        const ports = getNodePorts(doc, n);
        const placements = layoutNodePorts(doc, n);
        for (const pl of placements) {
          const port = ports.find((p) => p.id === pl.portId)!;
          const sig = signals.get(port.signalType);
          const color = signalColor(th, sig?.color ?? '#888888');
          // 個別に動かしたポートは、グループの辺ではなく配置された辺に従う
          const spec = markerSpec(port.direction, pl.side);
          const cellId = `p:${n.id}/${port.id}`;
          const isConnected = connected.has(`${n.id}/${port.id}`);
          const cell = g.insertVertex({
            parent: nodeCell,
            id: cellId,
            position: [pl.x - markerSize / 2, pl.y - markerSize / 2],
            size: [markerSize, markerSize],
            style: {
              shape: spec.shape,
              direction: spec.direction,
              // 空きは白抜き、接続済みは信号色で塗りつぶす(設計書 5.3)
              fillColor: isConnected ? color : th.portEmptyFill,
              strokeColor: color,
              strokeWidth: 1.4,
            },
          });
          this.portInfo.set(cellId, { nodeId: n.id, portId: port.id });
          this.portLabels.set(cellId, portTooltipHtml(port, sig?.label, Boolean(n.count && n.count > 1)));
          portCells.set(`${n.id}/${port.id}`, cell);
        }
      }

      const edgeCells: Cell[] = [];
      for (const e of page.edges) {
        const a = portCells.get(`${e.from.nodeId}/${e.from.portId}`);
        const b = portCells.get(`${e.to.nodeId}/${e.to.portId}`);
        if (!a || !b) continue; // 検証済みのドキュメントでは起きない。壊れた参照は描かない
        const fromPort = findPortByRef(this.store.doc, e.from);
        const toPort = findPortByRef(this.store.doc, e.to);
        const fromSide = this.findSide(e.from);
        const toSide = this.findSide(e.to);
        const color = signalColor(th, signals.get(fromPort?.signalType ?? '')?.color ?? '#666666');
        const edge = g.insertEdge({
          parent,
          id: `e:${e.id}`,
          source: a,
          target: b,
          style: {
            strokeColor: color,
            strokeWidth: th.edgeWidth,
            // 指摘のある接続は線種で示す。保存せず、描くたびに判定する(直せば実線に戻る)
            // 方向の不一致は破線、信号の不一致は点線(色だけに頼らず、印刷しても見分けられる)
            ...this.issueStyle(fromPort, toPort),
            sourcePortConstraint: fromSide ? SIDE_TO_CONSTRAINT[fromSide] : undefined,
            targetPortConstraint: toSide ? SIDE_TO_CONSTRAINT[toSide] : undefined,
          },
        });
        this.edgeByCell.set(`e:${e.id}`, e.id);
        edgeCells.push(edge);
      }

      // 重なり順は「グループ枠 < 線 < 機器とポート」にする(実ブラウザの検証で判明した2点)。
      // ・線が機器の上にあると、ポートへマウスを合わせたときに線に当たり、接続先にできない。
      // ・グループ枠(塗りなし)が線の上にあると、枠の内側にある線をクリックしても選択できない。
      // 機器の側を前面へ動かす方法は、子のポートの描画順が追従せず、機器本体が
      // ポートの上に来てしまうため使わない。線→枠の順に最背面へ送り、枠を一番奥にする。
      g.orderCells(true, edgeCells);
      g.orderCells(true, groupCells);
    });
  }

  private issueStyle(a: Port | undefined, b: Port | undefined): { dashed?: boolean; dashPattern?: string } {
    if (!a || !b) return {};
    const issues = connectionIssues(a, b);
    if (issues.includes('direction-mismatch')) return { dashed: true, dashPattern: '8 4' };
    if (issues.includes('signal-mismatch')) return { dashed: true, dashPattern: '2 4' };
    return {};
  }

  /** ポートが実際に置かれている辺(個別に動かした場合はその辺) */
  private findSide(ref: PortRef): Side | undefined {
    const doc = this.store.doc;
    const node = doc.pages[0].nodes.find((n) => n.id === ref.nodeId);
    return node ? layoutNodePorts(doc, node).find((p) => p.portId === ref.portId)?.side : undefined;
  }

  /** 枠で選んでいるポート */
  getPortSelection(): readonly PortRef[] {
    return this.ports.getPortSelection();
  }

  /** ポートの選択を解除する(notify=false なら通知しない) */
  clearPortSelection(notify = true): void {
    this.ports.clearPortSelection(notify);
  }

  /** 図の座標を、コンテナ内の画面座標へ変換する(clientToGraph の逆。表示の平行移動と拡大率を考慮する) */
  graphToScreen(p: { x: number; y: number }): { x: number; y: number } {
    const tr = this.graph.getView().getTranslate();
    return { x: (p.x + tr.x) * this.zoom, y: (p.y + tr.y) * this.zoom };
  }

  /**
   * イベントの位置にある、モデル側の対象(機器・枠・接続)。ポートの上は、そのポートを持つ機器として返す。
   * 右クリックメニューが、何の上で開かれたかを知るために使う。何もなければ undefined。
   */
  targetAt(ev: MouseEvent): { kind: 'node' | 'frame' | 'edge' | 'note'; id: string } | undefined {
    const model = this.graph.getDataModel();
    // 機器の中のアイコンなどの子セルに当たることがあるので、親をたどって機器・枠・接続を探す
    for (let cell: Cell | null | undefined = (() => { const id = this.cellIdAt(ev); return id ? model.getCell(id) : undefined; })(); cell; cell = cell.getParent()) {
      const id = cell.getId() as string;
      const node = this.nodeByCell.get(id);
      if (node) return { kind: 'node', id: node };
      const frame = this.frameByCell.get(id);
      if (frame) return { kind: 'frame', id: frame };
      const note = this.noteByCell.get(id);
      if (note) return { kind: 'note', id: note };
      const edge = this.edgeByCell.get(id);
      if (edge) return { kind: 'edge', id: edge };
      const port = this.portInfo.get(id);
      if (port) return { kind: 'node', id: port.nodeId };
    }
    return undefined;
  }

  /** イベントの位置にあるセルのID(なければ undefined)。getCellAt は、図の座標ではなく拡大後の画面座標(コンテナ内)で判定する */
  cellIdAt(ev: MouseEvent): string | undefined {
    const at = this.graphToScreen(this.clientToGraph(ev.clientX, ev.clientY));
    return this.graph.getCellAt(at.x, at.y)?.getId() as string | undefined;
  }
}
