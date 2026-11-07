import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGNAL_TYPES } from '../../src/model/defaults';
import { expandPortGroups } from '../../src/model/ports';
import { PRESETS, isPresetTemplateId, presetTemplateId, presetToTemplate } from '../../src/model/presets';
import { KNOWN_ICON_KINDS } from '../../src/view/icons';

describe('PRESETS(標準機器)', () => {
  it('IDが重複しない', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('スイッチ 8/16/24/48 ポートがある(設計書 5.3)', () => {
    for (const n of [8, 16, 24, 48]) {
      const p = PRESETS.find((x) => x.id === `switch${n}`);
      expect(p, `switch${n}`).toBeDefined();
      expect(expandPortGroups(p!.portGroups)).toHaveLength(n);
    }
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s: ポート定義が有効で、標準の信号種別・アイコンを使っている', (_id, p) => {
    expect(() => expandPortGroups(p.portGroups)).not.toThrow();
    const signals = new Set(DEFAULT_SIGNAL_TYPES.map((s) => s.id));
    for (const grp of p.portGroups) expect(signals.has(grp.signalType), grp.signalType).toBe(true);
    expect(KNOWN_ICON_KINDS).toContain(p.kind);
  });
});

describe('presetToTemplate', () => {
  it('テンプレートIDは preset- 付き。ポート定義は複製で、元を書き換えても影響しない', () => {
    const def = PRESETS[0];
    const tpl = presetToTemplate(def, '汎用機器');
    expect(tpl.id).toBe(presetTemplateId(def.id));
    expect(isPresetTemplateId(tpl.id)).toBe(true);
    expect(tpl.name).toBe('汎用機器');
    tpl.portGroups[0].count = 99;
    expect(def.portGroups[0].count).not.toBe(99);
  });

  it('preset- で始まらないIDは標準機器ではない', () => {
    expect(isPresetTemplateId('switch')).toBe(false);
  });
});
