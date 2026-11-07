import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { buildSvg } from '../../src/io/svgExport';
import { addNodeFromTemplate, removeItems } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { clearNodeImage, resizeNode, resizeNodeRect, setNodeImage, usedAssets } from '../../src/model/imageActions';
import { copySelection, pasteClipboard } from '../../src/model/clipboard';
import { MAX_IMAGES_PER_DOCUMENT } from '../../src/model/images';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { setPageSize } from '../../src/model/actions';
import { validateDocument } from '../../src/model/validate';
import { DocumentStore } from '../../src/state/store';
import { TINY_JPEG, TINY_PNG } from '../fixtures/tinyImage';

// 期待値は計画(.tasks/custom_images)の規則から導く: 大きさ=グリッドの倍数・最小より小さくしない・ページ内、画像=幅は不変で高さを合わせる。
const P = 'page-1';
type Doc = ReturnType<typeof createEmptyDocument>;
const tpl = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);
const node = (doc: Doc, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;

function put(doc: Doc, presetId: string, x: number, y: number, w?: number, h?: number): string {
  const id = addNodeFromTemplate(P, tpl(presetId), 'N', { x, y })(doc).created!;
  if (w !== undefined) node(doc, id).w = w;
  if (h !== undefined) node(doc, id).h = h;
  return id;
}
/** 指定の寸法を持つ PNG の data URI(ヘッダだけ。寸法の読み取りの確認用) */
const pngUri = (w: number, h: number): string => {
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0];
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
};
const image = (id: string, width = 100, height = 100, dataUri = TINY_PNG) => ({ id, dataUri, width, height });

describe('resizeNode', () => {
  it('グリッドが有効なら、グリッドの倍数へ丸める', () => {
    const doc = createEmptyDocument(); // グリッド 10
    const id = put(doc, 'generic', 40, 40);
    expect(resizeNode(P, id, { w: 233, h: 177 })(doc).ok).toBe(true);
    expect([node(doc, id).w, node(doc, id).h]).toEqual([230, 180]);
  });

  it('グリッドが無効なら、丸めない', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'generic', 40, 40);
    resizeNode(P, id, { w: 233, h: 177 })(doc);
    expect([node(doc, id).w, node(doc, id).h]).toEqual([233, 177]);
  });

  it('ポートと文字が収まる最小より小さくはしない', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'switch', 40, 40); // LAN 8ポートが1辺に並ぶ
    const before = { w: node(doc, id).w, h: node(doc, id).h };
    resizeNode(P, id, { w: 10, h: 10 })(doc);
    expect(node(doc, id).w).toBeGreaterThanOrEqual(120);
    expect(node(doc, id).w).toBeLessThanOrEqual(before.w); // 標準の大きさ以下には変わらない(最小=標準)
    expect(node(doc, id).h).toBeGreaterThanOrEqual(50);
  });

  it('ページより大きくはせず、はみ出す位置は内側へ寄せる', () => {
    const doc = createEmptyDocument();
    setPageSize(P, { w: 640, h: 360 })(doc);
    const id = put(doc, 'generic', 500, 300);
    resizeNode(P, id, { w: 200, h: 100 })(doc);
    expect([node(doc, id).x, node(doc, id).y]).toEqual([440, 260]); // 440+200=640, 260+100=360
    resizeNode(P, id, { w: 5000, h: 5000 })(doc);
    expect([node(doc, id).w, node(doc, id).h]).toEqual([640, 360]);
    expect([node(doc, id).x, node(doc, id).y]).toEqual([0, 0]);
  });

  it('不正な値・存在しない機器・ページは断り、何も変えない', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'generic', 40, 40);
    const before = structuredClone(doc);
    expect(resizeNode(P, id, { w: 0, h: 100 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(resizeNode(P, id, { w: -5, h: 100 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(resizeNode(P, id, { w: Number.NaN, h: 100 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(resizeNode(P, id, { w: Number.POSITIVE_INFINITY, h: 100 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(resizeNode(P, 'nope', { w: 100, h: 100 })(doc)).toMatchObject({ ok: false, error: 'unknown-node' });
    expect(resizeNode('nope', id, { w: 100, h: 100 })(doc)).toMatchObject({ ok: false, error: 'unknown-page' });
    expect(doc).toEqual(before);
  });

  it('元に戻すは1回で戻る(ストア経由)', () => {
    const store = new DocumentStore(createEmptyDocument());
    const id = addNodeFromTemplate(P, tpl('generic'), 'N', { x: 40, y: 40 });
    store.apply(id);
    const nid = store.doc.pages[0].nodes[0].id;
    const w = store.doc.pages[0].nodes[0].w;
    store.apply(resizeNode(P, nid, { w: 300, h: 200 }));
    expect(store.doc.pages[0].nodes[0].w).toBe(300);
    store.undo();
    expect(store.doc.pages[0].nodes[0].w).toBe(w);
  });
});

describe('resizeNodeRect(ドラッグでの変形)', () => {
  const rectOf = (doc: Doc, id: string) => ({ x: node(doc, id).x, y: node(doc, id).y, w: node(doc, id).w, h: node(doc, id).h });

  it('右下の角を動かしたとき(位置は変わらない)は、幅・高さだけが変わる', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'generic', 100, 100, 120, 60);
    resizeNodeRect(P, id, { x: 100, y: 100, w: 200, h: 90 })(doc);
    expect(rectOf(doc, id)).toEqual({ x: 100, y: 100, w: 200, h: 90 });
  });

  it('左・上の辺を動かしたときは、右・下の辺が動かない', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'generic', 100, 100, 120, 60); // 右端 220、下端 160
    resizeNodeRect(P, id, { x: 40, y: 70, w: 180, h: 90 })(doc);
    expect(rectOf(doc, id)).toEqual({ x: 40, y: 70, w: 180, h: 90 });
    expect(node(doc, id).x + node(doc, id).w).toBe(220);
    expect(node(doc, id).y + node(doc, id).h).toBe(160);
  });

  it('左の辺をドラッグして最小より小さくしても、右の辺は動かず、最小の大きさで止まる', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'generic', 100, 100, 200, 60); // 右端 300。最小の幅は 120
    resizeNodeRect(P, id, { x: 280, y: 100, w: 20, h: 60 })(doc);
    expect(node(doc, id).w).toBe(120);
    expect(node(doc, id).x).toBe(180); // 300 - 120
  });

  it('グリッドが有効なら、位置と大きさをグリッドの倍数へ丸める', () => {
    const doc = createEmptyDocument(); // グリッド 10
    const id = put(doc, 'generic', 100, 100, 120, 60);
    resizeNodeRect(P, id, { x: 63, y: 100, w: 157, h: 64 })(doc); // 左の辺を 100 → 63 へ、右端は 220 のまま
    expect(node(doc, id).w).toBe(160); // 157 → 160
    expect(node(doc, id).x).toBe(60); // 220 - 160
    expect(node(doc, id).h).toBe(60); // 64 → 60
  });

  it('グリッドの外にある機器でも、固定する側の辺は動かない(丸めない)', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'generic', 103, 100, 121, 60); // 右端 224(グリッドの外)
    doc.grid.enabled = true; // グリッド 10
    resizeNodeRect(P, id, { x: 63, y: 100, w: 161, h: 60 })(doc); // 左の辺を動かした
    expect(node(doc, id).w).toBe(160);
    expect(node(doc, id).x + node(doc, id).w).toBe(224); // 右の辺は 224 のまま
  });

  it('Shift(fitImage): 画像のある機器は、幅を基準に、画像の縦横比に合う高さになる(余白なし)', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'speaker', 40, 40, 160, 60);
    setNodeImage(P, id, image('img-a', 640, 640, pngUri(640, 640)))(doc); // 正方形 → 高さ = 32 + (w-16) + 8
    resizeNodeRect(P, id, { x: 40, y: 40, w: 256, h: 184 }, { fitImage: true })(doc); // 幅だけが変わった(高さは設定直後の184のまま)
    expect(node(doc, id).w).toBe(256);
    expect(node(doc, id).h).toBe(32 + 240 + 8);
  });

  it('Shift(fitImage): 高さの変化が大きいときは、高さを基準に幅を決める', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'speaker', 40, 40, 160, 60);
    setNodeImage(P, id, image('img-a', 640, 640, pngUri(640, 640)))(doc); // 160 × 184
    resizeNodeRect(P, id, { x: 40, y: 40, w: 165, h: 328 }, { fitImage: true })(doc);
    expect(node(doc, id).h).toBe(328);
    expect(node(doc, id).w).toBe((328 - 32 - 8) + 16); // 304
  });

  it('Shift でも、画像のない機器は、動かした大きさのまま(何も固定しない)', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'generic', 100, 100, 120, 60);
    resizeNodeRect(P, id, { x: 100, y: 100, w: 300, h: 70 }, { fitImage: true })(doc);
    expect([node(doc, id).w, node(doc, id).h]).toEqual([300, 70]);
  });

  it('不正な値・存在しない機器は断り、何も変えない', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'generic', 100, 100);
    const before = structuredClone(doc);
    expect(resizeNodeRect(P, id, { x: Number.NaN, y: 0, w: 100, h: 100 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(resizeNodeRect(P, id, { x: 0, y: 0, w: 0, h: 100 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(resizeNodeRect(P, 'nope', { x: 0, y: 0, w: 100, h: 100 })(doc)).toMatchObject({ ok: false, error: 'unknown-node' });
    expect(doc).toEqual(before);
  });
});

describe('setNodeImage / clearNodeImage', () => {
  it('画像を assets に入れ、機器の imageId で参照する。幅は変わらず、高さが「名称の行 + 幅に合わせた画像の高さ」になる', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'speaker', 40, 40, 160, 60);
    expect(setNodeImage(P, id, image('img-a', 750, 750))(doc).ok).toBe(true);
    expect(doc.assets['img-a']).toBe(TINY_PNG);
    expect(node(doc, id).imageId).toBe('img-a');
    expect(node(doc, id).w).toBe(160);
    expect(node(doc, id).h).toBe(184); // 32 + 144 + 8
  });

  it('グリッドが有効なら、高さをグリッドの倍数へ切り上げる', () => {
    const doc = createEmptyDocument(); // グリッド 10
    const id = put(doc, 'speaker', 40, 40, 160, 60);
    setNodeImage(P, id, image('img-a', 750, 750))(doc);
    expect(node(doc, id).h).toBe(190); // 184 → 190
  });

  it('名称が長く折り返すときは、その分だけ高さを足す(文字と画像が重ならない)', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'speaker', 40, 40, 160, 60);
    node(doc, id).label = '天井スピーカー(会議室A前方・左側)'; // 160 では2行に折り返す
    setNodeImage(P, id, image('img-a', 750, 750))(doc);
    expect(node(doc, id).h).toBe(38 + 144 + 8);
  });

  it('横長の画像: 画像に合わせた高さ(70)になる。アンプのポートが収まる最小の高さも70', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'amp', 40, 40, 240, 90);
    setNodeImage(P, id, image('img-w', 1024, 133))(doc);
    expect(node(doc, id).h).toBe(70);
  });

  it('極端に横長で、画像に合わせた高さがポートの最小(70)を下回るときは、最小の高さにする', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'amp', 40, 40, 240, 90);
    setNodeImage(P, id, image('img-w', 4000, 100))(doc); // 32 + 224×0.025 + 8 = 45.6 → 46
    expect(node(doc, id).h).toBe(70);
  });

  it('同じ画像(同じID)を複数の機器に設定しても、assets は1つ', () => {
    const doc = createEmptyDocument();
    const a = put(doc, 'speaker', 40, 40);
    const b = put(doc, 'speaker', 300, 40);
    setNodeImage(P, a, image('img-a'))(doc);
    setNodeImage(P, b, image('img-a'))(doc);
    expect(Object.keys(doc.assets)).toEqual(['img-a']);
    expect(node(doc, a).imageId).toBe('img-a');
    expect(node(doc, b).imageId).toBe('img-a');
  });

  it('不正な画像(SVG・不正なID・不正な寸法)や、同じIDで内容が違うものは断り、何も変えない', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'speaker', 40, 40);
    setNodeImage(P, id, image('img-a'))(doc);
    const before = structuredClone(doc);
    expect(setNodeImage(P, id, image('img-b', 10, 10, 'data:image/svg+xml;base64,AAAA'))(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(setNodeImage(P, id, image('a/b'))(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(setNodeImage(P, id, image('img-c', 0, 10))(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(setNodeImage(P, id, image('img-a', 10, 10, TINY_JPEG))(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(setNodeImage(P, 'nope', image('img-d'))(doc)).toMatchObject({ ok: false, error: 'unknown-node' });
    expect(doc).toEqual(before);
  });

  it('図の画像が上限の枚数に達していたら、新しい画像は断る(document-too-large)', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'speaker', 40, 40);
    for (let i = 0; i < MAX_IMAGES_PER_DOCUMENT; i++) doc.assets[`img-${i}`] = TINY_PNG;
    expect(setNodeImage(P, id, image('img-new'))(doc)).toMatchObject({ ok: false, error: 'document-too-large' });
    expect(node(doc, id).imageId).toBeUndefined();
    expect(setNodeImage(P, id, image('img-0'))(doc).ok).toBe(true); // すでにある画像は再利用できる
  });

  it('画像を外すと imageId が消える(大きさと assets はそのまま)', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'speaker', 40, 40);
    setNodeImage(P, id, image('img-a'))(doc);
    const h = node(doc, id).h;
    expect(clearNodeImage(P, id)(doc).ok).toBe(true);
    expect(node(doc, id).imageId).toBeUndefined();
    expect(node(doc, id).h).toBe(h);
    expect(doc.assets['img-a']).toBeDefined();
    expect(clearNodeImage(P, 'nope')(doc)).toMatchObject({ ok: false, error: 'unknown-node' });
  });

  it('元に戻すは1回で、画像の設定も大きさも戻る(ストア経由)', () => {
    const store = new DocumentStore(createEmptyDocument());
    store.apply(addNodeFromTemplate(P, tpl('speaker'), 'N', { x: 40, y: 40 }));
    const nid = store.doc.pages[0].nodes[0].id;
    const h = store.doc.pages[0].nodes[0].h;
    store.apply(setNodeImage(P, nid, image('img-a', 750, 750)));
    expect(store.doc.pages[0].nodes[0].imageId).toBe('img-a');
    store.undo();
    expect(store.doc.pages[0].nodes[0].imageId).toBeUndefined();
    expect(store.doc.pages[0].nodes[0].h).toBe(h);
    expect(store.doc.assets['img-a']).toBeUndefined();
  });
});

describe('ストア: 画像の共有・整理・図の入れ替わり', () => {
  function storeWithNode() {
    const store = new DocumentStore(createEmptyDocument());
    store.apply(addNodeFromTemplate(P, tpl('speaker'), 'N', { x: 40, y: 40 }));
    return { store, id: store.doc.pages[0].nodes[0].id };
  }

  it('どの機器からも使われなくなった画像は、図から外れる(外す・差し替える)。元に戻すで戻る', () => {
    const { store, id } = storeWithNode();
    store.apply(setNodeImage(P, id, image('img-a')));
    store.apply(setNodeImage(P, id, image('img-b', 50, 50, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')));
    expect(Object.keys(store.doc.assets)).toEqual(['img-b']); // 差し替えで img-a は外れる
    store.apply(clearNodeImage(P, id));
    expect(store.doc.assets).toEqual({});
    store.undo();
    expect(Object.keys(store.doc.assets)).toEqual(['img-b']);
  });

  it('画像のある機器を削除すると、その画像も図から外れる', () => {
    const { store, id } = storeWithNode();
    store.apply(setNodeImage(P, id, image('img-a')));
    store.apply(removeItems(P, { nodeIds: [id], edgeIds: [], frameIds: [] }));
    expect(store.doc.assets).toEqual({});
  });

  it('同じ画像を50回差し替えても、枚数の上限には近づかない', () => {
    const { store, id } = storeWithNode();
    for (let i = 0; i < MAX_IMAGES_PER_DOCUMENT + 5; i++) {
      const uri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      expect(store.apply(setNodeImage(P, id, image(`img-${i}`, 10, 10, uri))).ok).toBe(true);
    }
    expect(Object.keys(store.doc.assets)).toHaveLength(1);
  });

  it('操作のたびに画像を複製しない(履歴の各世代で、同じ assets オブジェクトを共有する)', () => {
    const { store, id } = storeWithNode();
    store.apply(setNodeImage(P, id, image('img-a')));
    const before = store.doc.assets;
    store.apply(resizeNode(P, id, { w: 300, h: 200 }));
    expect(store.doc.assets).toBe(before);
    store.undo();
    expect(store.doc.assets).toBe(before);
    expect(store.doc.pages[0].nodes[0].imageId).toBe('img-a');
  });

  it('epoch は、図が丸ごと入れ替わったとき(replace)だけ進む', () => {
    const { store, id } = storeWithNode();
    const e = store.epoch;
    store.apply(resizeNode(P, id, { w: 200, h: 100 }));
    store.undo();
    expect(store.epoch).toBe(e);
    store.replace(createEmptyDocument());
    expect(store.epoch).toBe(e + 1);
  });
});

describe('コピー・貼り付け', () => {
  it('画像のある機器を複製すると、同じ画像を共有する(assets は増えない)', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'speaker', 40, 40);
    setNodeImage(P, id, image('img-a', 750, 750))(doc);
    const data = copySelection(doc, P, { nodeIds: [id], frameIds: [] })!;
    const r = pasteClipboard(P, data, { dx: 100, dy: 0 })(doc);
    expect(r.ok).toBe(true);
    const copy = node(doc, r.createdNodeIds![0]);
    expect(copy.imageId).toBe('img-a');
    expect(copy.h).toBe(node(doc, id).h);
    expect(Object.keys(doc.assets)).toEqual(['img-a']);
  });
});

describe('保存・読み込み・検証', () => {
  function withImage() {
    const doc = createEmptyDocument();
    const id = put(doc, 'speaker', 40, 40);
    setNodeImage(P, id, image('img-a'))(doc);
    return { doc, id };
  }

  it('使われていない画像は、保存しない(外した画像で、ファイルが膨らまない)', () => {
    const { doc, id } = withImage();
    doc.assets['img-unused'] = TINY_PNG;
    expect(usedAssets(doc)).toEqual({ 'img-a': TINY_PNG });
    clearNodeImage(P, id)(doc);
    const parsed = JSON.parse(serializeDocument(doc));
    expect(parsed.assets).toEqual({});
    expect(doc.assets['img-a']).toBeDefined(); // 元の doc は変えない
  });

  it('画像つきの図は、保存して読み込むと同じ画像・参照になる', () => {
    const { doc, id } = withImage();
    const r = parseDocument(serializeDocument(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.assets['img-a']).toBe(TINY_PNG);
    expect(r.doc.pages[0].nodes.find((n) => n.id === id)!.imageId).toBe('img-a');
  });

  it('画像のない既存の図(assets が空・無い)も、そのまま読み込める', () => {
    expect(validateDocument(createEmptyDocument()).ok).toBe(true);
    const legacy = JSON.parse(JSON.stringify(createEmptyDocument()));
    delete legacy.assets;
    expect(validateDocument(legacy).ok).toBe(true);
    expect(usedAssets(legacy)).toEqual({});
  });

  it('imageId が assets に無い図は、読み込みを断る', () => {
    const { doc } = withImage();
    const broken = structuredClone(doc);
    broken.assets = {};
    const r = validateDocument(broken);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('imageId');
  });

  it('assets に画像でないもの(SVG・外部URL・スクリプト)がある図は、読み込みを断る', () => {
    for (const bad of ['data:image/svg+xml;base64,AAAA', 'https://example.com/x.png', 'javascript:alert(1)', 5]) {
      const doc = structuredClone(createEmptyDocument()) as unknown as Record<string, unknown>;
      doc.assets = { 'img-a': bad };
      expect(validateDocument(doc).ok, String(bad)).toBe(false);
    }
  });
});

describe('SVG出力', () => {
  const opts = { edgePoints: new Map(), countText: (n: number) => `×${n}台`, legendTitle: '凡例' };

  it('画像のある機器は <image>(縦横比を保って収める)で出し、小さなアイコンは出さない。名前は左端寄りから始まる', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = false;
    const id = put(doc, 'speaker', 40, 40, 160, 60);
    setNodeImage(P, id, image('img-a', 750, 750))(doc);
    const withImg = buildSvg(doc, P, opts);
    expect(withImg).toContain(`<image x="48" y="72" width="144" height="144" preserveAspectRatio="xMidYMid meet" href="${TINY_PNG}"/>`);
    expect(withImg).not.toContain('<g transform="translate(48 48)'); // アイコン(機器の左上 +8)が無い

    clearNodeImage(P, id)(doc);
    const without = buildSvg(doc, P, opts);
    expect(without).not.toContain('<image');
    expect(without).toContain('<g transform="translate(48 48)');
  });

  it('画像が assets に無い(壊れた)機器は、アイコンのまま出す(例外にしない)', () => {
    const doc = createEmptyDocument();
    const id = put(doc, 'speaker', 40, 40);
    node(doc, id).imageId = 'missing';
    const svg = buildSvg(doc, P, opts);
    expect(svg).not.toContain('<image');
    expect(svg).toContain('<g transform="translate(');
  });
});
