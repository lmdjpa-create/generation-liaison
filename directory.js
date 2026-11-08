function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeWeeklyAvailability(value) {
  if (!Array.isArray(value) || value.length > 7) {
    throw new Error('Choisissez les jours et horaires disponibles.');
  }
  const seenDays = new Set();
  return value.map(window => {
    if (!window || !Number.isInteger(window.dayOfWeek) || window.dayOfWeek < 0 || window.dayOfWeek > 6 ||
        typeof window.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.startTime) ||
        typeof window.endTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.endTime) ||
        window.startTime >= window.endTime || seenDays.has(window.dayOfWeek)) {
      throw new Error('Vérifiez les jours et les heures renseignés.');
    }
    seenDays.add(window.dayOfWeek);
    return {
      dayOfWeek: window.dayOfWeek,
      startTime: window.startTime,
      endTime: window.endTime
    };
  }).sort((left, right) => left.dayOfWeek - right.dayOfWeek);
}

function zonedDateTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const difference = target - represented;
    if (difference === 0) break;
    guess += difference;
  }
  const resolved = new Date(guess);
  const resolvedParts = Object.fromEntries(formatter.formatToParts(resolved)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  if (resolvedParts.year !== year || resolvedParts.month !== month || resolvedParts.day !== day ||
      resolvedParts.hour !== hour || resolvedParts.minute !== minute) {
    return null;
  }
  return resolved;
}

function dateInTimeZone(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function getDailyRange(date, timeZone) {
  if (!isValidIsoDate(date) || !isValidTimeZone(timeZone)) {
    throw new Error('La date ou le fuseau horaire est invalide.');
  }
  const nextDate = new Date(`${date}T12:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateString = nextDate.toISOString().slice(0, 10);
  return {
    start: zonedDateTimeToUtc(date, '00:00', timeZone),
    end: zonedDateTimeToUtc(nextDateString, '00:00', timeZone)
  };
}

function availableSlots({ date, timeZone, weeklyAvailability, durationMinutes, busyIntervals }) {
  if (!isValidIsoDate(date) || !isValidTimeZone(timeZone) ||
      !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
    throw new Error('Paramètres de disponibilité invalides.');
  }
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const dayWindow = weeklyAvailability.find(window => window.dayOfWeek === weekday);
  if (!dayWindow) return [];

  const slots = [];
  const startMinutes = Number(dayWindow.startTime.slice(0, 2)) * 60 + Number(dayWindow.startTime.slice(3));
  const endMinutes = Number(dayWindow.endTime.slice(0, 2)) * 60 + Number(dayWindow.endTime.slice(3));
  for (let minute = startMinutes; minute + durationMinutes <= endMinutes; minute += durationMinutes) {
    const startTime = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const endMinute = minute + durationMinutes;
    const endTime = `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`;
    const start = zonedDateTimeToUtc(date, startTime, timeZone);
    const end = zonedDateTimeToUtc(date, endTime, timeZone);
    if (!start || !end || start <= new Date() ||
        end.getTime() - start.getTime() !== durationMinutes * 60 * 1000) continue;
    if (busyIntervals.some(interval => start < interval.end && end > interval.start)) continue;
    slots.push({ start: start.toISOString(), end: end.toISOString() });
  }
  return slots;
}

module.exports = {
  availableSlots,
  dateInTimeZone,
  getDailyRange,
  isValidIsoDate,
  isValidTimeZone,
  normalizeWeeklyAvailability
};
