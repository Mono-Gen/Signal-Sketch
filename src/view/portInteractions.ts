import { t } from '../i18n';
import { locatePorts, planBulkConnect, portsInRect } from '../model/bulkConnect';
import type { BulkPlan } from '../model/bulkConnect';
import { connectCandidates } from '../model/connectCandidates';
import { alongRange, nearestSide } from '../model/portLayout';
import { frameOfNode } from '../model/frames';
import { findPortByRef, getPage, layoutNodePorts, portFooterExtra, portHeaderExtra } from '../model/query';
import type { PortRef, Side } from '../model/types';
import type { DocumentStore } from '../state/store';
import { signalColor } from './theme';
import type { Theme } from './theme';

/**
 * ポートに対する操作(ポートの移動・枠選択・一括接続・つなぎ先の候補の強調・ホバー)と、その重ね描き。
 * 責任: ポート上のポインタ操作を受け取り、選択・プレビュー・強調を図の上に重ねて描くこと。
 * 対象外: 図そのものの描画・選択(DiagramView)、接続や移動のモデルへの反映(コールバックでモデル側へ戻す)。
 */

/** DiagramView が提供する、座標変換とセルの照会 */
export interface PortInteractionHost {
  readonly container: HTMLElement;
  readonly store: DocumentStore;
  /** 現在のテーマ(テーマの切り替えに追随するため、値ではなく取得関数で受け取る) */
  getTheme(): Theme;
  getZoom(): number;
  clientToGraph(clientX: number, clientY: number): { x: number; y: number };
  /** 図の座標を、コンテナ内の画面座標へ変換する(表示の平行移動と拡大率を考慮する) */
  graphToScreen(p: { x: number; y: number }): { x: number; y: number };
  /** イベントの位置にあるセルのID(なければ undefined) */
  cellIdAt(ev: MouseEvent): string | undefined;
  portRefOfCell(cellId: string): PortRef | undefined;
  isFrameCell(cellId: string): boolean;
  /** 機器・枠・接続の選択を外す */
  clearGraphSelection(): void;
  /** 進行中の接続のドラッグを取り消す */
  cancelConnection(): void;
}

export interface PortInteractionCallbacks {
  /** ポートを別の辺・位置へ動かす要求(位置は辺に沿った座標。丸めと吸着はモデル側) */
  onPortMove(nodeId: string, portId: string, side: Side, pos: number): void;
  /** 枠でポートを選んだとき(選んだ数。0 は解除) */
  onPortsSelected(count: number): void;
  /** 選んだポートを、別のポートへまとめてつなぐ操作(割り当ては計画済み。反映はモデル側) */
  onBulkConnect(plan: BulkPlan): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 落とし先として受け付ける、ポートからの距離(画面のpx)。ポートの印(数px)に正確に当てなくてもよいように */
const DROP_RADIUS_PX = 12;
/** 枠の幅がこれ未満(画面のpx)なら、枠を引いたことにしない(クリックとの区別) */
const MIN_BAND_PX = 3;

const keyOf = (r: PortRef) => `${r.nodeId}/${r.portId}`;
const sameRef = (a: PortRef, b: PortRef) => a.nodeId === b.nodeId && a.portId === b.portId;

interface DragHandlers {
  move?(e: PointerEvent): void;
  /** ボタンを離したとき(離した位置のイベント)、または取り消されたとき(null) */
  end(e: PointerEvent | null): void;
}

/**
 * ドラッグの追跡。動き・ボタンを離す・Esc を、文書全体で捕捉段階に受け取る。
 * end は1回だけ呼ばれ、そのとき必ず監視を外す。返す関数で、外から取り消せる(end(null))。
 * cancelOnEscape が真なら、Esc でも取り消す(この Esc は取り消しだけに使い、アプリ側の Esc には渡さない)。
 * ボタンを離した通知が届かない場合(ブラウザが操作を中断した pointercancel、ウィンドウを切り替えた blur)も、
 * 取り消しとして終わらせる。終わらないと、離したあとの動きや次のクリックが、前のドラッグの続きとして扱われてしまう。
 */
function trackDrag(handlers: DragHandlers, cancelOnEscape: boolean): () => void {
  let done = false;
  const remove = () => {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onAbort, true);
    window.removeEventListener('blur', onAbort);
    document.removeEventListener('keydown', onKey, true);
  };
  const finish = (e: PointerEvent | null) => {
    if (done) return;
    done = true;
    remove();
    handlers.end(e);
  };
  const onMove = (e: PointerEvent) => handlers.move?.(e);
  const onUp = (e: PointerEvent) => finish(e);
  const onAbort = () => finish(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    finish(null);
  };
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onAbort, true);
  window.addEventListener('blur', onAbort);
  if (cancelOnEscape) document.addEventListener('keydown', onKey, true);
  return () => finish(null);
}

export class PortInteractions {
  /** 枠で選んだポート(一括接続の元)。描き直し・別の場所のクリック・Esc で解除する */
  private selection: PortRef[] = [];
  /** 一括接続のドラッグ中のプレビュー(なければ null) */
  private bulkPreview: { plan: BulkPlan; drop: PortRef; at: { x: number; y: number } } | null = null;
  private overlay: SVGSVGElement | null = null;
  /** 一括接続のドラッグ中だけ入る、取り消し処理(描き直しなどで選択が消えたら、ドラッグも取り消す) */
  private cancelBulkDrag: (() => void) | null = null;
  /** 接続ドラッグ中の候補(つなぎ先として強調するポート)。ドラッグしていなければ null */
  private candidates: PortRef[] | null = null;
  private candidateFrom: PortRef | null = null;
  /** マウスを合わせているポート(少し大きく見せる) */
  private hoverPort: PortRef | null = null;

  /**
   * 捕捉段階のリスナーは登録順に動く。ポート移動 → 枠選択・一括接続 → ホバーの順を保つこと
   * (ポート移動が先に Shift+ポートを奪い、枠選択は残りを見る)。
   */
  constructor(
    private readonly host: PortInteractionHost,
    private readonly callbacks: PortInteractionCallbacks,
  ) {
    this.installPortMove();
    this.installBulkSelect();
    this.installHover();
    this.installCandidateSafetyNet();
  }

  private get doc() {
    return this.host.store.doc;
  }

  private get pageId() {
    return this.doc.pages[0].id;
  }

  // ---------------------------------------------------------------------------
  // 状態の公開

  /** 枠で選んでいるポート */
  getPortSelection(): readonly PortRef[] {
    return this.selection;
  }

  /** ポートの選択を解除する(notify=false なら通知しない。描き直しの内部用) */
  clearPortSelection(notify = true): void {
    const had = this.selection.length > 0;
    this.cancelBulkDrag?.(); // ドラッグ中に選択が消えた場合(元に戻す等)、解除前のポートで接続しない
    this.selection = [];
    this.bulkPreview = null;
    this.refresh();
    if (notify && had) this.callbacks.onPortsSelected(0);
  }

  /** 図が描き直されるとき: 位置や接続が変わりうるので、選択とホバーは持ち越さない(選択が消えたことは通知する) */
  onRender(): void {
    this.clearPortSelection(true);
    this.hoverPort = null;
  }

  /** 拡大率が変わったとき: 重ね描きの位置を合わせ直す */
  onZoomChanged(): void {
    this.hoverPort = null;
    this.refresh();
  }

  /** 接続のドラッグが始まった(開始ポートが分かれば、つなぎ先の候補を強調する) */
  beginCandidates(from: PortRef | undefined): void {
    this.candidateFrom = from ?? null;
    this.candidates = from ? connectCandidates(this.doc, this.pageId, from) : null;
    this.hoverPort = null;
    this.refresh();
  }

  /** 接続のドラッグが終わった(強調を消す) */
  endCandidates(): void {
    if (!this.candidates && !this.candidateFrom) return;
    this.candidates = null;
    this.candidateFrom = null;
    this.refresh();
  }

  // ---------------------------------------------------------------------------
  // 重ね描き

  private ensureOverlay(): SVGSVGElement {
    if (this.overlay && this.overlay.isConnected) return this.overlay;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:9';
    this.host.container.append(svg);
    this.overlay = svg;
    return svg;
  }

  /** ポート中心の、コンテナ内の画面座標 */
  private portScreenPoint(ref: PortRef): { x: number; y: number } | undefined {
    const node = this.doc.pages[0].nodes.find((n) => n.id === ref.nodeId);
    const pl = node ? layoutNodePorts(this.doc, node).find((p) => p.portId === ref.portId) : undefined;
    return node && pl ? this.host.graphToScreen({ x: node.x + pl.x, y: node.y + pl.y }) : undefined;
  }

  /**
   * 重ね描きを描き直す。選択は橙の輪、つなぐ組は点線、つなげない選択側は赤い輪と×、
   * つなぎ先の候補は青い輪(それ以外のポートは白で薄く)、ホバーは信号色の淡い輪で示す(色だけに頼らない)。
   */
  refresh(): void {
    if (this.selection.length === 0 && !this.bulkPreview && !this.candidates && !this.hoverPort && !this.overlay) return;
    const svg = this.ensureOverlay();
    svg.replaceChildren();
    const el = (name: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(SVG_NS, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      svg.append(e);
      return e;
    };
    const grid = this.doc.grid.size;
    const zoom = this.host.getZoom();
    const r = Math.max(7, grid * this.host.getTheme().markerRatio * zoom * 0.9);

    this.drawCandidates(el, r, grid, zoom);
    this.drawHover(el, r);
    this.drawSelection(el, r);
    this.drawBulkPreview(el, r);
  }

  private drawCandidates(el: (name: string, attrs: Record<string, string | number>) => Element, r: number, grid: number, zoom: number): void {
    if (!this.candidates) return;
    const cand = new Set(this.candidates.map(keyOf));
    const from = this.candidateFrom;
    const dim = Math.max(4, grid * this.host.getTheme().markerRatio * zoom * 0.5 + 1.5);
    for (const lp of locatePorts(this.doc, this.pageId)) {
      // 開始ポートは薄くしない。ただし候補が1つもないとき(つなげない合図)は、開始ポートも含めて薄くする
      const isStart = from !== null && sameRef(lp.ref, from);
      if (cand.has(keyOf(lp.ref)) || (isStart && cand.size > 0)) continue;
      const pt = this.host.graphToScreen(lp);
      el('circle', { cx: pt.x, cy: pt.y, r: dim, fill: this.host.getTheme().halo, 'fill-opacity': 0.72 });
    }
    // 輪の直径はポートの間隔(1グリッド)に収める。収めないと、並んだポートで輪が隣と重なって鎖に見える
    const candR = Math.max(3, Math.min(r, grid * zoom * 0.48));
    for (const ref of this.candidates) {
      const pt = this.portScreenPoint(ref);
      if (pt) el('circle', { cx: pt.x, cy: pt.y, r: candR, fill: 'none', stroke: this.host.getTheme().candidate, 'stroke-width': 1.8 });
    }
  }

  private drawHover(el: (name: string, attrs: Record<string, string | number>) => Element, r: number): void {
    if (!this.hoverPort || this.candidates) return;
    const pt = this.portScreenPoint(this.hoverPort);
    const port = findPortByRef(this.doc, this.hoverPort);
    const color = signalColor(this.host.getTheme(), this.doc.signalTypes.find((x) => x.id === port?.signalType)?.color ?? '#888888');
    if (pt) el('circle', { cx: pt.x, cy: pt.y, r: r * 0.85, fill: color, 'fill-opacity': 0.25, stroke: color, 'stroke-width': 1.5 });
  }

  private drawSelection(el: (name: string, attrs: Record<string, string | number>) => Element, r: number): void {
    const preview = this.bulkPreview;
    const skipped = new Set(preview?.plan.skipped.map((s) => keyOf(s.ref)) ?? []);
    const refused = Boolean(preview?.plan.refused);
    for (const ref of this.selection) {
      const pt = this.portScreenPoint(ref);
      if (!pt) continue;
      const bad = refused || skipped.has(keyOf(ref));
      el('circle', { cx: pt.x, cy: pt.y, r, fill: 'none', stroke: bad ? this.host.getTheme().bad : this.host.getTheme().selection, 'stroke-width': 2.5 });
      if (bad) {
        const d = r * 0.55;
        el('path', { d: `M${pt.x - d} ${pt.y - d}L${pt.x + d} ${pt.y + d}M${pt.x + d} ${pt.y - d}L${pt.x - d} ${pt.y + d}`, stroke: this.host.getTheme().bad, 'stroke-width': 2, fill: 'none' });
      }
    }
  }

  private drawBulkPreview(el: (name: string, attrs: Record<string, string | number>) => Element, r: number): void {
    const preview = this.bulkPreview;
    if (!preview) return;
    if (!preview.plan.refused) {
      this.drawDropFrame(el, preview.drop);
      for (const pair of preview.plan.pairs) {
        const a = this.portScreenPoint(pair.from);
        const b = this.portScreenPoint(pair.to);
        if (!a || !b) continue;
        el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: this.host.getTheme().selection, 'stroke-width': 2, 'stroke-dasharray': '6 4' });
        el('circle', { cx: b.x, cy: b.y, r, fill: 'none', stroke: this.host.getTheme().selection, 'stroke-width': 2, 'stroke-dasharray': '3 3' });
      }
    }
    const text = preview.plan.refused
      ? t(preview.plan.refused === 'mixed-direction' ? 'error.bulkMixedDirection' : 'error.bulkUnknownTarget')
      : t('bulk.preview', { count: preview.plan.pairs.length, skipped: preview.plan.skipped.length });
    const label = el('text', {
      x: preview.at.x + 14,
      y: preview.at.y - 10,
      'font-size': 12,
      'font-weight': 'bold',
      fill: preview.plan.refused || preview.plan.pairs.length === 0 ? this.host.getTheme().bad : this.host.getTheme().ink,
      stroke: this.host.getTheme().halo,
      'stroke-width': 3,
      'paint-order': 'stroke',
    });
    label.textContent = text;
  }

  /** 落とし先の機器が入っている枠を点線で囲む(一括接続が、その枠の中の機器へ進むことを見せる) */
  private drawDropFrame(el: (name: string, attrs: Record<string, string | number>) => Element, drop: PortRef): void {
    const page = getPage(this.doc, this.pageId);
    const node = page?.nodes.find((n) => n.id === drop.nodeId);
    const frame = page && node ? frameOfNode(page, node) : undefined;
    if (!frame) return;
    const a = this.host.graphToScreen({ x: frame.x, y: frame.y });
    const b = this.host.graphToScreen({ x: frame.x + frame.w, y: frame.y + frame.h });
    el('rect', {
      x: a.x,
      y: a.y,
      width: Math.max(0, b.x - a.x),
      height: Math.max(0, b.y - a.y),
      rx: 6,
      fill: 'none',
      stroke: this.host.getTheme().selection,
      'stroke-width': 2.5,
      'stroke-dasharray': '10 5',
    });
  }

  // ---------------------------------------------------------------------------
  // 入力

  /** イベントの位置にあるポートのマーク(なければ undefined) */
  private portMarkAt(ev: MouseEvent): PortRef | undefined {
    const id = this.host.cellIdAt(ev);
    return id ? this.host.portRefOfCell(id) : undefined;
  }

  /** イベントの位置にあるポート。ポートのマークに当たっていなければ、近く(画面で12px以内)の最寄りのポート */
  private portNear(ev: MouseEvent): PortRef | undefined {
    const hit = this.portMarkAt(ev);
    if (hit) return hit;
    const p = this.host.clientToGraph(ev.clientX, ev.clientY);
    const zoom = this.host.getZoom();
    let best: { ref: PortRef; d: number } | undefined;
    for (const lp of locatePorts(this.doc, this.pageId)) {
      const d = Math.hypot(lp.x - p.x, lp.y - p.y) * zoom;
      if (d <= DROP_RADIUS_PX && (!best || d < best.d)) best = { ref: lp.ref, d };
    }
    return best?.ref;
  }

  /**
   * Shift を押しながらポートをドラッグして、位置を動かす。
   * 普通のドラッグは接続の操作なので、修飾キーで区別する。maxGraph より先に(捕捉段階で)受け取り、
   * Shift 付きのときだけ奪う。移動先は、機器の最も近い辺とその辺上の位置(グリッド吸着は movePort が行う)。
   */
  private installPortMove(): void {
    const c = this.host.container;
    const localOf = (ev: MouseEvent, nodeId: string) => {
      const node = this.doc.pages[0].nodes.find((n) => n.id === nodeId)!;
      const p = this.host.clientToGraph(ev.clientX, ev.clientY);
      const local = { x: p.x - node.x, y: p.y - node.y };
      return { node, local, side: nearestSide(local, { w: node.w, h: node.h }) };
    };

    c.addEventListener(
      'pointerdown',
      (ev) => {
        if (!ev.shiftKey || ev.button !== 0) return;
        const ref = this.portMarkAt(ev);
        if (!ref) return;
        ev.stopPropagation(); // 接続の開始・機器の選択を起こさない
        ev.preventDefault();
        const ghost = document.createElement('div');
        ghost.style.cssText = `position:absolute;border:2px dashed ${this.host.getTheme().ghostStroke};border-radius:50%;pointer-events:none;z-index:10`;
        c.append(ghost);
        const showGhost = (e: PointerEvent) => {
          const { node, local, side } = localOf(e, ref.nodeId);
          const grid = this.doc.grid.size;
          const { min, max } = alongRange(side, { w: node.w, h: node.h }, grid, portHeaderExtra(this.doc, node), portFooterExtra(this.doc, node));
          const raw = side === 'left' || side === 'right' ? local.y : local.x;
          const pos = Math.min(max, Math.max(min, Math.round(raw / grid) * grid));
          const x = node.x + (side === 'left' ? 0 : side === 'right' ? node.w : pos);
          const y = node.y + (side === 'top' ? 0 : side === 'bottom' ? node.h : pos);
          // 点線の目印はコンテナ内の画面座標で置く(図の座標 × 拡大率)
          const z = this.host.getZoom();
          const s = Math.max(10, grid) * z;
          Object.assign(ghost.style, { left: `${x * z - s / 2}px`, top: `${y * z - s / 2}px`, width: `${s}px`, height: `${s}px` });
        };
        trackDrag(
          {
            move: showGhost,
            end: (e) => {
              ghost.remove();
              if (!e) return;
              const { local, side } = localOf(e, ref.nodeId);
              this.callbacks.onPortMove(ref.nodeId, ref.portId, side, side === 'left' || side === 'right' ? local.y : local.x);
            },
          },
          false, // ポートの移動は、Esc では取り消さない(従来どおり)
        );
        showGhost(ev);
      },
      true,
    );
  }

  /** 空き地から Shift+ドラッグで枠を引き、触れたポートを選ぶ */
  private startBand(ev: PointerEvent): void {
    this.host.clearGraphSelection();
    this.clearPortSelection(false);
    const origin = this.host.clientToGraph(ev.clientX, ev.clientY);
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;border:1.5px dashed ${this.host.getTheme().selection};background:${this.host.getTheme().marqueeFill};pointer-events:none;z-index:10`;
    this.host.container.append(box);
    const move = (e: PointerEvent) => {
      const a = this.host.graphToScreen(origin);
      const b = this.host.graphToScreen(this.host.clientToGraph(e.clientX, e.clientY));
      Object.assign(box.style, { left: `${Math.min(a.x, b.x)}px`, top: `${Math.min(a.y, b.y)}px`, width: `${Math.abs(a.x - b.x)}px`, height: `${Math.abs(a.y - b.y)}px` });
    };
    trackDrag(
      {
        move,
        end: (e) => {
          box.remove();
          if (!e) return;
          const end = this.host.clientToGraph(e.clientX, e.clientY);
          // ほぼ動かさなかったときは、枠を引いたことにしない(選択の解除だけ)
          if (Math.hypot(end.x - origin.x, end.y - origin.y) * this.host.getZoom() < MIN_BAND_PX) {
            this.callbacks.onPortsSelected(0);
            return;
          }
          const marker = this.doc.grid.size * this.host.getTheme().markerRatio + 2;
          this.selection = portsInRect(this.doc, this.pageId, { x1: origin.x, y1: origin.y, x2: end.x, y2: end.y }, marker);
          this.refresh();
          this.callbacks.onPortsSelected(this.selection.length);
        },
      },
      true,
    );
    move(ev);
  }

  /** 選んだポートのどれかをドラッグして、別のポートに落とす。ドラッグ中は、つなぐ組と、つなげない選択側を示す */
  private startBulkDrag(ev: PointerEvent): void {
    const selected = [...this.selection];
    const update = (e: PointerEvent) => {
      const drop = this.portNear(e);
      this.bulkPreview = drop
        ? { plan: planBulkConnect(this.doc, this.pageId, selected, drop), drop, at: this.host.graphToScreen(this.host.clientToGraph(e.clientX, e.clientY)) }
        : null;
      this.refresh();
    };
    const cancel = trackDrag(
      {
        move: update,
        end: (e) => {
          this.cancelBulkDrag = null;
          const drop = e ? this.portNear(e) : undefined;
          this.bulkPreview = null;
          this.refresh();
          if (e && drop) this.callbacks.onBulkConnect(planBulkConnect(this.doc, this.pageId, selected, drop));
        },
      },
      true,
    );
    this.cancelBulkDrag = cancel;
    update(ev);
  }

  /**
   * ポートの枠選択と一括接続。
   * - 空き地を Shift+ドラッグで枠を引くと、触れたポートを選ぶ(ポート上から始めると、従来のポート移動)。
   * - 選んだポート(2つ以上)のどれかをドラッグして別のポートに落とすと、まとめて接続する。Esc で取り消す。
   * - それ以外の場所の操作(クリックなど)で、選択は解除される。
   * maxGraph より先に(捕捉段階で)受け取り、この操作のときだけ奪う。
   */
  private installBulkSelect(): void {
    this.host.container.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.button !== 0) return;
        const cellId = this.host.cellIdAt(ev);
        const ref = cellId ? this.host.portRefOfCell(cellId) : undefined;
        if (ev.shiftKey) {
          // ポート上は従来のポート移動。機器・線の上では始めない。枠(グループ)の内側は、機器のない所なら始められる
          if (cellId && !this.host.isFrameCell(cellId)) return;
          ev.stopPropagation();
          ev.preventDefault();
          this.startBand(ev);
          return;
        }
        // 開始はポートのマークに当たったときだけ(近傍判定は落とし先用。開始側に使うと、ポートの近くからの機器の移動を妨げる)
        const onSelected = ref !== undefined && this.selection.some((s) => sameRef(s, ref));
        if (onSelected && this.selection.length >= 2) {
          ev.stopPropagation();
          ev.preventDefault();
          this.startBulkDrag(ev);
          return;
        }
        if (this.selection.length > 0) this.clearPortSelection(); // ほかの場所の操作で解除
      },
      true,
    );
  }

  /** ポートにマウスを合わせたとき、少し大きく見せる(ボタンを押している間・接続ドラッグ中は出さない) */
  private installHover(): void {
    const c = this.host.container;
    const set = (ref: PortRef | null) => {
      const same = ref === this.hoverPort || (ref && this.hoverPort && sameRef(ref, this.hoverPort));
      if (same) return;
      this.hoverPort = ref;
      this.refresh();
    };
    c.addEventListener('pointermove', (ev) => {
      if (ev.buttons !== 0 || this.candidates) {
        set(null);
        return;
      }
      set(this.portMarkAt(ev) ?? null);
    });
    c.addEventListener('pointerleave', () => set(null));
  }

  /**
   * つなぎ先の候補の強調が、確実に消えるようにする。maxGraph の接続の終了(RESET)が届かない場合に備え、
   * ボタンを離した・ウィンドウを離れた時点で強調を消す。接続のドラッグ中の Esc では、接続を取り消す
   * (maxGraph の標準には無い。一括接続のドラッグと同じ操作にそろえる)。
   */
  private installCandidateSafetyNet(): void {
    const end = () => this.endCandidates();
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', end);
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.candidates) return;
        e.stopPropagation(); // 取り消しだけに使い、ポート選択の解除(アプリ側の Esc)には渡さない
        this.host.cancelConnection();
        this.endCandidates();
      },
      true,
    );
  }
}
