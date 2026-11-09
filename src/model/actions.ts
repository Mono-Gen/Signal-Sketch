import { DEFAULT_SIGNAL_TYPES } from './defaults';
import { snap } from './grid';
import { uniqueId } from './ids';
import { autoNodeSize } from './nodeSize';
import { findFreePosition } from './placement';
import { connectionIssues } from './diagnostics';
import { exceedsPortLimit, expandPortGroups, expandUnits } from './ports';
import { alongRange } from './portLayout';
import { isValidPageSize, itemsOutside } from './pageSize';
import { getNodePorts, getPage, getTemplate, layoutNodePorts } from './query';
import { MAX_TEMPLATES } from './templateActions';
import type { DeviceTemplate, DiagramDocument, DiagramNode, PortGroup, PortRef, Side } from './types';

/** 失敗理由のコード。文言は画面側(i18n)で決める(モデルは言語を持たない) */
export type ActionError =
  | 'unknown-page'
  | 'unknown-node'
  | 'unknown-port'
  | 'unknown-template'
  | 'self-connection'
  | 'duplicate-edge'
  | 'port-occupied'
  | 'invalid-value'
  | 'invalid-port-groups'
  | 'ports-in-use'
  | 'position-occupied'
  | 'unknown-frame'
  | 'unknown-note'
  | 'too-many-notes'
  | 'unknown-signal'
  | 'signal-in-use'
  | 'template-in-use'
  | 'too-many-templates'
  | 'page-too-small'
  | 'import-no-space'
  | 'document-too-large';

export type ActionWarning = 'signal-mismatch' | 'direction-mismatch';

export interface ActionResult {
  ok: boolean;
  error?: ActionError;
  /** 最初の警告(後方互換)。すべての警告は warnings */
  warning?: ActionWarning;
  warnings?: ActionWarning[];
  /** 新しく作った機器のID(機器の追加のとき) */
  created?: string;
  /** 貼り付けで新しく作った機器・枠のID */
  createdNodeIds?: string[];
  createdFrameIds?: string[];
  /** ページを小さくできない理由: はみ出す機器・枠の名称(page-too-small のとき) */
  blockers?: string[];
  /** 機器一覧の読み込みで、ページに収まらず置けなかった機器の名称(すべて置けなかったときは import-no-space の blockers にも入る) */
  unplaced?: string[];
}

/** ドキュメントを直接書き換える操作。呼び出し側(ストア)が複製に対して実行する */
export type Action = (doc: DiagramDocument) => ActionResult;

const fail = (error: ActionError): ActionResult => ({ ok: false, error });
const OK: ActionResult = { ok: true };

/** 登録サイズを尊重しつつ、ページ内かつポートを表示できる最小サイズへ収める。 */
function templatePlacementSize(
  doc: DiagramDocument,
  pageSize: { w: number; h: number },
  template: DeviceTemplate,
  label: string,
): { w: number; h: number } | null {
  const minimum = autoNodeSize({ groups: template.portGroups, label, model: '', grid: doc.grid.size });
  if (minimum.w > pageSize.w || minimum.h > pageSize.h) return null;
  const preferred = template.size ?? minimum;
  return {
    w: Math.min(Math.max(preferred.w, minimum.w), pageSize.w),
    h: Math.min(Math.max(preferred.h, minimum.h), pageSize.h),
  };
}

function fitNodePosition(
  doc: DiagramDocument,
  at: { x: number; y: number },
  size: { w: number; h: number },
  pageSize: { w: number; h: number },
): { x: number; y: number } {
  const placed = {
    x: doc.grid.enabled ? snap(at.x, doc.grid.size) : at.x,
    y: doc.grid.enabled ? snap(at.y, doc.grid.size) : at.y,
  };
  return {
    x: Math.min(Math.max(placed.x, 0), pageSize.w - size.w),
    y: Math.min(Math.max(placed.y, 0), pageSize.h - size.h),
  };
}

/** 機器をまとめて移動する。グリッドが有効なら吸着する */
export function moveNodes(pageId: string, moves: readonly { id: string; x: number; y: number }[]): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    // 1件でも不正なら全体を適用しない(途中まで動いた状態を残さない)
    for (const m of moves) {
      if (!page.nodes.some((n) => n.id === m.id)) return fail('unknown-node');
    }
    for (const m of moves) {
      const node = page.nodes.find((n) => n.id === m.id)!;
      node.x = doc.grid.enabled ? snap(m.x, doc.grid.size) : m.x;
      node.y = doc.grid.enabled ? snap(m.y, doc.grid.size) : m.y;
    }
    return OK;
  };
}

/**
 * ポート同士を接続する。信号種別が異なる場合は禁止せず警告を返す(設計書 4章)。
 * 1つのポートに繋げる線は1本まで(実際のケーブルは1ポートに1本のため)。
 * すでに線があるポートを選んだ場合は 'port-occupied' で失敗する。
 */
export function addEdge(pageId: string, from: PortRef, to: PortRef): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const a = page.nodes.find((n) => n.id === from.nodeId);
    const b = page.nodes.find((n) => n.id === to.nodeId);
    if (!a || !b) return fail('unknown-node');
    const pa = getNodePorts(doc, a).find((p) => p.id === from.portId);
    const pb = getNodePorts(doc, b).find((p) => p.id === to.portId);
    if (!pa || !pb) return fail('unknown-port');
    if (from.nodeId === to.nodeId && from.portId === to.portId) return fail('self-connection');
    const same = (x: PortRef, y: PortRef) => x.nodeId === y.nodeId && x.portId === y.portId;
    const dup = page.edges.some((e) => (same(e.from, from) && same(e.to, to)) || (same(e.from, to) && same(e.to, from)));
    if (dup) return fail('duplicate-edge');
    const used = (r: PortRef) => page.edges.some((e) => same(e.from, r) || same(e.to, r));
    // 複数接続を許可したポート(並列のスピーカーなど)以外は、1ポート1本
    if ((used(from) && !pa.multi) || (used(to) && !pb.multi)) return fail('port-occupied');
    page.edges.push({
      id: uniqueId('e', page.edges.map((e) => e.id)),
      from: { ...from },
      to: { ...to },
    });
    const warnings: ActionWarning[] = connectionIssues(pa, pb);
    return warnings.length === 0 ? OK : { ok: true, warning: warnings[0], warnings };
  };
}

/**
 * 複数の接続をまとめて追加する(一括接続)。1件でも失敗したら全体を適用しない
 * (呼び出し側のストアは複製に対して実行するので、途中まで増えた状態は残らない)。
 * 1回の操作として履歴に積まれるため、元に戻すのも1回で済む。
 */
export function addEdges(pageId: string, pairs: readonly { from: PortRef; to: PortRef }[]): Action {
  return (doc) => {
    if (pairs.length === 0) return fail('invalid-value');
    const warnings: ActionWarning[] = [];
    for (const pair of pairs) {
      const r = addEdge(pageId, pair.from, pair.to)(doc);
      if (!r.ok) return r;
      for (const w of r.warnings ?? []) if (!warnings.includes(w)) warnings.push(w);
    }
    return warnings.length === 0 ? OK : { ok: true, warning: warnings[0], warnings };
  };
}

/**
 * テンプレートから機器を1台追加する。テンプレートが図にまだ無ければ(標準機器など)、
 * 図へ取り込む。すでに同じIDがあれば取り込み済みのものを使い、上書きしない。
 * 位置を省略すると空いている場所へ置く。登録済みの大きさ・画像があれば引き継ぎ、
 * 無い標準機器は従来どおりポートと名称に合わせた自動サイズを使う。
 */
export function addNodeFromTemplate(
  pageId: string,
  template: DeviceTemplate,
  label: string,
  at?: { x: number; y: number },
): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    let tpl = doc.deviceTemplates.find((t) => t.id === template.id);
    if (!tpl) {
      if (doc.deviceTemplates.length >= MAX_TEMPLATES) return fail('too-many-templates');
      tpl = structuredClone(template);
      doc.deviceTemplates.push(tpl);
    }
    ensureSignalTypes(doc, tpl.portGroups);
    const size = templatePlacementSize(doc, page.size, tpl, label);
    if (!size) return { ok: false, error: 'import-no-space', blockers: [label] };
    const pos = at
      ? fitNodePosition(doc, at, size, page.size)
      : findFreePosition(page.nodes, size, page.size, doc.grid.size);
    const id = uniqueId('n', page.nodes.map((n) => n.id));
    page.nodes.push({
      id,
      templateId: tpl.id,
      label,
      model: '',
      x: pos.x,
      y: pos.y,
      w: size.w,
      h: size.h,
      ...(tpl.imageId ? { imageId: tpl.imageId } : {}),
    });
    return { ok: true, created: id };
  };
}

/** 一列配置の個数の上限と、間隔(px)の上限。図全体の上限(機器数・ポート数)は、ストアが別に判定する */
export const MAX_ROW_COUNT = 99;
export const MAX_ROW_GAP = 500;

export interface RowLayout {
  count: number;
  direction: 'horizontal' | 'vertical';
  /** 機器どうしの間の最小の空き(px)。グリッドが有効なら、刻みはグリッドの倍数へ切り上げる */
  gap: number;
}

/**
 * 同じ機器を、一列に並べて複数台追加する(同じ名称)。at は先頭の機器の左上。
 * 列がページからはみ出す位置なら内側へ寄せ、列そのものがページに収まらなければ断る。
 * 1回の操作として扱う(Undo は1回で全部戻る)。
 */
export function addNodesInRow(
  pageId: string,
  template: DeviceTemplate,
  label: string,
  row: RowLayout,
  at: { x: number; y: number },
): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    if (!Number.isInteger(row.count) || row.count < 1 || row.count > MAX_ROW_COUNT) return fail('invalid-value');
    if (!Number.isFinite(row.gap) || row.gap < 0 || row.gap > MAX_ROW_GAP) return fail('invalid-value');
    if (row.direction !== 'horizontal' && row.direction !== 'vertical') return fail('invalid-value');
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return fail('invalid-value');

    let tpl = doc.deviceTemplates.find((t) => t.id === template.id);
    if (!tpl) {
      if (doc.deviceTemplates.length >= MAX_TEMPLATES) return fail('too-many-templates');
      tpl = structuredClone(template);
      doc.deviceTemplates.push(tpl);
    }
    ensureSignalTypes(doc, tpl.portGroups);
    const size = templatePlacementSize(doc, page.size, tpl, label);
    if (!size) return { ok: false, error: 'import-no-space', blockers: [label] };

    const g = doc.grid.size;
    const gridOn = doc.grid.enabled;
    const horizontal = row.direction === 'horizontal';
    const unit = horizontal ? size.w : size.h;
    // 刻み(隣の機器の先頭までの距離)。グリッドが有効なら、全員がグリッド上に乗るよう倍数にする
    const step = gridOn ? Math.ceil((unit + row.gap) / g) * g : unit + row.gap;
    const alongTotal = step * (row.count - 1) + unit;
    const pageAlong = horizontal ? page.size.w : page.size.h;
    const pageAcross = horizontal ? page.size.h : page.size.w;
    const across = horizontal ? size.h : size.w;
    if (alongTotal > pageAlong || across > pageAcross) return { ok: false, error: 'import-no-space', blockers: [label] };

    // 先頭の位置: ページの内側へ寄せてから、グリッドへ(切り捨てて内側に残す)
    const fit = (v: number, extent: number, pageExtent: number) => {
      const clamped = Math.min(Math.max(v, 0), pageExtent - extent);
      return gridOn ? Math.floor(clamped / g) * g : clamped;
    };
    const startX = fit(at.x, horizontal ? alongTotal : size.w, page.size.w);
    const startY = fit(at.y, horizontal ? size.h : alongTotal, page.size.h);

    const used = page.nodes.map((n) => n.id);
    const created: string[] = [];
    for (let i = 0; i < row.count; i++) {
      const id = uniqueId('n', used);
      used.push(id);
      created.push(id);
      page.nodes.push({
        id,
        templateId: tpl.id,
        label,
        model: '',
        x: horizontal ? startX + i * step : startX,
        y: horizontal ? startY : startY + i * step,
        w: size.w,
        h: size.h,
        ...(tpl.imageId ? { imageId: tpl.imageId } : {}),
      });
    }
    return { ok: true, created: created[0], createdNodeIds: created };
  };
}

/**
 * 機器が使う信号種別が図の凡例に無ければ、標準の定義で補う(凡例から削除済みの種別を使う標準機器を追加しても、
 * 線の色が失われないように)。標準にも無い種別は、既存の扱い(灰色)のままにする。
 */
function ensureSignalTypes(doc: DiagramDocument, groups: readonly PortGroup[]): void {
  for (const g of groups) {
    if (doc.signalTypes.some((s) => s.id === g.signalType)) continue;
    const std = DEFAULT_SIGNAL_TYPES.find((s) => s.id === g.signalType);
    if (std) doc.signalTypes.push({ ...std });
  }
}

/** 機器の名称・型番・台数を変更する。台数は正の整数、空(undefined)なら台数表記を消す */
export function updateNode(
  pageId: string,
  nodeId: string,
  patch: { label?: string; model?: string; count?: number | undefined },
  options: { removeOrphanEdges?: boolean } = {},
): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return fail('unknown-node');
    if ('count' in patch && patch.count !== undefined && (!Number.isInteger(patch.count) || patch.count < 1)) {
      return fail('invalid-value');
    }
    // 台数・ポート数の上限(台数ぶんのポートが展開されるため、展開の前に確認する)
    if ('count' in patch && patch.count !== undefined) {
      const groups = node.portGroupsOverride ?? getTemplate(doc, node.templateId)?.portGroups ?? [];
      if (exceedsPortLimit(groups, patch.count)) return fail('invalid-value');
    }
    // 台数を減らすと、なくなる台のポートの接続が失われる。確認済みでなければ止める
    if ('count' in patch) {
      const lost = lostEdgeIdsForCount(doc, pageId, nodeId, patch.count ?? 1);
      if (lost.length > 0 && !options.removeOrphanEdges) return fail('ports-in-use');
      const lostSet = new Set(lost);
      page.edges = page.edges.filter((e) => !lostSet.has(e.id));
    }
    if (patch.label !== undefined) node.label = patch.label;
    if (patch.model !== undefined) node.model = patch.model;
    if ('count' in patch) {
      if (patch.count === undefined) delete node.count;
      else node.count = patch.count;
      pruneStalePlacements(node, node.portGroupsOverride ?? getTemplate(doc, node.templateId)?.portGroups ?? []);
      growToFit(node, doc);
    }
    return OK;
  };
}

const SIDES = ['left', 'right', 'top', 'bottom'];
const DIRECTIONS = ['in', 'out', 'inout'];

/** ポート構成を変えたとき、存在しなくなるポートにつながっている接続のID */
export function lostEdgeIds(
  doc: DiagramDocument,
  pageId: string,
  nodeId: string,
  groups: readonly PortGroup[],
  units?: number,
): string[] {
  const page = getPage(doc, pageId);
  if (!page) return [];
  const node = page.nodes.find((n) => n.id === nodeId);
  let kept: Set<string>;
  // 上限を超える入力(巨大な台数など)は、この後の操作が断るので、ここでは展開しない(展開すると固まる)
  if (exceedsPortLimit(groups, units ?? node?.count ?? 1)) return [];
  try {
    kept = new Set(expandUnits(expandPortGroups(groups), units ?? node?.count ?? 1).map((p) => p.id));
  } catch {
    return [];
  }
  return page.edges
    .filter((e) => (e.from.nodeId === nodeId && !kept.has(e.from.portId)) || (e.to.nodeId === nodeId && !kept.has(e.to.portId)))
    .map((e) => e.id);
}

/** 台数を変えたとき、なくなる台のポートにつながっている接続のID(画面の確認メッセージに使う) */
export function lostEdgeIdsForCount(doc: DiagramDocument, pageId: string, nodeId: string, units: number): string[] {
  const node = getPage(doc, pageId)?.nodes.find((n) => n.id === nodeId);
  const tpl = node ? getTemplate(doc, node.templateId) : undefined;
  if (!node || !tpl) return [];
  return lostEdgeIds(doc, pageId, nodeId, node.portGroupsOverride ?? tpl.portGroups, units);
}

/**
 * 機器のポート構成を、この機器だけ上書きする(同じテンプレートの他の機器は変わらない)。
 * 存在しなくなるポートに接続があるときは、removeOrphanEdges が無い限り失敗させる
 * (利用者の確認を取ってから、線ごと消す)。ポートが収まらなければ機器を大きくする。
 */
export function setPortGroups(
  pageId: string,
  nodeId: string,
  groups: readonly PortGroup[],
  options: { removeOrphanEdges?: boolean } = {},
): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return fail('unknown-node');
    if (!validGroups(doc, groups)) return fail('invalid-port-groups');
    if (exceedsPortLimit(groups, node.count ?? 1)) return fail('invalid-port-groups');

    const lost = lostEdgeIds(doc, pageId, nodeId, groups);
    if (lost.length > 0 && !options.removeOrphanEdges) return fail('ports-in-use');
    const lostSet = new Set(lost);
    page.edges = page.edges.filter((e) => !lostSet.has(e.id));

    node.portGroupsOverride = structuredClone([...groups]);
    pruneStalePlacements(node, groups);
    growToFit(node, doc);
    return OK;
  };
}

/** 存在しなくなったポートの位置指定を捨てる(同じIDのポートが後で作られても、古い位置を引き継がない) */
function pruneStalePlacements(node: DiagramNode, groups: readonly PortGroup[]): void {
  if (!node.portPlacements) return;
  const alive = new Set(expandUnits(expandPortGroups(groups), node.count ?? 1).map((p) => p.id));
  for (const id of Object.keys(node.portPlacements)) {
    if (!alive.has(id)) delete node.portPlacements[id];
  }
  if (Object.keys(node.portPlacements).length === 0) delete node.portPlacements;
}

function validGroups(doc: DiagramDocument, groups: readonly PortGroup[]): boolean {
  if (exceedsPortLimit(groups, 1)) return false; // 個数が巨大なまま展開して固まらないよう、先に上限を確認する
  try {
    expandPortGroups(groups);
  } catch {
    return false;
  }
  const signals = new Set(doc.signalTypes.map((s) => s.id));
  return groups.every(
    (g) =>
      signals.has(g.signalType) &&
      SIDES.includes(g.side) &&
      DIRECTIONS.includes(g.direction) &&
      typeof g.labelPrefix === 'string' &&
      (g.multi === undefined || typeof g.multi === 'boolean'),
  );
}

/** ポート構成に合わせて機器を大きくする(小さくはしない。利用者が決めた大きさを尊重する) */
/** ポート・名称・型番が収まる、機器の最小の大きさ(グリッドの倍数) */
export function minNodeSize(node: DiagramNode, doc: DiagramDocument): { w: number; h: number } {
  const groups = node.portGroupsOverride ?? getTemplate(doc, node.templateId)?.portGroups ?? [];
  return autoNodeSize({ groups, label: node.label, model: node.model, grid: doc.grid.size, units: node.count });
}

function growToFit(node: DiagramNode, doc: DiagramDocument): void {
  const need = minNodeSize(node, doc);
  node.w = Math.max(node.w, need.w);
  node.h = Math.max(node.h, need.h);
}

/**
 * ポート1つを、指定した辺・位置へ動かす(この機器だけ。テンプレートは変わらない)。
 * 位置はグリッドに吸着し、辺の範囲へ丸める。ほかのポートと同じ場所になる場合は失敗する。
 */
export function movePort(pageId: string, nodeId: string, portId: string, side: Side, pos: number): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return fail('unknown-node');
    if (!getNodePorts(doc, node).some((p) => p.id === portId)) return fail('unknown-port');
    if (!SIDES.includes(side) || !Number.isFinite(pos)) return fail('invalid-value');

    const size = { w: node.w, h: node.h };
    const { min, max } = alongRange(side, size, doc.grid.size);
    const along = Math.min(max, Math.max(min, doc.grid.enabled ? snap(pos, doc.grid.size) : pos));

    const before = node.portPlacements;
    node.portPlacements = { ...before, [portId]: { side, pos: along } };
    const placed = layoutNodePorts(doc, node);
    const me = placed.find((p) => p.portId === portId)!;
    const clash = placed.some((p) => p.portId !== portId && p.x === me.x && p.y === me.y);
    if (clash) {
      if (before) node.portPlacements = before;
      else delete node.portPlacements;
      return fail('position-occupied');
    }
    return OK;
  };
}

/** 個別に動かしたポートを、すべて自動配置へ戻す */
export function clearPortPlacements(pageId: string, nodeId: string): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return fail('unknown-node');
    delete node.portPlacements;
    return OK;
  };
}

/**
 * ページ(キャンバス)の大きさを変える。グリッドの倍数へ丸め、範囲外は拒否する。
 * 小さくして機器・枠がはみ出す場合は変更せず、はみ出す名称を blockers に入れて断る(消えてしまわないように)。
 */
export function setPageSize(pageId: string, size: { w: number; h: number }): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    if (!Number.isFinite(size.w) || !Number.isFinite(size.h)) return fail('invalid-value');
    const next = { w: snap(size.w, doc.grid.size), h: snap(size.h, doc.grid.size) };
    if (!isValidPageSize(next)) return fail('invalid-value');
    const blockers = itemsOutside(page, next);
    if (blockers.length > 0) return { ok: false, error: 'page-too-small', blockers };
    page.size = next;
    return OK;
  };
}

/** グリッド吸着のオン/オフを切り替える(ドキュメントの設定として保存される) */
export function setGridEnabled(enabled: boolean): Action {
  return (doc) => {
    doc.grid.enabled = enabled;
    return OK;
  };
}

/** 機器と接続を削除する。削除した機器につながる接続も一緒に消える */
export function removeItems(
  pageId: string,
  items: { nodeIds?: readonly string[]; edgeIds?: readonly string[]; frameIds?: readonly string[]; noteIds?: readonly string[] },
): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const nodeIds = new Set(items.nodeIds ?? []);
    const edgeIds = new Set(items.edgeIds ?? []);
    page.nodes = page.nodes.filter((n) => !nodeIds.has(n.id));
    page.edges = page.edges.filter(
      (e) => !edgeIds.has(e.id) && !nodeIds.has(e.from.nodeId) && !nodeIds.has(e.to.nodeId),
    );
    // 枠だけを消す。中の機器は残る(所属は見た目で決まるので、後始末は要らない)
    const frameIds = new Set(items.frameIds ?? []);
    page.groups = page.groups.filter((g) => !frameIds.has(g.id));
    if (items.noteIds && page.notes) {
      const noteIds = new Set(items.noteIds);
      page.notes = page.notes.filter((n) => !noteIds.has(n.id));
    }
    return OK;
  };
}
