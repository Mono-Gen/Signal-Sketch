import { describe, expect, it } from 'vitest';
import { addEdge, addNodeFromTemplate, setPortGroups } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { isDirectionMismatch } from '../../src/model/ports';
import { validateDocument } from '../../src/model/validate';

const P = 'page-1';
const preset = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);

/** 空の図に、アンプ2台とスピーカー2台を置く */
function setup() {
  const doc = createEmptyDocument();
  const add = (id: string, label: string) => addNodeFromTemplate(P, preset(id), label)(doc).created!;
  const ids = { amp1: add('amp', 'Amp1'), amp2: add('amp', 'Amp2'), spk1: add('speaker', 'Spk1'), spk2: add('speaker', 'Spk2') };
  // 標準のスピーカーは複数入力にしない(仕様は検討中)。複数可の挙動は、利用者が指定した場合として検証する
  doc.deviceTemplates.find((t) => t.id === 'preset-speaker')!.portGroups.forEach((g) => (g.multi = true));
  return { doc, ...ids };
}
const ref = (nodeId: string, portId: string) => ({ nodeId, portId });

describe('isDirectionMismatch', () => {
  const p = (direction: 'in' | 'out' | 'inout', multi = false) => ({ direction, multi });
  it.each([
    [p('in'), p('in'), true],
    [p('out'), p('out'), true],
    [p('in'), p('out'), false],
    [p('out'), p('in'), false],
    [p('inout'), p('in'), false],
    [p('inout'), p('inout'), false],
    [p('in', true), p('in'), false], // 並列接続: どちらかが複数可なら不一致にしない
    [p('out', true), p('out'), false],
  ])('%j と %j → %s', (a, b, expected) => {
    expect(isDirectionMismatch(a, b)).toBe(expected);
  });
});

describe('addEdge: 方向', () => {
  it('入力と出力の接続は、警告なし', () => {
    const { doc, amp1, spk1 } = setup();
    expect(addEdge(P, ref(amp1, 'audio-out-1'), ref(spk1, 'audio-1'))(doc)).toEqual({ ok: true });
  });

  it('入力同士(複数可でない)は接続できるが、警告する', () => {
    const { doc, amp1, amp2 } = setup();
    const r = addEdge(P, ref(amp1, 'audio-1'), ref(amp2, 'audio-1'))(doc);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['direction-mismatch']);
  });

  it('出力同士は警告する', () => {
    const { doc, amp1, amp2 } = setup();
    expect(addEdge(P, ref(amp1, 'audio-out-1'), ref(amp2, 'audio-out-1'))(doc).warnings).toEqual(['direction-mismatch']);
  });

  it('入出力のポートは、どの方向とも組める(信号が違う警告だけ)', () => {
    const { doc, amp1, amp2 } = setup();
    const r = addEdge(P, ref(amp1, 'lan-1'), ref(amp2, 'audio-1'))(doc);
    expect(r.warnings).toEqual(['signal-mismatch']);
  });
});

describe('addEdge: 複数接続', () => {
  it('複数可でないポートは、1本まで(従来どおり)', () => {
    const { doc, amp1, spk1, spk2 } = setup();
    addEdge(P, ref(amp1, 'audio-out-1'), ref(spk1, 'audio-1'))(doc);
    expect(addEdge(P, ref(amp1, 'audio-out-1'), ref(spk2, 'audio-1'))(doc)).toMatchObject({ ok: false, error: 'port-occupied' });
  });

  it('複数可に指定したポート(スピーカーの入力)には、複数の線を接続できる', () => {
    const { doc, amp1, amp2, spk1 } = setup();
    expect(addEdge(P, ref(amp1, 'audio-out-1'), ref(spk1, 'audio-1'))(doc).ok).toBe(true);
    expect(addEdge(P, ref(amp2, 'audio-out-1'), ref(spk1, 'audio-1'))(doc).ok).toBe(true);
    expect(doc.pages[0].edges).toHaveLength(2);
  });

  it('スピーカー同士の入力と入力(並列)は、警告なしで接続できる', () => {
    const { doc, amp1, spk1, spk2 } = setup();
    addEdge(P, ref(amp1, 'audio-out-1'), ref(spk1, 'audio-1'))(doc);
    expect(addEdge(P, ref(spk1, 'audio-1'), ref(spk2, 'audio-1'))(doc)).toEqual({ ok: true });
  });

  it('同じ2つのポートの重複接続は、複数可でも拒否する', () => {
    const { doc, spk1, spk2 } = setup();
    addEdge(P, ref(spk1, 'audio-1'), ref(spk2, 'audio-1'))(doc);
    expect(addEdge(P, ref(spk2, 'audio-1'), ref(spk1, 'audio-1'))(doc).error).toBe('duplicate-edge');
  });

  it('複数可を「1本まで」に戻しても、すでにある複数の線は消えず、検証も通る', () => {
    const { doc, amp1, amp2, spk1 } = setup();
    addEdge(P, ref(amp1, 'audio-out-1'), ref(spk1, 'audio-1'))(doc);
    addEdge(P, ref(amp2, 'audio-out-1'), ref(spk1, 'audio-1'))(doc);
    const groups = doc.deviceTemplates.find((t) => t.id === 'preset-speaker')!.portGroups.map((g) => ({ ...g, multi: false }));
    expect(setPortGroups(P, spk1, groups)(doc).ok).toBe(true);
    expect(doc.pages[0].edges).toHaveLength(2);
    expect(validateDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  });
});

describe('標準機器とデータ', () => {
  it('標準機器は、どのポートも複数接続を許可しない(初期値は1本まで)', () => {
    for (const p of PRESETS) expect(p.portGroups.every((g) => !g.multi), p.id).toBe(true);
  });

  it('multi が真偽値でない保存データは検出される', () => {
    const { doc } = setup();
    doc.deviceTemplates[0].portGroups[0].multi = 'yes' as never;
    expect(validateDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(false);
  });
});
