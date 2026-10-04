/**
 * By Client view
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { ICON } from '../icons.js';
import { RedmineState } from '../core/state.js';
import { $, escapeHtml, toast } from '../core/helpers.js';
import { switchView } from '../ui/navigation.js';
import { issueSelectCell, issueSelectHeader, updateBatchBar } from '../ui/batch-selection.js';
import { emptyState, matchesQuickFilter } from '../ui/list-controls.js';
import { fetchRedmine } from '../redmine/client.js';
import { fetchRedmineAllIssues, genericLoadingSkeleton, priorityBadge } from './tester/queue.js';
import { loadRedmineProjects } from '../redmine/projects.js';
import { issueDescriptionCell, resolveNewIssueProjectIds } from './new-issues.js';

/* ============================================================
   BY CLIENT — Redmine custom field "Client Name"
   ============================================================ */
window.__clientCfId = window.__clientCfId || null;
window.__clientIssues = window.__clientIssues || [];
window.__clientMeta = null;
window.__clientError = null;
window.__clientQuery = window.__clientQuery || '';

function getIssueClientName(issue){
  const fields = issue && issue.custom_fields;
  if(!Array.isArray(fields)) return '';
  const f = fields.find(cf => {
    const n = String(cf.name || '').toLowerCase().trim();
    return n === 'client name' || n === 'client' || n === 'customer' || n === 'customer name';
  });
  if(!f) return '';
  const v = f.value;
  if(Array.isArray(v)) return v.filter(Boolean).join(', ');
  return String(v || '').trim();
}

async function resolveClientNameFieldId(force){
  if(!force && window.__clientCfId) return window.__clientCfId;
  try {
    const cached = localStorage.getItem('erp_client_cf_id');
    if(!force && cached){
      window.__clientCfId = cached;
      return cached;
    }
  } catch(_){}
  try {
    const { data } = await fetchRedmine('/api/redmine?resource=custom_fields', { force: !!force });
    const list = data.custom_fields || data || [];
    const arr = Array.isArray(list) ? list : [];
    const found = arr.find(cf => {
      const n = String(cf.name || '').toLowerCase().trim();
      return n === 'client name' || n === 'client' || n === 'customer name';
    });
    if(found && found.id){
      window.__clientCfId = String(found.id);
      try { localStorage.setItem('erp_client_cf_id', window.__clientCfId); } catch(_){}
      return window.__clientCfId;
    }
  } catch(err){
    console.warn('resolveClientNameFieldId', err);
  }
  return null;
}

function searchClientFromGlobal(name){
  const q = String(name || '').trim();
  openClientsView();
  const input = $('clientSearchInput');
  if(input) input.value = q;
  if(q) loadClientIssues(q, true);
}
function openClientsView(){
  switchView('clients');
  try {
    if($('pageTitle')) $('pageTitle').textContent = 'By Client';
    if($('pageSubtitle')) $('pageSubtitle').textContent = 'Search issues by Client Name';
  } catch(_){}
  const q = ($('clientSearchInput')?.value || '').trim();
  if(q) loadClientIssues(q, false);
  else renderClientIssues();
  setTimeout(() => { try { $('clientSearchInput')?.focus(); } catch(_){} }, 100);
}

async function loadClientIssues(clientName, force){
  const q = String(clientName || $('clientSearchInput')?.value || '').trim();
  window.__clientQuery = q;
  const el = $('clientsBody');
  const btn = $('btnRefreshClients');
  if(!q){
    window.__clientIssues = [];
    window.__clientError = null;
    window.__clientMeta = null;
    renderClientIssues();
    return;
  }
  if(el) el.innerHTML = (typeof genericLoadingSkeleton === 'function')
    ? genericLoadingSkeleton('Loading issues for client…')
    : '<p style="padding:16px">Loading…</p>';
  if(btn) btn.disabled = true;

  try {
    if(!RedmineState.loaded){
      try { await loadRedmineProjects(); } catch(_){}
    }
    const cfId = await resolveClientNameFieldId(!!force);
    const targets = (typeof resolveNewIssueProjectIds === 'function') ? resolveNewIssueProjectIds() : [];
    const merged = [];
    let anyOk = false;

    // Prefer server-side cf filter when we know the field id
    await Promise.all((targets.length ? targets : [{ projectId: null, label: 'All' }]).map(async (t) => {
      try {
        const params = new URLSearchParams();
        params.set('status_id', '*'); // all statuses
        params.set('sort', 'updated_on:desc');
        if(t.projectId) params.set('project_id', String(t.projectId));
        if(cfId){
          params.set('client_cf_id', String(cfId));
          params.set('client_name', q);
        }
        const result = await fetchRedmineAllIssues(params, { force: !!force, pageSize: 100, maxPages: 4 });
        anyOk = true;
        (result.issues || []).forEach(i => {
          const client = getIssueClientName(i) || (cfId ? q : '');
          // If no cf filter worked, filter client-side
          if(!cfId){
            const name = getIssueClientName(i).toLowerCase();
            if(!name.includes(q.toLowerCase())) return;
          } else if(client && !String(client).toLowerCase().includes(q.toLowerCase())){
            // extra client-side safety
            const name = getIssueClientName(i).toLowerCase();
            if(name && !name.includes(q.toLowerCase())) return;
          }
          merged.push({
            ...i,
            _clientName: getIssueClientName(i) || q,
            _projectLabel: t.projectName || t.label || i.project?.name || ''
          });
        });
      } catch(err){
        console.warn('loadClientIssues project', t.label, err);
      }
    }));

    // Deduplicate by id
    const byId = new Map();
    merged.forEach(i => { if(i && i.id != null) byId.set(String(i.id), i); });
    let list = Array.from(byId.values());

    // If cf filter returned nothing, fallback: fetch open issues and filter by custom field client-side
    if(!list.length){
      const fallback = [];
      await Promise.all((targets.length ? targets : [{ projectId: null }]).map(async (t) => {
        if(!t.projectId) return;
        try {
          const params = new URLSearchParams();
          params.set('status_id', 'open');
          params.set('sort', 'updated_on:desc');
          params.set('project_id', String(t.projectId));
          const result = await fetchRedmineAllIssues(params, { force: !!force, pageSize: 100, maxPages: 3 });
          (result.issues || []).forEach(i => {
            const name = getIssueClientName(i);
            if(name && name.toLowerCase().includes(q.toLowerCase())){
              fallback.push({
                ...i,
                _clientName: name,
                _projectLabel: t.projectName || t.label || i.project?.name || ''
              });
            }
          });
        } catch(_){}
      }));
      fallback.forEach(i => byId.set(String(i.id), i));
      list = Array.from(byId.values());
    }

    list.sort((a, b) => String(b.updated_on || '').localeCompare(String(a.updated_on || '')));
    window.__clientIssues = list;
    window.__clientError = null;
    window.__clientMeta = { q, total: list.length, at: Date.now(), cfId };
    const badge = $('countClients');
    if(badge) badge.textContent = String(list.length);
    const tb = $('clientsTotalBadge');
    if(tb) tb.textContent = String(list.length);
    renderClientIssues();
    if(!list.length){
      toast('No issues found for this client', 'error');
    } else {
      toast(`${list.length} issue(s) for “${q}”`);
    }
  } catch(err){
    console.error(err);
    window.__clientError = err.friendly || { title: 'Failed', message: err.message || 'Load failed' };
    renderClientIssues();
  } finally {
    if(btn) btn.disabled = false;
  }
}

function renderClientIssues(){
  const el = $('clientsBody');
  if(!el) return;
  const filtersBar = $('clientsFiltersBar');
  if(window.__clientError){
    if(filtersBar) filtersBar.classList.add('hidden');
    el.innerHTML = emptyState(ICON.alert, window.__clientError.title || 'Error', window.__clientError.message || '', [
      { label: 'Try again', action: "loadClientIssues(window.__clientQuery, true)", primary: true }
    ]);
    return;
  }
  const q = window.__clientQuery || '';
  if(!q){
    if(filtersBar) filtersBar.classList.add('hidden');
    el.innerHTML = `<div class="empty clients-empty">
      <p class="clients-empty-title">Search by client</p>
      <p class="clients-empty-desc">Enter a name from the Redmine field <b>Client Name</b>, then press Search.</p>
    </div>`;
    return;
  }
  const list = (window.__clientIssues || []).filter(i => matchesQuickFilter(i));
  if(!list.length){
    if(filtersBar) filtersBar.classList.add('hidden');
    el.innerHTML = emptyState(ICON.inbox, 'No issues', `No issues matched “${escapeHtml(q)}”. Try the exact Client Name from Redmine.`, [
      { label: 'Search again', action: "loadClientIssues(window.__clientQuery, true)", primary: true }
    ]);
    return;
  }
  if(filtersBar) filtersBar.classList.remove('hidden');

  // Group by status
  const groups = {};
  list.forEach(i => {
    const st = i.status?.name || 'Unknown';
    if(!groups[st]) groups[st] = [];
    groups[st].push(i);
  });
  const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));

  el.innerHTML = `
    <div class="list-meta-row" style="padding:4px 4px 10px">Client <b>${escapeHtml(q)}</b> · <b>${list.length}</b> issue(s)</div>
    ${keys.map(st => `
      <div class="tester-group">
        <div class="tester-group-head">
          <span class="tester-group-title">${escapeHtml(st)}</span>
          <span class="badge badge-cyan">${groups[st].length}</span>
        </div>
        ${renderClientTable(groups[st])}
      </div>
    `).join('')}`;
  try { updateBatchBar(); } catch(_){}
}

function renderClientTable(issues){
  const rows = issues.map(issue => {
    const url = `https://pjm.zahironline.com/issues/${issue.id}`;
    const pri = issue.priority?.name || '—';
    const priHtml = (typeof priorityBadge === 'function') ? priorityBadge(pri) : escapeHtml(pri);
    const st = issue.status?.name || '—';
    return `<tr class="tester-tr" onclick="window.open('${escapeHtml(url)}','_blank','noopener')">
      ${issueSelectCell(issue.id)}
      <td class="col-id"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${issue.id}</a></td>
      <td class="col-subject">${issueDescriptionCell(issue, { showProject: true })}</td>
      <td class="col-priority">${priHtml}</td>
      <td class="col-tracker">${escapeHtml(st)}</td>
      <td class="col-open"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${ICON.externalLink}</a></td>
    </tr>`;
  }).join('');
  return `<div class="tester-table-wrap">
    <table class="tester-table">
      <thead><tr>
        ${issueSelectHeader()}
        <th class="col-id">Issue</th>
        <th class="col-subject">Description</th>
        <th class="col-priority">Priority</th>
        <th class="col-tracker">Status</th>
        <th class="col-open"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export {
  getIssueClientName,
  loadClientIssues,
  openClientsView,
  renderClientIssues,
  resolveClientNameFieldId,
  searchClientFromGlobal
};
