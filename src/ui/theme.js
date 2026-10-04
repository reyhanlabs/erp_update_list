/**
 * Light / dark / auto theme
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { toast } from '../core/helpers.js';

/* ============================================================
   THEME MANAGER
   ============================================================ */
const ThemeManager = {
  STORAGE_KEY: 'zahir-theme',
  mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),
  getPreference(){ return localStorage.getItem(this.STORAGE_KEY) || 'auto'; },
  resolve(pref){ return pref === 'auto' ? (this.mediaQuery.matches ? 'dark' : 'light') : pref; },
  apply(pref){
    const resolved = this.resolve(pref);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-pref', pref);
    localStorage.setItem(this.STORAGE_KEY, pref);
    this.updateUI(pref);
  },
  updateUI(pref){
    document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('active', b.dataset.themeSet === pref));
  },
  init(){
    this.apply(this.getPreference());
    this.mediaQuery.addEventListener('change', ()=>{
      if(this.getPreference() === 'auto'){
        document.documentElement.setAttribute('data-theme', this.resolve('auto'));
      }
    });
    document.querySelectorAll('[data-theme-set]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        this.apply(btn.dataset.themeSet);
        toast(`Switched to ${btn.dataset.themeSet} theme`);
      });
    });
  }
};

export {
  ThemeManager
};
