import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rawRecordCount } from '../lib/collection.mjs';

test('counts records in a composite NCDR raw snapshot', () => {
  assert.equal(rawRecordCount({
    index: { success: true, result: [{ capid: 'CAP-1' }, { capid: 'CAP-2' }] },
    details: [{ capid: 'CAP-1', payload: {} }, { capid: 'CAP-2', payload: {} }],
    partial: false,
  }), 2);
});

test('counts official CWA typhoon info records', () => {
  assert.equal(rawRecordCount({
    records: { info: [{ event: '颱風警報' }] },
  }), 1);
});
