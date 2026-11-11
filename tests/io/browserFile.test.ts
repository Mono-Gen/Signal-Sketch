import { describe, expect, it } from 'vitest';
import { isLikelyLockedError, saveFile, PNG_FORMAT } from '../../src/io/browserFile';

const named = (name: string): Error => Object.assign(new Error(name), { name });

describe('isLikelyLockedError', () => {
  it('書き込み不可・状態不正・読み取り不可は、他のアプリが開いている可能性が高い失敗とみなす', () => {
    for (const name of ['NoModificationAllowedError', 'InvalidStateError', 'NotReadableError']) {
      expect(isLikelyLockedError(named(name))).toBe(true);
    }
  });

  it('それ以外の失敗や、エラーでない値は該当しない', () => {
    expect(isLikelyLockedError(named('QuotaExceededError'))).toBe(false);
    expect(isLikelyLockedError(new Error('x'))).toBe(false);
    expect(isLikelyLockedError(null)).toBe(false);
    expect(isLikelyLockedError('NoModificationAllowedError')).toBe(false);
  });
});

describe('saveFile(上書きに失敗したとき)', () => {
  const withPicker = (close: () => Promise<void>, aborted: { n: number }) => {
    (globalThis as unknown as { window: unknown }).window = {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async () => undefined,
          close,
          abort: async () => {
            aborted.n++;
          },
        }),
      }),
    };
  };

  it('close に失敗したら、書きかけを破棄して、元の失敗をそのまま伝える', async () => {
    const aborted = { n: 0 };
    const err = named('NoModificationAllowedError');
    withPicker(() => Promise.reject(err), aborted);
    await expect(saveFile(new Blob(['x']), 'a.png', PNG_FORMAT)).rejects.toBe(err);
    expect(aborted.n).toBe(1);
  });

  it('保存ダイアログを取り消したら cancelled を返す', async () => {
    (globalThis as unknown as { window: unknown }).window = {
      showSaveFilePicker: async () => {
        throw named('AbortError');
      },
    };
    await expect(saveFile('x', 'a.json', PNG_FORMAT)).resolves.toBe('cancelled');
  });
});
