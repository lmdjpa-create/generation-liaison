const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWeatherService } = require('../weather');

function forecast(day = '2026-03-02') {
  const icons = ['clear-day', 'partly-cloudy-day', 'cloudy', 'fog', 'rain', 'snow', 'thunder-rain'];
  return {
    timezone: 'Europe/Paris',
    currentConditions: { temp: 12.5, icon: 'cloudy' },
    days: icons.map((icon, index) => ({
      datetime: `2026-03-${String(Number(day.slice(-2)) + index).padStart(2, '0')}`,
      tempmin: 2 + index, tempmax: 12 + index, icon
    }))
  };
}
test('Visual Crossing weather requires a key, rounds coordinates and shares cached requests', async () => {
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
  await new Promise(done => setImmediate(done));
  assert.equal(urls.length, 1);
  assert.equal(urls[0].host, 'weather.visualcrossing.com');
  assert.match(urls[0].pathname, /\/timeline\/48\.86,2\.35\/today\/next6days$/);
  assert.equal(urls[0].searchParams.get('key'), 'secret');
  resolve();
  const data = await a;
  assert.deepEqual(await b, data);
  assert.equal(data.temperature, 12.5);
  assert.equal(data.days.length, 7);
  assert.equal((await service.getWeather(48.8566, 2.3522)).days[0].max, 12);
  assert.equal(urls.length, 1);
  now += 30 * 60 * 1000;
  const refresh = service.getWeather(48.8566, 2.3522);
  await new Promise(done => setImmediate(done));
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
        if (calls === 1) data.days[2].tempmin = null;
        return data;
      }
    })
  });
  await assert.rejects(service.getWeather(48, 2), /invalid weather response/);
  assert.equal((await service.getWeather(48, 2)).days.length, 7);
  assert.equal(calls, 2);
});
