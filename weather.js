const ICON_CODES = Object.assign(Object.create(null), {
  'clear-day': 0, 'clear-night': 0, 'partly-cloudy-day': 2, 'partly-cloudy-night': 2, cloudy: 3, wind: 3,
  fog: 45, rain: 63, 'showers-day': 80, 'showers-night': 80, sleet: 67, snow: 73,
  'snow-showers-day': 85, 'snow-showers-night': 85, hail: 77,
  'thunder-rain': 95, 'thunder-showers-day': 95, 'thunder-showers-night': 95
});

function createWeatherService({ apiKey, fetchImpl = fetch, now = Date.now }) {
  const cache = new Map();
  const pending = new Map();
  let tail = Promise.resolve();

  function queue(task) {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  }

  function localDate(timeZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(now())).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  async function getWeather(latitude, longitude) {
    if (!apiKey) throw new Error('La météo n’est pas encore configurée.');
    const lat = Number(latitude.toFixed(2));
    const lon = Number(longitude.toFixed(2));
    const key = `${lat},${lon}`;
    const cached = cache.get(key);
    if (cached && cached.until > now() && cached.day === localDate(cached.timeZone)) return cached.data;
    if (pending.has(key)) return pending.get(key);

    const request = (async () => {
      const url = new URL(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/today/next6days`);
      url.search = new URLSearchParams({
        unitGroup: 'metric', include: 'days,current', elements: 'datetime,tempmax,tempmin,temp,icon',
        contentType: 'json', key: apiKey
      }).toString();
      const response = await queue(() => fetchImpl(url, { signal: AbortSignal.timeout(8000) }));
      if (!response.ok) throw new Error('weather provider unavailable');
      const data = await response.json();
      const source = data.days;
      if (typeof data.timezone !== 'string' || !Number.isFinite(data.currentConditions?.temp) ||
          !(data.currentConditions?.icon in ICON_CODES) ||
          !Array.isArray(source) || source.length !== 7) {
        throw new Error('invalid weather response');
      }
      const day = localDate(data.timezone);
      if (source[0].datetime !== day) throw new Error('stale weather response');
      const days = source.map(item => {
        const { datetime: date, tempmin: min, tempmax: max, icon } = item;
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(min) || !Number.isFinite(max) || !(icon in ICON_CODES)) {
          throw new Error('invalid weather response');
        }
        return { date, min, max, code: ICON_CODES[icon] };
      });
      const result = {
        temperature: data.currentConditions.temp,
        code: ICON_CODES[data.currentConditions.icon],
        days
      };
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(key, { data: result, until: now() + 30 * 60 * 1000, timeZone: data.timezone, day });
      return result;
    })();
    pending.set(key, request);
    try {
      return await request;
    } finally {
      pending.delete(key);
    }
  }

  return { getWeather };
}

module.exports = { createWeatherService };
