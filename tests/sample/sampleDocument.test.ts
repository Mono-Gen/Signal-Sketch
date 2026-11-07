import { describe, expect, it } from 'vitest';
import { nodesInFrame } from '../../src/model/frames';
import { isOnGrid } from '../../src/model/grid';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';

describe('サンプルドキュメント', () => {
  const doc = createSampleDocument();

  it('検証に通る(参照整合性・ポート番号が正しい)', () => {
    expect(validateDocument(doc)).toEqual({ ok: true, errors: [] });
  });

  it('機器とグループの位置・サイズはすべてグリッドの倍数', () => {
    const g = doc.grid.size;
    for (const n of doc.pages[0].nodes) {
      for (const v of [n.x, n.y, n.w, n.h]) expect(isOnGrid(v, g), `${n.id}: ${v}`).toBe(true);
    }
    for (const grp of doc.pages[0].groups) {
      for (const v of [grp.x, grp.y, grp.w, grp.h]) expect(isOnGrid(v, g), `${grp.id}: ${v}`).toBe(true);
    }
  });

  it('枠の所属(中心が枠内)が、意図した機器になる', () => {
    const page = doc.pages[0];
    const members = (id: string) =>
      nodesInFrame(page, page.groups.find((g) => g.id === id)!)
        .map((n) => n.id)
        .sort();
    expect(members('g-table')).toEqual(['enc', 'lap', 'mute', 'tap', 'tsc']);
    expect(members('g-behind')).toEqual(['dec', 'mini']);
    expect(members('g-rack')).toEqual(['amp', 'ctl', 'sw']);
  });
});
