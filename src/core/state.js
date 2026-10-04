/**
 * Shared app state: plan filters, Redmine state, State store
 * (split from the former monolithic src/app.js — v4.40.0)
 */

/* Plan list filter state */
window.__planFilter = window.__planFilter || 'all';
window.__expandedPlans = window.__expandedPlans || new Set();

/* ============================================================
   REDMINE STATE
   ============================================================ */
const RedmineState = {
  projects: [],
  selectedProjectId: null,
  loaded: false
};


/* Track which copy dropdown is currently open (survives re-render) */
window.__openCopyMenuId = window.__openCopyMenuId || null;


/* ============================================================
   STATE
   ============================================================ */
const State = {
  _plans: [],
  _summaries: [],
  plans: {
    all(){ return State._plans; },
    get(id){ return State._plans.find(x => x.id === id); },
    set(arr){ State._plans = arr; }
  },
  summaries: {
    all(){ return State._summaries; },
    get(id){ return State._summaries.find(x => x.id === id); },
    set(arr){ State._summaries = arr; }
  }
};

export {
  RedmineState,
  State
};
