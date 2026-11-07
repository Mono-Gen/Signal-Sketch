import { describe, expect, it } from 'vitest';
import { addNodeFromTemplate, updateNode } from '../../src/model/actions';
import { copySelection, pasteClipboard, suggestPasteOffset } from '../../src/model/clipboard';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { createEmptyDocument } from '../../src/model/defaults';
import { addFrame, moveSelection, nodesInFrame, resizeFrame } from '../../src/model/frames';
import { movePort } from '../../src/model/actions';
import { validateDocument } from '../../src/model/validate';
import { DocumentStore } from '../../src/state/store';
import { createSampleDocument } from '../fixtures/sampleDocument';

const P = 'page-1';
const fresh = () => createSampleDocument();
const node = (doc: ReturnType<typeof fresh>, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;
const paste = (doc: ReturnType<typeof fresh>, data: NonNullable<ReturnType<typeof copySelection>>, d = 20) =>
  pasteClipboard(P, data, { dx: d, dy: d })(doc);

describe('copySelection', () => {
  it('何も選ばれていない・存在しないページは null', () => {
    const doc = fresh();
    expect(copySelection(doc, P, {})).toBeNull();
    expect(copySelection(doc, P, { nodeIds: ['nope'] })).toBeNull();
    expect(copySelection(doc, 'nope', { nodeIds: ['sw'] })).toBeNull();
  });

  it('選んだ機器どうしの接続だけを含み、外の機器への接続は含めない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: ['lap', 'enc'] })!;
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['enc', 'lap']);
    expect(data.edges.map((e) => e.id)).toEqual(['e-9']); // lap→enc だけ。enc→sw は外へ出るので含めない
  });

  it('枠を選ぶと、中の機器も含める', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { frameIds: ['g-rack'] })!;
    expect(data.frames.map((f) => f.id)).toEqual(['g-rack']);
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['amp', 'ctl', 'sw']);
  });

  it('入れ子の枠は、外側を選ぶと内側の枠も含める', () => {
    const doc = fresh();
    const inner = addFrame(P, '内側', { x: 540, y: 340 })(doc).created!;
    resizeFrame(P, inner, { x: 540, y: 340, w: 300, h: 200 })(doc);
    const data = copySelection(doc, P, { frameIds: ['g-rack'] })!;
    expect(data.frames.map((f) => f.id).sort()).toEqual([inner, 'g-rack'].sort());
  });

  it('コピーした後で元の機器を変えても、コピーの内容は変わらない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: ['sw'] })!;
    updateNode(P, 'sw', { label: '変更後' })(doc);
    expect(data.nodes[0].label).toBe('Network Switch');
  });
});

describe('pasteClipboard', () => {
  it('新しいIDで機器が増え、内容(名称・型番・台数・ポート位置)を引き継ぎ、位置はずれる', () => {
    const doc = fresh();
    movePort(P, 'mute', 'lan-1@2', 'top', 60)(doc);
    const src = { ...node(doc, 'mute') };
    const data = copySelection(doc, P, { nodeIds: ['mute'] })!;
    const before = doc.pages[0].nodes.length;
    const r = paste(doc, data);
    expect(r.ok).toBe(true);
    expect(doc.pages[0].nodes).toHaveLength(before + 1);
    const copy = node(doc, r.createdNodeIds![0]);
    expect(copy.id).not.toBe('mute');
    expect(copy).toMatchObject({ label: src.label, model: src.model, count: 4, templateId: src.templateId, w: src.w, h: src.h });
    expect(copy.portPlacements).toEqual(src.portPlacements);
    expect([copy.x, copy.y]).toEqual([src.x + 20, src.y + 20]);
  });

  it('貼り付けた機器どうしの接続は、新しい機器に付け替えて作られる。元の接続は変わらない', () => {
    const doc = fresh();
    const edgesBefore = JSON.stringify(doc.pages[0].edges);
    const data = copySelection(doc, P, { nodeIds: ['lap', 'enc'] })!;
    const r = paste(doc, data);
    const [a, b] = r.createdNodeIds!;
    const added = doc.pages[0].edges.slice(16);
    expect(added).toHaveLength(1);
    expect(added[0].from.nodeId === a || added[0].from.nodeId === b).toBe(true);
    expect([added[0].from.nodeId, added[0].to.nodeId].sort()).toEqual([a, b].sort());
    expect(JSON.stringify(doc.pages[0].edges.slice(0, 16))).toBe(edgesBefore);
  });

  it('外の機器へつながる接続は作らない(貼り付けた機器のポートは、空きのまま)', () => {
    const doc = fresh();
    const r = paste(doc, copySelection(doc, P, { nodeIds: ['sw'] })!);
    const newId = r.createdNodeIds![0];
    expect(doc.pages[0].edges.some((e) => e.from.nodeId === newId || e.to.nodeId === newId)).toBe(false);
  });

  it('手動の経路(waypoints)は引き継がない', () => {
    const doc = fresh();
    doc.pages[0].edges.find((e) => e.id === 'e-9')!.waypoints = [{ x: 1, y: 2 }];
    const r = paste(doc, copySelection(doc, P, { nodeIds: ['lap', 'enc'] })!);
    expect(r.ok).toBe(true);
    expect(doc.pages[0].edges.at(-1)!.waypoints).toBeUndefined();
  });

  it('枠を貼り付けると、新しい枠の中に、貼り付けた機器だけが所属する(元の機器は含まれない)', () => {
    // 他の機器と重ならない、専用の図で確かめる
    const doc = createEmptyDocument();
    const tpl = presetToTemplate(PRESETS.find((p) => p.id === 'camera')!, 'カメラ');
    addNodeFromTemplate(P, tpl, 'A', { x: 60, y: 80 })(doc);
    addNodeFromTemplate(P, tpl, 'B', { x: 60, y: 200 })(doc);
    const fid = addFrame(P, 'Room', { x: 40, y: 50 })(doc).created!;
    const data = copySelection(doc, P, { frameIds: [fid] })!;
    expect(data.nodes).toHaveLength(2);
    const r = pasteClipboard(P, data, suggestPasteOffset(doc, P, data, 1))(doc);
    const frame = doc.pages[0].groups.find((g) => g.id === r.createdFrameIds![0])!;
    expect(frame.label).toBe('Room');
    expect(nodesInFrame(doc.pages[0], frame).map((n) => n.id).sort()).toEqual([...r.createdNodeIds!].sort());
    // 元の枠は、元の機器だけのまま
    const orig = doc.pages[0].groups.find((g) => g.id === fid)!;
    expect(nodesInFrame(doc.pages[0], orig).map((n) => n.label).sort()).toEqual(['A', 'B']);
  });

  it('suggestPasteOffset: 機器だけなら右下へ少しずつずらす', () => {
    const doc = fresh();
    const nodesOnly = copySelection(doc, P, { nodeIds: ['sw'] })!;
    expect(suggestPasteOffset(doc, P, nodesOnly, 1)).toEqual({ dx: 20, dy: 20 });
    expect(suggestPasteOffset(doc, P, nodesOnly, 3)).toEqual({ dx: 60, dy: 60 });
  });

  it('suggestPasteOffset: 枠は、元の位置に最も近い空き(元の枠から1グリッド以上あける)へ置く', () => {
    const doc = createEmptyDocument();
    const tpl = presetToTemplate(PRESETS.find((p) => p.id === 'camera')!, 'カメラ');
    addNodeFromTemplate(P, tpl, 'A', { x: 60, y: 80 })(doc);
    const fid = addFrame(P, 'Room', { x: 40, y: 50 })(doc).created!; // 40..340 x 50..250
    const data = copySelection(doc, P, { frameIds: [fid] })!;
    // 右へ 300+10=310、下へ 200+10=210。近いのは下(同じ幅なら縦ずれ最小の右を優先するが、距離は下が小さい)
    expect(suggestPasteOffset(doc, P, data, 1)).toEqual({ dx: 0, dy: 210 });
  });

  it('suggestPasteOffset: ほぼ満杯の図(サンプル)でも、小さくずらす案より、取り込む既存の機器が増えない', () => {
    const doc = fresh();
    for (const fid of ['g-table', 'g-behind', 'g-rack']) {
      const data = copySelection(doc, P, { frameIds: [fid] })!;
      const captured = (offset: { dx: number; dy: number }): number => {
        const copy = structuredClone(doc);
        const r = pasteClipboard(P, data, offset)(copy);
        const frame = copy.pages[0].groups.find((g) => g.id === r.createdFrameIds![0])!;
        const mine = new Set(r.createdNodeIds);
        return nodesInFrame(copy.pages[0], frame).filter((n) => !mine.has(n.id)).length; // 取り込んだ既存の機器
      };
      const suggested = suggestPasteOffset(doc, P, data, 1);
      expect(captured(suggested), fid).toBeLessThanOrEqual(captured({ dx: 20, dy: 20 }));
    }
  });

  it('suggestPasteOffset: ページ全体に広がる枠など、動かせる余地が無ければ、小さくずらす', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { frameIds: ['g-rack'] })!;
    const huge = { ...data, frames: [{ ...data.frames[0], x: 0, y: 0, w: 1280, h: 720 }] };
    expect(suggestPasteOffset(doc, P, huge, 1)).toEqual({ dx: 20, dy: 20 });
  });
  it('貼り付けた結果の図は、検証を通り、IDが重複しない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { frameIds: ['g-table'] })!;
    paste(doc, data, 20);
    paste(doc, data, 40);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual({ ok: true, errors: [] });
  });

  it('位置はグリッドの倍数に吸着し、ページの外へは出ない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: ['aif'] })!;
    const r = paste(doc, data, 9999);
    const n = node(doc, r.createdNodeIds![0]);
    expect(n.x % doc.grid.size).toBe(0);
    expect(n.x + n.w).toBeLessThanOrEqual(doc.pages[0].size.w);
    expect(n.y + n.h).toBeLessThanOrEqual(doc.pages[0].size.h);
    const neg = paste(doc, data, -9999);
    const m = node(doc, neg.createdNodeIds![0]);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.y).toBeGreaterThanOrEqual(0);
  });

  it('別の図(新規)へ貼ると、機器の種類と信号の種類も補われ、検証を通る', () => {
    const src = fresh();
    const data = copySelection(src, P, { nodeIds: ['amp'] })!;
    const dst = createEmptyDocument();
    dst.signalTypes = []; // 信号の種類が1つも無い図
    const r = pasteClipboard(P, data, { dx: 20, dy: 20 })(dst);
    expect(r.ok).toBe(true);
    expect(dst.deviceTemplates.map((t) => t.id)).toContain(node(src, 'amp').templateId);
    expect(dst.signalTypes.length).toBeGreaterThan(0);
    expect(validateDocument(JSON.parse(JSON.stringify(dst))).ok).toBe(true);
  });

  it('図にすでにある機器の種類・信号の種類は、上書きしない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: ['sw'] })!;
    doc.signalTypes[0].color = '#123456';
    doc.deviceTemplates.find((t) => t.id === node(doc, 'sw').templateId)!.name = '編集済み';
    paste(doc, data);
    expect(doc.signalTypes[0].color).toBe('#123456');
    expect(doc.deviceTemplates.find((t) => t.id === node(doc, 'sw').templateId)!.name).toBe('編集済み');
  });

  it('空の内容・存在しないページは失敗する', () => {
    const doc = fresh();
    const empty = { nodes: [], frames: [], edges: [], templates: [], signalTypes: [] };
    expect(pasteClipboard(P, empty, { dx: 0, dy: 0 })(doc).ok).toBe(false);
    const data = copySelection(doc, P, { nodeIds: ['sw'] })!;
    expect(pasteClipboard('nope', data, { dx: 0, dy: 0 })(doc).error).toBe('unknown-page');
  });

  it('貼り付けは、元に戻す1回で全部戻る', () => {
    const store = new DocumentStore(fresh());
    const data = copySelection(store.doc, P, { frameIds: ['g-table'] })!;
    const before = JSON.stringify(store.doc);
    expect(store.apply(pasteClipboard(P, data, { dx: 20, dy: 20 })).ok).toBe(true);
    expect(JSON.stringify(store.doc)).not.toBe(before);
    store.undo();
    expect(JSON.stringify(store.doc)).toBe(before);
  });

  it('枠を動かした後でも、貼り付けた機器は元の機器とは独立して動く', () => {
    const doc = fresh();
    const r = paste(doc, copySelection(doc, P, { nodeIds: ['sw'] })!);
    const copyId = r.createdNodeIds![0];
    const orig = { x: node(doc, 'sw').x, y: node(doc, 'sw').y };
    moveSelection(P, [{ id: copyId, x: 900, y: 100 }], [])(doc);
    expect([node(doc, 'sw').x, node(doc, 'sw').y]).toEqual([orig.x, orig.y]);
  });
});
