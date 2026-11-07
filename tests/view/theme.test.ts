import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import { buildSvg } from '../../src/io/svgExport';
import { createEmptyDocument } from '../../src/model/defaults';
import { DARK_THEME, FLAT_THEME, SIGNAL_MIN_CONTRAST, signalColor, themeFor } from '../../src/view/theme';

/** WCAG 2.x の相対輝度とコントラスト比 */
function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** index.html から、指定したセレクタのブロックの変数(--name: value)を取り出す */
function cssVars(selector: string): Record<string, string> {
  const start = html.indexOf(selector);
  expect(start, `${selector} が見つからない`).toBeGreaterThanOrEqual(0);
  const body = html.slice(html.indexOf('{', start) + 1, html.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim();
  return vars;
}

const light = cssVars(':root {');
const darkManual = cssVars(':root[data-theme="dark"]');
const darkAuto = cssVars(':root:not([data-theme]) {');

describe('テーマ(色の定義)', () => {
  it('ダークは、ライトと同じ項目をすべて持つ(取りこぼしがない)', () => {
    expect(Object.keys(DARK_THEME).sort()).toEqual(Object.keys(FLAT_THEME).sort());
    expect(themeFor('light')).toBe(FLAT_THEME);
    expect(themeFor('dark')).toBe(DARK_THEME);
  });

  it('ダークの色の値が、ライトの色と食い違っていない(同一の項目を上書きしている)', () => {
    for (const k of ['nodeFill', 'nodeStroke', 'nodeText', 'portEmptyFill', 'halo'] as const) {
      expect(DARK_THEME[k], k).not.toBe(FLAT_THEME[k]);
    }
  });

  it('SVG出力は、テーマの指定が無ければ常にライト配色(画面がダークでも明るい用紙)', () => {
    const doc = createEmptyDocument();
    const svg = buildSvg(doc, doc.pages[0]!.id, {
      countText: (n: number) => String(n),
      legendTitle: 'legend',
      edgePoints: new Map(),
    });
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain(DARK_THEME.nodeFill);
    expect(svg).not.toContain(DARK_THEME.portEmptyFill);
  });
});

describe('signalColor(信号色の画面表示の補正)', () => {
  const paper = DARK_THEME.signalPaper!;

  it('ダークの用紙は、CSSの用紙色と一致している', () => {
    expect(paper.toLowerCase()).toBe(darkManual['--paper']!.toLowerCase());
  });

  it('ライトは補正せず、そのまま返す', () => {
    expect(signalColor(FLAT_THEME, '#7b4fa0')).toBe('#7b4fa0');
    expect(signalColor(FLAT_THEME, '#000000')).toBe('#000000');
  });

  it('ダークで暗い色は、用紙に対して 3:1 以上になるまで明るくする', () => {
    for (const c of ['#7b4fa0', '#000000', '#222222', '#1a3a8a', '#5a1a1a']) {
      const out = signalColor(DARK_THEME, c);
      expect(out, c).not.toBe(c);
      expect(contrast(out, paper), c).toBeGreaterThanOrEqual(SIGNAL_MIN_CONTRAST);
    }
  });

  it('ダークで十分明るい色は、そのまま返す', () => {
    for (const c of ['#ffffff', '#4dabf7', '#ffd43b', '#69db7c']) {
      expect(contrast(c, paper), `前提: ${c}`).toBeGreaterThanOrEqual(SIGNAL_MIN_CONTRAST);
      expect(signalColor(DARK_THEME, c), c).toBe(c);
    }
  });

  it('補正は必要な分だけ(基準を大きく超えて白に寄せ過ぎない)', () => {
    const out = signalColor(DARK_THEME, '#7b4fa0');
    expect(contrast(out, paper)).toBeLessThan(SIGNAL_MIN_CONTRAST + 0.5);
  });

  it('HEXでない値は、そのまま返す(壊さない)', () => {
    for (const c of ['', 'red', '#fff', '#12345', 'rgb(1,2,3)', '#gggggg']) {
      expect(signalColor(DARK_THEME, c), c).toBe(c);
    }
  });

  it('大文字のHEXも補正でき、結果は有効な6桁のHEX', () => {
    const out = signalColor(DARK_THEME, '#7B4FA0');
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(out, paper)).toBeGreaterThanOrEqual(SIGNAL_MIN_CONTRAST);
  });
});

describe('index.html のCSS変数', () => {
  it('自動(OS連動)用と手動ダーク用のダーク値が一致している', () => {
    expect(Object.keys(darkAuto).length).toBeGreaterThan(0);
    expect(darkAuto).toEqual(darkManual);
  });

  it('ダークは、ライトと同じ変数をすべて上書きする(color-scheme は別扱い)', () => {
    const lightKeys = Object.keys(light).sort();
    expect(Object.keys(darkManual).sort()).toEqual(lightKeys);
  });

  it('画面の文字と背景のコントラストが、ライト・ダークとも 4.5:1 以上(WCAG AA)', () => {
    const allGrounds = ['--bg', '--panel', '--control-bg', '--control-hover', '--paper'];
    // 状態の色(ok/warn/err)は、ツールバーのメッセージとボタンの上にだけ出る(画面の背景には直接出ない)
    const statusGrounds = ['--panel', '--control-bg', '--control-hover'];
    const pairs: [string, string[]][] = [
      ['--text', allGrounds],
      ['--muted', allGrounds],
      ['--accent', allGrounds],
      ['--ok', statusGrounds],
      ['--warn', statusGrounds],
      ['--err', statusGrounds],
    ];
    for (const [name, v] of [['light', light], ['dark', darkManual]] as const) {
      for (const [fg, grounds] of pairs) {
        for (const bg of grounds) {
          expect(contrast(v[fg]!, v[bg]!), `${name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(v['--tooltip-fg']!, v['--text']!), `${name}: ツールチップ`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ダークの機器の文字・図形が、機器の塗り・用紙の上で読める', () => {
    const t = DARK_THEME;
    expect(contrast(t.nodeText, t.nodeFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.modelText, t.nodeFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.nodeStroke, t.nodeFill)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.groupStroke, darkManual['--paper']!)).toBeGreaterThanOrEqual(4.5);
    for (const k of ['selection', 'bad', 'candidate', 'ink'] as const) {
      expect(contrast(t[k], darkManual['--paper']!), k).toBeGreaterThanOrEqual(3);
    }
    expect(t.portEmptyFill.toLowerCase()).toBe(darkManual['--paper']!.toLowerCase()); // 白抜きに見せる
  });
});
