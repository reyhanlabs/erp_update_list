/**
 * Redmine project loader + date range helper
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { apiFetch } from '../api.js';
import { REDMINE_STORAGE_KEY } from '../config.js';
import { RedmineState } from '../core/state.js';
import { $, escapeHtml, todayISO } from '../core/helpers.js';
import { currentView } from '../ui/navigation.js';
import { loadTesterReminder } from '../features/tester/queue.js';
import { showSyncResult } from '../features/redmine-sync.js';

/* ============================================================
   REDMINE — PROJECT LOADER
   ============================================================ */
async function loadRedmineProjects(){
  if(RedmineState.loaded && RedmineState.projects.length) return;

  const sel = $('syncProject');
  if(sel){
    sel.innerHTML = '<option value="">Loading projects…</option>';
    sel.disabled = true;
  }

  try {
    const r = await apiFetch('/api/redmine-projects');
    const data = await r.json();

    if(!r.ok) throw new Error(data.detail || data.error || 'Failed to load projects');

    const projects = (data.projects || []).filter(p => p.status === 1);
    if(!projects.length){
      if(sel) sel.innerHTML = '<option value="">No active projects found</option>';
      return;
    }

    RedmineState.projects = projects;
    RedmineState.loaded = true;

    let saved = null;
    try { saved = localStorage.getItem(REDMINE_STORAGE_KEY); } catch(e){}
    if(saved && projects.some(p => String(p.id) === saved || p.identifier === saved)){
      RedmineState.selectedProjectId = saved;
    } else if(projects.length === 1){
      RedmineState.selectedProjectId = String(projects[0].id);
    } else {
      const zahir = projects.find(p =>
        p.name.toLowerCase().includes('zahir erp') ||
        p.identifier === 'zahir-erp'
      );
      if(zahir) RedmineState.selectedProjectId = String(zahir.id);
    }

    sel.innerHTML = '<option value="">— Select project —</option>' +
      projects.map(p => {
        const isZahir = p.name.toLowerCase().includes('zahir erp') || p.identifier === 'zahir-erp';
        const label = (isZahir ? '⭐ ' : '') + p.name + (p.parent ? ` (${p.parent.name})` : '');
        return `<option value="${p.id}" data-identifier="${escapeHtml(p.identifier)}">${escapeHtml(label)}</option>`;
      }).join('');

    if(RedmineState.selectedProjectId){
      sel.value = RedmineState.selectedProjectId;
    }

    sel.disabled = false;
    updateRedmineProjectBadge();
    // Drop a stale "Could not load projects" banner from an earlier failed attempt
    const res = $('syncResult');
    if(res && /Could not load projects/i.test(res.textContent || '')) res.innerHTML = '';

  } catch(err){
    console.error('Failed to load projects:', err);
    sel.innerHTML = '<option value="">⚠ Failed to load projects</option>';
    sel.disabled = false;
    showSyncResult('error', `<b>Could not load projects:</b> ${escapeHtml(err.message)}`);
  }
}

function onRedmineProjectChange(){
  const sel = $('syncProject');
  if(!sel) return;
  const val = sel.value;
  if(!val){
    RedmineState.selectedProjectId = null;
    updateRedmineProjectBadge();
    return;
  }
  RedmineState.selectedProjectId = val;
  try { localStorage.setItem(REDMINE_STORAGE_KEY, val); } catch(e){}
  updateRedmineProjectBadge();
  // Refresh tester queue for the newly selected project
  if(currentView === 'tester') loadTesterReminder(true);
}

function updateRedmineProjectBadge(){
  const label = $('redmineProjectLabel');
  const idLabel = $('redmineProjectIdLabel');
  if(!label || !idLabel) return;

  const pid = RedmineState.selectedProjectId;
  if(!pid){
    label.textContent = 'No project selected';
    idLabel.textContent = '—';
    idLabel.style.display = 'none';
    return;
  }

  const proj = RedmineState.projects.find(p => String(p.id) === pid);
  if(proj){
    label.textContent = proj.name;
    idLabel.textContent = proj.identifier;
    idLabel.style.display = 'inline-flex';
  } else {
    label.textContent = pid;
    idLabel.style.display = 'none';
  }
}

function getSelectedProjectId(){
  return RedmineState.selectedProjectId;
}

/* ============================================================
   REDMINE DATE RANGE HELPER  (NEW in v4.10.0)
   ============================================================ */
function getRedmineDateRange(){
  const preset = ($('syncDatePreset')?.value) || 'today';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  const daysAgo = (n) => {
    const d = new Date(now);
    d.setDate(now.getDate() - n);
    return d;
  };

  switch (preset) {
    case 'today':
      return { from: ymd(now), to: ymd(now) };

    case 'week': {
      const day = now.getDay(); // 0=Min
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      return { from: ymd(monday), to: ymd(now) };
    }

    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: ymd(first), to: ymd(now) };
    }

    case '7d':
      return { from: ymd(daysAgo(7)), to: ymd(now) };

    case '30d':
      return { from: ymd(daysAgo(30)), to: ymd(now) };

    case 'custom':
      return {
        from: $('syncFrom')?.value || null,
        to:   $('syncTo')?.value   || null
      };

    case 'all':
    default:
      return { from: null, to: null };
  }
}

function onDatePresetChange(){
  const preset = $('syncDatePreset').value;
  const customRow = $('syncCustomRow');
  const warn = $('syncAllWarning');

  if (customRow) customRow.style.display = preset === 'custom' ? '' : 'none';
  if (warn)      warn.style.display      = preset === 'all'    ? '' : 'none';

  if (preset === 'custom') {
    if ($('syncFrom') && !$('syncFrom').value) $('syncFrom').value = todayISO();
    if ($('syncTo')   && !$('syncTo').value)   $('syncTo').value   = todayISO();
  }
}

export {
  getRedmineDateRange,
  getSelectedProjectId,
  loadRedmineProjects,
  onDatePresetChange,
  onRedmineProjectChange
};
