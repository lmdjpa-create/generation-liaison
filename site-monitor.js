const areas = ['connexion', 'messagerie', 'agenda', 'notifications', 'annuaire', 'autres'];
const categories = [
  ['connexion', ['/api/auth', '/api/account', '/api/senior-links']],
  ['messagerie', ['/api/messages', '/api/assistant']],
  ['agenda', ['/api/agenda', '/api/planning']],
  ['notifications', ['/api/notifications']],
  ['annuaire', ['/api/directory']]
];

function siteArea(path) {
  for (const [area, prefixes] of categories) {
    if (prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return area;
  }
  return 'autres';
}

function emptyCounts() {
  return { requests: 0, clientErrors: 0, serverErrors: 0 };
}

function createSiteMonitor(now = () => Date.now()) {
  const startedAt = now();
  const buckets = new Map();
  const windowMinutes = 15;

  function prune(currentMinute) {
    for (const minute of buckets.keys()) {
      if (minute <= currentMinute - windowMinutes) buckets.delete(minute);
    }
  }

  return {
    record(status, area = 'autres') {
      const minute = Math.floor(now() / 60000);
      prune(minute);
      const bucket = buckets.get(minute) || Object.fromEntries(areas.map(key => [key, emptyCounts()]));
      const counts = bucket[areas.includes(area) ? area : 'autres'];
      counts.requests++;
      if (status >= 400 && status < 500) counts.clientErrors++;
      if (status >= 500) counts.serverErrors++;
      buckets.set(minute, bucket);
    },
    snapshot() {
      prune(Math.floor(now() / 60000));
      const totals = emptyCounts();
      const byArea = Object.fromEntries(areas.map(key => [key, emptyCounts()]));
      for (const bucket of buckets.values()) {
        for (const area of areas) {
          for (const field of Object.keys(totals)) {
            byArea[area][field] += bucket[area][field];
            totals[field] += bucket[area][field];
          }
        }
      }
      return { windowMinutes, observedSince: new Date(startedAt).toISOString(), ...totals, byArea };
    }
  };
}

module.exports = { createSiteMonitor, siteArea };
