const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../functions/node_modules/typescript');
const { DateTime } = require('../functions/node_modules/luxon');
const { inPostingWindow, timezoneSchema, mediaSchema } = require('../functions/lib/validation');
const source = fs.readFileSync(path.join(__dirname, '../apps/mobile/src/utils/time.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const mobile = { exports: {} };
new Function('require', 'exports', compiled.outputText)((name) => require('../functions/node_modules/' + name), mobile.exports);

for (const zone of ['UTC', 'America/Toronto', 'Asia/Kolkata', 'Pacific/Auckland']) {
  test(`AM/PM boundaries match on client and server in ${zone}`, () => {
    for (const [time, allowed] of [
      ['11:10:59.999', false], ['11:11:00', true], ['11:12:29.999', true],
      ['11:12:30', false], ['23:10:59.999', false], ['23:11:00', true],
      ['23:12:29.999', true], ['23:12:30', false],
    ]) {
      const now = DateTime.fromISO(`2026-09-23T${time}`, { zone });
      assert.equal(inPostingWindow(now), allowed, time);
      assert.equal(mobile.exports.postingWindow(now).open, allowed, time);
    }
  });
}
test('next window uses local calendar across midnight and daylight saving changes', () => {
  for (const date of ['2026-09-23', '2026-03-07', '2026-10-31']) {
    const now = DateTime.fromISO(`${date}T23:59:00`, { zone: 'America/Toronto' });
    const { start } = mobile.exports.postingWindow(now);
    assert.equal(start.toISODate(), now.plus({ days: 1 }).toISODate());
    assert.equal(start.toFormat('HH:mm:ss'), '11:11:00');
  }
});
test('reject invalid zones and phone-local or missing photo URLs', () => {
  assert.equal(timezoneSchema.safeParse('invalid-zone').success, false);
  assert.equal(timezoneSchema.safeParse('America/Toronto').success, true);
  for (const media of [{ type: 'image' }, { type: 'image', url: 'file:///photo.jpg' }]) {
    assert.equal(mediaSchema.safeParse(media).success, false);
  }
  assert.equal(mediaSchema.safeParse({ type: 'image', url: 'https://example.com/photo.jpg' }).success, true);
});
