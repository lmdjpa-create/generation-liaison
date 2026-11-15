const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWeatherService } = require('../weather');

function forecast(day = '2026-03-02') {
  return {
    timezone: 'Europe/Paris',
    current: { temperature_2m: 12.5, weather_code: 3 },
    daily: {
      time: Array.from({ length: 7 }, (_, index) => `2026-03-${String(Number(day.slice(-2)) + index).padStart(2, '0')}`),
      temperature_2m_min: [2, 3, 4, 5, 6, 7, 8],
      temperature_2m_max: [12, 13, 14, 15, 16, 17, 18],
      weather_code: [0, 1, 2, 3, 45, 61, 95]
    }
  };
}

test('commercial weather requires a key, rounds coordinates and shares cached requests', async () => {
  let resolve;
  const urls = [];
  let now = Date.parse('2026-03-02T10:00:00Z');
  const service = createWeatherService({
    apiKey: 'secret', now: () => now,
    fetchImpl: url => {
      urls.push(url);
      return new Promise(done => { resolve = () => done({ ok: true, json: async () => forecast() }); });
    }
  });
  const a = service.getWeather(48.8566, 2.3522);
  const b = service.getWeather(48.857, 2.352);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].host, 'customer-api.open-meteo.com');
  assert.equal(urls[0].searchParams.get('latitude'), '48.86');
  assert.equal(urls[0].searchParams.get('longitude'), '2.35');
  assert.equal(urls[0].searchParams.get('timezone'), 'auto');
  resolve();
  const data = await a;
  assert.deepEqual(await b, data);
  assert.equal(data.temperature, 12.5);
  assert.equal(data.days.length, 7);
  assert.equal((await service.getWeather(48.8566, 2.3522)).days[0].max, 12);
  assert.equal(urls.length, 1);
  now += 30 * 60 * 1000;
  const refresh = service.getWeather(48.8566, 2.3522);
  assert.equal(urls.length, 2);
  resolve();
  await refresh;
  const disabled = createWeatherService({ apiKey: '', fetchImpl: () => { throw new Error('unexpected request'); } });
  await assert.rejects(disabled.getWeather(48, 2), /pas encore configurée/);
});

test('forecast cache does not cross midnight in the selected municipality', async () => {
  let now = Date.parse('2026-03-02T22:55:00Z');
  let calls = 0;
  const service = createWeatherService({
    apiKey: 'secret', now: () => now,
    fetchImpl: async () => ({ ok: true, json: async () => forecast(++calls === 1 ? '2026-03-02' : '2026-03-03') })
  });
  await service.getWeather(48, 2);
  now = Date.parse('2026-03-02T23:05:00Z');
  const result = await service.getWeather(48, 2);
  assert.equal(calls, 2);
  assert.equal(result.days[0].date, '2026-03-03');
});

test('provider failures and invalid data are not cached', async () => {
  let calls = 0;
  const service = createWeatherService({
    apiKey: 'secret', now: () => Date.parse('2026-03-02T10:00:00Z'),
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        calls++;
        const data = forecast();
        if (calls === 1) data.daily.temperature_2m_min[2] = null;
        return data;
      }
    })
  });
  await assert.rejects(service.getWeather(48, 2), /invalid weather response/);
  assert.equal((await service.getWeather(48, 2)).days.length, 7);
  assert.equal(calls, 2);
});
