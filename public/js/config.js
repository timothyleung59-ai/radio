// public/js/config.js
let cachedConfig = null;

export async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const res = await fetch('/api/config');
  cachedConfig = await res.json();
  return cachedConfig;
}

export function invalidateConfigCache() {
  cachedConfig = null;
}
