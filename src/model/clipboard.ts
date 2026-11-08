import type { Action, ActionResult } from './actions';
import { assetsIssue } from './images';
import { snap } from './grid';
import { uniqueId } from './ids';
import { getPage } from './query';
import { isCustomTemplateId, MAX_TEMPLATES } from './templateActions';
import type { DeviceTemplate, DiagramDocument, DiagramEdge, DiagramGroup, DiagramNode, SignalType } from './types';

// コピー&貼り付け。選んだ機器・枠を、アプリのデータとして複製する。
// (描画ライブラリ標準の Ctrl+ドラッグ複製は、データに入らず選択も削除もできないため使わない)

/** コピーした内容。貼り付け先の図に無い機器の種類・信号の種類も一緒に持つ(別の図へ貼っても壊れない) */
export interface ClipboardData {
  nodes: DiagramNode[];
  frames: DiagramGroup[];
  /** コピーした機器どうしの接続(片方でも外にある接続は含めない。1ポート1本のため) */
  edges: DiagramEdge[];
  templates: DeviceTemplate[];
  signalTypes: SignalType[];
  assets: Record<string, string>;
}

/** 貼り付けの1回ごとのずらし量(グリッド2つぶん) */
const PASTE_STEP_GRID = 2;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const centerInside = (inner: Rect, frame: Rect): boolean => {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx >= frame.x && cx < frame.x + frame.w && cy >= frame.y && cy < frame.y + frame.h;
};

/**
 * 選んだ機器・枠をコピーする。枠を選んだときは、中の機器と入れ子の枠も含める
 * (枠を動かすと中も動くのと同じ考え方)。何も選ばれていなければ null。
 */
export function copySelection(
  doc: DiagramDocument,
  pageId: string,
  selection: { nodeIds?: readonly string[]; frameIds?: readonly string[] },
): ClipboardData | null {
  const page = getPage(doc, pageId);
  if (!page) return null;
  const nodeIds = new Set(selection.nodeIds ?? []);
  const frameIds = new Set(selection.frameIds ?? []);
  for (const fid of [...frameIds]) {
    const frame = page.groups.find((g) => g.id === fid);
    if (!frame) continue;
    for (const n of page.nodes) if (centerInside(n, frame)) nodeIds.add(n.id);
    for (const g of page.groups) if (g.id !== fid && centerInside(g, frame)) frameIds.add(g.id);
  }
  const nodes = page.nodes.filter((n) => nodeIds.has(n.id));
  const frames = page.groups.filter((g) => frameIds.has(g.id));
  if (nodes.length === 0 && frames.length === 0) return null;

  const copiedNodeIds = new Set(nodes.map((n) => n.id));
  const edges = page.edges.filter((e) => copiedNodeIds.has(e.from.nodeId) && copiedNodeIds.has(e.to.nodeId));
  const templates = doc.deviceTemplates.filter((t) => nodes.some((n) => n.templateId === t.id));

  const usedSignals = new Set<string>();
  for (const t of templates) for (const g of t.portGroups) usedSignals.add(g.signalType);
  for (const n of nodes) for (const g of n.portGroupsOverride ?? []) usedSignals.add(g.signalType);
  const signalTypes = doc.signalTypes.filter((s) => usedSignals.has(s.id));

  const assetIds = new Set<string>();
  for (const node of nodes) if (node.imageId) assetIds.add(node.imageId);
  for (const template of templates) if (template.imageId) assetIds.add(template.imageId);
  const assets = Object.fromEntries(
    [...assetIds].filter((id) => doc.assets?.[id] !== undefined).map((id) => [id, doc.assets![id]]),
  );

  return structuredClone({ nodes, frames, edges, templates, signalTypes, assets });
}

function sameSize(a: DeviceTemplate['size'], b: DeviceTemplate['size']): boolean {
  if (!a || !b) return a === b;
  return a.w === b.w && a.h === b.h;
}

function samePortGroups(a: DeviceTemplate['portGroups'], b: DeviceTemplate['portGroups']): boolean {
  if (a.length !== b.length) return false;
  return a.every((group, index) => {
    const other = b[index];
    return (
      group.id === other.id &&
      group.signalType === other.signalType &&
      group.direction === other.direction &&
      group.side === other.side &&
      group.count === other.count &&
      group.labelPrefix === other.labelPrefix &&
      group.multi === other.multi
    );
  });
}

/** 別の図の定義を安全に再利用できるか、配置に影響する全項目で比較する。 */
function sameTemplate(a: DeviceTemplate, b: DeviceTemplate): boolean {
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.shape === b.shape &&
    a.imageId === b.imageId &&
    sameSize(a.size, b.size) &&
    samePortGroups(a.portGroups, b.portGroups)
  );
}

function importedTemplatePrefix(templateId: string): string {
  if (isCustomTemplateId(templateId)) return 'custom';
  // preset-* は組み込み定義と誤認されないIDへ退避する。
  return 'imported';
}

/** 余白 margin を含めて、2つの矩形が重なるか(辺が接するだけなら重ならない) */
const overlaps = (p: Rect, q: Rect, margin: number): boolean =>
  p.x < q.x + q.w + margin && q.x < p.x + p.w + margin && p.y < q.y + q.h + margin && q.y < p.y + p.h + margin;

/**
 * 貼り付けのずらし量の提案。step は、続けて貼り付けた回数(1始まり)。
 * 機器だけなら、グリッド2つぶんずつ右下へずらす。
 * 枠を含むときは、元の位置から最も近い「空き」へ置く。空きの条件:
 *  ・ページに収まる
 *  ・貼り付ける枠の中に、既存の機器の中心が入らない(所属は中心が枠内かで決まるため。
 *    入ると、新しい枠を動かしたとき、無関係な機器や元の機器まで連れて動いてしまう)
 *  ・既存の枠と重ならない(余白1グリッド)。貼り付ける機器が、既存の機器と重ならない
 * 空きが無い(ほぼ満杯の図)ときは、ぶつかりが最も少ない場所を選ぶ。続けて貼るときは、前回貼り付けた枠が
 * 既存の枠として判定に効くので、自然に別の場所になる(step は、機器だけの貼り付けにだけ効く)。
 */
export function suggestPasteOffset(doc: DiagramDocument, pageId: string, data: ClipboardData, step: number): { dx: number; dy: number } {
  const g = doc.grid.size;
  const small = step * PASTE_STEP_GRID * g;
  const page = getPage(doc, pageId);
  if (!page || data.frames.length === 0) return { dx: small, dy: small };
  const all: Rect[] = [...data.nodes, ...data.frames];
  const minX = Math.min(...all.map((r) => r.x));
  const minY = Math.min(...all.map((r) => r.y));
  const maxX = Math.max(...all.map((r) => r.x + r.w));
  const maxY = Math.max(...all.map((r) => r.y + r.h));

  /** 貼り付けた結果の「ぶつかり」の数: 取り込んでしまう既存の機器、重なる既存の枠、重なる既存の機器 */
  const conflicts = (dx: number, dy: number): number => {
    const move = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
    let count = 0;
    for (const f of data.frames.map(move)) {
      count += page.nodes.filter((n) => centerInside(n, f)).length;
      count += page.groups.filter((o) => overlaps(f, o, g)).length;
    }
    for (const n of data.nodes.map(move)) count += page.nodes.filter((o) => overlaps(n, o, 0)).length;
    return count;
  };

  // 候補は、グリッド単位のずらし量。元の位置に近い順(同じ距離なら、縦のずれが小さい=右を優先)に探す
  const candidates: { dx: number; dy: number; conflicts: number }[] = [];
  for (let dx = Math.ceil(-minX / g) * g; dx <= page.size.w - maxX; dx += g) {
    for (let dy = Math.ceil(-minY / g) * g; dy <= page.size.h - maxY; dy += g) {
      if (dx !== 0 || dy !== 0) candidates.push({ dx, dy, conflicts: conflicts(dx, dy) });
    }
  }
  // ぶつかりが最も少なく(空きがあれば0)、同じなら元に近く、同じ距離なら縦のずれが小さい(=右)ものを選ぶ
  candidates.sort(
    (p, q) =>
      p.conflicts - q.conflicts ||
      Math.abs(p.dx) + Math.abs(p.dy) - (Math.abs(q.dx) + Math.abs(q.dy)) ||
      Math.abs(p.dy) - Math.abs(q.dy) ||
      p.dx - q.dx,
  );
  const best = candidates[0];
  return best ? { dx: best.dx, dy: best.dy } : { dx: small, dy: small };
}

/**
 * コピーした内容を貼り付ける。IDは振り直し、位置は offset だけずらす(グリッドへ吸着し、ページの外へ出ないよう収める)。
 * 貼り付けた機器・枠のIDは、結果の createdNodeIds / createdFrameIds に入る。
 * 図に無い機器の種類・信号の種類は、同じIDのものが無い場合に限り補う(既存の定義は上書きしない)。
 */
export function pasteClipboard(pageId: string, data: ClipboardData, offset: { dx: number; dy: number }): Action {
  return (doc): ActionResult => {
    const page = getPage(doc, pageId);
    if (!page) return { ok: false, error: 'unknown-page' };
    if (data.nodes.length === 0 && data.frames.length === 0) return { ok: false, error: 'invalid-value' };

    const referencedAssetIds = new Set<string>();
    for (const node of data.nodes) if (node.imageId) referencedAssetIds.add(node.imageId);
    for (const template of data.templates) if (template.imageId) referencedAssetIds.add(template.imageId);
    for (const assetId of referencedAssetIds) {
      if (data.assets[assetId] === undefined && doc.assets?.[assetId] === undefined) {
        return { ok: false, error: 'invalid-value' };
      }
    }
    for (const [assetId, dataUri] of Object.entries(data.assets)) {
      const existing = doc.assets?.[assetId];
      if (existing !== undefined && existing !== dataUri) return { ok: false, error: 'invalid-value' };
    }
    // 履歴間で assets が参照共有されるため、貼り付け前のオブジェクトは一切変更しない。
    const nextAssets = { ...doc.assets, ...data.assets };
    if (assetsIssue(nextAssets)) return { ok: false, error: 'document-too-large' };

    const templateIdMap = new Map<string, string>();
    const importedTemplates: DeviceTemplate[] = [];
    const resolvedTemplates = [...doc.deviceTemplates];
    for (const template of data.templates) {
      const existing = resolvedTemplates.find((candidate) => candidate.id === template.id);
      if (!existing) {
        const imported = structuredClone(template);
        importedTemplates.push(imported);
        resolvedTemplates.push(imported);
        templateIdMap.set(template.id, template.id);
        continue;
      }
      if (sameTemplate(existing, template)) {
        templateIdMap.set(template.id, existing.id);
        continue;
      }

      const id = uniqueId(
        importedTemplatePrefix(template.id),
        resolvedTemplates.map((candidate) => candidate.id),
      );
      const imported = { ...structuredClone(template), id };
      importedTemplates.push(imported);
      resolvedTemplates.push(imported);
      templateIdMap.set(template.id, id);
    }
    for (const node of data.nodes) {
      if (!templateIdMap.has(node.templateId)) return { ok: false, error: 'invalid-value' };
    }
    if (doc.deviceTemplates.length + importedTemplates.length > MAX_TEMPLATES) {
      return { ok: false, error: 'too-many-templates' };
    }

    const g = doc.grid.size;
    const s = (v: number) => (doc.grid.enabled ? snap(v, g) : v);
    // ページの外へ出ないよう、全体の外接矩形が収まる範囲へ、ずらし量を丸める
    const all: Rect[] = [...data.nodes, ...data.frames];
    const minX = Math.min(...all.map((r) => r.x));
    const minY = Math.min(...all.map((r) => r.y));
    const maxX = Math.max(...all.map((r) => r.x + r.w));
    const maxY = Math.max(...all.map((r) => r.y + r.h));
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const dx = s(clamp(offset.dx, -minX, page.size.w - maxX));
    const dy = s(clamp(offset.dy, -minY, page.size.h - maxY));

    for (const st of data.signalTypes) {
      if (!doc.signalTypes.some((x) => x.id === st.id)) doc.signalTypes.push(structuredClone(st));
    }
    doc.deviceTemplates.push(...importedTemplates);
    doc.assets = nextAssets;

    const nodeIdMap = new Map<string, string>();
    const createdNodeIds: string[] = [];
    for (const n of structuredClone(data.nodes)) {
      const id = uniqueId('n', page.nodes.map((x) => x.id));
      nodeIdMap.set(n.id, id);
      page.nodes.push({
        ...n,
        id,
        templateId: templateIdMap.get(n.templateId)!,
        x: n.x + dx,
        y: n.y + dy,
      });
      createdNodeIds.push(id);
    }
    const createdFrameIds: string[] = [];
    for (const f of structuredClone(data.frames)) {
      const id = uniqueId('g', page.groups.map((x) => x.id));
      page.groups.push({ ...f, id, x: f.x + dx, y: f.y + dy });
      createdFrameIds.push(id);
    }
    for (const e of structuredClone(data.edges)) {
      const from = nodeIdMap.get(e.from.nodeId);
      const to = nodeIdMap.get(e.to.nodeId);
      if (!from || !to) continue; // コピーに含まれない機器への接続は作らない
      // 手動の経路(waypoints)は、ずらした位置と合わないため引き継がない
      page.edges.push({
        id: uniqueId('e', page.edges.map((x) => x.id)),
        from: { ...e.from, nodeId: from },
        to: { ...e.to, nodeId: to },
      });
    }
    return { ok: true, createdNodeIds, createdFrameIds };
  };
}
