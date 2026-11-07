import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '../../src/i18n';
import { portTooltipHtml } from '../../src/view/portTooltip';

let saved: ReturnType<typeof getLanguage>;
beforeEach(() => {
  saved = getLanguage();
  setLanguage('ja');
});
afterEach(() => setLanguage(saved));

const port = { label: 'LAN 1', direction: 'inout' as const, unit: 1, signalType: 'LAN' };

describe('portTooltipHtml', () => {
  it('ふつうの値は、そのまま文になる', () => {
    expect(portTooltipHtml(port, 'LAN', false)).toBe('LAN 1(LAN / 入出力)');
  });

  it('台数が複数の機器は、何台目かを添える', () => {
    expect(portTooltipHtml({ ...port, unit: 2 }, 'LAN', true)).toContain('2台目');
  });

  it('ポートの表示名・信号の名前に含まれるHTMLは、エスケープされる(ツールチップは innerHTML で挿入されるため)', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const html = portTooltipHtml({ ...port, label: payload }, payload, false);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"alert');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('信号の名前が無いときは、信号の種類のIDを使い、それもエスケープする', () => {
    const html = portTooltipHtml({ ...port, signalType: '<b>x</b>' }, undefined, false);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('「&」も文字として表示される', () => {
    expect(portTooltipHtml({ ...port, label: 'A&B' }, 'LAN', false)).toContain('A&amp;B');
  });
});
