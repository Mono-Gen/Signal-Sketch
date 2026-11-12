import { describe, expect, it } from 'vitest';
import { buildSvg } from '../../src/io/svgExport';
import { addSignalType } from '../../src/model/signalActions';
import { DARK_THEME, FLAT_THEME } from '../../src/view/theme';
import { createSampleDocument } from '../fixtures/sampleDocument';

// 特性化テスト: 画面とSVGの見た目の決定を共通化するリファクタの前後で、SVG出力が1バイトも変わらないことを固定する。
// 期待値(__golden__/*.svg)はリファクタ前の出力。意図して見た目を変えたときだけ、差分を確かめたうえで作り直す。

const P = 'page-1';

type Doc = ReturnType<typeof createSampleDocument>;

const options = (doc: Doc, theme = FLAT_THEME) => ({
  // 線ごとに経路を変える(経路の取り違えも検出できるように)
  edgePoints: new Map(doc.pages[0].edges.map((e, i) => [e.id, [{ x: 100 + i, y: 100 }, { x: 200 + i, y: 100 }, { x: 200 + i, y: 200 + i }]] as const)),
  countText: (n: number) => `×${n}台`,
  legendTitle: '凡例',
  theme,
});

/** 番号表示・複数接続・サブ信号(親子の線)・4辺・双方向を一度に含む図 */
function richDocument(): Doc {
  const doc = createSampleDocument();
  const sub = addSignalType('LAN-SUB', '#000000', 'LAN')(doc).created!;
  for (const n of doc.pages[0].nodes) n.showPortLabels = true;
  const sw = doc.pages[0].nodes.find((n) => n.id === 'sw')!;
  sw.portGroupsOverride = [
    { id: 'lan-l', signalType: 'LAN', direction: 'inout', side: 'left', count: 4, labelPrefix: 'L', startNumber: 3, multi: true },
    { id: 'lan-r', signalType: sub, direction: 'inout', side: 'right', count: 2, labelPrefix: 'R' },
    { id: 'lan-t', signalType: 'LAN', direction: 'in', side: 'top', count: 2, labelPrefix: 'T' },
    { id: 'lan-b', signalType: 'LAN', direction: 'out', side: 'bottom', count: 4, labelPrefix: 'B', multi: true },
  ];
  // 親(LAN)側の接続と、サブ信号側の接続を混ぜる(線と接続済みポートの色が、サブ信号側にそろう)
  const mute = doc.pages[0].nodes.find((n) => n.id === 'mute')!;
  mute.portGroupsOverride = [{ id: 'lan', signalType: sub, direction: 'inout', side: 'right', count: 1, labelPrefix: 'LAN ' }];
  // 1つのポートへ、系統の違う線が集まる接続(接続済みでも、ポート自身の色を保つ仕様の確認)
  doc.pages[0].edges.push({ id: 'e-conflict', from: { nodeId: 'ap', portId: 'audio-1' }, to: { nodeId: 'ptz', portId: 'lan-1' } });
  return doc;
}

describe('SVG出力の特性化(リファクタで変わらない)', () => {
  it('サンプル図・ライト', async () => {
    const doc = createSampleDocument();
    await expect(buildSvg(doc, P, options(doc))).toMatchFileSnapshot('./__golden__/sample_light.svg');
  });
  it('サンプル図・ダーク', async () => {
    const doc = createSampleDocument();
    await expect(buildSvg(doc, P, options(doc, DARK_THEME))).toMatchFileSnapshot('./__golden__/sample_dark.svg');
  });
  it('番号・複数接続・サブ信号・4辺・ライト', async () => {
    const doc = richDocument();
    await expect(buildSvg(doc, P, options(doc))).toMatchFileSnapshot('./__golden__/rich_light.svg');
  });
  it('番号・複数接続・サブ信号・4辺・ダーク', async () => {
    const doc = richDocument();
    await expect(buildSvg(doc, P, options(doc, DARK_THEME))).toMatchFileSnapshot('./__golden__/rich_dark.svg');
  });
  it('リッチな図で、サブ信号の色と複数接続の外枠が実際に出力に含まれる(テスト自体の有効性)', () => {
    const doc = richDocument();
    const svg = buildSvg(doc, P, options(doc));
    expect(svg).toContain('LAN-SUB');
    expect(svg.match(/<polygon[^>]*fill="none"/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
