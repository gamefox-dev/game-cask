// Required structure of the resumable porting state in reports/.
export const STATUSES = ['unknown', 'in_progress', 'implemented', 'tested', 'verified'];
/* v0.2 pipeline strategies first; v0.1 names kept so older reports still validate */
export const STRATEGIES = ['lifted', 'profile', 'override', 'unsupported', 'preserve', 'reconstruct', 'replace', 'selective-emulate'];
export const CONFIDENCE = ['low', 'medium', 'high'];
export const LEVELS = ['blocked', 'L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

export const REPORT_FILES = {
  'inventory.json': 'npm run inspect',
  'analysis.md': 'game-analyst: binary/asset analysis with evidence',
  'subsystem-map.json': 'game-analyst/game-porter: per-subsystem plan + status',
  'progress.json': 'game-porter: resumable state, achieved level, next step',
  'errors.json': 'game-porter: failures seen and their resolution',
  'e2e-results.json': 'playwright (written automatically)',
  'validation.md': 'independent-validator',
  'final-report.md': 'game-porter, then checked by `npm run report`',
};

const req = (obj, key, where, errs, check) => {
  if (!(key in obj)) errs.push(`${where}: missing "${key}"`);
  else if (check && !check(obj[key])) errs.push(`${where}: invalid "${key}": ${JSON.stringify(obj[key])}`);
};

export function validateSubsystemMap(doc) {
  const errs = [];
  if (!doc || !Array.isArray(doc.subsystems)) return ['subsystem-map.json: expected { "subsystems": [...] }'];
  doc.subsystems.forEach((s, i) => {
    const w = `subsystem-map.json subsystems[${i}]${s?.name ? ` (${s.name})` : ''}`;
    req(s, 'name', w, errs);
    req(s, 'source_evidence', w, errs, (v) => Array.isArray(v));
    req(s, 'confidence', w, errs, (v) => CONFIDENCE.includes(v));
    req(s, 'implementation_strategy', w, errs, (v) => STRATEGIES.includes(v));
    req(s, 'status', w, errs, (v) => STATUSES.includes(v));
    req(s, 'known_deviations', w, errs, (v) => Array.isArray(v));
    if (s.status === 'verified' && !(s.verification_evidence?.length > 0)) errs.push(`${w}: status "verified" requires non-empty "verification_evidence"`);
  });
  return errs;
}

export function validateProgress(doc) {
  const errs = [];
  req(doc, 'game', 'progress.json', errs);
  req(doc, 'achieved_level', 'progress.json', errs, (v) => LEVELS.includes(v));
  req(doc, 'target_level', 'progress.json', errs, (v) => LEVELS.includes(v));
  req(doc, 'steps', 'progress.json', errs, (v) => Array.isArray(v));
  req(doc, 'next', 'progress.json', errs);
  return errs;
}

export function validateErrors(doc) {
  if (!doc || !Array.isArray(doc.errors)) return ['errors.json: expected { "errors": [...] }'];
  const errs = [];
  doc.errors.forEach((e, i) => {
    req(e, 'summary', `errors.json errors[${i}]`, errs);
    req(e, 'status', `errors.json errors[${i}]`, errs, (v) => ['open', 'resolved', 'wontfix'].includes(v));
  });
  return errs;
}
