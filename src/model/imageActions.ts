import { minNodeSize } from './actions';
import type { Action, ActionResult } from './actions';
import { ceilToGrid, snap } from './grid';
import { assetsIssue, IMAGE_PAD, imageDataUriSize, imageTop, isAssetId, isImageDataUri, nodeHeightForImage } from './images';
import { getPage } from './query';
import type { DiagramDocument, DiagramNode, Page } from './types';

// 機器の大きさの変更と、機器の画像の設定・解除。

const OK: ActionResult = { ok: true };
const fail = (error: NonNullable<ActionResult['error']>): ActionResult => ({ ok: false, error });

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 機器がページの外へ出ないよう、位置を内側へ寄せる(機器がページより大きいときは、左上に合わせる) */
function keepInsidePage(node: DiagramNode, page: Page): void {
  node.x = Math.max(0, Math.min(node.x, page.size.w - node.w));
  node.y = Math.max(0, Math.min(node.y, page.size.h - node.h));
}

/** 変形の結果の矩形(機器の位置と大きさ) */
export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 機器をドラッグで変形した結果(新しい位置と大きさ)を反映する。
 * - 値はグリッドの倍数へ丸め(グリッドが有効なとき)、ポートと文字が収まる最小の大きさより小さくはしない。
 * - 動かさなかった側の辺は固定する(左・上の辺をドラッグしたときは、右・下の辺の位置を保つ)。
 * - ページより大きくはせず、はみ出す位置は内側へ寄せる。接続は、ポートの位置が変わるだけで保たれる。
 * - fitImage(Shift を押しながらのドラッグ)で、画像のある機器は、枠が画像の縦横比にちょうど合うように、
 *   動かした量が大きい方(幅か高さ)を基準に、もう一方を決める(余白なしで画像が収まる)。
 */
export function resizeNodeRect(pageId: string, nodeId: string, rect: NodeRect, options: { fitImage?: boolean } = {}): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return fail('unknown-node');
    if (!finitePositive(rect.w) || !finitePositive(rect.h) || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return fail('invalid-value');

    const old = { x: node.x, y: node.y, w: node.w, h: node.h };
    let w = rect.w;
    let h = rect.h;

    if (options.fitImage && node.imageId) {
      const size = imageDataUriSize(doc.assets?.[node.imageId]);
      if (size) {
        const ratio = size.height / size.width;
        const widthDriven = Math.abs(w - old.w) / old.w >= Math.abs(h - old.h) / old.h;
        if (widthDriven) {
          h = nodeHeightForImage({ ...node, w }, size.width, size.height);
        } else {
          const top = imageTop({ ...node, w: old.w });
          w = (h - top - IMAGE_PAD) / ratio + IMAGE_PAD * 2;
          h = nodeHeightForImage({ ...node, w }, size.width, size.height);
        }
      }
    }

    const round = (v: number) => (doc.grid.enabled ? snap(v, doc.grid.size) : v);
    const min = minNodeSize(node, doc);
    node.w = Math.min(Math.max(round(w), min.w), Math.max(page.size.w, min.w));
    node.h = Math.min(Math.max(round(h), min.h), Math.max(page.size.h, min.h));

    // 左・上の辺を動かしたときは、右・下の辺を固定する。丸めや最小への補正のあとの大きさで決める
    const leftMoved = rect.x !== old.x;
    const topMoved = rect.y !== old.y;
    // 固定する辺は丸めない(グリッドの外にあった辺を丸めると、固定したはずの辺が動く)。辺と大きさがグリッドの倍数なら、位置も倍数になる
    node.x = leftMoved ? old.x + old.w - node.w : old.x;
    node.y = topMoved ? old.y + old.h - node.h : old.y;
    keepInsidePage(node, page);
    return OK;
  };
}

/** 機器の大きさを、位置を変えずに変える(パネルの幅・高さの欄)。ほかの規則は resizeNodeRect と同じ */
export function resizeNode(pageId: string, nodeId: string, size: { w: number; h: number }): Action {
  return (doc) => {
    const node = getPage(doc, pageId)?.nodes.find((n) => n.id === nodeId);
    if (!node) return fail(getPage(doc, pageId) ? 'unknown-node' : 'unknown-page');
    return resizeNodeRect(pageId, nodeId, { x: node.x, y: node.y, ...size })(doc);
  };
}

export interface NodeImage {
  /** 画像の ID(内容のハッシュ)。同じ内容は同じ ID になり、1つの図の中で共有される */
  id: string;
  dataUri: string;
  /** 保存する画像の寸法(px)。機器の高さを決めるのに使う */
  width: number;
  height: number;
}

/**
 * 機器に画像を設定する。画像は図の assets に入れ(同じ ID があれば再利用)、機器の imageId で参照する。
 * 幅はそのままで、高さを「名称の行 + 幅に合わせた画像の高さ」にする(ポートが収まらなければ足す)。
 */
export function setNodeImage(pageId: string, nodeId: string, image: NodeImage): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return fail('unknown-node');
    if (!isAssetId(image.id) || !isImageDataUri(image.dataUri) || !finitePositive(image.width) || !finitePositive(image.height)) return fail('invalid-value');

    const existing = doc.assets?.[image.id];
    if (existing !== undefined && existing !== image.dataUri) return fail('invalid-value'); // 同じ ID で内容が違う(ハッシュの衝突は起きない前提。起きれば断る)
    const nextAssets = { ...(doc.assets ?? {}), [image.id]: image.dataUri };
    if (assetsIssue(nextAssets)) return fail('document-too-large');
    doc.assets = nextAssets;
    node.imageId = image.id;

    const wanted = nodeHeightForImage(node, image.width, image.height);
    const min = minNodeSize(node, doc);
    node.h = Math.max(doc.grid.enabled ? ceilToGrid(wanted, doc.grid.size) : wanted, min.h);
    node.h = Math.min(node.h, Math.max(page.size.h, min.h));
    keepInsidePage(node, page);
    return OK;
  };
}

/** 機器の画像を外す(大きさはそのまま)。図の assets からは消さない(元に戻すで戻せるよう、保存時に整理する) */
export function clearNodeImage(pageId: string, nodeId: string): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return fail('unknown-node');
    delete node.imageId;
    return OK;
  };
}

/**
 * 複数の機器へ、同じ画像をまとめて設定する。機器ごとに、幅はそのままで高さを画像に合わせる(setNodeImage と同じ)。
 * すでに別の画像がある機器は上書きする。1台でも失敗したら、全体を適用しない(ストアは失敗した操作を捨てる)。
 */
export function setNodesImage(pageId: string, nodeIds: readonly string[], image: NodeImage): Action {
  return (doc) => {
    const ids = [...new Set(nodeIds)];
    if (ids.length === 0) return fail('unknown-node');
    for (const id of ids) {
      const r = setNodeImage(pageId, id, image)(doc);
      if (!r.ok) return r;
    }
    return OK;
  };
}

/** 複数の機器から、画像をまとめて外す。画像のない機器が混ざっていてもよい(そのまま通す) */
export function clearNodesImage(pageId: string, nodeIds: readonly string[]): Action {
  return (doc) => {
    const ids = [...new Set(nodeIds)];
    if (ids.length === 0) return fail('unknown-node');
    for (const id of ids) {
      const r = clearNodeImage(pageId, id)(doc);
      if (!r.ok) return r;
    }
    return OK;
  };
}

/** どの機器・登録テンプレートからも使われていない画像を除いた assets を返す(保存のとき。元の doc は変えない) */
export function usedAssets(doc: Pick<DiagramDocument, 'assets' | 'deviceTemplates' | 'pages'>): Record<string, string> {
  const used = new Set<string>();
  for (const page of doc.pages) for (const n of page.nodes) if (n.imageId) used.add(n.imageId);
  for (const template of doc.deviceTemplates) if (template.imageId) used.add(template.imageId);
  return Object.fromEntries(Object.entries(doc.assets ?? {}).filter(([id]) => used.has(id)));
}
