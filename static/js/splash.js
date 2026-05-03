// ══════════════════════════════════════════════════════════════════════
// Il Mio Giardino — Logica dello splash screen
// ══════════════════════════════════════════════════════════════════════
// Questo file gestisce solo lo splash screen di apertura. È separato dal
// resto della logica dell'applicazione (giardino.js) perché:
//   1. Concettualmente è una preoccupazione indipendente — non dipende
//      da nessuna delle funzioni dell'app principale e nessuna funzione
//      dell'app principale lo richiama.
//   2. È piccolo e va eseguito subito, prima che l'app principale
//      inizi a caricarsi: tenerlo separato evita di doverlo aspettare
//      dietro al download del bundle JS più grande.
//   3. Lo script tag che lo carica è posizionato subito dopo l'elemento
//      <div id="splash-screen"> nell'HTML, così la funzione dismissSplash
//      è già definita quando il <div> ha il suo onclick="dismissSplash()".
//
// La funzione dismissSplash è esposta sul global scope (window) perché
// l'attributo onclick="..." nell'HTML risolve i nomi proprio cercando
// nel global scope.
// ══════════════════════════════════════════════════════════════════════

  // Logica dello splash screen.
  // Il dismissal è automatico dopo 2.5s dal load, ma l'utente può
  // anticipare tappando lo splash. Il flag _splashDismissed evita
  // chiamate doppie che produrrebbero transizioni glitch.
  let _splashDismissed = false;
  function dismissSplash() {
    if (_splashDismissed) return;
    _splashDismissed = true;
    const el = document.getElementById('splash-screen');
    if (!el) return;
    el.style.opacity = '0';
    // Rimuovo l'elemento dopo la transizione, così non occupa più
    // spazio nel DOM e non intercetta più click accidentali.
    setTimeout(() => el.remove(), 600);
  }
  window.addEventListener('load', () => {
    setTimeout(dismissSplash, 2500);
  });
