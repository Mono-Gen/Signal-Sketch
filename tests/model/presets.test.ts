import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGNAL_TYPES } from '../../src/model/defaults';
import { expandPortGroups } from '../../src/model/ports';
import { PRESETS, isPresetTemplateId, presetTemplateId, presetToTemplate, switchPortGroups } from '../../src/model/presets';
import { KNOWN_ICON_KINDS } from '../../src/view/icons';

describe('PRESETS(標準機器)', () => {
  it('IDが重複しない', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('スイッチは標準に1つだけ(8ポート)。ポート数は置いたあとに変える', () => {
    const switches = PRESETS.filter((x) => x.kind === 'switch');
    expect(switches.map((p) => p.id)).toEqual(['switch']);
    expect(expandPortGroups(switches[0].portGroups)).toHaveLength(8);
  });

  it('switchPortGroups: LANポートの数だけを変え、元は変えない。指定なし・0は標準のまま', () => {
    const base = PRESETS.find((x) => x.id === 'switch')!.portGroups;
    expect(switchPortGroups(base, 24)[0].count).toBe(24);
    expect(base[0].count).toBe(8);
    expect(switchPortGroups(base, undefined)[0].count).toBe(8);
    expect(switchPortGroups(base, 0)[0].count).toBe(8);
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
