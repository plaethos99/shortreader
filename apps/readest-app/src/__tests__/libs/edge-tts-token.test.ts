import { describe, expect, test } from 'vitest';

import { generateSecMsGecV2 } from '@/libs/edgeTTSToken';

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

describe('Sec-MS-GEC v2', () => {
  test('has the <16 hex>-<64 hex> shape', () => {
    expect(generateSecMsGecV2(TOKEN)).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
  });

  // Pinned from the implementation Microsoft's service accepted (HTTP 101) on
  // 2026-10-19, when the v1 token started getting 403.
  test('matches the value the service accepted', () => {
    expect(generateSecMsGecV2(TOKEN, 1790000000)).toBe(
      'D4216A7D3DE0C94F-91D741832FD084A110FDAD52BE2FFA569C6EA5F7D06A9429380A398738F4559A',
    );
  });

  test('is the same within a 5-minute window and changes after it', () => {
    const start = 1790000100 - (1790000100 % 300);
    expect(generateSecMsGecV2(TOKEN, start + 10)).toBe(generateSecMsGecV2(TOKEN, start + 290));
    expect(generateSecMsGecV2(TOKEN, start + 300)).not.toBe(generateSecMsGecV2(TOKEN, start));
  });
});
