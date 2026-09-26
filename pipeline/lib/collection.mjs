export function rawRecordCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.details)) return payload.details.length;
  const records = payload.LiveEvents
    ?? payload.Events
    ?? payload.events
    ?? payload.result?.records
    ?? payload.result?.data
    ?? payload.records?.Earthquake
    ?? payload.records?.location
    ?? payload.records?.info
    ?? payload.data
    ?? payload.records
    ?? payload.items
    ?? payload.alerts;
  return Array.isArray(records) ? records.length : null;
}
