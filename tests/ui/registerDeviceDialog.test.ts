import { describe, expect, it } from 'vitest';
import { MAX_TEMPLATE_NAME_LENGTH } from '../../src/model/templateActions';
import { parseRegistrationName } from '../../src/ui/registerDeviceDialog';

describe('parseRegistrationName', () => {
  it('前後の空白を除いて名前を返す', () => {
    expect(parseRegistrationName('  天井スピーカー  ')).toBe('天井スピーカー');
  });

  it('空と上限超過を拒否し、上限ちょうどは許す', () => {
    expect(parseRegistrationName('   ')).toBeNull();
    expect(parseRegistrationName('x'.repeat(MAX_TEMPLATE_NAME_LENGTH))).toBe('x'.repeat(MAX_TEMPLATE_NAME_LENGTH));
    expect(parseRegistrationName('x'.repeat(MAX_TEMPLATE_NAME_LENGTH + 1))).toBeNull();
  });
});
