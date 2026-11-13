const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertScheduleAvailable, lockScheduleParticipants } = require('../schedule-conflicts');

test('locks both participant schedules in a stable order', async () => {
  const keys = [];
  const client = {
    async query(sql, values) {
      assert.match(sql, /pg_advisory_xact_lock/);
      keys.push(values[0]);
    }
  };
  await lockScheduleParticipants(client, 'professional-id', 'senior-id');
  assert.deepEqual(keys, ['professional:professional-id', 'senior:senior-id']);
});

test('checks the full interval and reports an existing participant conflict', async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [{}] };
    }
  };
  await assert.rejects(assertScheduleAvailable(client, {
    professionalId: 'professional-id',
    seniorId: 'senior-id',
    start: '2030-01-01T10:00:00.000Z',
    durationMinutes: 30,
    excludeKind: 'service',
    excludeId: 'booking-id'
  }), error => error.status === 409 && /chevauche/.test(error.message));
  assert.equal(queries[0].values[2].toISOString(), '2030-01-01T10:00:00.000Z');
  assert.equal(queries[0].values[3].toISOString(), '2030-01-01T10:30:00.000Z');
  assert.deepEqual(queries[0].values.slice(4), ['service', 'booking-id']);
});

test('allows an available interval', async () => {
  const client = { async query() { return { rows: [] }; } };
  await assert.doesNotReject(assertScheduleAvailable(client, {
    professionalId: 'professional-id',
    seniorId: 'senior-id',
    start: '2030-01-01T10:30:00.000Z',
    durationMinutes: 60
  }));
});
