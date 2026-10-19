/**
 * Issue + request status helpers (v4.71.0)
 *
 * Pure functions shared by the Client Report, Client requests and the public
 * report page (/r/<token>), which runs without Firebase. Nothing here may
 * import Firebase, the team module or the app state.
 *
 * The issues of the client being looked at live in window.__clientIssues, and
 * parent issues fetched by id (they often lack the Client Name field) in
 * window.__clientParents.
 */

/** done | doing | todo from the issue's OWN current status. */
export function groupOf(issue){
  const n = String(issue.status?.name || '').toLowerCase();
  if(/^new$|^baru$/.test(n)) return 'todo';
  if(/resolved|closed|fixed|done|finish|selesai|rejected|cancel|duplicate/.test(n)) return 'done';
  if(issue.status?.is_closed === true) return 'done';
  return 'doing';
}

export const REQUEST_STATUS = {
  done:    { label: 'Done',            cls: 'is-done' },
  doing:   { label: 'In progress',     cls: 'is-doing' },
  todo:    { label: 'Not started',     cls: 'is-todo' },
  missing: { label: 'No issue yet',    cls: 'is-missing' },
  dropped: { label: 'Dropped',         cls: 'is-dropped' }
};

// the client's issues plus parent issues that don't carry the Client Name field (fetched by id)
export function issuesOfClient(){
  const own = window.__clientIssues || [], extra = window.__clientParents || [];
  if(!extra.length) return own;
  const ids = new Set(own.map(i => String(i.id)));
  return own.concat(extra.filter(i => !ids.has(String(i.id))));
}
export const issueById = (id) => issuesOfClient().find(i => String(i.id) === String(id));

/** progress group of a linked issue: its OWN current status (v4.69.5). */
export function linkedGroup(id){
  const i = issueById(id);
  return i ? groupOf(i) : 'todo';
}

export function itemStatus(item){
  if(item.mode === 'done') return 'done';
  if(item.mode === 'dropped') return 'dropped';
  const ids = item.issueIds || [];
  if(!ids.length) return 'missing';
  const g = ids.map(id => linkedGroup(id));
  if(g.every(x => x === 'done')) return 'done';
  if(g.every(x => x === 'todo')) return 'todo';
  return 'doing';
}
export function listCounts(list){
  const c = { total: 0, done: 0, doing: 0, todo: 0, missing: 0, dropped: 0 };
  (list.items || []).forEach(it => { c.total++; c[itemStatus(it)]++; });
  c.active = c.total - c.dropped;
  return c;
}
