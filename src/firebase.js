/** Firebase init — requires firebase compat SDK on window */
export let auth = null;
export let db = null;

const firebaseConfig = {
  apiKey: "AIzaSyA9EXEDl79MzQkO4k181BH4SQPE6lOArGg",
  authDomain: "erpupdate-f0b18.firebaseapp.com",
  projectId: "erpupdate-f0b18",
  storageBucket: "erpupdate-f0b18.firebasestorage.app",
  messagingSenderId: "500016291571",
  appId: "1:500016291571:web:455e3a23ce8f8597142186",
  measurementId: "G-WNPME76HRK"
};

export function initFirebase(){
  if(typeof firebase === 'undefined'){
    throw new Error('Firebase SDK not loaded');
  }
  if(!firebase.apps || !firebase.apps.length){
    firebase.initializeApp(firebaseConfig);
  }
  auth = firebase.auth();
  db = firebase.firestore();
  // Also expose for any residual global access during migration
  window.__erpAuth = auth;
  window.__erpDb = db;
  return { auth, db };
}
