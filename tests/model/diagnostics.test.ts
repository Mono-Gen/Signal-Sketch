import { describe, expect, it } from 'vitest';
import { addEdge, addNodeFromTemplate, removeItems, setPortGroups } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { connectionIssues, diagnose } from '../../src/model/diagnostics';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { createSampleDocument } from '../fixtures/sampleDocument';

const P = 'page-1';
const preset = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);
const ref = (nodeId: string, portId: string) => ({ nodeId, portId });

function setup() {
  const doc = createEmptyDocument();
  const add = (id: string, label: string) => addNodeFromTemplate(P, preset(id), label)(doc).created!;
  return { doc, amp1: add('amp', 'Amp1'), amp2: add('amp', 'Amp2'), spk: add('speaker', 'Spk'), cam: add('camera', 'Cam') };
}

describe('diagnose', () => {
  it('問題のない図は空', () => {
    const { doc, amp1, spk } = setup();
    addEdge(P, ref(amp1, 'audio-out-1'), ref(spk, 'audio-1'))(doc);
    expect(diagnose(doc)).toEqual([]);
  });

  it('サンプルの図には指摘がない(正しい接続だけで作られている)', () => {
    expect(diagnose(createSampleDocument())).toEqual([]);
  });

  it('信号種別が違う接続を警告として挙げる', () => {
    const { doc, amp1, cam } = setup();
    addEdge(P, ref(amp1, 'audio-1'), ref(cam, 'hdmi-1'))(doc);
    const d = diagnose(doc);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'warning', code: 'signal-mismatch' });
  });

  it('入力同士を警告として挙げ、信号も違えば2件になる', () => {
    const { doc, amp1, amp2, cam } = setup();
    addEdge(P, ref(amp1, 'audio-1'), ref(amp2, 'audio-1'))(doc); // 入力×入力
    addEdge(P, ref(amp1, 'audio-2'), ref(cam, 'lan-1'))(doc); // 入力×入出力(方向は問題なし・信号違い)
    const codes = diagnose(doc).map((d) => d.code);
    expect(codes).toEqual(['direction-mismatch', 'signal-mismatch']);
  });

  it('直すと一覧から消える(保存した状態ではなく、毎回計算する)', () => {
    const { doc, amp1, amp2 } = setup();
    addEdge(P, ref(amp1, 'audio-1'), ref(amp2, 'audio-1'))(doc);
    expect(diagnose(doc)).toHaveLength(1);
    // amp2 の AUDIO 入力を「出力」へ直す
    const groups = doc.deviceTemplates.find((t) => t.id === 'preset-amp')!.portGroups.map((g) => (g.id === 'audio' ? { ...g, direction: 'out' as const } : g));
    expect(setPortGroups(P, amp2, groups)(doc).ok).toBe(true);
    expect(diagnose(doc)).toEqual([]);
  });

  it('接続を削除すると、その指摘も消える', () => {
    const { doc, amp1, amp2 } = setup();
    addEdge(P, ref(amp1, 'audio-1'), ref(amp2, 'audio-1'))(doc);
    removeItems(P, { edgeIds: [doc.pages[0].edges[0].id] })(doc);
    expect(diagnose(doc)).toEqual([]);
  });

  it('存在しないポートを指す接続は、読み飛ばさずエラーとして先頭に並べる', () => {
    const { doc, amp1, amp2, cam } = setup();
    addEdge(P, ref(amp1, 'audio-1'), ref(cam, 'hdmi-1'))(doc); // 警告
    doc.pages[0].edges.push({ id: 'broken', from: ref(amp2, 'nope'), to: ref(cam, 'lan-1') });
    const d = diagnose(doc);
    expect(d.map((x) => [x.severity, x.code])).toEqual([['error', 'broken-edge'], ['warning', 'signal-mismatch']]);
  });

  it('項目のkeyは、接続ID+種類で、内容が同じなら描き直しても同じ', () => {
    const { doc, amp1, amp2 } = setup();
    addEdge(P, ref(amp1, 'audio-1'), ref(amp2, 'audio-1'))(doc);
    const a = diagnose(doc).map((d) => d.key);
    expect(diagnose(doc).map((d) => d.key)).toEqual(a);
    expect(a[0]).toBe(`${doc.pages[0].edges[0].id}:direction-mismatch`);
  });

  it('接続時の警告と、一覧の指摘が同じ判定を使う(食い違わない)', () => {
    const { doc, amp1, amp2, cam } = setup();
    const r1 = addEdge(P, ref(amp1, 'audio-1'), ref(amp2, 'audio-1'))(doc);
    const r2 = addEdge(P, ref(amp1, 'audio-2'), ref(cam, 'lan-1'))(doc);
    expect([...(r1.warnings ?? []), ...(r2.warnings ?? [])]).toEqual(diagnose(doc).map((d) => d.code));
  });
});

describe('connectionIssues', () => {
  const port = (signalType: string, direction: 'in' | 'out' | 'inout', multi = false) => ({ signalType, direction, multi });
  it('一致していれば空', () => expect(connectionIssues(port('LAN', 'out'), port('LAN', 'in'))).toEqual([]));
  it('信号違い・方向違いを両方返す', () => expect(connectionIssues(port('LAN', 'in'), port('HDMI', 'in'))).toEqual(['signal-mismatch', 'direction-mismatch']));
});
