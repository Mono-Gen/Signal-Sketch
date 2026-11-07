import { describe, expect, it } from 'vitest';
import { uniqueId } from '../../src/model/ids';

describe('uniqueId', () => {
  it('既存が無ければ 1 番', () => {
    expect(uniqueId('e', [])).toBe('e-1');
  });

  it('既存の最大番号+1(欠番があっても最大の次)', () => {
    expect(uniqueId('e', ['e-1', 'e-3'])).toBe('e-4');
  });

  it('別の接頭辞や、番号でないIDは無視する', () => {
    expect(uniqueId('e', ['n-9', 'e-abc', 'e-2x', 'e-'])).toBe('e-1');
  });

  it('生成したIDは現在のIDと衝突しない', () => {
    const ids = ['e-1', 'e-2', 'e-10'];
    expect(ids).not.toContain(uniqueId('e', ids));
  });

  it('数として正確に扱えない大きな番号(2^53)があっても、既存のIDと重ならない', () => {
    const ids = ['n-9007199254740992'];
    const next = uniqueId('n', ids);
    expect(ids).not.toContain(next);
    const next2 = uniqueId('n', [...ids, next]);
    expect([...ids, next]).not.toContain(next2);
  });
});
