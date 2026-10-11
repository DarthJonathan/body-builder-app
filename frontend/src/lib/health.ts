import type { HealthEnergy } from './domain';

export function validateHealthEnergy(value: unknown): asserts value is HealthEnergy {
  const h = value as HealthEnergy;
  if (!h || typeof h !== 'object' || Array.isArray(h) || Object.keys(h).some(k=>!['source','syncedAt','timezone','sources','days'].includes(k)) || h.source !== 'apple-health' || typeof h.syncedAt !== 'string' || !Number.isFinite(Date.parse(h.syncedAt)) || !Array.isArray(h.sources) || h.sources.length < 1 || h.sources.length > 30 || h.sources.some(s => typeof s !== 'string' || !s.trim() || s.length > 150)) throw new Error('Apple Health data is missing its source or sync time.');
  try { new Intl.DateTimeFormat('en', { timeZone: h.timezone }); } catch { throw new Error('Apple Health timezone is invalid.'); }
  if (typeof h.timezone !== 'string' || !Array.isArray(h.days) || h.days.length < 7 || h.days.length > 14) throw new Error('At least seven complete days of resting and active energy are needed.');
  const dates = new Set<string>();
  for (const day of h.days) {
    if (!day || typeof day !== 'object' || Array.isArray(day) || Object.keys(day).some(k=>!['date','restingCalories','activeCalories','coverageHours','dayHours'].includes(k))) throw new Error('Apple Health has an unsupported daily summary.');
    const date = new Date(`${day.date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day.date || dates.has(day.date)) throw new Error('Apple Health days must be valid and unique.');
    dates.add(day.date);
    if (![day.restingCalories, day.activeCalories, day.coverageHours, day.dayHours].every(Number.isFinite) || day.restingCalories < 300 || day.restingCalories > 5000 || day.activeCalories < 0 || day.activeCalories > 8000 || day.dayHours < 23 || day.dayHours > 25 || day.coverageHours < day.dayHours * .9 || day.coverageHours > day.dayHours + .01) throw new Error('Apple Health has incomplete or unsupported daily energy values. Use the equation estimate instead.');
  }
  const first = [...dates].sort()[0], last = [...dates].sort().at(-1)!;
  if ((Date.parse(last) - Date.parse(first)) / 86400000 > 13) throw new Error('Use Apple Health days from one recent fourteen-day window.');
  const parts = new Intl.DateTimeFormat('en', { timeZone: h.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(h.syncedAt));
  const syncDay = ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
  if (last >= syncDay) throw new Error('Apple Health energy must exclude the current, incomplete day.');
}

export function healthEnergyMean(energy: HealthEnergy): { resting: number; maintenance: number } {
  validateHealthEnergy(energy);
  return {
    resting: energy.days.reduce((n, d) => n + d.restingCalories, 0) / energy.days.length,
    maintenance: energy.days.reduce((n, d) => n + d.restingCalories + d.activeCalories, 0) / energy.days.length
  };
}

type HealthBridge = { readEnergy(): Promise<{ energy?: HealthEnergy; message?: string }> };
declare global { interface Window { BodyBuilderHealth?: HealthBridge } }
export function hasAppleHealth(): boolean { return typeof window !== 'undefined' && !!window.BodyBuilderHealth; }
export async function readAppleHealth(): Promise<HealthEnergy> {
  if (!hasAppleHealth()) throw new Error('Apple Health is available in the BodyBuilder iPhone app. The browser uses the equation estimate.');
  const result = await window.BodyBuilderHealth!.readEnergy();
  if (!result.energy) throw new Error(result.message || 'No complete Apple Health energy history is available. Check Health permissions and use the equation estimate meanwhile.');
  validateHealthEnergy(result.energy);
  return structuredClone(result.energy);
}
