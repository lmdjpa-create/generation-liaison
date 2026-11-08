const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  availableSlots,
  dateInTimeZone,
  getDailyRange,
  isValidIsoDate,
  isValidTimeZone,
  normalizeWeeklyAvailability
} = require('../directory');

test('validates weekly appointment windows and rejects duplicate days', () => {
  const windows = normalizeWeeklyAvailability([
    { dayOfWeek: 2, startTime: '09:00', endTime: '12:00' },
    { dayOfWeek: 0, startTime: '10:00', endTime: '11:00' }
  ]);
  assert.deepEqual(windows.map(window => window.dayOfWeek), [0, 2]);
  assert.throws(() => normalizeWeeklyAvailability([
    { dayOfWeek: 2, startTime: '09:00', endTime: '12:00' },
    { dayOfWeek: 2, startTime: '13:00', endTime: '15:00' }
  ]), /Vérifiez les jours/);
});

test('validates ISO dates and time zones', () => {
  assert.equal(isValidIsoDate('2030-03-31'), true);
  assert.equal(isValidIsoDate('2030-02-30'), false);
  assert.equal(isValidTimeZone('Europe/Paris'), true);
  assert.equal(isValidTimeZone('not/a-zone'), false);
});

test('converts local calendar dates across the spring daylight-saving change', () => {
  const range = getDailyRange('2030-03-31', 'Europe/Paris');
  assert.equal(range.end.getTime() - range.start.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(dateInTimeZone(new Date('2030-03-31T22:30:00.000Z'), 'Europe/Paris'), '2030-04-01');
});

test('does not offer nonexistent local times during the spring daylight-saving change', () => {
  const slots = availableSlots({
    date: '2030-03-31',
    timeZone: 'Europe/Paris',
    weeklyAvailability: [{ dayOfWeek: 0, startTime: '01:00', endTime: '04:00' }],
    durationMinutes: 30,
    busyIntervals: []
  });
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map(slot => slot.start), [
    '2030-03-31T00:00:00.000Z',
    '2030-03-31T01:00:00.000Z',
    '2030-03-31T01:30:00.000Z'
  ]);
});

test('keeps appointment duration exact across the autumn daylight-saving change', () => {
  const slots = availableSlots({
    date: '2030-10-27',
    timeZone: 'Europe/Paris',
    weeklyAvailability: [{ dayOfWeek: 0, startTime: '01:00', endTime: '03:00' }],
    durationMinutes: 30,
    busyIntervals: []
  });
  assert.ok(slots.every(slot =>
    new Date(slot.end).getTime() - new Date(slot.start).getTime() === 30 * 60 * 1000
  ));
});

test('excludes slots overlapping a calendar or local appointment', () => {
  const slots = availableSlots({
    date: '2030-04-01',
    timeZone: 'Europe/Paris',
    weeklyAvailability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }],
    durationMinutes: 30,
    busyIntervals: [{
      start: new Date('2030-04-01T07:15:00.000Z'),
      end: new Date('2030-04-01T07:30:00.000Z')
    }]
  });
  assert.deepEqual(slots.map(slot => slot.start), ['2030-04-01T07:30:00.000Z']);
});
