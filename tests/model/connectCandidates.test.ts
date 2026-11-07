import { describe, expect, it } from 'vitest';
import { addEdge, addNodeFromTemplate, updateNode } from '../../src/model/actions';
import { connectCandidates } from '../../src/model/connectCandidates';
import { createEmptyDocument } from '../../src/model/defaults';
import { PRESETS, presetToTemplate } from '../../src/model/presets';

const P = 'page-1';
const preset = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);
const ref = (nodeId: string, portId: string) => ({ nodeId, portId });
const place = (doc: ReturnType<typeof createEmptyDocument>, id: string, label: string, x: number, y: number) =>
  addNodeFromTemplate(P, preset(id), label, { x, y })(doc).created!;
const keys = (rs: { nodeId: string; portId: string }[]) => rs.map((r) => `${r.nodeId}/${r.portId}`).sort();

describe('connectCandidates: 接続ドラッグ中の候補', () => {
  it('同じ信号の空きポートだけが候補になる(開始ポート自身・他の信号は含まない)', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'Cam', 40, 100); // lan-1(LAN), hdmi-1(HDMI)
    const sw = place(doc, 'switch', 'SW', 400, 100); // lan-1..8(LAN)
    const c = connectCandidates(doc, P, ref(cam, 'lan-1'));
    expect(keys(c)).toEqual(keys(Array.from({ length: 8 }, (_, i) => ref(sw, `lan-${i + 1}`))));
    expect(c.some((r) => r.nodeId === cam)).toBe(false); // 開始ポート自身と、カメラのHDMIは含まない
  });

  it('接続済みのポートは候補にしない', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'Cam', 40, 100);
    const other = place(doc, 'camera', 'Other', 40, 300);
    const sw = place(doc, 'switch', 'SW', 400, 100);
    addEdge(P, ref(other, 'lan-1'), ref(sw, 'lan-2'))(doc);
    const c = keys(connectCandidates(doc, P, ref(cam, 'lan-1')));
    expect(c).not.toContain(`${sw}/lan-2`);
    expect(c).not.toContain(`${other}/lan-1`);
    expect(c).toContain(`${sw}/lan-1`);
    expect(c).toHaveLength(8 - 1 + 0); // スイッチ7つ(lan-2 は使用中)。他のカメラのLANは接続済み
  });

  it('複数接続可のポートは、線があっても候補にする', () => {
    const doc = createEmptyDocument();
    const amp = place(doc, 'amp', 'A', 40, 100);
    const spk = place(doc, 'speaker', 'S', 400, 100);
    const spk2 = place(doc, 'speaker', 'S2', 400, 300);
    doc.deviceTemplates.find((t) => t.id === 'preset-speaker')!.portGroups.forEach((g) => (g.multi = true));
    addEdge(P, ref(amp, 'audio-out-1'), ref(spk, 'audio-1'))(doc);
    const c = keys(connectCandidates(doc, P, ref(amp, 'audio-out-2')));
    expect(c).toContain(`${spk}/audio-1`); // 線があっても、複数可なので候補
    expect(c).toContain(`${spk2}/audio-1`);
  });

  it('開始ポートが接続済み(複数可でない)なら、候補は空', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'Cam', 40, 100);
    const sw = place(doc, 'switch', 'SW', 400, 100);
    addEdge(P, ref(cam, 'lan-1'), ref(sw, 'lan-1'))(doc);
    expect(connectCandidates(doc, P, ref(cam, 'lan-1'))).toEqual([]);
  });

  it('台数が複数の機器は、台ごとのポートが別々に候補になる', () => {
    const doc = createEmptyDocument();
    const amp = place(doc, 'amp', 'A', 40, 100);
    const spk = place(doc, 'speaker', 'S', 400, 100);
    updateNode(P, spk, { count: 3 })(doc);
    const c = keys(connectCandidates(doc, P, ref(amp, 'audio-out-1')));
    expect(c).toEqual(expect.arrayContaining([`${spk}/audio-1`, `${spk}/audio-1@2`, `${spk}/audio-1@3`]));
  });

  it('存在しないポート・ページは空', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'Cam', 40, 100);
    expect(connectCandidates(doc, P, ref(cam, 'nothing'))).toEqual([]);
    expect(connectCandidates(doc, P, ref('ghost', 'lan-1'))).toEqual([]);
    expect(connectCandidates(doc, 'no-page', ref(cam, 'lan-1'))).toEqual([]);
  });
});
