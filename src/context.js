const layers = new Set(['identity', 'behavior_history', 'memory', 'continuity']);

export function validateRecords(records) {
  if (!Array.isArray(records) || records.length > 1000) throw new Error('Invalid context records');
  const ids = new Set();
  for (const r of records) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !layers.has(r.layer)) throw new Error('Invalid or duplicate record');
    if (!['private', 'public'].includes(r.visibility) || typeof r.text !== 'string' || r.text.length > 10000) throw new Error('Invalid record content');
    if (typeof r.approvedForExternalUse !== 'boolean' || !Number.isInteger(r.revision) || r.revision < 1) throw new Error('Invalid approval or revision');
    ids.add(r.id);
  }
  return records;
}

export function buildExternalContext(records) {
  validateRecords(records);
  // Missing consent never means consent. Private material is excluded even if marked approved.
  return records.filter(r => r.visibility === 'public' && r.approvedForExternalUse)
    .map(r => ({ id: r.id, layer: r.layer, revision: r.revision, text: r.text }));
}

export function reviseRecord(records, id, text) {
  validateRecords(records);
  if (typeof text !== 'string' || text.length > 10000) throw new Error('Invalid revision');
  if (!records.some(r => r.id === id)) throw new Error('Unknown record');
  return records.map(r => r.id === id ? { ...r, text, revision: r.revision + 1, approvedForExternalUse: false } : r);
}
