import { describe, expect, it } from 'vitest';
import { buildSvg, roundedPath, wrapText } from '../../src/io/svgExport';
import { estimateTextWidth } from '../../src/model/nodeSize';
import { setPageSize, updateNode } from '../../src/model/actions';
import { addFrame } from '../../src/model/frames';
import { getNodePorts } from '../../src/model/query';
import { createSampleDocument } from '../fixtures/sampleDocument';
import { DARK_THEME } from '../../src/view/theme';
import { FLAT_THEME, signalColor } from '../../src/view/theme';
import { exportBackground } from '../../src/ui/fileCommands';

const P = 'page-1';
const opts = (doc: ReturnType<typeof createSampleDocument>) => ({
  edgePoints: new Map(
    doc.pages[0].edges.map((e) => [e.id, [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }]] as const),
  ),
  countText: (n: number) => `×${n}台`,
  legendTitle: '凡例',
});
/** 接続の線(アイコンの <path> と区別するため、塗りなし+線色の指定で数える) */
const EDGE_PATH = /<path d="[^"]*" fill="none" stroke="#/g;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('roundedPath', () => {
  it('2点なら直線', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }], 8)).toBe('M0 0 L50 0');
  });
  it('角は丸め(Q曲線)、丸めの半径は短い辺の半分を超えない', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }], 8);
    expect(d).toContain('Q10 0');
    expect(d).toContain('L5 0'); // 短い辺(10)の半分=5まで
  });
  it('空・1点でも壊れない', () => {
    expect(roundedPath([], 8)).toBe('');
    expect(roundedPath([{ x: 1, y: 2 }], 8)).toBe('M1 2');
  });
});

describe('buildSvg', () => {
  it('複数接続の四角形には外枠が付き、番号表示は欠番と開始番号に従う', () => {
    const doc = createSampleDocument();
    const n = doc.pages[0].nodes.find((v) => v.id === 'sw')!;
    n.showPortLabels = true;
    n.portGroupsOverride = [
      { id: 'a', signalType: 'LAN', direction: 'inout', side: 'left', count: 3, labelPrefix: 'P', startNumber: 5, skipped: [2], multi: true },
      { id: 'b', signalType: 'LAN', direction: 'inout', side: 'right', count: 1, labelPrefix: 'Only' },
    ];
    doc.pages[0].nodes = [n];
    doc.pages[0].edges = [];
    const svg = buildSvg(doc, P, opts(doc));
    expect(count(svg, /<polygon /g)).toBe(5);
    expect(count(svg, /<polygon[^>]*fill="none"/g)).toBe(2);
    expect(svg).toContain('>P5</text>');
    expect(svg).not.toContain('>P6</text>');
    expect(svg).toContain('>P7</text>');
    expect(svg).toContain('>Only</text>');
    const polygon = svg.match(/<polygon points="([^"]+)"/)![1].split(' ').map((p) => p.split(',').map(Number));
    expect(polygon).toHaveLength(4);
    expect(polygon[0][1]).toBe(polygon[1][1]);
    expect(polygon[1][0]).toBe(polygon[2][0]);
    n.showPortLabels = false;
    expect(buildSvg(doc, P, opts(doc))).not.toContain('>P5</text>');
  });
  it('暗い信号色を線・ポート・凡例で同じように補正し、空きポートを用紙色にする', () => {
    const doc = createSampleDocument();
    doc.signalTypes.find((s) => s.id === 'LAN')!.color = '#141a26';
    const dark = buildSvg(doc, P, { ...opts(doc), theme: DARK_THEME });
    const corrected = signalColor(DARK_THEME, '#141a26');
    expect(corrected).not.toBe('#141a26');
    expect(dark).toMatch(new RegExp(`<path[^>]*stroke="${corrected}"`));
    expect(dark).toMatch(new RegExp(`<polygon[^>]*fill="${corrected}" stroke="${corrected}"`));
    expect(dark).toMatch(new RegExp(`<polygon[^>]*fill="#141a26" stroke="${corrected}"`));
    expect(dark).toMatch(new RegExp(`<line[^>]*stroke="${corrected}"`));
    const light = buildSvg(doc, P, { ...opts(doc), theme: FLAT_THEME });
    expect(light).toBe(buildSvg(doc, P, opts(doc)));
    expect(light).toMatch(/<path[^>]*stroke="#141a26"/);
    expect(light).toMatch(/<polygon[^>]*fill="#ffffff" stroke="#141a26"/);
    expect(light).toMatch(/<line[^>]*stroke="#141a26"/);
  });
  it('ダークテーマの背景と文字色を使う', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, { ...opts(doc), theme: DARK_THEME });
    expect(svg).toContain('fill="#141a26"');
    expect(svg).toContain('fill="#e6ebf7"');
    expect(exportBackground('dark')).toBe('#141a26');
    expect(exportBackground('light')).toBe('#ffffff');
  });
  it('ページの大きさを変えると、SVGの寸法もそれに従う(1920x1080 → 幅1920・高さ1120)', () => {
    const doc = createSampleDocument();
    setPageSize(P, { w: 1920, h: 1080 })(doc);
    const svg = buildSvg(doc, P, opts(doc));
    expect(svg).toContain('width="1920" height="1120"');
    expect(svg).toContain('viewBox="0 0 1920 1120"');
  });

  it('SVG文書として組み立てられ、ページ寸法+凡例の高さになる', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, opts(doc));
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="1280" height="760"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('文字は <text> で出力し、foreignObject(PowerPointで表示されない)や画像参照は使わない', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, opts(doc));
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('data:');
    expect(svg).toContain('>Network Switch</text>');
    expect(svg).toContain('>Model-E1</text>');
  });

  it('機器・枠・接続・ポートが、図のデータどおりの数で出る', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, opts(doc));
    const page = doc.pages[0];
    expect(count(svg, /<clipPath /g)).toBe(page.nodes.length);
    expect(count(svg, /stroke-dasharray="6 4"/g)).toBe(page.groups.length);
    expect(count(svg, EDGE_PATH)).toBe(page.edges.length);
    const ports = page.nodes.reduce((s, n) => s + getNodePorts(doc, n).length, 0); // 台数ぶんのポートも含む
    expect(count(svg, /<polygon /g)).toBe(ports);
  });

  it('台数表記と、凡例(信号の種類名)が出る', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, opts(doc));
    expect(svg).toContain('×4'); // 折り返されても、台数表記は欠けない(「×4」は一続き)
    expect(svg).toContain('台</text>');
    expect(svg).toContain('>凡例</text>');
    for (const s of doc.signalTypes) expect(svg).toContain(`>${s.label}</text>`);
  });

  it('接続済みのポートは信号色で塗り、空きは白', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, opts(doc));
    expect(svg).toMatch(/<polygon [^>]*fill="#ffffff"/);
    expect(svg).toMatch(/<polygon [^>]*fill="#1a9850"/); // LAN の信号色
  });

  it('名称・型番・枠名・凡例名に入れたタグや引用符は、無害化される(インジェクションしない)', () => {
    const doc = createSampleDocument();
    updateNode(P, 'sw', { label: '<script>alert(1)</script>', model: '"><svg onload=x>' })(doc);
    const f = addFrame(P, '</text><circle r="9"/>')(doc).created!;
    doc.signalTypes[0].label = '<b>x</b>';
    const svg = buildSvg(doc, P, opts(doc));
    expect(f).toBeDefined();
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<svg onload');
    expect(svg).not.toContain('<circle r="9"');
    expect(svg).not.toContain('<b>x</b>');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('経路が渡されない接続は、描かずに読み飛ばす(壊れたSVGを出さない)', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, { ...opts(doc), edgePoints: new Map() });
    expect(count(svg, EDGE_PATH)).toBe(0);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('存在しないページは例外', () => {
    const doc = createSampleDocument();
    expect(() => buildSvg(doc, 'nope', opts(doc))).toThrow(RangeError);
  });

  it('SVGに置けない文字(制御文字)を含む名称でも、XMLとして不正な文字を出力しない', () => {
    const doc = createSampleDocument();
    updateNode(P, 'sw', { label: 'A\u0001B' })(doc);
    const svg = buildSvg(doc, P, opts(doc));
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(svg)).toBe(false);
  });
});

describe('wrapText', () => {
  const mono = (text: string): number => text.length * 6; // 測定結果の代わり(1文字6px)

  it('幅に収まれば1行のまま', () => {
    expect(wrapText('Camera', 200, mono)).toEqual(['Camera']);
  });

  it('半角は単語の切れ目(スペース)で折り返し、どの行も幅に収まる。文字は欠けない', () => {
    const lines = wrapText('Control Touch Panel', 80, mono);
    expect(lines).toEqual(['Control Touch', 'Panel']);
    for (const l of lines) expect(mono(l)).toBeLessThanOrEqual(80);
  });

  it('全角は1文字ずつ折り返せる。文字は欠けない', () => {
    const text = '天井埋め込みスピーカーシステム';
    const lines = wrapText(text, 60, mono);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
  });

  it('「×4」のような記号は、数字と離れて折り返されない', () => {
    const lines = wrapText('Model-A2 ×4台', 70, mono);
    expect(lines.join(' ').replace(/ /g, '')).toBe('Model-A2×4台');
    for (const l of lines) expect(l.endsWith('×')).toBe(false);
  });

  it('1語が幅を超えても、その語は分割せず1行に置く(欠けない)', () => {
    expect(wrapText('Supercalifragilistic', 20, mono)).toEqual(['Supercalifragilistic']);
  });

  it('空文字は空の1行', () => {
    expect(wrapText('', 100, mono)).toEqual(['']);
  });

  it('測定関数を渡すと、機器のラベルがその幅で折り返されて複数の <text> になる(切れない)', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, { ...opts(doc), measureText: (text) => text.length * 6 });
    expect(svg).toContain('>Control Touch</text>');
    expect(svg).toContain('>Panel</text>');
  });

  it('測定関数が無くても(見積もり)、名称は欠けず複数行に分かれる', () => {
    const doc = createSampleDocument();
    const svg = buildSvg(doc, P, opts(doc));
    expect(svg).toContain('>Panel</text>');
  });
});
