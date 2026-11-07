import { describe, expect, it } from 'vitest';
import { APP_ID, storageKey } from '../../src/app/appInfo';

describe('storageKey', () => {
  it('「内部ID:名前」の形式で、内部IDは既定で APP_ID', () => {
    expect(storageKey('language')).toBe(`${APP_ID}:language`);
  });

  it('内部IDを差し替えると接頭辞だけが変わる(名前変更時の旧キー参照用)', () => {
    expect(storageKey('language', 'old-app')).toBe('old-app:language');
  });

  it('異なる設定名は異なるキーになる', () => {
    expect(storageKey('language')).not.toBe(storageKey('gridSize'));
  });
});
