/**
 * Knowledge Base menu structure (v4.45.0)
 *
 * The team defines, per product, an ordered list of modules and each module's
 * submenus, e.g.  Zahir ERP › Master Data › Contacts.
 * Stored in the reserved document  workspaces/{ws}/kb/_structure  as
 *   { products: { erp: [{ id, name, subs: [{ id, name }] }], one: [...], ... },
 *     updatedAt, updatedBy }
 * Guides keep plain names in `module` / `submenu`; renames in the structure
 * are pushed to the guides that use them (see planRenames).
 * Pure functions only — no DOM, no Firestore.
 */

export const STRUCTURE_ID = '_structure';
export const GENERAL = '__general__';   // guides without a submenu
export const PRODUCT_KEYS = ['erp', 'one', 'mfg', 'mrp'];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const lc = (v) => clean(v).toLowerCase();

export function newId(){
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function emptyStructure(){
  return Object.fromEntries(PRODUCT_KEYS.map(p => [p, []]));
}

export function normalizeStructure(raw){
  const out = emptyStructure();
  const products = (raw && raw.products) || {};
  PRODUCT_KEYS.forEach(p => {
    const seen = new Set();
    (Array.isArray(products[p]) ? products[p] : []).forEach(m => {
      const name = clean(m && m.name);
      if(!name || seen.has(lc(name))) return;
      seen.add(lc(name));
      const subSeen = new Set();
      const subs = (Array.isArray(m.subs) ? m.subs : []).map(s => ({ id: String(s.id || newId()), name: clean(s.name) }))
        .filter(s => s.name && !subSeen.has(lc(s.name)) && subSeen.add(lc(s.name)));
      out[p].push({ id: String(m.id || newId()), name, subs });
    });
  });
  return out;
}

export function cloneStructure(st){
  return JSON.parse(JSON.stringify(st || emptyStructure()));
}

export function hasAnyModules(st){
  return PRODUCT_KEYS.some(p => (st[p] || []).length);
}

/** Draft a product's structure from the modules/submenus its guides already use. */
export function structureFromArticles(articles, product){
  const mods = new Map();
  (articles || []).filter(a => a.product === product).forEach(a => {
    const m = clean(a.module);
    if(!m) return;
    if(!mods.has(lc(m))) mods.set(lc(m), { id: newId(), name: m, subs: [] });
    const s = clean(a.submenu);
    const mod = mods.get(lc(m));
    if(s && !mod.subs.some(x => lc(x.name) === lc(s))) mod.subs.push({ id: newId(), name: s });
  });
  return [...mods.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => ({ ...m, subs: m.subs.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/**
 * Library tree for one render: defined modules/submenus first (in the team's
 * order, even with 0 guides), then names used by guides but not defined.
 * `articles` should already be filtered by the search query.
 */
export function buildTree(structure, articles){
  const st = structure || emptyStructure();
  const products = new Map();
  let total = 0;
  PRODUCT_KEYS.forEach(p => {
    const mods = [];
    const byName = new Map();
    (st[p] || []).forEach(m => {
      const node = { name: m.name, count: 0, defined: true, subs: m.subs.map(s => ({ key: s.name, count: 0, defined: true })) };
      mods.push(node);
      byName.set(lc(m.name), node);
    });
    products.set(p, { count: 0, modules: mods, byName });
  });

  (articles || []).forEach(a => {
    const prod = products.get(a.product);
    if(!prod) return;
    total++;
    prod.count++;
    const mName = clean(a.module) || 'Other';
    let mod = prod.byName.get(lc(mName));
    if(!mod){
      mod = { name: mName, count: 0, defined: false, subs: [] };
      prod.modules.push(mod);
      prod.byName.set(lc(mName), mod);
    }
    mod.count++;
    const sName = clean(a.submenu);
    const key = sName || GENERAL;
    let sub = mod.subs.find(s => (s.key === GENERAL ? key === GENERAL : lc(s.key) === lc(key)));
    if(!sub){
      sub = { key, count: 0, defined: false };
      mod.subs.push(sub);
    }
    sub.count++;
  });

  // tidy: undefined names after defined ones (alphabetical), "General" last;
  // hide "General" when a module has no named submenus at all
  products.forEach(prod => {
    const defined = prod.modules.filter(m => m.defined);
    const extra = prod.modules.filter(m => !m.defined).sort((a, b) => a.name.localeCompare(b.name));
    prod.modules = [...defined, ...extra];
    prod.modules.forEach(m => {
      const named = m.subs.filter(s => s.key !== GENERAL);
      const defSubs = named.filter(s => s.defined);
      const extraSubs = named.filter(s => !s.defined).sort((a, b) => a.key.localeCompare(b.key));
      const general = m.subs.find(s => s.key === GENERAL);
      m.subs = named.length ? [...defSubs, ...extraSubs, ...(general ? [general] : [])] : [];
    });
    delete prod.byName;
  });
  return { total, products };
}

/** Module names for a product: defined first, then any used by guides. */
export function moduleOptions(structure, articles, product){
  const names = (structure[product] || []).map(m => m.name);
  const extra = [];
  (articles || []).filter(a => a.product === product).forEach(a => {
    const m = clean(a.module);
    if(m && !names.some(n => lc(n) === lc(m)) && !extra.some(n => lc(n) === lc(m))) extra.push(m);
  });
  return { defined: names, extra: extra.sort((a, b) => a.localeCompare(b)) };
}

export function submenuOptions(structure, articles, product, moduleName){
  const mod = (structure[product] || []).find(m => lc(m.name) === lc(moduleName));
  const names = mod ? mod.subs.map(s => s.name) : [];
  const extra = [];
  (articles || []).filter(a => a.product === product && lc(a.module) === lc(moduleName)).forEach(a => {
    const s = clean(a.submenu);
    if(s && !names.some(n => lc(n) === lc(s)) && !extra.some(n => lc(n) === lc(s))) extra.push(s);
  });
  return { defined: names, extra: extra.sort((a, b) => a.localeCompare(b)) };
}

/** Problems that block saving a draft (empty or duplicate names). */
export function validateStructure(st){
  const errors = [];
  PRODUCT_KEYS.forEach(p => {
    const seen = new Set();
    (st[p] || []).forEach((m, i) => {
      const n = lc(m.name);
      if(!n) errors.push({ product: p, module: i, msg: 'A module has no name' });
      else if(seen.has(n)) errors.push({ product: p, module: i, msg: `Module “${clean(m.name)}” is listed twice` });
      seen.add(n);
      const subSeen = new Set();
      (m.subs || []).forEach((s, j) => {
        const sn = lc(s.name);
        if(!sn) errors.push({ product: p, module: i, sub: j, msg: `A submenu in “${clean(m.name)}” has no name` });
        else if(subSeen.has(sn)) errors.push({ product: p, module: i, sub: j, msg: `Submenu “${clean(s.name)}” is listed twice in “${clean(m.name)}”` });
        subSeen.add(sn);
      });
    });
  });
  return errors;
}

/**
 * Guides that must change because a module or submenu was renamed
 * (matched by item id between the saved and the edited structure).
 * Returns [{ id, module, submenu }].
 */
export function planRenames(before, after, articles){
  const updates = [];
  PRODUCT_KEYS.forEach(p => {
    const oldMods = new Map((before[p] || []).map(m => [m.id, m]));
    const moduleMap = new Map();   // old name (lc) → { name, subs: Map(old lc → new) }
    (after[p] || []).forEach(m => {
      const old = oldMods.get(m.id);
      if(!old) return;
      const oldSubs = new Map((old.subs || []).map(s => [s.id, s]));
      const subMap = new Map();
      (m.subs || []).forEach(s => {
        const os = oldSubs.get(s.id);
        if(os && clean(os.name) !== clean(s.name)) subMap.set(lc(os.name), clean(s.name));
      });
      if(clean(old.name) !== clean(m.name) || subMap.size){
        moduleMap.set(lc(old.name), { name: clean(m.name), subs: subMap });
      }
    });
    if(!moduleMap.size) return;
    (articles || []).filter(a => a.product === p).forEach(a => {
      const entry = moduleMap.get(lc(a.module));
      if(!entry) return;
      const newModule = entry.name;
      const newSub = a.submenu && entry.subs.has(lc(a.submenu)) ? entry.subs.get(lc(a.submenu)) : (a.submenu || '');
      if(newModule !== (a.module || '') || newSub !== (a.submenu || '')){
        updates.push({ id: a.id, module: newModule, submenu: newSub });
      }
    });
  });
  return updates;
}

/** How many guides use a module / a submenu (for delete protection). */
export function usage(articles, product, moduleName, subName){
  return (articles || []).filter(a => a.product === product && lc(a.module) === lc(moduleName)
    && (subName == null || lc(a.submenu) === lc(subName))).length;
}
