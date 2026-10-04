/**
 * Modal control & Add New
 * (split from the former monolithic src/app.js — v4.40.0)
 */
import { $ } from '../core/helpers.js';
import { currentView, switchView } from './navigation.js';
import { resetPlanForm } from '../features/plans/plans.js';
import { populatePlanDropdown, resetSummaryForm } from '../features/summaries.js';

/* ============================================================
   MODAL CONTROL
   ============================================================ */
function openModal(id){ $(id).classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeModal(id){ $(id).classList.remove('show'); document.body.style.overflow = ''; }

/* ============================================================
   ADD NEW
   ============================================================ */
function openAddModal(event){
  if(event) event.preventDefault();
  if(currentView === 'plans'){
    resetPlanForm();
    $('planModalTitle').textContent = 'Add Update Plan';
    openModal('planModal');
  } else if(currentView === 'summaries'){
    resetSummaryForm();
    $('summaryModalTitle').textContent = 'Add Summary';
    populatePlanDropdown();
    openModal('summaryModal');
  } else {
    switchView('plans');
    setTimeout(()=>{
      resetPlanForm();
      $('planModalTitle').textContent = 'Add Update Plan';
      openModal('planModal');
    }, 50);
  }
}

export {
  closeModal,
  openAddModal,
  openModal
};
