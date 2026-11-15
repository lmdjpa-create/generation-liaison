function createWeatherService({ apiKey, fetchImpl = fetch, now = Date.now }) {
  const cache = new Map();
  const pending = new Map();

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
      const url = new URL('https://customer-api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({
        latitude: String(lat), longitude: String(lon),
        current: 'temperature_2m,weather_code',
        daily: 'temperature_2m_min,temperature_2m_max,weather_code',
        timezone: 'auto', forecast_days: '7', apikey: apiKey
      }).toString();
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('weather provider unavailable');
      const data = await response.json();
      const daily = data.daily;
      if (typeof data.timezone !== 'string' || !Number.isFinite(data.current?.temperature_2m) ||
          !Number.isInteger(data.current?.weather_code) ||
          !Array.isArray(daily?.time) || daily.time.length !== 7 ||
          !Array.isArray(daily.temperature_2m_min) || daily.temperature_2m_min.length !== 7 ||
          !Array.isArray(daily.temperature_2m_max) || daily.temperature_2m_max.length !== 7 ||
          !Array.isArray(daily.weather_code) || daily.weather_code.length !== 7) {
        throw new Error('invalid weather response');
      }
      const day = localDate(data.timezone);
      if (daily.time[0] !== day) throw new Error('stale weather response');
      const days = daily.time.map((date, index) => {
        const min = daily.temperature_2m_min[index];
        const max = daily.temperature_2m_max[index];
        const code = daily.weather_code[index];
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(min) || !Number.isFinite(max) || !Number.isInteger(code)) {
          throw new Error('invalid weather response');
        }
        return { date, min, max, code };
      });
      const result = {
        temperature: data.current.temperature_2m,
        code: data.current.weather_code,
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
