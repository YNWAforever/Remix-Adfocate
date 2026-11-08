// Offline review utilities only. No database client, environment URL or network.
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function statements(sql) {
  const out = []; let start = 0; let quote = ''; let dollar = ''; let comment = 0;
  for (let i = 0; i < sql.length; i++) {
    const a = sql[i], b = sql[i + 1];
    if (comment === -1) { if (a === '\n') comment = 0; continue; }
    if (comment > 0) { if (a === '/' && b === '*') { comment++; i++; } else if (a === '*' && b === '/') { comment--; i++; } continue; }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ''; } continue; }
    if (quote) {
      if (a === quote) { if (b === quote) i++; else quote = ''; }
      else if (a === '\\' && quote === "'") i++;
      continue;
    }
    if (a === '-' && b === '-') { comment = -1; i++; continue; }
    if (a === '/' && b === '*') { comment = 1; i++; continue; }
    if (a === "'" || a === '"') { quote = a; continue; }
    if (a === '$') { const m = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/); if (m) { dollar = m[0]; i += dollar.length - 1; continue; } }
    if (a === ';') { out.push(sql.slice(start, i + 1)); start = i + 1; }
  }
  if (quote || dollar || comment > 0) throw new Error('UNTERMINATED_SQL');
  if (sql.slice(start).trim()) out.push(sql.slice(start));
  return out;
}
export function executablePrefix(sql) {
  let s = sql.trimStart();
  while (s.startsWith('--') || s.startsWith('/*')) {
    if (s.startsWith('--')) { const end = s.indexOf('\n'); if (end < 0) return ''; s = s.slice(end + 1).trimStart(); }
    else {
      let depth = 1, i = 2;
      for (; i < s.length && depth; i++) { if (s.slice(i, i + 2) === '/*') { depth++; i++; } else if (s.slice(i, i + 2) === '*/') { depth--; i++; } }
      if (depth) throw new Error('UNTERMINATED_COMMENT');
      s = s.slice(i).trimStart();
    }
  }
  return s;
}
export function classify(sql) {
  const s = executablePrefix(sql);
  if (!s) return 'comment';
  if (/^(begin(?:\s+(?:work|transaction))?|commit(?:\s+work)?|end(?:\s+work)?)\s*;?$/i.test(s)) return 'transaction-boundary';
  if (/^(rollback|savepoint|release|start\s+transaction)\b/i.test(s)) throw new Error('UNEXPECTED_TRANSACTION_CONTROL');
  if (/^create\s+(?:or\s+replace\s+)?function\b/i.test(s)) return 'function-definition';
  if (/^do\b/i.test(s)) return 'do-block-review-required';
  if (/^(insert|update|delete|merge|truncate|copy|select|with|call)\b/i.test(s)) return 'top-level-data-or-call-review-required';
  if (/^(alter|drop)\b/i.test(s)) return 'existing-object-change-review-required';
  return 'schema-or-privilege';
}
export function flattenMigration(sql) {
  const parts = statements(sql); let opened = false; let ended = false;
  const kept = parts.filter(part => {
    const kind = classify(part);
    if (kind !== 'transaction-boundary') {
      if (ended && kind !== 'comment') throw new Error('SQL_AFTER_COMMIT');
      return true;
    }
    const start = /^begin\b/i.test(executablePrefix(part));
    if (start ? opened || ended : !opened || ended) throw new Error('UNEXPECTED_TRANSACTION_BOUNDARY');
    if (start) opened = true; else ended = true;
    return false;
  });
  if (opened && !ended) throw new Error('UNCLOSED_TRANSACTION');
  return kept.join('').trim() + '\n';
}
