// ══════════════════════════════════════════════════════════════════════
// Il Mio Giardino — Logica principale dell'applicazione
// ══════════════════════════════════════════════════════════════════════
// Questo file contiene tutta la logica dell'applicazione: le chiamate
// API verso il server, la navigazione tra sezioni, la gestione delle
// piante e dei vasi, il calcolatore di fertirrigazione, l'integrazione
// con i sensori meteo, la generazione delle viste mensile/giornaliera/
// del diario, e l'inizializzazione complessiva.
//
// Il file è caricato come <script src="..."> alla fine del <body>,
// così quando lo script gira tutto l'HTML del documento è già stato
// parsato e gli elementi referenziati con document.getElementById
// esistono. Lo script NON è caricato come module: tutte le funzioni e
// le costanti dichiarate al top level finiscono nel global scope, così
// gli attributi onclick="..." e similari nell'HTML possono richiamarle
// per nome senza bisogno di import o di binding espliciti.
//
// L'organizzazione interna è per banner-commento "═══...═══" che
// suddividono il file in sezioni tematiche (API HELPERS, NAVIGATION,
// SCHEDE, VASI, ACQUA, MENSILE, GIORNI, DIARIO, METEO, PARAMS,
// PIANTE CUSTOM, ecc.). Per cercare una funzione, conviene usare il
// grep su nome o cercare il banner della sezione di pertinenza.
// ══════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// API HELPERS
// ══════════════════════════════════════════════════════════════════════
// Wrapper su fetch() che applica un timeout di default a tutte le chiamate API.
// Evita che il browser resti appeso se il server o Ecowitt si bloccano.
// Uso: apiFetch('/api/inventory') oppure apiFetch(url, {method:'POST', body:..., timeout:10000})
// Se il chiamante passa un signal proprio (es. AbortSignal.timeout(1200) per ping veloci),
// quello ha precedenza sul timeout di default.
async function apiFetch(url, options = {}) {
  if (options.signal) {
    // Il chiamante ha già un suo AbortSignal — lo rispettiamo
    return fetch(url, options);
  }
  const timeout = options.timeout || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {...options, signal: controller.signal});
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ══════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════
const sectionInited = {schede:false, mensile:false, giorni:false, diario:false, acqua:false, vasi:false, meteo:false, params:false};

function showSection(name) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+name).classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.toggle('active', t.dataset.sec===name));
  window.scrollTo(0,0);
  if (!sectionInited[name]) {
    if (name==='schede') sInitSchede();
    else if (name==='mensile') cInitMensile();
    else if (name==='giorni') gInitGiorni();
    else if (name==='diario') dInitDiario();
    else if (name==='acqua') wInitCalc();
    else if (name==='vasi') invInit();
    else if (name==='meteo') meteoInit();
    else if (name==='params') paramsInit();
    sectionInited[name] = true;
  }
  if (name==='diario') dRender();
  if (name==='meteo') meteoRefresh();
}

document.addEventListener('keydown', e => {
  if (e.key==='Escape') { sCloseDetail(); cCloseOverlay(); gClosePanel(); invCloseForm(); simClose(); cpCloseForm(); }
});

// ══════════════════════════════════════════════════════════════════════
// ① SCHEDE PIANTE
// ══════════════════════════════════════════════════════════════════════
// Le 26 piante native sono dichiarate qui come array mutabile (let) perché
// il sistema di piante custom le estende a runtime. La fusione avviene in
// loadCustomPlants() che fa push dei record creati a partire dal database.
// Le 26 piante native originali sono state rimosse: ora il giardino si
// popola esclusivamente con piante create dall'utente tramite il pannello
// "Le mie piante personalizzate". L'array resta dichiarato come let perché
// loadCustomPlants() lo riempie dinamicamente all'avvio leggendo dal
// database, e perché molte funzioni in giro per il file fanno reset con
// sPlants.length = 0 e poi push() dei record custom.
let sPlants = [];

// ── Helper: lookup pianta per id reale ─────────────────────────────────────
// Le 26 native hanno id 0-25 e fino al Passo 5 erano accessibili come
// sPlants[id] perché posizione coincideva con id. Le piante custom invece
// arrivano dal backend ordinate per nome e quindi posizione ≠ id.
//
// Questa funzione fa il lookup corretto cercando per id, indipendentemente
// dalla posizione. Va usata OVUNQUE si avesse prima sPlants[plantTypeIdx]
// dove plantTypeIdx è un id (perché ora la dropdown della sezione Vasi
// salva l'id reale invece dell'indice di posizione).
//
// Se non trova niente (per esempio perché la pianta è stata eliminata),
// ritorna null. Il chiamante deve verificare e gestire il caso difensivamente.
function getPlantById(id, list) {
  if (id === undefined || id === null) return null;
  const arr = list || sPlants;
  // Confronto con coercion (==) per gestire stringa vs numero, perché
  // a volte l'id arriva da DOM come stringa "26" e altre volte da DB come 26.
  return arr.find(p => p && p.id == id) || null;
}

const sTabDefs = [
  {key:"con",label:"Concimazione",fields:[{k:"periodo",l:"Periodo"},{k:"frequenza",l:"Frequenza"},{k:"concime",l:"Concime"},{k:"stop",l:"Stop"},{k:"note",l:"Note"}]},
  {key:"sub",label:"Substrato",fields:[{k:"terreno",l:"Terreno"},{k:"ph",l:"pH ideale"},{k:"vaso",l:"Vaso"},{k:"rinvaso",l:"Rinvaso"},{k:"vivo",l:"Terreno vivo"}]},
  {key:"esp",label:"Esposizione",fields:[{k:"luce",l:"Luce"},{k:"sole",l:"Sole diretto"},{k:"temperatura",l:"Temperatura"},{k:"umidita",l:"Umidità"}]},
  {key:"cur",label:"Cure",fields:[{k:"acqua",l:"Annaffiatura"},{k:"potatura",l:"Potatura"},{k:"parassiti",l:"Parassiti"},{k:"extra",l:"Da sapere"}]},
  {key:"bio",label:"BioBizz",fields:[{k:"prodotti",l:"Prodotti"},{k:"primavera",l:"Primavera"},{k:"estate",l:"Estate"},{k:"autunno",l:"Autunno/inverno"},{k:"rinvaso",l:"Al rinvaso"},{k:"note",l:"Note"}]}
];

function sInitSchede() { renderCards(sPlants); }

let sFilteredPlants = sPlants;

function renderCards(list) {
  sFilteredPlants = list;
  const grid = document.getElementById('s-grid');
  document.getElementById('s-count').textContent = list.length + (list.length===1?' pianta':' piante');
  // Ogni card è cliccabile e apre la scheda dettaglio (sOpenDetail). Sopra
  // l'icona della pianta inserisco due pulsanti azione (modifica/rimuovi)
  // posizionati in alto a destra con position:absolute. Il punto delicato
  // qui è il propagation handling: senza event.stopPropagation() un click
  // su un pulsante farebbe scattare ANCHE il click esterno della card
  // (l'evento risale dal pulsante alla card per via dell'event bubbling),
  // aprendo per sbaglio il dialog dei dettagli oltre all'azione richiesta.
  // Lo stop sulla propagazione garantisce che ogni pulsante esegua solo
  // la sua azione, mentre il resto della card continua ad aprire il
  // dettaglio come prima.
  grid.innerHTML = list.map((p,i)=>`
    <div class="plant-card" onclick="sOpenDetail(${i})" style="position:relative">
      <div class="plant-card-actions" style="position:absolute;top:8px;right:8px;display:flex;gap:4px;z-index:2">
        <button onclick="event.stopPropagation();cpOpenEditForm(${p.id})"
                title="Modifica"
                style="border:none;background:rgba(255,255,255,0.85);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background 0.15s">
          ✏️
        </button>
        <button onclick="event.stopPropagation();cpDeletePlantById(${p.id})"
                title="Rimuovi"
                style="border:none;background:rgba(255,255,255,0.85);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background 0.15s">
          🗑️
        </button>
      </div>
      <div class="card-header">
        <div class="plant-icon">${p.icon}</div>
        <div>
          <div class="card-title">${p.name}${p.isNew?'<span class="new-badge">nuovo</span>':''}</div>
          <div class="card-subtitle">${p.latin||'Pianta ornamentale'}</div>
        </div>
      </div>
      <div class="pill-row">${p.tags.map((t,ti)=>`<span class="pill ${p.tc[ti]}">${t}</span>`).join('')}</div>
      <p class="toggle-hint">tocca per dettagli</p>
    </div>`).join('');
}

// Riferimento alla pianta attualmente aperta nel pannello dettaglio. Lo
// salvo in una variabile di modulo perché tre funzioni (sMenuEdit,
// sMenuDelete, e l'eventuale chiusura inerziale del menù via clic
// esterno) hanno bisogno di sapere su quale pianta stanno agendo, e
// passare l'id come argomento dei pulsanti onclick="..." sarebbe
// possibile ma più rumoroso da leggere nell'HTML. Resta null quando
// l'overlay è chiuso.
let sCurrentPlant = null;

function sOpenDetail(idx) {
  const p = sFilteredPlants[idx];
  if (!p) return;
  sCurrentPlant = p;
  document.getElementById('s-panel-icon').textContent = p.icon;
  document.getElementById('s-panel-title').textContent = p.name;
  document.getElementById('s-panel-latin').textContent = p.latin || 'Pianta ornamentale';
  document.getElementById('s-panel-tags').innerHTML = p.tags.map((t,i)=>`<span class="pill ${p.tc[i]}">${t}</span>`).join('');
  // Tabs
  const tabsEl = document.getElementById('s-panel-tabs');
  tabsEl.innerHTML = sTabDefs.map((t,i)=>`<button class="tab-btn${i===0?' active':''}" onclick="sSwitchTab(this,'${t.key}')">${t.label}</button>`).join('');
  // Content
  const body = document.getElementById('s-panel-body');
  body.innerHTML = sTabDefs.map((t,i)=>`<div class="tab-content${i===0?' active':''}" data-tab="${t.key}">${t.fields.map(f=>`<div class="detail-row"><span class="detail-label">${f.l}</span><span class="detail-value">${p[t.key][f.k]||'—'}</span></div>`).join('')}</div>`).join('');
  // Visibilità del menù kebab: storicamente era condizionata al flag
  // p.isCustom perché le 26 piante native non erano modificabili. Adesso
  // che tutte le piante sono record del database e tutte sono modificabili
  // allo stesso modo, il menu è sempre visibile. Il dropdown viene tenuto
  // chiuso ogni volta che si apre una nuova scheda, così se l'utente
  // l'aveva lasciato aperto in una visualizzazione precedente non si
  // trova lo stato sporco.
  const menuWrap = document.getElementById('s-menu-wrap');
  if (menuWrap) {
    menuWrap.style.display = 'block';
    document.getElementById('s-menu-dropdown').style.display = 'none';
  }
  document.getElementById('s-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function sCloseDetail() {
  document.getElementById('s-overlay').classList.remove('open');
  document.body.style.overflow = '';
  sCurrentPlant = null;
  // Chiudo anche il dropdown del menù, nel caso fosse aperto: senza questo,
  // alla prossima apertura della scheda il menù riapparirebbe già esteso.
  const dd = document.getElementById('s-menu-dropdown');
  if (dd) dd.style.display = 'none';
}

// ── Menù modifica/elimina della scheda ─────────────────────────────────
// Il pulsante kebab nell'header della scheda (visibile solo per le piante
// custom) apre un piccolo dropdown con due voci. Le tre funzioni qui sotto
// gestiscono apertura, ramo "Modifica" e ramo "Elimina".

// Apre o chiude il dropdown. Lo stop della propagazione è importante:
// senza, il listener globale qui sotto (che chiude il menù al click
// fuori) intercetterebbe lo stesso evento e lo richiuderebbe subito.
function sToggleMenu(event) {
  if (event) event.stopPropagation();
  const dd = document.getElementById('s-menu-dropdown');
  if (!dd) return;
  dd.style.display = (dd.style.display === 'none' || !dd.style.display) ? 'block' : 'none';
}

// Listener globale per chiudere il menù quando l'utente clicca da
// qualsiasi altra parte. È il pattern standard per i dropdown nativi:
// dietro le quinte, ogni click sul documento controlla se è avvenuto
// dentro il wrapper del menù; se no, lo chiude. Lo aggiungo una sola
// volta all'avvio e resta dormiente fino a che l'utente non interagisce.
document.addEventListener('click', (event) => {
  const wrap = document.getElementById('s-menu-wrap');
  const dd = document.getElementById('s-menu-dropdown');
  if (!wrap || !dd) return;
  if (dd.style.display === 'block' && !wrap.contains(event.target)) {
    dd.style.display = 'none';
  }
});

// "Modifica": chiudo la scheda dettaglio e apro il form di edit caricando
// la pianta dal cache. Senza chiudere prima la scheda, il nuovo overlay
// si sovrapporrebbe al vecchio creando una pila visivamente confusa.
//
// La guardia su sCurrentPlant.isCustom è stata rimossa: storicamente
// proteggeva il sistema dal modificare le 26 piante "native" che vivevano
// cablate nel codice e non erano editabili. Oggi tutte le piante vivono
// nel database e sono editabili allo stesso modo.
function sMenuEdit() {
  if (!sCurrentPlant) return;
  const id = sCurrentPlant.id;
  sCloseDetail();
  // Piccolo timeout per permettere alla transizione di chiusura della
  // scheda di partire prima che apriamo il form, così l'utente percepisce
  // un passaggio più ordinato. 50ms sono sotto la soglia di percepibilità
  // ma sufficienti perché il browser pianifichi il render frame.
  setTimeout(() => {
    if (typeof cpOpenEditForm === 'function') cpOpenEditForm(id);
  }, 50);
}

// "Elimina": chiede conferma, poi DELETE all'API. Uso confirm() del
// browser perché è semplice, accessibile, e per un'azione distruttiva
// rara la mancanza di styling personalizzato è un piccolo prezzo da
// pagare a fronte del fatto che il dialogo è "ovviamente serio". Per
// dare un po' di contesto in più alla domanda, riporto il nome della
// pianta nel testo della conferma — riduce drasticamente la possibilità
// che l'utente cancelli la pianta sbagliata per disattenzione.
//
// La guardia su sCurrentPlant.isCustom è stata rimossa per le stesse
// ragioni storiche di sMenuEdit: oggi tutte le piante sono cancellabili.
async function sMenuDelete() {
  if (!sCurrentPlant) return;
  const id = sCurrentPlant.id;
  const name = sCurrentPlant.name;
  if (!confirm(`Eliminare definitivamente "${name}"?\n\nL'operazione non è reversibile.`)) return;
  try {
    const res = await apiFetch(`/api/plants/${id}`, { method: 'DELETE' });
    if (res.status === 409) {
      // Eliminazione bloccata: ci sono dipendenze (vasi nell'inventario o
      // voci di diario). Mostro la lista come fa cpDeletePlantById, in
      // modo da dare all'utente il dettaglio di cosa è bloccante e quindi
      // poter sciogliere il blocco autonomamente.
      const data = await res.json();
      const pots = data.blocking?.pots || [];
      const diaryCount = data.blocking?.diary_entries || 0;
      let msg = `Non posso eliminare "${name}" perché è ancora in uso.\n\n`;
      if (pots.length) {
        msg += `🪴 Vasi che la usano (${pots.length}):\n`;
        pots.slice(0, 5).forEach(p => msg += `  • ${p.nickname || 'senza nome'} (id ${p.id})\n`);
        if (pots.length > 5) msg += `  ... e altri ${pots.length - 5}\n`;
        msg += '\n';
      }
      if (diaryCount > 0) {
        msg += `📓 Voci diario che la nominano: ${diaryCount}\n\n`;
      }
      msg += `Per eliminare questa pianta, prima rimuovi i vasi associati dalla sezione Vasi.\nLe voci diario possono restare: si riferiranno solo al nome storico.`;
      alert(msg);
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({error: 'Errore sconosciuto'}));
      // Riuso il toast del modulo custom-plants se è disponibile, così il
      // feedback ha lo stesso look-and-feel del resto delle azioni.
      if (typeof cpToast === 'function') cpToast(err.error || 'Errore nell\'eliminazione', 'error');
      else alert('Errore nell\'eliminazione: ' + (err.error || 'sconosciuto'));
      return;
    }
    if (typeof cpToast === 'function') cpToast(`✅ ${name} eliminata`, 'success');
    sCloseDetail();
    // Ricarico le piante: la fusione idempotente di loadCustomPlants
    // aggiorna la cache e le strutture in memoria, e poi re-inizializzo
    // la sezione Schede così la card sparisce subito senza che l'utente
    // debba navigare avanti e indietro.
    if (typeof loadCustomPlants === 'function') await loadCustomPlants();
    if (typeof sInitSchede === 'function') sInitSchede();
  } catch (e) {
    alert('Errore di rete: ' + e.message);
  }
}

function sSwitchTab(btn, key) {
  const panel = document.getElementById('s-overlay');
  panel.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  panel.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  panel.querySelector('[data-tab="'+key+'"]').classList.add('active');
}

function sFilter(q) {
  const l = q.toLowerCase();
  renderCards(sPlants.filter(p=>
    p.name.toLowerCase().includes(l)||p.latin.toLowerCase().includes(l)||
    p.tags.some(t=>t.toLowerCase().includes(l))||
    ['con','sub','esp','cur'].flatMap(k=>Object.values(p[k])).join(' ').toLowerCase().includes(l)
  ));
}

// ══════════════════════════════════════════════════════════════════════
// ② CALENDARIO MENSILE
// ══════════════════════════════════════════════════════════════════════
// cPlants è esteso a runtime con le piante custom (vedi loadCustomPlants).
// Per ogni pianta custom viene generato un record con months[] e notes{}
// dedotti dai fert_months oppure prelevati dalle colonne monthly_states e
// monthly_notes se l'utente ha compilato il calendario manualmente.
// Calendario mensile — popolato dinamicamente da loadCustomPlants() a
// partire dai dati monthly_states/monthly_notes salvati per ogni pianta.
// Le 26 native originali avevano questo array pre-popolato a mano; oggi
// nasce vuoto e viene riempito dal sistema custom.
let cPlants = [];

const cMonths = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const cMonthsShort = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const cSeasons = ["Inverno","Inverno","Primavera","Primavera","Primavera","Estate","Estate","Estate","Autunno","Autunno","Autunno","Inverno"];
function cSC(s){return["stop","active","reduce","special"][s]}
function cSL(s){return["Riposo","Attiva","Ridotta","Attenzione"][s]}

function cInitMensile() {
  const barLabels = document.getElementById('c-bar-labels');
  cMonthsShort.forEach(m=>{const el=document.createElement('div');el.className='bar-month-label';el.textContent=m;barLabels.appendChild(el)});
  const yearBars = document.getElementById('c-year-bars');
  cPlants.forEach(p=>{
    const row=document.createElement('div');row.className='bar-plant-row';
    const label=document.createElement('div');label.className='bar-plant-label';
    // Per le custom aggiungo un piccolo indicatore visivo sottile accanto al nome.
    // Lo rendo discreto (font piccolo, colore tenue) per non distrarre dalla griglia.
    label.innerHTML = `${p.icon} ${cpEscape(p.name)}`;
    row.appendChild(label);
    const bars=document.createElement('div');bars.className='bar-months';
    p.months.forEach((s,mi)=>{const bar=document.createElement('div');bar.className='bar-month '+cSC(s);bar.title=cMonths[mi]+': '+cSL(s);bars.appendChild(bar)});
    row.appendChild(bars);yearBars.appendChild(row);
  });
  const grid = document.getElementById('c-months-grid');
  cMonths.forEach((month,mi)=>{
    const card=document.createElement('div');card.className='month-card';card.onclick=()=>cOpenMonthDetail(mi);
    const header=document.createElement('div');header.className='month-header';
    header.innerHTML=`<span class="month-name">${month}</span><span class="month-season">${cSeasons[mi]}</span>`;
    card.appendChild(header);
    const body=document.createElement('div');body.className='month-body';
    const active=cPlants.filter(p=>p.months[mi]>0);
    if(!active.length){body.innerHTML='<div class="empty-month">Riposo per tutte le piante</div>';}
    else{active.forEach(p=>{const s=p.months[mi];const row=document.createElement('div');row.className='plant-row';row.innerHTML=`<span class="plant-icon-sm">${p.icon}</span><span class="plant-name-sm">${cpEscape(p.name)}</span><span class="status-badge badge-${cSC(s)}">${cSL(s)}</span>`;body.appendChild(row)});}
    card.appendChild(body);grid.appendChild(card);
  });
}

function cOpenMonthDetail(mi) {
  document.getElementById('c-panel-title').textContent = cMonths[mi]+' · '+cSeasons[mi];
  const active=cPlants.filter(p=>p.months[mi]===1),reduce=cPlants.filter(p=>p.months[mi]===2),special=cPlants.filter(p=>p.months[mi]===3),stop=cPlants.filter(p=>p.months[mi]===0);
  function rg(list,status,label){
    if(!list.length)return'';
    let out=`<div class="detail-section-title">${label}</div>`;
    list.forEach(p=>{
      const note=p.notes[mi+1]||'';
      // Pulsante modifica in fondo alla riga: apre il form di edit della
      // pianta. Adesso che tutte le piante sono editabili allo stesso modo
      // (la distinzione native/custom è stata abolita), il pulsante è
      // sempre presente. Uso event.stopPropagation perché la riga ha
      // altri handler legati alla card e non vogliamo scatenarli quando
      // il click è destinato al pulsante.
      const editBtn = `<button onclick="event.stopPropagation();cCloseOverlay();cpOpenEditForm(${p.id})" style="margin-top:6px;padding:4px 10px;font-size:0.85em;border:1px solid #b0a070;background:#fff8e0;border-radius:6px;cursor:pointer;color:#5a4a10">✏️ Modifica</button>`;
      out+=`<div class="plant-detail-row ${status}"><div class="pdr-icon">${p.icon}</div><div class="pdr-content"><div class="pdr-name">${cpEscape(p.name)}</div>${p.latin?`<div class="pdr-latin">${cpEscape(p.latin)}</div>`:''}<div class="pdr-info"><strong>Concime:</strong> ${cpEscape(p.concime)}<br><strong>Frequenza:</strong> ${cpEscape(p.freq)}${note?'<br>'+cpEscape(note):''}</div>${editBtn}</div><span class="pdr-badge ${status}">${cSL({active:1,reduce:2,special:3,stop:0}[status])}</span></div>`;
    });
    return out;
  }
  document.getElementById('c-panel-body').innerHTML = rg(special,'special','⚠️ Attenzione speciale')+rg(active,'active','✅ Concimazione attiva')+rg(reduce,'reduce','🔽 Dose ridotta')+rg(stop,'stop','⏸ In riposo');
  document.getElementById('c-overlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function cCloseOverlay(){document.getElementById('c-overlay').classList.remove('open');document.body.style.overflow='';}
function cCloseDetail(e){if(e.target===document.getElementById('c-overlay'))cCloseOverlay();}

// ══════════════════════════════════════════════════════════════════════
// ③ CALENDARIO GIORNI
// ══════════════════════════════════════════════════════════════════════
const gTODAY = new Date();
// gPlants è esteso a runtime con le piante custom (vedi loadCustomPlants).
// Per ogni pianta custom viene generato un record con schedules basato sui
// fert_months e fert_interval salvati nel database.
// Calendario fertilizzazione — popolato dinamicamente da loadCustomPlants()
// a partire dai parametri fert_months/fert_interval di ogni pianta custom.
// Le 26 native originali avevano questo array pre-popolato; oggi nasce
// vuoto e viene riempito dal sistema custom.
let gPlants = [];

let gCurrentMonth = gTODAY.getMonth();
let gCurrentYear  = gTODAY.getFullYear();
let gHiddenPlants = new Set();

// Helper: ritorna true se l'evento appartiene a una pianta nascosta nella legenda.
// Funziona sia con eventi per-specie (id === plant.id) sia con eventi per-vaso
// generati da expandEventByPots (id virtuale, ma _origPlantId punta alla specie).
function gIsHiddenEvent(ev) {
  const origId = ev.plant._origPlantId;
  if (origId !== undefined && gHiddenPlants.has(origId)) return true;
  return gHiddenPlants.has(ev.plant.id);
}
const gDateMap = {};
const gMonthNames = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const gWeekdays = ["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"];

function gDateKey(d){return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();}
function gCompKey(d,id){return'fert_'+gDateKey(d)+'_'+id;}
function gIsDone(d,id){try{return localStorage.getItem(gCompKey(d,id))==='1';}catch(e){return false;}}
function gSetDone(d,id,v){try{if(v)localStorage.setItem(gCompKey(d,id),'1');else localStorage.removeItem(gCompKey(d,id));}catch(e){}}
// ── Auto-diary helper ──────────────────────────────────────────────
function _autoDiary(date, plantName, op, noteText) {
  const yyyy=date.getFullYear(), mm=String(date.getMonth()+1).padStart(2,'0'), dd=String(date.getDate()).padStart(2,'0');
  dAddEntry({date:`${yyyy}-${mm}-${dd}`, plant:plantName, op:op, note:noteText, auto:true});
}

function gToggleDone(dy,dm,dd,pid){
  const date=new Date(dy,dm,dd);
  const wasDone=gIsDone(date,pid);
  gSetDone(date,pid,!wasDone);
  if(!wasDone){
    const ev=(gDateMap[gDateKey(date)]||[]).find(e=>e.plant.id===pid);
    if(ev) _autoDiary(date, ev.plant.name, 'concimazione', '📆 '+ev.plant.concime+(ev.note?' — '+ev.note:''));
  }
  gRenderCalendar();
  if(document.getElementById('g-overlay').classList.contains('open')){
    const k=gDateKey(date);
    const fe=(gFilter==='all'||gFilter==='fert')?(gDateMap[k]||[]).filter(e=>!gIsHiddenEvent(e)):[];
    const be=(gFilter==='all'||gFilter==='biobizz')?(bbDateMap[k]||[]).filter(e=>!bbHiddenProds.has(e.prod)):[];
    const te=(gFilter==='all'||gFilter==='tratt')?(trDateMap[k]||[]).filter(e=>!trHiddenProds.has(e.prod)):[];
    gOpenDay(date,fe,be,te);
  }
}

function gGenerateDates(plant) {
  const dates=[];const yearStart=new Date(2026,0,1);const yearEnd=new Date(2026,11,31);
  plant.schedules.forEach(sched=>{
    let cursor=new Date(plant.startDate);
    while(cursor>yearStart)cursor=new Date(cursor-sched.interval*86400000);
    while(cursor<=yearEnd){
      const m=cursor.getMonth()+1;
      if(sched.months.includes(m)&&cursor>=yearStart)dates.push({date:new Date(cursor),note:sched.note||null});
      cursor=new Date(cursor.getTime()+sched.interval*86400000);
    }
  });
  const seen=new Set();
  return dates.filter(d=>{const k=d.date.toDateString();if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>a.date-b.date);
}

// Filter state: 'all' | 'fert' | 'biobizz'
let gFilter = 'all';

function gSetFilter(f){
  gFilter = f;
  ['all','fert','biobizz','tratt','acqua'].forEach(k=>{
    const btn=document.getElementById('gf-'+k);
    if(btn) btn.style.background = k===f ? 'var(--text)' : '';
    if(btn) btn.style.color = k===f ? '#fff' : '';
    if(btn) btn.style.borderColor = k===f ? 'var(--text)' : '';
  });
  const show=(id,vis)=>{const el=document.getElementById(id);if(el)el.style.display=vis?'block':'none';};
  show('g-legend-wrap',  f==='all'||f==='fert');
  show('bb-legend-wrap', f==='all'||f==='biobizz');
  show('tr-legend-wrap', f==='all'||f==='tratt');
  show('wa-legend-wrap', f==='all'||f==='acqua');
  gRenderCalendar();
}

// ──────────────────────────────────────────────────────────────────────
// EXPAND EVENT BY POTS — utility per generare eventi calendario per-vaso
// ──────────────────────────────────────────────────────────────────────
// Dato un evento per-specie (fertirrigazione, BioBizz, trattamento), espande
// in N eventi per-vaso usando l'inventario. Se la specie non ha vasi
// registrati, ritorna un singolo evento equivalente all'originale.
//
// L'output ha id virtuali "1000 + item.id" identici al pattern già usato
// dalle annaffiature predittive — così le spunte e i toggle restano coerenti.
//
// Parametri:
//   plant      = oggetto pianta (gPlants/bbPlants/trPlants), serve id e icona
//   baseEvent  = oggetto evento originale (può contenere note, sched, prod)
//   inv        = array dell'inventario già caricato (passato esternamente per
//                evitare invLoad() nel loop, costoso con DB)
function expandEventByPots(plant, baseEvent, inv) {
  const pots = inv.filter(it => it.plantTypeIdx === plant.id);
  if (!pots.length) {
    // Specie senza vasi: comportamento legacy invariato
    return [baseEvent];
  }
  // Specie con vasi: un evento per ogni vaso
  return pots.map((pot, idx) => {
    const virtualId = 1000 + pot.id;
    const displayName = pot.nickname && pot.nickname.trim()
      ? pot.nickname
      : (pots.length > 1 ? `${plant.name} #${idx + 1}` : plant.name);
    return {
      ...baseEvent,
      plant: {
        ...plant,
        id: virtualId,                  // ID virtuale per spunte distinte
        name: displayName,              // Nickname o "Vinca #1"
        _origPlantId: plant.id,         // Ref alla specie originale (per toggle leggenda)
        _potRef: pot.id,                // Ref al vaso reale
      },
      _potItem: pot,                    // Oggetto vaso completo (per dosi calcolate)
    };
  });
}

function gInitGiorni() {
  // Carica una volta sola l'inventario per tutte le espansioni per-vaso
  const _inv = (typeof invLoad === 'function') ? invLoad() : [];

  // Build fert date map
  gPlants.forEach(p=>{
    p._dates=gGenerateDates(p);
    p._dates.forEach(d=>{
      const key=gDateKey(d.date);
      if(!gDateMap[key])gDateMap[key]=[];
      const baseEv = {plant:p,note:d.note};
      expandEventByPots(p, baseEv, _inv).forEach(ev => gDateMap[key].push(ev));
    });
  });
  // Build BioBizz date map
  bbPlants.forEach(p=>{
    p.schedules.forEach(sched=>{
      const yearStart=new Date(2026,0,1),yearEnd=new Date(2026,11,31);
      let cursor=new Date(sched.start);
      while(cursor>yearStart)cursor=new Date(cursor-sched.interval*86400000);
      while(cursor<=yearEnd){
        const m=cursor.getMonth()+1;
        if(sched.months.includes(m)&&cursor>=yearStart){
          const k=gDateKey(cursor);
          if(!bbDateMap[k])bbDateMap[k]=[];
          const baseEv = {plant:p,sched,prod:sched.prod};
          expandEventByPots(p, baseEv, _inv).forEach(ev => bbDateMap[k].push(ev));
        }
        cursor=new Date(cursor.getTime()+sched.interval*86400000);
      }
    });
    p._bbDates=Object.entries(bbDateMap)
      .filter(([,evs])=>evs.some(e=>e.plant._origPlantId===p.id || e.plant.id===p.id))
      .map(([k])=>{const[y,m,d]=k.split('-');return new Date(+y,+m-1,+d);})
      .sort((a,b)=>a-b);
  });
  // Plant legend (fertilizzazioni)
  // Svuoto il contenitore prima del loop di append. Senza questo, una
  // seconda chiamata a gInitGiorni — che oggi può accadere quando
  // loadCustomPlants invalida sectionInited dopo aver ricaricato i dati
  // dal backend — accoderebbe i chip nuovi a quelli vecchi senza
  // sostituirli, raddoppiando visivamente la legenda. Lo svuotamento
  // rende la funzione idempotente, che è la proprietà che ci aspettiamo.
  const legend=document.getElementById('g-legend');
  legend.innerHTML='';
  gPlants.forEach(p=>{
    const item=document.createElement('div');
    item.className='g-legend-item';
    item.id='gl-'+p.id;
    // Tooltip nativo HTML: il browser mostra il nome al hover (desktop)
    // e al long-press (mobile). Lo manteniamo anche se il nome è già
    // visibile come testo: serve da fallback per il caso in cui il
    // chip venga troncato per via di nomi molto lunghi (max-width nel
    // CSS) o di layout stretti su mobile.
    item.title=p.name;
    item.innerHTML=`<div class="g-legend-dot" style="background:${p.color}"></div>${p.icon} ${p.name}`;
    item.onclick=()=>gTogglePlant(p.id);
    legend.appendChild(item);
  });
  // BioBizz product legend
  // Sui prodotti BioBizz manteniamo la dicitura completa "Bio·Grow",
  // "CalMag" eccetera invece di solo emoji. Sono pochi (sette) e le
  // sigle dei nomi commerciali non sono universalmente note: il rischio
  // di non saper distinguere a colpo d'occhio è alto se diventano solo
  // pittogrammi astratti. Ridurre questi chip darebbe poca compattezza
  // a fronte di una perdita di chiarezza.
  const pl=document.getElementById('bb-prod-legend');
  pl.innerHTML='';
  Object.entries(BB_PRODUCTS).forEach(([k,p])=>{
    const c=document.createElement('div');c.className='bb-prod-chip';c.id='bpc-'+k;
    c.style.background=p.color;c.textContent=p.label;
    c.onclick=()=>{if(bbHiddenProds.has(k))bbHiddenProds.delete(k);else bbHiddenProds.add(k);c.classList.toggle('hidden');gRenderCalendar();};
    pl.appendChild(c);
  });
  // Build Treatment date map
  trPlants.forEach(p=>{
    p.schedules.forEach(sched=>{
      const yearStart=new Date(2026,0,1),yearEnd=new Date(2026,11,31);
      let cursor=new Date(sched.start);
      while(cursor>yearStart)cursor=new Date(cursor-sched.interval*86400000);
      while(cursor<=yearEnd){
        const m=cursor.getMonth()+1;
        if(sched.months.includes(m)&&cursor>=yearStart){
          const k=gDateKey(cursor);
          if(!trDateMap[k])trDateMap[k]=[];
          const baseEv = {plant:p,sched,prod:sched.prod};
          expandEventByPots(p, baseEv, _inv).forEach(ev => trDateMap[k].push(ev));
        }
        cursor=new Date(cursor.getTime()+sched.interval*86400000);
      }
    });
    p._trDates=Object.entries(trDateMap)
      .filter(([,evs])=>evs.some(e=>e.plant._origPlantId===p.id || e.plant.id===p.id))
      .map(([k])=>{const[y,m,d]=k.split('-');return new Date(+y,+m-1,+d);})
      .sort((a,b)=>a-b);
  });
  // Treatment product legend (stessa filosofia dei BioBizz: pochi
  // prodotti specifici con etichette non auto-esplicative, manteniamo
  // l'etichetta completa).
  const tl=document.getElementById('tr-prod-legend');
  tl.innerHTML='';
  Object.entries(TR_PRODUCTS).forEach(([k,p])=>{
    const c=document.createElement('div');c.className='tr-prod-chip';c.id='tpc-'+k;
    c.style.background=p.color;c.innerHTML='<div class="tr-diamond"></div>'+p.label;
    c.onclick=()=>{if(trHiddenProds.has(k))trHiddenProds.delete(k);else trHiddenProds.add(k);c.classList.toggle('hidden');gRenderCalendar();};
    tl.appendChild(c);
  });
  // Build Watering date map
  waPlants.forEach(p=>{
    p.schedules.forEach(sched=>{
      const yearStart=new Date(2026,0,1),yearEnd=new Date(2026,11,31);
      const startDate=new Date(2026,sched.months[0]-1,2);
      let cursor=new Date(startDate);
      while(cursor>yearStart)cursor=new Date(cursor-sched.interval*86400000);
      while(cursor<=yearEnd){
        const m=cursor.getMonth()+1;
        if(sched.months.includes(m)&&cursor>=yearStart){
          const k=gDateKey(cursor);
          if(!waDateMap[k])waDateMap[k]=[];
          if(!waDateMap[k].some(e=>e.plant.id===p.id))
            waDateMap[k].push({plant:p,note:sched.note});
        }
        cursor=new Date(cursor.getTime()+sched.interval*86400000);
      }
    });
    p._waDates=Object.entries(waDateMap)
      .filter(([,evs])=>evs.some(e=>e.plant.id===p.id))
      .map(([k])=>{const[y,m,d]=k.split('-');return new Date(+y,+m-1,+d);})
      .sort((a,b)=>a-b);
  });

  // ── Annaffiature predittive da simulazione (per vasi nell'inventario) ──
  if (PARAMS.useSimScheduling !== false) {
    buildSimWateringSchedule();
  }
  // Watering plant legend
  // Stessa logica della legenda fertilizzazioni: pulisco prima del loop
  // per essere idempotente, e mostro icona + nome con tooltip come
  // fallback. Il dot ha forma a goccia (vedi CSS .wa-legend-dot)
  // per richiamare il tema acqua, distinto dal cerchietto delle
  // fertilizzazioni.
  const wl=document.getElementById('wa-legend');
  wl.innerHTML='';
  waPlants.forEach(p=>{
    const item=document.createElement('div');
    item.className='wa-legend-item';
    item.id='wl-'+p.id;
    item.title=p.name;
    item.innerHTML='<div class="wa-legend-dot"></div>'+p.icon+' '+p.name;
    item.onclick=()=>{
      if(waHiddenPlants.has(p.id))waHiddenPlants.delete(p.id);
      else waHiddenPlants.add(p.id);
      item.classList.toggle('hidden-plant');
      // Aggiorno il counter dell'header e ridisegno il calendario.
      // Il counter va aggiornato qui perché il toggle dello stato è
      // inline (non passa per una funzione separata come gTogglePlant
      // delle fertilizzazioni), e senza questa chiamata il numero "X
      // visibili" nell'header resterebbe disallineato dallo stato reale.
      waUpdateLegendCounter();
      gRenderCalendar();
    };
    wl.appendChild(item);
  });
  // Inizializzo i due counter delle legende piante. Devono essere
  // chiamati DOPO che i chip sono stati popolati, perché leggono
  // gPlants.length e waPlants.length per calcolare il totale. Al primo
  // boot della pagina nessuna pianta è in gHiddenPlants, quindi i
  // counter mostreranno semplicemente "26 visibili" (o quante ne hai).
  gUpdateLegendCounter();
  waUpdateLegendCounter();
  // Build curative events from inventory diseases
  buildCurativeEvents();
  // Set initial filter button style
  gSetFilter('all');
}

function gTogglePlant(id){
  if(gHiddenPlants.has(id))gHiddenPlants.delete(id);else gHiddenPlants.add(id);
  document.getElementById('gl-'+id).classList.toggle('hidden-plant');
  gUpdateLegendCounter();
  gRenderCalendar();
}

// ── Toggle collapsabile della legenda ────────────────────────────────
// Tutte le legende del calendario (fertilizzazioni, annaffiature,
// BioBizz, trattamenti) sono collapsabili: hanno un wrapper con classe
// "legend-collapsible collapsed" all'avvio, e un click sull'header
// rimuove la classe "collapsed" facendole espandere. Click successivi
// la rimettono. La funzione è generica e accetta l'id del wrapper così
// può servire tutti e quattro i blocchi senza duplicare codice.
//
// Nota tecnica sull'animazione: l'altezza del body viene gestita da CSS
// usando max-height con valore alto (vedi giardino.css). Non serve qui
// in JavaScript leggere o impostare l'altezza esplicita: l'aggiunta o
// rimozione della classe basta a far partire la transizione.
function toggleLegend(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.classList.toggle('collapsed');
}

// ── Aggiornamento del counter "X visibili" / "X / Y visibili" ────────
// Il counter nell'header della legenda mostra quante piante sono
// attualmente attive (cioè non in gHiddenPlants). Se sono tutte attive,
// mostra solo "N visibili" (formato pulito); se ce ne sono di nascoste
// mostra "X / N visibili" per evidenziare lo stato di filtraggio
// parziale. Questo permette all'utente di sapere se ha filtri attivi
// anche con la legenda chiusa, senza doverla aprire per controllare.
function gUpdateLegendCounter() {
  const el = document.getElementById('g-legend-counter');
  if (!el) return;
  const total = gPlants.length;
  const visible = total - gHiddenPlants.size;
  el.textContent = (visible === total) ? `${total} visibili` : `${visible} / ${total} visibili`;
  // Aggiungo una classe "filtered" al counter quando c'è un filtro
  // attivo, così posso colorarlo diversamente in CSS (utile come
  // segnale visivo quando la legenda è chiusa).
  el.classList.toggle('filtered', visible !== total);
}

function waUpdateLegendCounter() {
  const el = document.getElementById('wa-legend-counter');
  if (!el) return;
  const total = waPlants.length;
  const visible = total - waHiddenPlants.size;
  el.textContent = (visible === total) ? `${total} visibili` : `${visible} / ${total} visibili`;
  el.classList.toggle('filtered', visible !== total);
}

// ── Selezione e deselezione in massa per la legenda fertilizzazioni ──
// gShowAllPlants svuota il set delle nascoste e ripulisce visivamente
// tutti i chip rimuovendo la classe 'hidden-plant'. gHideAllPlants fa
// l'operazione speculare: popola il set con tutti gli id e applica la
// classe a tutti i chip. In entrambi i casi si chiama gRenderCalendar
// una sola volta alla fine, invece di una volta per ogni pianta come
// farebbe un loop di gTogglePlant: ridisegnare ventisei volte il
// calendario sarebbe rallentamento gratuito.
function gShowAllPlants() {
  gHiddenPlants.clear();
  document.querySelectorAll('#g-legend .g-legend-item').forEach(el => {
    el.classList.remove('hidden-plant');
  });
  gUpdateLegendCounter();
  gRenderCalendar();
}

function gHideAllPlants() {
  // Aggiungo al set ogni id presente in gPlants, non solo quelli che
  // hanno chip visibili nel DOM. La struttura logica è gPlants come
  // sorgente di verità, mentre il DOM è la sua proiezione visiva: se
  // c'è una desincronizzazione (per qualche bug futuro), affidarsi alla
  // struttura logica garantisce comunque il comportamento atteso.
  gPlants.forEach(p => gHiddenPlants.add(p.id));
  document.querySelectorAll('#g-legend .g-legend-item').forEach(el => {
    el.classList.add('hidden-plant');
  });
  gUpdateLegendCounter();
  gRenderCalendar();
}

// ── Selezione e deselezione in massa per la legenda annaffiature ──
// Logica parallela alle due funzioni sopra ma per il set waHiddenPlants
// e i chip della legenda annaffiature. Tengo i due gruppi di funzioni
// separati perché i due filtri sono indipendenti: l'utente può nascondere
// alcune piante dalla vista fertilizzazioni e averle ancora visibili
// nella vista annaffiature, e viceversa.
function waShowAllPlants() {
  waHiddenPlants.clear();
  document.querySelectorAll('#wa-legend .wa-legend-item').forEach(el => {
    el.classList.remove('hidden-plant');
  });
  waUpdateLegendCounter();
  gRenderCalendar();
}

function waHideAllPlants() {
  waPlants.forEach(p => waHiddenPlants.add(p.id));
  document.querySelectorAll('#wa-legend .wa-legend-item').forEach(el => {
    el.classList.add('hidden-plant');
  });
  waUpdateLegendCounter();
  gRenderCalendar();
}

function gRenderStats(){
  const daysInMonth=new Date(gCurrentYear,gCurrentMonth+1,0).getDate();
  let eDays=0,fertTotal=0,bbTotal=0,trTotal=0;
  for(let d=1;d<=daysInMonth;d++){
    const date=new Date(gCurrentYear,gCurrentMonth,d);
    const fe=(gDateMap[gDateKey(date)]||[]).filter(e=>!gIsHiddenEvent(e));
    const be=(bbDateMap[gDateKey(date)]||[]).filter(e=>!bbHiddenProds.has(e.prod));
    const te=(trDateMap[gDateKey(date)]||[]).filter(e=>!trHiddenProds.has(e.prod));
    const showF=gFilter==='all'||gFilter==='fert';
    const showB=gFilter==='all'||gFilter==='biobizz';
    const showT=gFilter==='all'||gFilter==='tratt';
    const hasAny=(showF&&fe.length)||(showB&&be.length)||(showT&&te.length);
    if(hasAny)eDays++;
    fertTotal+=fe.length;bbTotal+=be.length;trTotal+=te.length;
  }
  let pills=`<div class="stat-pill">Giorni attivi: <strong>${eDays}</strong></div>`;
  if(gFilter==='all'||gFilter==='fert')pills+=`<div class="stat-pill">Fertilizzazioni: <strong>${fertTotal}</strong></div>`;
  if(gFilter==='all'||gFilter==='biobizz')pills+=`<div class="stat-pill">BioBizz: <strong>${bbTotal}</strong></div>`;
  if(gFilter==='all'||gFilter==='tratt')pills+=`<div class="stat-pill">Trattamenti: <strong>${trTotal}</strong></div>`;
  document.getElementById('g-stats').innerHTML=pills;
}

function gRenderCalendar(){
  document.getElementById('g-nav-title').textContent=gMonthNames[gCurrentMonth]+' '+gCurrentYear;
  gRenderStats();
  const grid=document.getElementById('g-days-grid');grid.innerHTML='';
  const firstDay=new Date(gCurrentYear,gCurrentMonth,1).getDay();
  const daysInMonth=new Date(gCurrentYear,gCurrentMonth+1,0).getDate();
  const prevDays=new Date(gCurrentYear,gCurrentMonth,0).getDate();
  for(let i=firstDay-1;i>=0;i--){const c=document.createElement('div');c.className='day-cell other-month';c.innerHTML=`<div class="day-num" style="opacity:.3">${prevDays-i}</div>`;grid.appendChild(c);}
  for(let d=1;d<=daysInMonth;d++){
    const date=new Date(gCurrentYear,gCurrentMonth,d);
    const key=gDateKey(date);
    const fertEvs=(gFilter==='all'||gFilter==='fert')?(gDateMap[key]||[]).filter(e=>!gIsHiddenEvent(e)):[];
    const bbEvs=(gFilter==='all'||gFilter==='biobizz')?(bbDateMap[key]||[]).filter(e=>!bbHiddenProds.has(e.prod)):[];
    const trEvs=(gFilter==='all'||gFilter==='tratt')?(trDateMap[key]||[]).filter(e=>!trHiddenProds.has(e.prod)):[];
    const cureEvs=(gFilter==='all'||gFilter==='tratt')?(cureDateMap[key]||[]):[];
    const waEvs=(gFilter==='all'||gFilter==='acqua')?(waDateMap[key]||[]).filter(e=>!waHiddenPlants.has(e.plant.id)):[];
    const hasAny=fertEvs.length||bbEvs.length||trEvs.length||cureEvs.length||waEvs.length;
    const isToday=date.toDateString()===gTODAY.toDateString();
    const cell=document.createElement('div');
    cell.className='day-cell'+(isToday?' today':'')+(hasAny?' has-events':'')+(date.getDay()===0?' sunday':'');
    const num=document.createElement('div');num.className='day-num';num.textContent=d;cell.appendChild(num);
    if(hasAny){
      const fertDone=fertEvs.every(e=>gIsDone(date,e.plant.id));
      const bbDone=bbEvs.every(e=>bbIsDone(date,e.plant.id,e.prod));
      const trDone=trEvs.every(e=>trIsDone(date,e.plant.id,e.prod));
      const cureDone=cureEvs.every(e=>cureIsDone(date,e.invId,e.disease.type));
      const waDone=waEvs.every(e=>waIsDone(date,e.plant.id));
      if((!fertEvs.length||fertDone)&&(!bbEvs.length||bbDone)&&(!trEvs.length||trDone)&&(!cureEvs.length||cureDone)&&(!waEvs.length||waDone))cell.classList.add('all-done');
      const dots=document.createElement('div');dots.className='dots-container';
      // Circular dots = fertilizzazioni
      fertEvs.slice(0,4).forEach(e=>{
        const done=gIsDone(date,e.plant.id);
        const dot=document.createElement('div');dot.className='plant-dot'+(done?' done':'');
        dot.style.background=e.plant.color;dot.title=e.plant.name;dot.textContent=done?'':e.plant.icon;
        dots.appendChild(dot);
      });
      // Square dots = BioBizz
      bbEvs.slice(0,4).forEach(e=>{
        const p=BB_PRODUCTS[e.prod];const done=bbIsDone(date,e.plant.id,e.prod);
        const dot=document.createElement('div');dot.className='prod-dot'+(done?' done':'');
        dot.style.background=p.color;dot.textContent=done?'':p.abbr;dot.title=e.plant.name+' '+p.label;
        dots.appendChild(dot);
      });
      // Diamond dots = trattamenti preventivi
      trEvs.slice(0,4).forEach(e=>{
        const p=TR_PRODUCTS[e.prod];const done=trIsDone(date,e.plant.id,e.prod);
        const dot=document.createElement('div');dot.className='treat-dot'+(done?' done':'');
        dot.style.background=p.color;dot.innerHTML=done?'':`<span class="treat-abbr">${p.abbr}</span>`;dot.title=e.plant.name+' '+p.label;
        dots.appendChild(dot);
      });
      // Red diamond dots = trattamenti curativi
      cureEvs.slice(0,3).forEach(e=>{
        const done=cureIsDone(date,e.invId,e.disease.type);
        const dot=document.createElement('div');dot.className='treat-dot'+(done?' done':'');
        dot.style.background=e.color;dot.innerHTML=done?'':`<span class="treat-abbr">!</span>`;dot.title=e.plant.name+' — '+e.diseaseLabel;
        dots.appendChild(dot);
      });
      // Drop dots = annaffiature
      waEvs.slice(0,3).forEach(e=>{
        const done=waIsDone(date,e.plant.id);
        const dot=document.createElement('div');dot.className='water-dot'+(done?' done':'');
        dot.innerHTML=done?'':'<span class="wa-abbr">'+e.plant.icon+'</span>';dot.title=e.plant.name+' annaffiatura';
        dots.appendChild(dot);
      });
      const overflow=(fertEvs.length>4?fertEvs.length-4:0)+(bbEvs.length>4?bbEvs.length-4:0)+(trEvs.length>4?trEvs.length-4:0)+(cureEvs.length>3?cureEvs.length-3:0)+(waEvs.length>3?waEvs.length-3:0);
      if(overflow){const m=document.createElement('div');m.className='dot-count';m.textContent='+'+overflow;dots.appendChild(m);}
      cell.appendChild(dots);
      cell.onclick=()=>gOpenDay(date,fertEvs,bbEvs,trEvs,waEvs);
    }
    grid.appendChild(cell);
  }
  const total=firstDay+daysInMonth;const rem=total%7===0?0:7-(total%7);
  for(let i=1;i<=rem;i++){const c=document.createElement('div');c.className='day-cell other-month';c.innerHTML=`<div class="day-num" style="opacity:.3">${i}</div>`;grid.appendChild(c);}
}

function gOpenDay(date, fertEvs, bbEvs, trEvs, waEvs) {
  if(!trEvs) trEvs=(gFilter==='all'||gFilter==='tratt')?(trDateMap[gDateKey(date)]||[]).filter(e=>!trHiddenProds.has(e.prod)):[];
  if(!waEvs) waEvs=(gFilter==='all'||gFilter==='acqua')?(waDateMap[gDateKey(date)]||[]).filter(e=>!waHiddenPlants.has(e.plant.id)):[];
  document.getElementById('g-panel-title').textContent=gWeekdays[date.getDay()]+' '+date.getDate()+' '+gMonthNames[date.getMonth()];
  const cureEvs2 = (cureDateMap[gDateKey(date)] || []);
  const allEvs=[...fertEvs,...bbEvs,...trEvs,...cureEvs2,...waEvs];
  const fertDone=fertEvs.filter(e=>gIsDone(date,e.plant.id)).length;
  const bbDone=bbEvs.filter(e=>bbIsDone(date,e.plant.id,e.prod)).length;
  const trDoneCount=trEvs.filter(e=>trIsDone(date,e.plant.id,e.prod)).length;
  const cureDoneCount=cureEvs2.filter(e=>cureIsDone(date,e.invId,e.disease.type)).length;
  const waDoneCount=waEvs.filter(e=>waIsDone(date,e.plant.id)).length;
  const totDone=fertDone+bbDone+trDoneCount+cureDoneCount+waDoneCount;
  document.getElementById('g-panel-subtitle').textContent=totDone+'/'+allEvs.length+' completate';
  const pct=allEvs.length?Math.round(totDone/allEvs.length*100):0;
  let html=`<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>`;

  // ── Sezione fertilizzazioni generali
  if(fertEvs.length){
    html+=`<div class="event-group"><div class="event-group-title" style="background:#4a4a4a">📆 Fertilizzazioni</div>`;
    fertEvs.forEach(e=>{
      const p=e.plant;const done=gIsDone(date,p.id);
      const origP = p._origPlantId !== undefined ? gPlants.find(gp => gp.id === p._origPlantId) : null;
      const concimeLabel = (origP && origP.concime) || p.concime;
      const nextSrc = origP ? origP._dates : p._dates;
      const next = nextSrc && nextSrc.find(d=>d.date>date);
      const nextStr=next?('Prossima: '+next.date.getDate()+' '+gMonthNames[next.date.getMonth()]):'Fine stagione';
      const dy=date.getFullYear(),dm=date.getMonth(),dd=date.getDate();
      const potInfo = e._potItem
        ? `<div style="font-size:10px;color:#2a5a8a;margin-top:2px">🪴 ${invGetDimsLabel(e._potItem)} · ${invGetVolFromItem(e._potItem).toFixed(1)}L</div>`
        : '';
      html+=`<div class="event-row${done?' done':''}">
        <div class="event-icon">${p.icon}</div>
        <div class="event-content">
          <div class="event-name">${p.name}</div>
          ${p.latin?`<div class="event-latin">${p.latin}</div>`:''}
          ${potInfo}
          <div class="event-info"><strong>Concime:</strong> ${concimeLabel}<br>${e.note?`<strong>Nota:</strong> ${e.note}<br>`:''}<span style="color:var(--muted)">${nextStr}</span></div>
        </div>
        <button class="check-btn${done?' done':''}" onclick="gToggleDone(${dy},${dm},${dd},${p.id})">✓</button>
      </div>`;
    });
    html+=`</div>`;
  }

  // ── Sezione BioBizz per prodotto
  if(bbEvs.length){
    const byProd={};
    bbEvs.forEach(e=>{if(!byProd[e.prod])byProd[e.prod]=[];byProd[e.prod].push(e);});
    Object.entries(byProd).forEach(([prod,evs])=>{
      const p=BB_PRODUCTS[prod];
      html+=`<div class="event-group"><div class="event-group-title" style="background:${p.color}">💚 ${p.label}</div>`;
      evs.forEach(e=>{
        const done=bbIsDone(date,e.plant.id,e.prod);
        const dy=date.getFullYear(),dm=date.getMonth(),dd=date.getDate();
        const nextDate=e.plant._bbDates && e.plant._bbDates.find(nd=>nd>date&&(bbDateMap[gDateKey(nd)]||[]).some(ev=>ev.plant.id===e.plant.id&&ev.prod===prod));
        const nextStr=nextDate?('Prossima: '+nextDate.getDate()+' '+gMonthNames[nextDate.getMonth()]):'Fine stagione';
        // Info vaso se evento espanso da inventario
        const potInfo = e._potItem
          ? `<div style="font-size:10px;color:#2a5a8a;margin-top:2px">🪴 ${invGetDimsLabel(e._potItem)} · ${invGetVolFromItem(e._potItem).toFixed(1)}L</div>`
          : '';
        html+=`<div class="event-row${done?' done':''}">
          <div class="event-icon">${e.plant.icon}</div>
          <div class="event-content">
            <div class="event-name">${e.plant.name}</div>
            ${e.plant.latin?`<div class="event-latin">${e.plant.latin}</div>`:''}
            ${potInfo}
            <div style="margin-bottom:3px"><span class="event-prod" style="background:${p.color}">${p.label}</span></div>
            <div class="event-info"><strong>Dose:</strong> ${e.sched.dose}${e.sched.note?`<br>${e.sched.note}`:''}
            <br><span style="color:var(--muted)">${nextStr}</span></div>
          </div>
          <button class="check-btn${done?' done':''}" style="${done?'background:'+p.color+';border-color:'+p.color:''}"
            onclick="bbToggleDone(${dy},${dm},${dd},${e.plant.id},'${prod}')">✓</button>
        </div>`;
      });
      html+=`</div>`;
    });
  }

  // ── Pulsante fertirrigazione
  if(fertEvs.length || bbEvs.length){
    // Salva i dati del giorno per il calcolo fertirrigazione
    window._fiCalEvts = {fertEvs, bbEvs, date};
    html+=`<div style="text-align:center;margin:12px 0">
      <button class="ctrl-btn primary" style="padding:10px 20px;font-size:13px;border-radius:10px" onclick="fiOpenFromCalendar()">🧪💧 Calcola fertirrigazione per oggi</button>
    </div>`;
  }

  // ── Sezione trattamenti preventivi
  if(trEvs.length){
    const byProd={};
    trEvs.forEach(e=>{if(!byProd[e.prod])byProd[e.prod]=[];byProd[e.prod].push(e);});
    Object.entries(byProd).forEach(([prod,evs])=>{
      const p=TR_PRODUCTS[prod];
      html+=`<div class="event-group"><div class="event-group-title" style="background:${p.color}">🛡️ ${p.label} <span style="font-size:10px;opacity:.8">(preventivo)</span></div>`;
      evs.forEach(e=>{
        const done=trIsDone(date,e.plant.id,e.prod);
        const dy=date.getFullYear(),dm=date.getMonth(),dd=date.getDate();
        const nextDate=e.plant._trDates && e.plant._trDates.find(nd=>nd>date&&(trDateMap[gDateKey(nd)]||[]).some(ev=>ev.plant.id===e.plant.id&&ev.prod===prod));
        const nextStr=nextDate?('Prossimo: '+nextDate.getDate()+' '+gMonthNames[nextDate.getMonth()]):'Fine stagione';
        const potInfo = e._potItem
          ? `<div style="font-size:10px;color:#2a5a8a;margin-top:2px">🪴 ${invGetDimsLabel(e._potItem)} · ${invGetVolFromItem(e._potItem).toFixed(1)}L</div>`
          : '';
        html+=`<div class="event-row${done?' done':''}">
          <div class="event-icon">${e.plant.icon}</div>
          <div class="event-content">
            <div class="event-name">${e.plant.name}</div>
            ${e.plant.latin?`<div class="event-latin">${e.plant.latin}</div>`:''}
            ${potInfo}
            <div style="margin-bottom:3px"><span class="event-prod" style="background:${p.color}">${p.label}</span></div>
            <div class="event-info"><strong>Dose:</strong> ${e.sched.dose}${e.sched.note?`<br>${e.sched.note}`:''}
            <br><span style="color:var(--muted)">${nextStr}</span></div>
          </div>
          <button class="check-btn${done?' done':''}" style="${done?'background:'+p.color+';border-color:'+p.color:''}"
            onclick="trToggleDone(${dy},${dm},${dd},${e.plant.id},'${prod}')">✓</button>
        </div>`;
      });
      html+=`</div>`;
    });
  }

  // ── Sezione trattamenti curativi (da malattie inventario)
  const cureEvs = (cureDateMap[gDateKey(date)] || []);
  if(cureEvs.length){
    // Raggruppa per malattia
    const byDisease = {};
    cureEvs.forEach(e => {
      const key = e.disease.type + '_' + e.invId;
      if (!byDisease[key]) byDisease[key] = {disease: e.disease, label: e.diseaseLabel, color: e.color, plant: e.plant, invId: e.invId, events: []};
      byDisease[key].events.push(e);
    });
    Object.values(byDisease).forEach(group => {
      html += `<div class="event-group"><div class="event-group-title" style="background:${group.color}">🔴 ${group.label} <span style="font-size:10px;opacity:.8">(curativo)</span></div>`;
      group.events.forEach(e => {
        const done = cureIsDone(date, e.invId, e.disease.type);
        const dy = date.getFullYear(), dm = date.getMonth(), dd = date.getDate();
        const prodLabel = TR_PRODUCTS[e.prod]?.label || CURE_EXTRA_PRODUCTS[e.prod]?.label || e.prod;
        html += `<div class="event-row${done ? ' done' : ''}">
          <div class="event-icon">${e.plant.icon}</div>
          <div class="event-content">
            <div class="event-name">${e.plant.name}</div>
            <div style="margin-bottom:3px">
              <span class="event-prod" style="background:${group.color}">${group.label}</span>
              <span style="font-size:9px;color:var(--muted);margin-left:4px">Passo ${e.step}/${e.totalSteps}</span>
            </div>
            <div class="event-info">
              <strong>Prodotto:</strong> ${prodLabel}<br>
              <strong>Dose:</strong> ${e.dose}
              ${e.note ? `<br>${e.note}` : ''}
              ${e.disease.note ? `<br><span style="color:var(--muted)">📝 ${e.disease.note}</span>` : ''}
            </div>
          </div>
          <button class="check-btn${done ? ' done' : ''}" style="${done ? 'background:' + group.color + ';border-color:' + group.color : ''}"
            onclick="cureToggleDone(${dy},${dm},${dd},${e.invId},'${e.disease.type}')">✓</button>
        </div>`;
      });
      html += `</div>`;
    });
  }

  // ── Sezione annaffiature con meteo intelligente
  if(waEvs.length){
    html+=`<div class="event-group"><div class="event-group-title" style="background:#3a8abf">💧 Annaffiature</div>`;
    // Banner meteo (aggiornato async)
    html+=`<div id="wa-meteo-banner" style="padding:6px 12px;font-size:11px;color:#5a7a9a;background:#edf5ff;border-bottom:1px solid #d0e0f0">⏳ Analisi condizioni meteo...</div>`;
    waEvs.forEach(e=>{
      const done=waIsDone(date,e.plant.id);
      const dy=date.getFullYear(),dm=date.getMonth(),dd=date.getDate();
      const nextDate=e.plant._waDates?e.plant._waDates.find(nd=>nd>date):null;
      const nextStr=nextDate?('Prossima: '+nextDate.getDate()+' '+gMonthNames[nextDate.getMonth()]):(e._sim?'Prossima: aggiornata dalla simulazione':'Fine stagione');
      const simBadge = e._sim ? '<span style="font-size:9px;background:#2a7abf;color:#fff;padding:2px 6px;border-radius:10px;margin-left:4px;font-weight:500">🔮 PREDITTIVA</span>' : '';
      const simNote = e._sim && e._liters ? `<div style="margin-top:4px;padding:4px 8px;background:#e6f1fb;border-left:2px solid #2a7abf;border-radius:4px;font-size:10px;color:#2a5a8a"><b>💧 ${e._liters.toFixed(2)}L</b> · calcolati dalla simulazione bilancio idrico</div>` : '';
      html+=`<div class="event-row${done?' done':''}" id="wa-row-${e.plant.id}">
        <div class="event-icon">${e.plant.icon}</div>
        <div class="event-content">
          <div class="event-name">${e.plant.name}${simBadge}</div>
          <div class="event-info"><strong>Metodo:</strong> ${e.plant.method}${e.note?`<br>${e.note}`:''}
          <br><span style="color:var(--muted)">${nextStr}</span></div>
          ${simNote}
          <div id="wa-badge-${e.plant.id}" style="margin-top:4px"></div>
        </div>
        <button class="check-btn${done?' done':''}" style="${done?'background:#3a8abf;border-color:#3a8abf':''}"
          onclick="waToggleDone(${dy},${dm},${dd},${e.plant.id})">✓</button>
      </div>`;
    });
    html+=`</div>`;
    // Trigger async meteo analysis after render
    setTimeout(()=>waAnalyzeMeteo(waEvs, date), 50);
  }

  // ── Prossimi 7 giorni
  const upcoming=[];
  for(let dd2=1;dd2<=7;dd2++){
    const nd=new Date(date.getTime()+dd2*86400000);const nk=gDateKey(nd);
    const nf=(gFilter==='all'||gFilter==='fert')?(gDateMap[nk]||[]).filter(e=>!gIsHiddenEvent(e)):[];
    const nb=(gFilter==='all'||gFilter==='biobizz')?(bbDateMap[nk]||[]).filter(e=>!bbHiddenProds.has(e.prod)):[];
    const nt=(gFilter==='all'||gFilter==='tratt')?(trDateMap[nk]||[]).filter(e=>!trHiddenProds.has(e.prod)):[];
    const nc=(gFilter==='all'||gFilter==='tratt')?(cureDateMap[nk]||[]):[];
    const nw=(gFilter==='all'||gFilter==='acqua')?(waDateMap[nk]||[]).filter(e=>!waHiddenPlants.has(e.plant.id)):[];
    if(nf.length||nb.length||nt.length||nc.length||nw.length)upcoming.push({date:nd,fert:nf,bb:nb,tr:nt,cure:nc,wa:nw});
  }
  if(upcoming.length){
    html+=`<div class="next-section"><div class="next-title">Prossimi 7 giorni</div>`;
    upcoming.forEach(u=>{
      u.fert.forEach(e=>{html+=`<div class="next-row"><div class="next-icon">${e.plant.icon}</div><div class="next-name">${e.plant.name}</div><div class="next-days">${gWeekdays[u.date.getDay()].slice(0,3)} ${u.date.getDate()}/${u.date.getMonth()+1}</div></div>`;});
      u.bb.forEach(e=>{const p=BB_PRODUCTS[e.prod];html+=`<div class="next-row"><span class="next-prod-badge" style="background:${p.color}">${p.abbr}</span><span style="font-size:12px">${e.plant.icon}</span><div class="next-name">${e.plant.name}</div><div class="next-days">${gWeekdays[u.date.getDay()].slice(0,3)} ${u.date.getDate()}/${u.date.getMonth()+1}</div></div>`;});
      u.tr.forEach(e=>{const p=TR_PRODUCTS[e.prod];html+=`<div class="next-row"><span class="next-prod-badge" style="background:${p.color}">${p.abbr}</span><span style="font-size:12px">${e.plant.icon}</span><div class="next-name">${e.plant.name}</div><div class="next-days">${gWeekdays[u.date.getDay()].slice(0,3)} ${u.date.getDate()}/${u.date.getMonth()+1}</div></div>`;});
      u.cure.forEach(e=>{html+=`<div class="next-row"><span class="next-prod-badge" style="background:${e.color}">!</span><span style="font-size:12px">${e.plant.icon}</span><div class="next-name">${e.plant.name} — ${e.diseaseLabel}</div><div class="next-days">${gWeekdays[u.date.getDay()].slice(0,3)} ${u.date.getDate()}/${u.date.getMonth()+1}</div></div>`;});
      u.wa.forEach(e=>{html+=`<div class="next-row"><span class="next-prod-badge" style="background:#3a8abf">💧</span><span style="font-size:12px">${e.plant.icon}</span><div class="next-name">${e.plant.name}</div><div class="next-days">${gWeekdays[u.date.getDay()].slice(0,3)} ${u.date.getDate()}/${u.date.getMonth()+1}</div></div>`;});
    });
    html+=`</div>`;
  }

  document.getElementById('g-panel-body').innerHTML=html;
  document.getElementById('g-overlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function gClosePanel(){document.getElementById('g-overlay').classList.remove('open');document.body.style.overflow='';}
function gCloseOverlay(e){if(e.target===document.getElementById('g-overlay'))gClosePanel();}
function gChangeMonth(dir){gCurrentMonth+=dir;if(gCurrentMonth>11){gCurrentMonth=0;gCurrentYear++;}if(gCurrentMonth<0){gCurrentMonth=11;gCurrentYear--;}gRenderCalendar();}
function gGoToday(){gCurrentMonth=gTODAY.getMonth();gCurrentYear=gTODAY.getFullYear();gRenderCalendar();}

// ══════════════════════════════════════════════════════════════════════
// ④ DIARIO  —  API SQLite (con fallback localStorage)
// ══════════════════════════════════════════════════════════════════════
const dOpLabels = {
  concimazione:'💚 Concimazione', annaffiatura:'💧 Annaffiatura',
  potatura:'✂️ Potatura', rinvaso:'🪴 Rinvaso', trattamento:'🧪 Trattamento',
  osservazione:'🔍 Osservazione', altro:'📝 Altro'
};
const dMonths = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const API = '/api/diary';
let dUseAPI = false;  // verrà impostato al primo ping

// Indicatore modalità (API o locale)
function dSetMode(isAPI) {
  dUseAPI = isAPI;
  const ind = document.querySelectorAll('.d-mode-indicator');
  if (isAPI) {
    ind.forEach(element => {
      element.textContent = '🟢 Database SQLite attivo';
      element.style.color = 'white';
    });
  } else {
    ind.forEach(element => {
      element.textContent = '🟡 Modalità locale (avvia server.py per SQLite)';
      element.style.color = 'white';
    });
  }
}

// Ping al server per capire se è attivo
async function dPingServer() {
  try {
    const res = await apiFetch(API + '?_ping=1', {signal: AbortSignal.timeout(1200)});
    dSetMode(res.ok);
  } catch {
    dSetMode(false);
  }
}

// ── localStorage fallback ─────────────────────────────────────────
function dLSLoad() {
  try { return JSON.parse(localStorage.getItem('diary_entries')||'[]'); } catch { return []; }
}
function dLSSave(entries) {
  try { localStorage.setItem('diary_entries', JSON.stringify(entries)); } catch {}
}

// ── Operazioni CRUD ───────────────────────────────────────────────
async function dLoadEntries(plant='', op='') {
  if (dUseAPI) {
    try {
      let url = API;
      const params = [];
      if (plant) params.push('plant='+encodeURIComponent(plant));
      if (op)    params.push('op='+encodeURIComponent(op));
      if (params.length) url += '?' + params.join('&');
      const res = await fetch(url);
      const data = await res.json();
      return data.entries || [];
    } catch { dSetMode(false); }
  }
  // fallback localStorage
  let entries = dLSLoad();
  if (plant) entries = entries.filter(e=>e.plant===plant);
  if (op)    entries = entries.filter(e=>e.op===op);
  return entries.sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
}

async function dAddEntry(entry) {
  if (dUseAPI) {
    try {
      const res = await apiFetch(API, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(entry)
      });
      if (res.ok) return true;
    } catch { dSetMode(false); }
  }
  // fallback localStorage
  const entries = dLSLoad();
  entries.unshift({...entry, id: Date.now(), auto: entry.auto||false});
  dLSSave(entries);
  return true;
}

async function dDeleteEntry(id) {
  if (!confirm('Eliminare questa voce?')) return;
  if (dUseAPI) {
    try {
      await apiFetch(API+'/'+id, {method:'DELETE'});
    } catch { dSetMode(false); }
  } else {
    const entries = dLSLoad().filter(e=>e.id!==id);
    dLSSave(entries);
  }
  dRender();
}

async function dUpdateEntry(id, data) {
  if (dUseAPI) {
    try {
      const res = await apiFetch(API+'/'+id, {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(data)
      });
      if (res.ok) return true;
    } catch { dSetMode(false); }
  }
  // fallback localStorage
  const entries = dLSLoad();
  const idx = entries.findIndex(e=>e.id===id);
  if (idx>=0) { Object.assign(entries[idx], data); dLSSave(entries); }
  return true;
}

function dEditEntry(id, date, plant, op, note) {
  document.getElementById('de-id').value = id;
  document.getElementById('de-date').value = date;
  document.getElementById('de-plant').value = plant;
  document.getElementById('de-op').value = op;
  document.getElementById('de-note').value = note || '';
  document.getElementById('d-edit-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function dCloseEdit() {
  document.getElementById('d-edit-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function dSaveEdit() {
  const id = +document.getElementById('de-id').value;
  const date = document.getElementById('de-date').value;
  const plant = document.getElementById('de-plant').value;
  const op = document.getElementById('de-op').value;
  const note = document.getElementById('de-note').value.trim();
  if (!date || !plant) { alert('Seleziona data e pianta!'); return; }

  const btn = document.getElementById('de-save-btn');
  btn.disabled = true;
  await dUpdateEntry(id, {date, plant, op, note});
  btn.textContent = '✓ Salvato!';
  btn.style.background = '#3a6a2c';
  setTimeout(()=>{ btn.textContent='Salva modifiche'; btn.style.background=''; btn.disabled=false; dCloseEdit(); dRender(); }, 800);
}

// ── Init & UI ─────────────────────────────────────────────────────
function dInitDiario() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,'0');
  const dd = String(today.getDate()).padStart(2,'0');
  document.getElementById('d-date').value = `${yyyy}-${mm}-${dd}`;
  // Popolo dinamicamente i dropdown delle piante con sPlants completo,
  // che include sia le 26 native sia le piante custom dell'utente.
  // Lo facciamo a runtime così le custom aggiunte dopo il primo caricamento
  // appaiono automaticamente quando l'utente apre il diario.
  // Le opzioni HTML hardcoded preesistenti vengono sostituite completamente.
  dPopulatePlantDropdowns();
  // Il ping al server NON è più qui dentro: lo facciamo una sola volta
  // all'avvio dell'app (vedi blocco "AVVIO APP" in fondo al file). In
  // questo modo gli indicatori di stato del database sono già aggiornati
  // su tutte le sezioni, indipendentemente da quale tab l'utente apre per
  // prima. Quando arriva qui, dUseAPI è già stato settato dal ping iniziale,
  // quindi dRender() può partire direttamente con la modalità giusta
  // (API o locale) senza dover aspettare nient'altro.
  dRender();
}

// Popola i due dropdown del diario (selettore voce + filtro) con la lista
// corrente di sPlants. Salva la selezione attuale dell'utente e la ripristina
// dopo aver rigenerato l'HTML, così filtri attivi non vengono persi.
function dPopulatePlantDropdowns() {
  const dPlantSel = document.getElementById('d-plant');
  const dFilterSel = document.getElementById('d-filter-plant');

  // Costruisco le option a partire da sPlants. Per le custom aggiungo un
  // piccolo pallino dorato al nome, coerente col pattern visivo delle
  // altre sezioni (Mensile, Annaffiature, Vasi). Il valore dell'option
  // resta il nome puro, perché il backend del diario filtra/cerca per nome.
  const plantOptions = sPlants.map(p => {
    // Escape minimo del nome per attribute value: solo virgolette doppie
    const nameAttr = p.name.replace(/"/g, '&quot;');
    return `<option value="${nameAttr}">${p.name}</option>`;
  }).join('');

  // Selettore per inserire nuova voce: opzione vuota di default, poi le piante
  if (dPlantSel) {
    const currentValue = dPlantSel.value;  // Conserva la selezione attuale
    dPlantSel.innerHTML = '<option value="">— Seleziona —</option>' + plantOptions;
    if (currentValue) dPlantSel.value = currentValue;  // Ripristina se esisteva
  }

  // Selettore filtro: "Tutte le piante" come default, poi le piante
  if (dFilterSel) {
    const currentFilter = dFilterSel.value;
    dFilterSel.innerHTML = '<option value="">Tutte le piante</option>' + plantOptions;
    if (currentFilter) dFilterSel.value = currentFilter;
  }
}

async function dSaveEntry() {
  const date  = document.getElementById('d-date').value;
  const plant = document.getElementById('d-plant').value;
  const op    = document.getElementById('d-op').value;
  const note  = document.getElementById('d-note').value.trim();
  if (!date || !plant) { alert('Seleziona data e pianta!'); return; }

  const btn = document.querySelector('.save-btn');
  btn.disabled = true;
  await dAddEntry({date, plant, op, note});
  document.getElementById('d-note').value = '';
  dInitDiario();
  await dRender();

  btn.textContent = '✓ Salvato!';
  btn.style.background = '#3a6a2c';
  setTimeout(()=>{ btn.textContent='Salva voce'; btn.style.background=''; btn.disabled=false; }, 1400);
}

function dFormatDate(dateStr) {
  const [y,m,d] = dateStr.split('-');
  const dt = new Date(+y,+m-1,+d);
  const wds = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  return wds[dt.getDay()]+' '+(+d)+' '+dMonths[+m-1]+' '+y;
}

// Popola dinamicamente i tre <select> del diario con i nomi delle piante
// custom presenti nel giardino. Viene chiamata da loadCustomPlants ogni
// volta che la cache delle piante viene aggiornata (avvio app, dopo
// add/edit/delete pianta), così i dropdown riflettono sempre lo stato
// reale del giardino.
//
// Pattern: per ognuno dei tre select rimuovo le option che rappresentano
// piante (tutte tranne quelle "speciali" che erano già nell'HTML statico,
// cioè il segnaposto vuoto e l'opzione "Tutte le piante"), e poi inserisco
// una option per ogni pianta della cache. Conservo la selezione corrente
// se la pianta selezionata esiste ancora, così l'utente non perde il
// filtro che aveva impostato in seguito a una modifica del catalogo.
function dPopulatePlantSelects() {
  const plantNames = (customPlantsCache || []).map(p => p.name).sort();

  // Helper: aggiorna un singolo <select> mantenendo le option speciali
  // (quelle senza testo standard di una pianta, che riconosco perché hanno
  // un value attribute esplicito o perché sono "Tutte le piante"). Se
  // l'option speciale "Tutte le piante" esiste, la inserisco DOPO le
  // piante perché è un'opzione catch-all che semanticamente sta in fondo;
  // se invece non c'è, mi limito a mettere le piante dopo il segnaposto.
  function refresh(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const previousValue = sel.value;
    // Tengo solo le option "speciali": quelle col value="" (segnaposti) e
    // quella col testo "Tutte le piante" (opzione catch-all). Tutte le
    // altre vengono rimosse perché sono piante che potrebbero non esistere
    // più nel catalogo.
    const specials = Array.from(sel.options).filter(opt =>
      opt.value === '' || opt.textContent === 'Tutte le piante'
    );
    const placeholder = specials.find(opt => opt.value === '');
    const tutte       = specials.find(opt => opt.textContent === 'Tutte le piante');

    sel.innerHTML = '';
    if (placeholder) sel.appendChild(placeholder);
    plantNames.forEach(name => {
      const opt = document.createElement('option');
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (tutte) sel.appendChild(tutte);

    // Ripristino la selezione precedente se quel valore esiste ancora tra
    // le option ricostruite. Se la pianta selezionata è stata eliminata,
    // sel.value tornerà a stringa vuota di fatto resettando il filtro:
    // è il comportamento più sensato perché qualsiasi cosa selezionassi
    // automaticamente sarebbe una scelta arbitraria fatta a sua insaputa.
    sel.value = previousValue;
  }

  refresh('d-plant');         // form di inserimento entry
  refresh('d-filter-plant');  // filtro lista entries
  refresh('de-plant');        // form di modifica entry
}

async function dRender() {
  const filterPlant = document.getElementById('d-filter-plant').value;
  const filterOp    = document.getElementById('d-filter-op').value;
  const entries = await dLoadEntries(filterPlant, filterOp);

  document.getElementById('d-count').textContent = entries.length+(entries.length===1?' voce':' voci');

  const list = document.getElementById('d-list');
  if (!entries.length) {
    list.innerHTML = `<div class="diary-empty"><span class="empty-icon">📓</span>${filterPlant||filterOp?'Nessuna voce trovata con questi filtri.':'Nessuna voce ancora.<br>Inizia ad annotare le tue operazioni!'}</div>`;
    return;
  }

  // Raggruppa per data
  const grouped = {};
  entries.forEach(e=>{ if(!grouped[e.date]) grouped[e.date]=[]; grouped[e.date].push(e); });

  list.innerHTML = Object.keys(grouped).sort((a,b)=>b.localeCompare(a)).map(date=>{
    const dayEntries = grouped[date];
    const html = dayEntries.map(e=>{
      const safeNote=(e.note||'').replace(/'/g,"\\'").replace(/\n/g,"\\n");
      return `
      <div class="diary-entry">
        <div class="entry-header">
          <span class="entry-plant">${e.plant}</span>
          <span class="entry-op op-${e.op}">${dOpLabels[e.op]||e.op}</span>
          ${e.auto?'<span class="entry-auto">auto</span>':''}
        </div>
        ${e.note?`<div class="entry-note">${e.note.replace(/\n/g,'<br>')}</div>`:''}
        <div class="entry-actions">
          <button class="entry-btn edit" onclick="dEditEntry(${e.id},'${e.date}','${e.plant.replace(/'/g,"\\'")}','${e.op}','${safeNote}')" title="Modifica">✏️</button>
          <button class="entry-btn del" onclick="dDeleteEntry(${e.id})" title="Elimina">✕</button>
        </div>
      </div>`}).join('');
    return `<div style="margin-bottom:4px">
      <div style="font-size:11px;font-weight:500;color:var(--muted);margin:10px 0 5px;padding-left:2px;letter-spacing:.3px;text-transform:uppercase">${dFormatDate(date)}</div>
      ${html}</div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════
// ⑤ CALCOLATORE ACQUA
// ══════════════════════════════════════════════════════════════════════

// Ritenzione idrica per tipo di substrato (% del volume trattenuta)
const wSubstrates = [
  { id:'universale',  name:'Terriccio universale',   whc: 0.52, color:'#8b6914' },
  { id:'perlite',     name:'Perlite',                whc: 0.08, color:'#c0b090' },
  { id:'pomice',      name:'Pomice',                 whc: 0.18, color:'#a0a090' },
  { id:'akadama',     name:'Akadama',                whc: 0.44, color:'#c07030' },
  { id:'sabbia',      name:'Sabbia grossa',          whc: 0.06, color:'#d4b870' },
  { id:'corteccia',   name:'Corteccia / Bark',       whc: 0.28, color:'#7a5030' },
  { id:'cocco',       name:'Fibra di cocco',         whc: 0.56, color:'#a07840' },
  { id:'humus',       name:'Humus di lombrico',      whc: 0.62, color:'#4a3020' },
  { id:'succulente',  name:'Mix succulente/cactus',  whc: 0.22, color:'#c0a060' },
  { id:'argilla',     name:'Argilla espansa (leca)', whc: 0.15, color:'#c06030' },
  { id:'kanuma',      name:'Kanuma',                 whc: 0.50, color:'#d4a850' },
  { id:'kiryu',       name:'Kiryu',                  whc: 0.25, color:'#8a8a70' },
  { id:'lapillo',     name:'Lapillo vulcanico',      whc: 0.12, color:'#6a3030' },
  { id:'sfagno',      name:'Sfagno',                 whc: 0.80, color:'#7aa050' },
  { id:'zeolite',     name:'Zeolite',                whc: 0.35, color:'#8090a0' },
  { id:'kyodama',     name:'Kyodama',                whc: 0.40, color:'#b0905a' },
  { id:'torba',       name:'Torba',                  whc: 0.65, color:'#5a3818' },
  { id:'vermiculite', name:'Vermiculite',            whc: 0.55, color:'#c0a868' },
];

// WHC media per preset substrato (globale: usata sia dal calcolatore acqua che dal simulatore)
const SUBSTRATE_WHC = {
  universale_mix: 0.32, succulente_mix: 0.17, orchidee_mix: 0.21,
  agrumi_mix: 0.34, bonsai_mix: 0.38, mediterranee_mix: 0.20,
  tropicali_mix: 0.40, acidofile_mix: 0.38, arbusti_mix: 0.36, custom: 0.30
};
// Fattore materiale vaso (globale)
const POT_MAT_FACTOR = {plastica:1.0, ceramica:1.0, terracotta:0.88, bonsai:1.0};
// Fattore pianta (globale)
const PLANT_WATER_FACTOR = {
  0:0.55, 12:0.55, 24:0.55,
  5:0.65, 19:0.65, 25:0.65,
  4:0.75, 6:0.75, 9:0.75, 21:0.75, 22:0.75,
  8:0.85, 10:0.85, 11:0.85,
  1:1.15,
};

let wVolMode = 'dim'; // 'dim' o 'lit'
let wVolLiters = 5;   // volume corrente calcolato
let wActivePreset = 'universale_mix';

const wPresets = [
  {id:'universale_mix', icon:'🌱', label:'Universale', desc:'Piante verdi',
    mix:{universale:50, perlite:30, pomice:20}},
  {id:'succulente_mix', icon:'🌵', label:'Succulente/Cactus', desc:'Aloe, Crassula',
    mix:{succulente:50, sabbia:20, pomice:20, perlite:10}},
  {id:'orchidee_mix', icon:'🌸', label:'Orchidee', desc:'Epifite',
    mix:{corteccia:60, perlite:15, pomice:15, argilla:10}},
  {id:'agrumi_mix', icon:'🍋', label:'Agrumi', desc:'Limone, Arancio',
    mix:{universale:35, perlite:20, humus:20, sabbia:15, pomice:10}},
  {id:'bonsai_mix', icon:'💜', label:'Bonsai', desc:'Glicine, Gelso',
    mix:{akadama:60, pomice:20, humus:20}},
  {id:'mediterranee_mix', icon:'🌿', label:'Mediterranee', desc:'Rosmarino, Salvia',
    mix:{universale:30, sabbia:30, perlite:20, pomice:20}},
  {id:'tropicali_mix', icon:'🌳', label:'Tropicali', desc:'Ficus, Pilea',
    mix:{universale:45, perlite:20, humus:20, cocco:15}},
  {id:'acidofile_mix', icon:'🍂', label:'Acidofile', desc:'Liquidambar, Betulla',
    mix:{universale:35, humus:25, corteccia:20, perlite:10, pomice:10}},
  {id:'arbusti_mix', icon:'🌺', label:'Arbusti da fiore', desc:'Oleandro, Vinca',
    mix:{universale:45, humus:20, perlite:20, pomice:15}},
  {id:'custom', icon:'⚙️', label:'Personalizzato', desc:'Regola gli slider',
    mix:null},
];

function wApplyPreset(presetId) {
  wActivePreset = presetId;
  document.querySelectorAll('.preset-btn').forEach(b=>b.classList.toggle('active', b.dataset.preset===presetId));
  const preset = wPresets.find(p=>p.id===presetId);
  if (!preset || !preset.mix) return;
  // Reset all to 0
  wSubstrates.forEach(s=>wSetSlider(s.id, 0));
  // Apply preset values
  Object.entries(preset.mix).forEach(([id,val])=>wSetSlider(id, val));
  wUpdateTotal();
}

function wInitCalc() {
  // Render presets
  const presetsEl = document.getElementById('w-presets');
  presetsEl.innerHTML = wPresets.map(p=>`<button class="preset-btn${p.id===wActivePreset?' active':''}" data-preset="${p.id}" onclick="wApplyPreset('${p.id}')"><span class="preset-icon">${p.icon}</span><span>${p.label}<br><span style="font-size:9px;opacity:.65">${p.desc}</span></span></button>`).join('');
  // Costruisci slider substrato
  const grid = document.getElementById('w-substrate-grid');
  grid.innerHTML = wSubstrates.map(s => `
    <div class="sub-row">
      <span class="sub-name" title="${s.name}">${s.name}</span>
      <input type="range" class="sub-slider" id="ws-${s.id}" min="0" max="100" value="0"
        oninput="wOnSliderChange('${s.id}')" style="accent-color:${s.color}">
      <span class="sub-val" id="wsv-${s.id}">0%</span>
    </div>`).join('');
  // Imposta il preset default
  wApplyPreset('universale_mix');
  wCalcVol();
}

function wOnSliderChange(id) {
  wUpdateSlider(id);
  // Quando l'utente muove uno slider manualmente, passa a "Personalizzato"
  if (wActivePreset !== 'custom') {
    wActivePreset = 'custom';
    document.querySelectorAll('.preset-btn').forEach(b=>b.classList.toggle('active', b.dataset.preset==='custom'));
  }
}

function wSetSlider(id, val) {
  document.getElementById('ws-'+id).value = val;
  document.getElementById('wsv-'+id).textContent = val + '%';
}

function wUpdateSlider(id) {
  const val = +document.getElementById('ws-'+id).value;
  document.getElementById('wsv-'+id).textContent = val + '%';
  wUpdateTotal();
}

function wUpdateTotal() {
  const total = wSubstrates.reduce((s, sub) => s + (+document.getElementById('ws-'+sub.id).value), 0);
  const el = document.getElementById('w-sub-total');
  el.textContent = 'Totale: ' + total + '%';
  el.className = 'sub-total ' + (Math.abs(total-100) <= 2 ? 'ok' : 'warn');
  if (Math.abs(total-100) > 2) el.textContent += ' ⚠️ deve essere 100%';
}

function wToggleVol(mode) {
  wVolMode = mode;
  document.getElementById('v-dim').style.display = mode==='dim'?'block':'none';
  document.getElementById('v-lit').style.display  = mode==='lit'?'block':'none';
  document.getElementById('v-btn-dim').classList.toggle('active', mode==='dim');
  document.getElementById('v-btn-lit').classList.toggle('active', mode==='lit');
  wCalcVol();
}

function wCalcVol() {
  let liters = 0;
  if (wVolMode === 'lit') {
    liters = +document.getElementById('w-liters-direct').value || 0;
  } else {
    const shape = document.getElementById('w-shape').value;
    const h = +document.getElementById('w-height').value || 0;
    const hSq = +document.getElementById('w-height-sq').value || 0;
    // Mostra/nascondi campi in base alla forma
    const isSq = shape === 'square';
    const isTrunc = shape === 'truncated';
    document.getElementById('v-cylinder').style.display = isSq ? 'none' : 'flex';
    document.getElementById('v-square').style.display   = isSq ? 'flex' : 'none';
    document.getElementById('v-diam-bot-wrap').style.display = isTrunc ? 'flex' : 'none';
    if (isSq) {
      const w = +document.getElementById('w-width').value || 0;
      const d = +document.getElementById('w-depth').value || 0;
      liters = (w * d * hSq) / 1000;
    } else if (isTrunc) {
      const r1 = (+document.getElementById('w-diam-top').value || 0) / 2;
      const r2 = (+document.getElementById('w-diam-bot').value || 0) / 2;
      // Volume tronco di cono: π/3 × h × (r1²+r1×r2+r2²)
      liters = (Math.PI / 3 * h * (r1*r1 + r1*r2 + r2*r2)) / 1000;
    } else {
      const r = (+document.getElementById('w-diam-top').value || 0) / 2;
      liters = (Math.PI * r * r * h) / 1000;
    }
    // Fattore riempimento reale ~85% (spazio per le radici, ecc.)
    liters *= 0.85;
  }
  wVolLiters = Math.max(0.1, liters);
  const preview = document.getElementById('w-vol-preview');
  if (preview) preview.textContent = wVolLiters.toFixed(1) + ' L (' + Math.round(wVolLiters*1000) + ' ml)';
}

// ── ET₀ Penman-Monteith ──────────────────────────────────────────────
let wET0Enabled = false;
let wET0Data = null;  // {temp, hum, solar, wind, et0, factor}

function wToggleET0() {
  wET0Enabled = !wET0Enabled;
  const sw = document.getElementById('w-et0-switch');
  const knob = document.getElementById('w-et0-knob');
  const panel = document.getElementById('w-et0-panel');
  const seasSel = document.getElementById('w-season');
  const expSel = document.getElementById('w-exposure');

  if (wET0Enabled) {
    sw.style.background = 'var(--accent)';
    knob.style.left = '20px';
    panel.style.display = 'block';
    seasSel.disabled = true; seasSel.style.opacity = '0.4';
    expSel.disabled = true;  expSel.style.opacity = '0.4';
    wFetchET0();
  } else {
    sw.style.background = 'var(--border)';
    knob.style.left = '2px';
    panel.style.display = 'none';
    seasSel.disabled = false; seasSel.style.opacity = '1';
    expSel.disabled = false;  expSel.style.opacity = '1';
    wET0Data = null;
  }
}

function wCheckET0Override() {
  // Se ET₀ è attivo, i select manuali sono disabilitati
  if (wET0Enabled) {
    document.getElementById('w-season').disabled = true;
    document.getElementById('w-exposure').disabled = true;
  }
}

async function wFetchET0() {
  const loading = document.getElementById('w-et0-loading');
  const dataDiv = document.getElementById('w-et0-data');
  loading.style.display = 'block';
  dataDiv.style.display = 'none';

  try {
    const res = await apiFetch('/api/ecowitt/realtime');
    const json = await res.json();
    if (!json.configured) {
      loading.innerHTML = '⚠️ Ecowitt non configurato — inserisci le chiavi in <b>config.json</b>';
      return;
    }
    if (json.code !== 0) {
      loading.innerHTML = '❌ Errore API: ' + (json.msg || 'sconosciuto');
      return;
    }

    // Estrai valori
    const getVal = (section, key) => {
      try { const v = json.data[section][key]; return v ? parseFloat(v.value || v) : null; }
      catch { return null; }
    };

    const temp = getVal('outdoor', 'temperature');
    const hum = getVal('outdoor', 'humidity');
    const solar = getVal('solar_and_uvi', 'solar');
    const windKmh = getVal('wind', 'wind_speed');

    if (temp === null) {
      loading.innerHTML = '❌ Dati temperatura non disponibili';
      return;
    }

    // Calcola ET₀ FAO Penman-Monteith semplificata
    const et0Result = calcET0(temp, hum || 50, solar || 0, windKmh || 0);

    wET0Data = et0Result;

    // Aggiorna UI
    document.getElementById('w-et0-temp').textContent = temp.toFixed(1);
    document.getElementById('w-et0-hum').textContent = hum !== null ? Math.round(hum) : '--';
    document.getElementById('w-et0-solar').textContent = solar !== null ? Math.round(solar) : '--';
    document.getElementById('w-et0-wind').textContent = windKmh !== null ? windKmh.toFixed(1) : '--';
    document.getElementById('w-et0-value').textContent = et0Result.et0.toFixed(2);
    document.getElementById('w-et0-factor').textContent = 'Fattore: ' + et0Result.factor.toFixed(2) + '×';
    document.getElementById('w-et0-desc').textContent = et0Result.desc;

    loading.style.display = 'none';
    dataDiv.style.display = 'block';
  } catch(e) {
    loading.innerHTML = '❌ Server non raggiungibile — avvia server.py';
  }
}

function calcET0(temp, humidity, solarWm2, windKmh) {
  // FAO Penman-Monteith semplificata per stima giornaliera
  // Riferimento: FAO Irrigation and Drainage Paper 56

  const T = temp;                           // °C
  const RH = Math.max(10, Math.min(100, humidity));  // %
  // Ecowitt dà radiazione istantanea in W/m². Per stimare il totale giornaliero:
  // ~8-10 ore di sole effettivo, ma il picco non è costante.
  const Rs = Math.max(0, solarWm2) * PARAMS.solarConv;  // W/m² istantanei → MJ/m²/day stimato
  const u2 = Math.max(0, windKmh) / 3.6;            // km/h → m/s

  // Pressione atmosferica approssimata (livello mare)
  const P = 101.3;  // kPa

  // Costante psicrometrica
  const gamma = 0.0665 * P / 100;  // kPa/°C (semplificata)

  // Pressione di vapore di saturazione
  const es = 0.6108 * Math.exp((17.27 * T) / (T + 237.3));

  // Pressione di vapore effettiva
  const ea = es * (RH / 100);

  // Deficit di pressione di vapore
  const vpd = Math.max(0, es - ea);

  // Pendenza della curva di saturazione
  const delta = (4098 * es) / Math.pow(T + 237.3, 2);

  // Radiazione netta approssimata (Rn ≈ 0.77 × Rs per giornata tipo)
  // Sottraiamo radiazione netta a onda lunga semplificata
  const Rns = 0.77 * Rs;
  const Rnl = 4.903e-9 * Math.pow(T + 273.16, 4) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * (Rs / Math.max(0.1, Rs * 1.5)) - 0.35);
  const Rn = Math.max(0, Rns - Math.max(0, Rnl));

  // G (flusso di calore nel suolo) ≈ 0 per calcolo giornaliero
  const G = 0;

  // ET₀ Penman-Monteith
  const num = 0.408 * delta * (Rn - G) + gamma * (900 / (T + 273)) * u2 * vpd;
  const den = delta + gamma * (1 + 0.34 * u2);
  let et0 = Math.max(0, num / den);

  // Clamp a valori ragionevoli (0-15 mm/day)
  et0 = Math.min(15, et0);

  // ET₀ di riferimento per giornata "media" di primavera
  const et0Ref = PARAMS.et0Ref;

  // Fattore: rapporto tra ET₀ attuale e ET₀ di riferimento
  // Questo sostituisce seasFactor × expFactor
  let factor = et0 / et0Ref;
  factor = Math.max(PARAMS.et0Min, Math.min(PARAMS.et0Max, factor));  // Clamp

  // Descrizione condizioni
  let desc = '';
  if (factor < 0.5) desc = 'Evapotraspirazione molto bassa — giornata fredda/umida/nuvolosa, riduci annaffiature';
  else if (factor < 0.8) desc = 'Evapotraspirazione sotto la media — le piante consumano meno acqua oggi';
  else if (factor < 1.2) desc = 'Evapotraspirazione nella norma — condizioni standard';
  else if (factor < 1.6) desc = 'Evapotraspirazione alta — giornata calda e soleggiata, aumenta annaffiature';
  else desc = 'Evapotraspirazione molto alta — caldo intenso, vento e bassa umidità, annaffia abbondantemente';

  return { et0, factor, desc, temp: T, humidity: RH, solar: solarWm2, wind: windKmh };
}

function wCalculate() {
  wCalcVol();

  // Calcola WHC pesato del substrato
  const total = wSubstrates.reduce((s,sub)=>s+(+document.getElementById('ws-'+sub.id).value),0);
  if (Math.abs(total-100) > 5) {
    alert('La composizione del substrato deve sommare a 100%.\nAttualmente è ' + total + '%.');
    return;
  }
  const whc = wSubstrates.reduce((s,sub)=>{
    const pct = +document.getElementById('ws-'+sub.id).value / 100;
    return s + pct * sub.whc;
  }, 0);

  const potFactor  = +document.getElementById('w-pot-mat').value;
  let seasFactor = +document.getElementById('w-season').value;
  const plantFactor= +document.getElementById('w-plant-cat').value;
  let expFactor  = +document.getElementById('w-exposure').value;
  const stageFactor= +document.getElementById('w-stage').value;

  // Se ET₀ live è attivo, sostituisci stagione × esposizione con il fattore calcolato
  let usingET0 = false;
  let et0Factor = 1.0;
  if (wET0Enabled && wET0Data) {
    et0Factor = wET0Data.factor;
    seasFactor = 1.0;  // Neutralizza il fattore statico
    expFactor = et0Factor;  // Usa il fattore ET₀ al suo posto
    usingET0 = true;
  }

  // Capacità idrica del vaso (ml)
  const waterCapacity = wVolLiters * 1000 * whc;

  // Quantità da dare per annaffiatura: saturazione target × fattori
  // Aggiungiamo extra per garantire il drenaggio completo
  const baseWater = waterCapacity * PARAMS.drenaggio;
  const adjustedWater = baseWater * potFactor * plantFactor;
  const waterMl = Math.round(adjustedWater / 10) * 10; // arrotonda a 10ml

  // Frequenza stimata (giorni tra una annaffiatura e l'altra)
  const subRetentionFactor = whc / 0.45; // normalizzato su terriccio standard
  const freqBase = PARAMS.freqBase;
  const freqDays = Math.round(freqBase * (1/seasFactor) * (1/expFactor) * (1/stageFactor) * subRetentionFactor * potFactor);
  const freqClamped = Math.max(1, Math.min(60, freqDays));

  // Aggiorna risultato
  document.getElementById('r-qty').textContent = waterMl >= 1000
    ? (waterMl/1000).toFixed(1) + ' L'
    : waterMl;
  document.getElementById('r-unit') && (document.getElementById('r-unit').textContent = waterMl >= 1000 ? '' : 'ml');
  document.getElementById('r-label').textContent =
    'per ogni annaffiatura · vaso da ' + wVolLiters.toFixed(1) + ' L';
  document.getElementById('r-vol').textContent  = wVolLiters.toFixed(1) + ' L (' + Math.round(wVolLiters*1000) + ' ml)';
  document.getElementById('r-ret').textContent  = Math.round(whc*100) + '% ritenzione idrica';
  document.getElementById('r-cap').textContent  = Math.round(waterCapacity) + ' ml capacità massima';
  document.getElementById('r-freq').textContent = freqClamped === 1 ? 'Ogni giorno' :
    freqClamped <= 3 ? 'Ogni ' + freqClamped + ' giorni' :
    freqClamped <= 7 ? 'Ogni ' + freqClamped + ' giorni (~' + Math.round(freqClamped/7*10)/10 + ' settimane)' :
    'Ogni ~' + Math.round(freqClamped/7) + (Math.round(freqClamped/7)===1?' settimana':' settimane');

  // Tips personalizzati
  const tips = [];
  if (usingET0 && wET0Data) {
    tips.push(`🌤️ <b>Dati meteo live (ET₀ = ${wET0Data.et0.toFixed(2)} mm/giorno)</b>: ${wET0Data.desc}`);
    if (wET0Data.temp > 30) tips.push('🔥 <b>Temperatura alta (' + wET0Data.temp.toFixed(0) + '°C)</b>: annaffia nelle ore più fresche (mattina presto o sera).');
    if (wET0Data.temp < 8) tips.push('❄️ <b>Temperatura bassa (' + wET0Data.temp.toFixed(0) + '°C)</b>: riduci le annaffiature — il terreno asciuga lentamente al freddo.');
    if (wET0Data.humidity < 30) tips.push('💧 <b>Aria molto secca (' + Math.round(wET0Data.humidity) + '%)</b>: nebulizza le foglie delle piante tropicali e dei bonsai.');
    if (wET0Data.wind > 20) tips.push('💨 <b>Vento forte (' + wET0Data.wind.toFixed(0) + ' km/h)</b>: i vasi esposti al vento asciugano più rapidamente, controlla più spesso.');
    if (wET0Data.solar > 600) tips.push('☀️ <b>Radiazione solare intensa (' + Math.round(wET0Data.solar) + ' W/m²)</b>: le piante all\'aperto consumano molta più acqua.');
    // Mostra il box ET₀ nel risultato
    document.getElementById('r-et0-item').style.display = 'block';
    document.getElementById('r-et0').textContent = wET0Data.et0.toFixed(2) + ' mm/g → fattore ' + et0Factor.toFixed(2) + '×';
  } else {
    document.getElementById('r-et0-item').style.display = 'none';
    if (whc < 0.20) tips.push('<b>Substrato molto drenante</b>: asciuga velocemente — monitora spesso e annaffia in piccole dosi più frequenti.');
    if (whc > 0.50) tips.push('<b>Substrato ricco</b>: trattiene molta umidità — aspetta sempre che i primi 2-3 cm siano asciutti prima di annaffiare di nuovo.');
    if (potFactor < 0.90) tips.push('<b>Terracotta</b>: il vaso assorbe acqua extra — nei mesi caldi controlla più spesso.');
    if (seasFactor <= 0.45) tips.push('<b>Inverno</b>: molte piante sono in semiriposo — meglio annaffiare meno e controllare visivamente.');
    if (expFactor >= 1.2) tips.push('<b>Sole diretto + vento</b>: l\u2019evaporazione è alta — la frequenza stimata potrebbe essere ancora più ravvicinata nei picchi estivi.');
  }
  tips.push('💡 <b>Regola pratica</b>: annaffia sempre abbondantemente fino a che l\u2019acqua esce dal foro di drenaggio, poi aspetta che il substrato sia parzialmente asciutto prima della prossima annaffiatura.');
  document.getElementById('r-tips').innerHTML = tips.join('<br>');

  document.getElementById('w-result').classList.add('visible');
  document.getElementById('w-result').scrollIntoView({behavior:'smooth', block:'nearest'});
}

// ══════════════════════════════════════════════════════════════════════
// ⑥ CALCOLATORE FERTILIZZANTE
// ══════════════════════════════════════════════════════════════════════

// Fattore di conversione → ml (o g) per 1 L d'acqua
const F_UNIT_CONV = {
  ml_l:   {factor: 1,      type:'ml', label:'ml/L'},
  g_l:    {factor: 1,      type:'g',  label:'g/L'},
  ml_10l: {factor: 0.1,    type:'ml', label:'ml/10L'},
  g_10l:  {factor: 0.1,    type:'g',  label:'g/10L'},
  ml_100l:{factor: 0.01,   type:'ml', label:'ml/100L'},
  g_100l: {factor: 0.01,   type:'g',  label:'g/100L'},
  pct:    {factor: 10,     type:'ml', label:'%'},       // 1% = 10 ml/L
  tsp_l:  {factor: 5,      type:'ml', label:'cucchiaini/L'},
  tbsp_l: {factor: 15,     type:'ml', label:'cucchiai/L'},
};

let fDoseFactor = 0.75;  // default: ¾ dose (valore prudente)

function fSetWater(liters) {
  document.getElementById('f-water').value = liters;
  fCalculate();
}

function fUseWaterFromCalc() {
  // Usa il volume del vaso calcolato sopra, moltiplicato per la ritenzione del substrato
  // In pratica usa la quantità d'acqua da dare per annaffiatura
  const qtyText = document.getElementById('r-qty').textContent;
  if (qtyText === '—') {
    alert('Prima calcola l\u2019acqua necessaria nel calcolatore sopra!');
    return;
  }
  // Il risultato può essere in ml o L
  let liters;
  if (qtyText.includes('L')) {
    liters = parseFloat(qtyText);
  } else {
    liters = (+qtyText) / 1000;
  }
  document.getElementById('f-water').value = liters.toFixed(2);
  fCalculate();
}

function fSetDoseFactor(f) {
  fDoseFactor = f;
  document.querySelectorAll('[id^="f-dose-"]').forEach(b=>b.classList.remove('active'));
  const id = f===1?'f-dose-100':f===0.75?'f-dose-75':f===0.5?'f-dose-50':'f-dose-25';
  document.getElementById(id).classList.add('active');
  fCalculate();
}

function fCalculate() {
  const dose = +document.getElementById('f-dose').value || 0;
  const unit = document.getElementById('f-unit').value;
  const water = +document.getElementById('f-water').value || 0;

  if (dose <= 0 || water <= 0) {
    document.getElementById('fr-qty').textContent = '—';
    document.getElementById('fr-unit').textContent = '';
    return;
  }

  const conv = F_UNIT_CONV[unit];
  // Quantità per 1 L alla dose piena del produttore
  const perLiterFull = dose * conv.factor;
  // Quantità totale per il volume d'acqua alla dose piena
  const totalFull = perLiterFull * water;
  // Quantità effettiva applicando il fattore riduzione
  const totalActual = totalFull * fDoseFactor;
  // Concentrazione finale (per litro)
  const finalConcentration = perLiterFull * fDoseFactor;

  // Formatta risultato principale
  const unitType = conv.type; // 'ml' o 'g'
  let qtyDisplay, unitDisplay;
  if (totalActual < 1) {
    // Mostra con più precisione se sotto 1 ml/g
    qtyDisplay = totalActual.toFixed(2);
    unitDisplay = unitType;
  } else if (totalActual < 10) {
    qtyDisplay = totalActual.toFixed(1);
    unitDisplay = unitType;
  } else {
    qtyDisplay = Math.round(totalActual);
    unitDisplay = unitType;
  }

  document.getElementById('fr-qty').textContent = qtyDisplay;
  document.getElementById('fr-unit').textContent = unitDisplay;

  // Dettagli
  document.getElementById('fr-prod').textContent = dose + ' ' + conv.label;
  const factorText = fDoseFactor===1?'100% (piena)':fDoseFactor===0.75?'75% (¾)':fDoseFactor===0.5?'50% (½)':'25% (¼)';
  document.getElementById('fr-applied').textContent = factorText;
  document.getElementById('fr-water').textContent = water >= 1 ? water + ' L' : Math.round(water*1000) + ' ml';
  document.getElementById('fr-conc').textContent = finalConcentration.toFixed(2) + ' ' + unitType + '/L';

  // Tips contestuali
  const tips = [];
  if (fDoseFactor === 1) {
    tips.push('<b>Dose piena</b>: usa solo per piante robuste in piena stagione di crescita. Molte piante sensibili preferiscono ½ o ¼ dose.');
  }
  if (fDoseFactor <= 0.25) {
    tips.push('<b>¼ dose</b>: ideale per orchidee, succulente, piante in scarsa luce o primo periodo dopo il rinvaso.');
  }
  if (totalActual < 0.5) {
    tips.push('<b>Quantità molto piccola</b> (< 0.5 ' + unitType + '): usa una siringa graduata o un contagocce per misurare con precisione.');
  } else if (totalActual < 2 && unitType === 'ml') {
    tips.push('<b>Usa una siringa</b> da 5 ml per dosare con precisione queste quantità minime.');
  }
  if (unitType === 'g') {
    tips.push('<b>Prodotto in polvere/granulare</b>: sciogli bene in acqua prima dell\u2019uso. Mescola fino a dissoluzione completa.');
  }
  tips.push('\u{1F4A1} <b>Regola d\u2019oro</b>: meglio sottodosare che sovradosare. In caso di dubbio parti da ½ dose e osserva la reazione della pianta dopo 2-3 applicazioni.');
  tips.push('\u{26A0}\u{FE0F} <b>Mai concimare su terreno asciutto</b> — bagna prima leggermente, poi applica la soluzione per evitare di bruciare le radici.');
  document.getElementById('fr-tips').innerHTML = tips.join('<br>');

  document.getElementById('f-result').classList.add('visible');
}

// Inizializza il calcolatore fertilizzante quando si apre la sezione acqua
const _wInitCalc_orig = wInitCalc;
wInitCalc = function() {
  _wInitCalc_orig();
  fCalculate();
  fiInit();
};

// ══════════════════════════════════════════════════════════════════════
// ⑨ CALCOLATORE FERTIRRIGAZIONE
// ══════════════════════════════════════════════════════════════════════

// FI_PLANTS è esteso a runtime con le piante custom (vedi loadCustomPlants).
// Per ogni pianta custom viene generato un record con waterMl/doseFactor
// dedotti dal gruppo simulazione, e loc dedotta dal primo vaso registrato
// (se esistente). Le 26 native restano hard-coded qui sotto.
// Calcolatore fertirrigazione — popolato dinamicamente da loadCustomPlants()
// che, per ogni pianta custom, deduce waterMl/doseFactor dal gruppo di
// simulazione e loc dal primo vaso registrato. Le 26 native originali
// avevano questo array pre-popolato; oggi nasce vuoto.
let FI_PLANTS = [];

let fiInited = false;

function fiInit() {
  if (fiInited) return;
  fiInited = true;
  const list = document.getElementById('fi-plant-list');
  list.innerHTML = FI_PLANTS.map(p => `
    <div class="fi-plant-row" id="fir-${p.id}">
      <input type="checkbox" class="fi-check" id="fic-${p.id}" onchange="fiUpdate()">
      <span class="fi-icon">${p.icon}</span>
      <span class="fi-name">${p.name}</span>
      <div class="fi-controls">
        <div class="fi-mini-field">🪴<input type="number" id="fin-${p.id}" value="1" min="1" max="50" style="width:38px" onchange="fiUpdate()" title="N° vasi"></div>
        <div class="fi-mini-field">💧<input type="number" id="fiw-${p.id}" value="${p.waterMl}" min="10" step="10" onchange="fiUpdate()" title="Acqua per vaso (ml)"><span>ml</span></div>
        <div class="fi-mini-field">⚖️<select id="fid-${p.id}" onchange="fiUpdate()" title="Dose">
          <option value="1"${p.doseFactor===1?' selected':''}>Piena</option>
          <option value="0.75"${p.doseFactor===0.75?' selected':''}>¾</option>
          <option value="0.5"${p.doseFactor===0.5?' selected':''}>½</option>
          <option value="0.25"${p.doseFactor===0.25?' selected':''}>¼</option>
        </select></div>
      </div>
    </div>`).join('');
}

function fiSelectAll()  { FI_PLANTS.forEach(p=>{document.getElementById('fic-'+p.id).checked=true;}); fiUpdate(); }
function fiSelectNone() { FI_PLANTS.forEach(p=>{document.getElementById('fic-'+p.id).checked=false;}); fiUpdate(); }
function fiSelectIndoor(){ FI_PLANTS.forEach(p=>{document.getElementById('fic-'+p.id).checked=(p.loc==='indoor');}); fiUpdate(); }
function fiSelectOutdoor(){FI_PLANTS.forEach(p=>{document.getElementById('fic-'+p.id).checked=(p.loc==='outdoor');}); fiUpdate(); }

async function fiOpenFromCalendar() {
  const evtData = window._fiCalEvts;
  if (!evtData) return;
  const {fertEvs, bbEvs, date} = evtData;

  gClosePanel();
  showSection('acqua');

  // Carica inventario
  const inv = invLoad();

  // Fetch dati sensori WH52 (EC + temp) se disponibili
  let soilByCh = {};
  try {
    const res = await apiFetch('/api/ecowitt/realtime');
    const json = await res.json();
    if (json.configured && json.code === 0) {
      for (let ch=1; ch<=16; ch++) {
        const d = meteoGetSoilData(json, ch);
        if (d.moisture !== null || d.temp !== null || d.ec !== null) soilByCh[ch] = d;
      }
    }
  } catch {}
  window._fiSoilByCh = soilByCh;

  // Raccogli piante del giorno con i loro prodotti
  // Per ogni pianta: trova nel inventario qty e volume vaso
  const plantMap = {}; // id → {name, icon, pots, waterMl, products:[{prod, dose, dosePerL}]}

  // Da eventi BioBizz: sappiamo quale prodotto specifico
  bbEvs.forEach(e => {
    const pid = e.plant.id;
    if (!plantMap[pid]) plantMap[pid] = {id:pid, name:e.plant.name, icon:e.plant.icon||'🌿', pots:1, waterMl:500, products:[]};
    const bbProd = BB_PRODUCTS[e.prod];
    const dbEntry = FERT_DB.find(f => f.id === 'bb-'+e.prod);
    const dosePerL = dbEntry ? dbEntry.dose : 2;
    // Evita duplicati prodotto per la stessa pianta
    if (!plantMap[pid].products.find(p => p.prod === e.prod)) {
      plantMap[pid].products.push({
        prod: e.prod,
        prodId: 'bb-'+e.prod,
        label: bbProd ? bbProd.label : e.prod,
        color: bbProd ? bbProd.color : '#4a8a3a',
        dosePerL: dosePerL,
        doseFactor: e.sched && e.sched.dose ? (e.sched.dose.includes('¼')?0.25 : e.sched.dose.includes('½')?0.5 : e.sched.dose.includes('¾')?0.75 : 1) : 0.5,
        doseLabel: e.sched ? e.sched.dose : '½ dose',
      });
    }
  });

  // Da eventi fertilizzazione generica: non hanno un prodotto BioBizz specifico
  // Cerchiamo nel inventario quali concimi usa la pianta
  fertEvs.forEach(e => {
    const pid = e.plant.id;
    if (!plantMap[pid]) plantMap[pid] = {id:pid, name:e.plant.name, icon:e.plant.icon||'🌿', pots:1, waterMl:500, products:[]};
    // Se non ha già prodotti da bbEvs, cerca nell'inventario
    if (!plantMap[pid].products.length) {
      const invItems = inv.filter(it => {
        const p = getPlantById(it.plantTypeIdx);
        return p && p.name === e.plant.name;
      });
      invItems.forEach(it => {
        (it.fertilizers||[]).forEach(fid => {
          const f = FERT_DB.find(x=>x.id===fid);
          if (f && f.type === 'liquido' && !plantMap[pid].products.find(p=>p.prodId===fid)) {
            plantMap[pid].products.push({
              prod: fid, prodId: fid,
              label: f.brand+' '+f.name, color: '#5a7a4a',
              dosePerL: f.dose, doseFactor: 0.5, doseLabel: '½ dose',
            });
          }
        });
      });
    }
  });

  // Arricchisci con dati dall'inventario: ogni vaso ha le sue dimensioni
  // Espandi plantMap in potEntries: una riga per ogni record inventario
  const potEntries = [];

  Object.values(plantMap).forEach(pm => {
    const invItems = inv.filter(it => {
      const p = getPlantById(it.plantTypeIdx);
      return p && p.name === pm.name;
    });

    if (invItems.length) {
      // Una riga per ogni record dell'inventario (diversi vasi della stessa pianta)
      invItems.forEach((it, idx) => {
        const vol = invGetVolFromItem(it);
        let whc = SUBSTRATE_WHC[it.substrate] || 0.30;
        if (it.substrate === 'custom' && it.customSubstrate) {
          whc = wSubstrates.reduce((s, sub) => {
            const pct = (it.customSubstrate[sub.id] || 0) / 100;
            return s + pct * sub.whc;
          }, 0) || 0.30;
        }
        const potFactor = POT_MAT_FACTOR[it.potMat] || 1.0;
        const plantFactor = PLANT_WATER_FACTOR[pm.id] || 1.0;
        const normalWater = vol * 1000 * whc * PARAMS.drenaggio * potFactor * plantFactor;
        const waterMl = Math.round(normalWater * (PARAMS.fertiReduction / 100));
        const pots = it.qty || 1;
        const label = it.nickname || (invItems.length > 1 ? pm.name + ' #' + (idx+1) : pm.name);
        const dimsStr = it.potShape === 'square'
          ? `${it.potW||25}×${it.potD||25}×${it.potHSq||22}cm`
          : it.potShape === 'truncated'
          ? `Ø${it.potDiamTop||25}/${it.potDiamBot||18}×${it.potHTrunc||22}cm`
          : `Ø${it.potDiam||25}×${it.potH||22}cm`;

        potEntries.push({
          id: pm.id, name: label, icon: pm.icon,
          pots, waterMl, vol: vol.toFixed(1),
          dimsStr, substrate: it.substrate,
          products: JSON.parse(JSON.stringify(pm.products)),
          invItem: it,
        });
      });
    } else {
      // Fallback: nessun record inventario, usa FI_PLANTS
      const fip = FI_PLANTS.find(f => f.id === pm.id);
      potEntries.push({
        id: pm.id, name: pm.name, icon: pm.icon,
        pots: 1, waterMl: fip ? fip.waterMl : 500,
        vol: '?', dimsStr: '', substrate: '',
        products: JSON.parse(JSON.stringify(pm.products)),
      });
    }
  });

  // Raggruppa per prodotto (ogni potEntry è una riga separata)
  const productGroups = {};
  potEntries.forEach(pe => {
    if (!pe.products.length) return;
    pe.products.forEach(prod => {
      if (!productGroups[prod.prodId]) {
        productGroups[prod.prodId] = {
          label: prod.label, color: prod.color, dosePerL: prod.dosePerL, plants: []
        };
      }
      productGroups[prod.prodId].plants.push({
        name: pe.name, icon: pe.icon, pots: pe.pots, waterMl: pe.waterMl,
        vol: pe.vol, dimsStr: pe.dimsStr,
        doseFactor: prod.doseFactor, doseLabel: prod.doseLabel,
        invItem: pe.invItem,
      });
    });
  });

  // Calcola totali e genera HTML
  let groupsHtml = '';
  let grandTotalWater = 0;
  let grandTotalPots = 0;
  const seenPots = new Set(); // Evita di contare i vasi 2 volte se una pianta usa 2 prodotti

  Object.entries(productGroups).forEach(([prodId, group]) => {
    let groupWater = 0, groupFert = 0, groupPots = 0;
    const rows = group.plants.map(pl => {
      const totalWater = pl.waterMl * pl.pots;
      const fert = (totalWater / 1000) * group.dosePerL * pl.doseFactor;
      groupWater += totalWater;
      groupFert += fert;
      groupPots += pl.pots;
      if (!seenPots.has(pl.name)) { grandTotalPots += pl.pots; seenPots.add(pl.name); }
      const waterStr = totalWater >= 1000 ? (totalWater/1000).toFixed(1)+' L' : totalWater+' ml';
      const fertStr = fert < 1 ? fert.toFixed(2) : fert < 10 ? fert.toFixed(1) : Math.round(fert);
      const perPot = pl.pots > 1 ? ` <span style="font-size:9px;color:var(--muted)">(${pl.pots}×${pl.waterMl}ml)</span>` : '';
      const dimsInfo = pl.dimsStr ? `<span style="font-size:9px;color:var(--muted)">${pl.dimsStr} · ${pl.vol}L</span>` : '';

      // Warning WH52 (temp/EC)
      let warning = '';
      const soilByCh = window._fiSoilByCh || {};
      if (pl.invItem && pl.invItem.sensorType === 'wh52' && pl.invItem.wh51Ch) {
        const sd = soilByCh[parseInt(pl.invItem.wh51Ch)];
        if (sd) {
          const cat = pl.invItem.wh51Cat || 'universale';
          const ecThresh = (PARAMS.sogliEC || {})[cat] || {min:400, target:800, max:2000};
          const warns = [];
          if (sd.temp !== null && sd.temp < PARAMS.tempRadiciMin) {
            warns.push(`🌡️ Radici ${sd.temp.toFixed(1)}°C (salta fertirrigazione, radici inattive)`);
          }
          if (sd.ec !== null && sd.moisture !== null && sd.moisture >= PARAMS.ecMoistureMin) {
            if (sd.ec > ecThresh.max) {
              warns.push(`⚡ EC ${Math.round(sd.ec)} µS/cm — lavaggio invece che fertirrigazione!`);
            } else if (sd.ec > ecThresh.target * 1.3) {
              warns.push(`⚡ EC ${Math.round(sd.ec)} µS/cm alto — riduci dose o salta`);
            }
          }
          if (warns.length) {
            warning = `<div style="grid-column:1/-1;margin-top:3px;padding:3px 6px;background:#faeaea;border-radius:4px;font-size:10px;color:#a04040">${warns.join(' · ')}</div>`;
          }
        }
      }

      return `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;background:#fff;font-size:11px;flex-wrap:wrap">
        <span>${pl.icon}</span>
        <span style="flex:1">
          <span style="font-weight:500">${pl.name}</span>${pl.pots>1?' <span style="font-size:9px;background:#e0ecff;color:#2a5a8a;padding:1px 5px;border-radius:10px">×'+pl.pots+'</span>':''}
          ${dimsInfo?'<br>'+dimsInfo:''}
        </span>
        <span style="color:var(--muted);text-align:right;min-width:55px">${waterStr}${perPot}</span>
        <span style="color:#2a5a8a;font-weight:500">→</span>
        <span style="color:#2d7a3a;font-weight:600;min-width:50px;text-align:right">${fertStr} ml</span>
        <span style="font-size:9px;color:var(--muted);min-width:32px">(${pl.doseLabel})</span>
        ${warning}
      </div>`;
    }).join('');

    grandTotalWater += groupWater;
    const groupWaterStr = groupWater >= 1000 ? (groupWater/1000).toFixed(1)+' L' : groupWater+' ml';
    const groupFertStr = groupFert < 1 ? groupFert.toFixed(2) : groupFert < 10 ? groupFert.toFixed(1) : Math.round(groupFert);

    groupsHtml += `<div style="margin-bottom:14px;border:1px solid #b0c8e8;border-radius:10px;overflow:hidden">
      <div style="background:${group.color};color:#fff;padding:8px 12px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:space-between">
        <span>💚 ${group.label}</span>
        <span style="font-size:11px;opacity:.9">${groupPots} vasi · ${groupWaterStr} acqua · ${groupFertStr} ml prodotto</span>
      </div>
      <div style="padding:8px;display:flex;flex-direction:column;gap:3px">${rows}</div>
      <div style="padding:6px 12px;background:#f0f5ff;font-size:11px;color:#2a5a8a">
        📋 <b>Prepara:</b> ${groupWaterStr} di acqua + <b>${groupFertStr} ml</b> di ${group.label}
      </div>
    </div>`;
  });

  // Mostra il risultato
  const calResult = document.getElementById('fi-cal-result');
  const dayStr = date.getDate()+' '+gMonthNames[date.getMonth()]+' '+date.getFullYear();
  document.getElementById('fi-cal-title').textContent = 'Fertirrigazione · '+dayStr;
  const prodCount = Object.keys(productGroups).length;
  document.getElementById('fi-cal-subtitle').textContent = prodCount > 1
    ? `${prodCount} prodotti diversi — prepara le soluzioni separatamente`
    : 'Soluzione unica';
  document.getElementById('fi-cal-groups').innerHTML = groupsHtml;
  document.getElementById('fi-cal-total-water').textContent = (grandTotalWater/1000) >= 10
    ? Math.round(grandTotalWater/1000) : (grandTotalWater/1000).toFixed(1);
  document.getElementById('fi-cal-total-pots').textContent = grandTotalPots;

  // Tips
  const tips = [];
  if (prodCount === 1) {
    tips.push('✅ <b>Un solo prodotto</b>: puoi preparare una soluzione unica e distribuirla a tutti i vasi.');
  } else {
    tips.push('⚠️ <b>Prodotti diversi</b>: prepara una soluzione separata per ogni prodotto. Non mescolare prodotti diversi nella stessa acqua.');
  }
  tips.push('💧 <b>Acqua ridotta al 70%</b>: il calcolo usa il 70% dell\'acqua di una normale annaffiatura — il terreno dovrebbe essere già leggermente umido prima della fertirrigazione.');
  tips.push('💡 <b>Procedura</b>: bagna prima leggermente con acqua pura, attendi che il substrato sia umido ma non saturo, poi applica la soluzione fertilizzante.');
  tips.push('📦 Vasi e substrato letti dalla sezione <b>I miei vasi</b>. Aggiorna l\'inventario per calcoli più precisi.');
  document.getElementById('fi-cal-tips').innerHTML = tips.join('<br>');

  calResult.style.display = 'block';

  // Nascondi il risultato manuale
  document.getElementById('fi-result').style.display = 'none';

  // Scrolla al risultato
  setTimeout(() => calResult.scrollIntoView({behavior:'smooth', block:'center'}), 200);
}

function fiUpdate() {
  // Nascondi risultato da calendario se si usa il calcolatore manuale
  const calRes = document.getElementById('fi-cal-result');
  if (calRes) calRes.style.display = 'none';

  // Show/hide custom dose
  const prodSel = document.getElementById('fi-product');
  const isCustom = prodSel.value === 'custom';
  document.getElementById('fi-custom-dose').style.display = isCustom ? 'block' : 'none';

  // Get product dose per liter
  let dosePerLiter, unitType;
  if (isCustom) {
    dosePerLiter = +(document.getElementById('fi-custom-val').value) || 0;
    unitType = document.getElementById('fi-custom-unit').value === 'g/L' ? 'g' : 'ml';
  } else {
    const opt = prodSel.options[prodSel.selectedIndex];
    dosePerLiter = +(opt.dataset.dose) || 0;
    unitType = 'ml';
  }

  // Toggle row highlight
  FI_PLANTS.forEach(p => {
    const checked = document.getElementById('fic-'+p.id).checked;
    document.getElementById('fir-'+p.id).classList.toggle('selected', checked);
  });

  // Gather selected plants
  const selected = FI_PLANTS.filter(p => document.getElementById('fic-'+p.id).checked).map(p => ({
    ...p,
    pots: +(document.getElementById('fin-'+p.id).value) || 1,
    waterMl: +(document.getElementById('fiw-'+p.id).value) || 0,
    doseFactor: +(document.getElementById('fid-'+p.id).value) || 1,
  }));

  const resultEl = document.getElementById('fi-result');
  if (!selected.length || dosePerLiter <= 0) {
    resultEl.style.display = 'none';
    return;
  }
  resultEl.style.display = 'block';

  // Calculate totals
  const totalWaterMl = selected.reduce((s,p) => s + p.waterMl * p.pots, 0);
  const totalWaterL = totalWaterMl / 1000;
  const totalPots = selected.reduce((s,p) => s + p.pots, 0);

  // Per-plant fertilizer
  const breakdown = selected.map(p => {
    const totalPlantWater = p.waterMl * p.pots;
    const fertMl = (totalPlantWater / 1000) * dosePerLiter * p.doseFactor;
    return { ...p, totalPlantWater, fertMl };
  });
  const totalFert = breakdown.reduce((s,p) => s + p.fertMl, 0);

  // Weighted average dose factor
  const avgDose = totalWaterMl > 0 ? breakdown.reduce((s,p) => s + p.doseFactor * p.totalPlantWater, 0) / totalWaterMl : 0;
  // Effective concentration
  const effectiveConc = totalWaterL > 0 ? totalFert / totalWaterL : 0;

  // Can we use a single solution?
  const allSameDose = breakdown.every(p => p.doseFactor === breakdown[0].doseFactor);

  // Display
  document.getElementById('fi-total-water').textContent = totalWaterL >= 10 ? Math.round(totalWaterL) : totalWaterL.toFixed(1);
  const fertDisplay = totalFert < 1 ? totalFert.toFixed(2) : totalFert < 10 ? totalFert.toFixed(1) : Math.round(totalFert);
  document.getElementById('fi-total-fert').textContent = fertDisplay;
  document.getElementById('fi-total-fert-unit').textContent = unitType;

  const prodName = isCustom ? 'prodotto' : prodSel.options[prodSel.selectedIndex].text.split('(')[0].trim();

  if (allSameDose) {
    document.getElementById('fi-summary').textContent = `Soluzione unica per ${totalPots} vasi: mescola tutto e distribuisci`;
  } else {
    document.getElementById('fi-summary').textContent = `${totalPots} vasi con dosi diverse: prepara per gruppo o misura per pianta`;
  }

  // Stats
  document.getElementById('fi-stats').innerHTML = `
    <div class="result-item" style="border-color:#b0c8e8"><div class="result-item-label">Piante</div><div class="result-item-val">${selected.length} specie · ${totalPots} vasi</div></div>
    <div class="result-item" style="border-color:#b0c8e8"><div class="result-item-label">Prodotto</div><div class="result-item-val">${prodName}</div></div>
    <div class="result-item" style="border-color:#b0c8e8"><div class="result-item-label">Concentrazione media</div><div class="result-item-val">${effectiveConc.toFixed(2)} ${unitType}/L</div></div>
    <div class="result-item" style="border-color:#b0c8e8"><div class="result-item-label">Risparmio vs dose piena</div><div class="result-item-val">${avgDose<1 ? Math.round((1-avgDose)*100)+'% risparmiato' : 'Dose piena'}</div></div>`;

  // Breakdown
  document.getElementById('fi-breakdown').innerHTML = breakdown.map(p => {
    const doseLabel = p.doseFactor===1?'piena':p.doseFactor===0.75?'¾':p.doseFactor===0.5?'½':'¼';
    const totalWStr = p.totalPlantWater >= 1000 ? (p.totalPlantWater/1000).toFixed(1)+' L' : p.totalPlantWater+' ml';
    const perPotStr = p.waterMl >= 1000 ? (p.waterMl/1000).toFixed(1)+' L' : p.waterMl+' ml';
    const fertStr = p.fertMl < 1 ? p.fertMl.toFixed(2) : p.fertMl < 10 ? p.fertMl.toFixed(1) : Math.round(p.fertMl);
    const potsInfo = p.pots > 1 ? `<span style="font-size:9px;color:var(--muted)"> (${p.pots}×${perPotStr})</span>` : '';
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;background:#f8faff;font-size:11px">
      <span>${p.icon}</span>
      <span style="flex:1;font-weight:500">${p.name}${p.pots>1?' <span style=\"font-size:9px;background:#e0ecff;color:#2a5a8a;padding:1px 5px;border-radius:10px\">×'+p.pots+'</span>':''}</span>
      <span style="color:var(--muted)">${totalWStr}${potsInfo}</span>
      <span style="color:#2a5a8a;font-weight:500">→</span>
      <span style="color:#2d7a3a;font-weight:600;min-width:50px;text-align:right">${fertStr} ${unitType}</span>
      <span style="font-size:9px;color:var(--muted);min-width:32px">(${doseLabel})</span>
    </div>`;
  }).join('');

  // Tips
  const tips = [];
  if (allSameDose) {
    tips.push(`<b>Soluzione unica possibile!</b> Tutte le piante selezionate usano la stessa dose (${breakdown[0].doseFactor===1?'piena':breakdown[0].doseFactor===0.75?'¾':breakdown[0].doseFactor===0.5?'½':'¼'}). Prepara ${totalWaterL.toFixed(1)} L di acqua con ${fertDisplay} ${unitType} di ${prodName} e distribuisci ai ${totalPots} vasi.`);
  } else {
    tips.push('<b>Dosi diverse tra piante</b>: hai selezionato piante con fattori di dose diversi. Due opzioni:');
    tips.push('&nbsp;&nbsp;① <b>Metodo semplice</b>: prepara la soluzione alla dose più bassa (¼) e dai più passate alle piante che richiedono dosi maggiori.');
    tips.push('&nbsp;&nbsp;② <b>Metodo preciso</b>: prepara soluzioni separate raggruppando le piante per dose. Segui le quantità nella tabella sopra.');
  }
  if (totalFert < 1) {
    tips.push('💉 <b>Quantità molto piccole</b>: usa una siringa graduata da 1-5 ml per dosare con precisione.');
  }
  tips.push('💡 <b>Ordine consigliato</b>: bagna prima leggermente le piante con acqua pura, poi applica la soluzione fertilizzante per evitare shock alle radici.');
  document.getElementById('fi-tips').innerHTML = tips.join('<br>');
}
// ══════════════════════════════════════════════════════════════════════
// ⑩ INVENTARIO VASI
// ══════════════════════════════════════════════════════════════════════

const FERT_DB = [
  // BioBizz
  {id:'bb-grow',    brand:'BioBizz',  name:'Bio·Grow',      npk:'4-3-6',   type:'liquido', dose:2,   unit:'ml/L', cat:'crescita'},
  {id:'bb-bloom',   brand:'BioBizz',  name:'Bio·Bloom',     npk:'2-7-4',   type:'liquido', dose:2,   unit:'ml/L', cat:'fioritura'},
  {id:'bb-topmax',  brand:'BioBizz',  name:'Top·Max',       npk:'0.1-0.01-0.1',type:'liquido',dose:1,unit:'ml/L', cat:'fioritura'},
  {id:'bb-alg',     brand:'BioBizz',  name:'Alg·A·Mic',     npk:'0.1-0.1-0.1', type:'liquido',dose:1,unit:'ml/L', cat:'rinvigorente'},
  {id:'bb-fish',    brand:'BioBizz',  name:'Fish·Mix',      npk:'5-1-4',   type:'liquido', dose:2,   unit:'ml/L', cat:'crescita'},
  {id:'bb-calmag',  brand:'BioBizz',  name:'CalMag',        npk:'0-0-0',   type:'liquido', dose:1,   unit:'ml/L', cat:'integratore'},
  {id:'bb-root',    brand:'BioBizz',  name:'Root·Juice',    npk:'0.1-0.1-0.1', type:'liquido',dose:1,unit:'ml/L', cat:'radicante'},
  {id:'bb-worm',    brand:'BioBizz',  name:'Worm·Humus',    npk:'1-0-0',   type:'solido',  dose:0,   unit:'% substrato', cat:'ammendante'},
  // COMPO
  {id:'compo-univ',  brand:'COMPO',   name:'Universale',    npk:'7-5-6',   type:'liquido', dose:7,  unit:'ml/L', cat:'universale'},
  {id:'compo-green', brand:'COMPO',   name:'Piante verdi',  npk:'7-3-6',   type:'liquido', dose:7,  unit:'ml/L', cat:'crescita'},
  {id:'compo-fior',  brand:'COMPO',   name:'Piante fiorite',npk:'3-5-7',   type:'liquido', dose:7,  unit:'ml/L', cat:'fioritura'},
  {id:'compo-agru',  brand:'COMPO',   name:'Agrumi e mediterranee',npk:'6-3-6',type:'liquido',dose:7,unit:'ml/L',cat:'agrumi'},
  {id:'compo-cact',  brand:'COMPO',   name:'Cactus',        npk:'4-5-7',   type:'liquido', dose:7,  unit:'ml/L', cat:'succulente'},
  {id:'compo-bons',  brand:'COMPO',   name:'Bonsai',        npk:'6-3-6',   type:'liquido', dose:7,  unit:'ml/L', cat:'bonsai'},
  {id:'compo-orch',  brand:'COMPO',   name:'Orchidee',      npk:'3-6-6',   type:'liquido', dose:7,  unit:'ml/L', cat:'orchidee'},
  {id:'compo-osmo',  brand:'COMPO',   name:'Osmocote universale',npk:'14-13-13',type:'granulare',dose:3,unit:'g/L substrato',cat:'lento rilascio'},
  // Cifo
  {id:'cifo-gran',   brand:'Cifo',    name:'Granverde universale',npk:'6-5-7',type:'liquido',dose:5,unit:'ml/L', cat:'universale'},
  {id:'cifo-fior',   brand:'Cifo',    name:'Granverde fioritura', npk:'4-6-8',type:'liquido',dose:5,unit:'ml/L', cat:'fioritura'},
  {id:'cifo-agru',   brand:'Cifo',    name:'Sinergon agrumi',npk:'6-5-5',  type:'liquido', dose:5,  unit:'ml/L', cat:'agrumi'},
  {id:'cifo-orch',   brand:'Cifo',    name:'Orchidee',      npk:'4-6-6',   type:'liquido', dose:5,  unit:'ml/L', cat:'orchidee'},
  {id:'cifo-ferro',  brand:'Cifo',    name:'Ferro chelato', npk:'0-0-0',   type:'liquido', dose:2,  unit:'ml/L', cat:'integratore'},
  // KB / Scotts
  {id:'kb-osmo',     brand:'KB/Scotts',name:'Osmocote Smart',npk:'11-11-18',type:'granulare',dose:3,unit:'g/L substrato',cat:'lento rilascio'},
  {id:'kb-univ',     brand:'KB/Scotts',name:'Universale liquido',npk:'7-7-7',type:'liquido',dose:7,unit:'ml/L',cat:'universale'},
  // Biogold
  {id:'bio-orig',    brand:'Biogold',  name:'Original',     npk:'5.5-6.5-3.5',type:'granulare organico',dose:0,unit:'pallini/vaso',cat:'bonsai'},
  {id:'bio-vital',   brand:'Biogold',  name:'Vital',        npk:'0-0-0',   type:'liquido', dose:2,  unit:'ml/L', cat:'rinvigorente'},
  // Flortis
  {id:'flor-univ',   brand:'Flortis',  name:'Universale Bio',npk:'5-5-5',  type:'liquido', dose:5,  unit:'ml/L', cat:'universale'},
  {id:'flor-agru',   brand:'Flortis',  name:'Agrumi Bio',   npk:'6-4-5',   type:'liquido', dose:5,  unit:'ml/L', cat:'agrumi'},
  {id:'flor-orch',   brand:'Flortis',  name:'Orchidee',     npk:'3-5-6',   type:'liquido', dose:5,  unit:'ml/L', cat:'orchidee'},
  // Vigorplant
  {id:'vigo-univ',   brand:'Vigorplant',name:'Fito universale',npk:'7-5-6',type:'liquido',dose:6,  unit:'ml/L', cat:'universale'},
  {id:'vigo-acid',   brand:'Vigorplant',name:'Acidofile',    npk:'5-3-7',   type:'liquido', dose:6,  unit:'ml/L', cat:'acidofile'},
  // Lupini
  {id:'lupini',      brand:'Naturale', name:'Lupini macinati',npk:'5-0-0',  type:'granulare organico',dose:0,unit:'g/vaso',cat:'agrumi'},
  // Stallatico
  {id:'stallatico',  brand:'Naturale', name:'Stallatico pellettato',npk:'3-3-3',type:'granulare organico',dose:0,unit:'g/vaso',cat:'universale'},
];

const INV_DISEASE_LABELS = {
  cocciniglia:'Cocciniglia',cocciniglia_cotonosa:'Cocciniglia cotonosa',ragnetto_rosso:'Ragnetto rosso',
  afidi:'Afidi',mosca_bianca:'Mosca bianca',oidio:'Oidio',marciume_radicale:'Marciume radicale',
  fumaggine:'Fumaggine',clorosi_ferrica:'Clorosi ferrica',minatore_fogliare:'Minatore fogliare',
  alternaria:'Alternaria',altro:'Altro'
};

// Inventory persistence — API SQLite con fallback localStorage
const INV_API = '/api/inventory';
let invUseAPI = false;
let invCache = null;

function invLSLoad(){ try { return JSON.parse(localStorage.getItem('inv_plants')||'[]'); } catch { return []; } }
function invLSSave(data){ try { localStorage.setItem('inv_plants', JSON.stringify(data)); } catch {} }

function invDbToJs(row) {
  // Defensive parse: se un campo JSON arriva come stringa (ad es. da una versione
  // buggata del server), lo parsiamo qui per evitare errori a cascata
  const parseIfString = (v, fallback) => {
    if (v == null) return fallback;
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch { return fallback; }
    }
    return v;
  };
  return {
    id: row.id, plantTypeIdx: row.plant_type_idx, qty: row.qty, nickname: row.nickname||'',
    location: row.location, potShape: row.pot_shape, potMat: row.pot_mat,
    potDiam: row.pot_diam, potH: row.pot_h, potVol: row.pot_vol,
    potDiamTop: row.pot_diam_top, potDiamBot: row.pot_diam_bot,
    potHTrunc: row.pot_h_trunc, potVolTrunc: row.pot_vol_trunc,
    potW: row.pot_w, potD: row.pot_d, potHSq: row.pot_h_sq, potVolSq: row.pot_vol_sq,
    substrate: row.substrate,
    customSubstrate: parseIfString(row.custom_substrate, null),
    wh51Ch: row.wh51_ch, wh51Cat: row.wh51_cat,
    sensorType: row.sensor_type || 'wh51',
    // Nuovi campi: parametri simulazione persistenti per vaso
    simParams: parseIfString(row.sim_params, {}),
    hasMulch: !!row.has_mulch,
    hasSaucer: !!row.has_saucer,
    lastWatered: row.last_watered || null,
    fertilizers: parseIfString(row.fertilizers, []),
    diseases: parseIfString(row.diseases, []),
  };
}

async function invPingAPI() {
  try {
    const res = await apiFetch(INV_API, {signal: AbortSignal.timeout(1200)});
    invUseAPI = res.ok;
  } catch { invUseAPI = false; }
}

function invLoad() {
  if (invCache !== null) return invCache;
  return invLSLoad();
}

async function invLoadFromAPI() {
  if (invUseAPI) {
    try {
      const res = await apiFetch(INV_API);
      const data = await res.json();
      const items = (data.items||[]).map(invDbToJs);
      invCache = items;
      invLSSave(items);
      return items;
    } catch { invUseAPI = false; }
  }
  invCache = invLSLoad();
  return invCache;
}

async function invAPIAdd(entry) {
  if (invUseAPI) {
    try {
      const res = await apiFetch(INV_API, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(entry)
      });
      if (res.ok) {
        const data = await res.json();
        return invDbToJs(data.item);
      }
    } catch { invUseAPI = false; }
  }
  const items = invLSLoad();
  entry.id = Date.now();
  items.push(entry);
  invLSSave(items);
  return entry;
}

async function invAPIUpdate(id, entry) {
  if (invUseAPI) {
    try {
      const res = await apiFetch(INV_API+'/'+id, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(entry)
      });
      if (res.ok) return true;
    } catch { invUseAPI = false; }
  }
  const items = invLSLoad();
  const idx = items.findIndex(i=>i.id===id);
  if (idx>=0) { Object.assign(items[idx], entry); invLSSave(items); }
  return true;
}

async function invAPIDelete(id) {
  if (invUseAPI) {
    try { await apiFetch(INV_API+'/'+id, {method:'DELETE'}); } catch { invUseAPI = false; }
  } else {
    const items = invLSLoad().filter(i=>i.id!==id);
    invLSSave(items);
  }
}

let invTempDiseases = [];

function invShapeChange() {
  const shape = document.getElementById('inv-pot-shape').value;
  document.getElementById('inv-dims-cyl').style.display   = shape==='cylinder'  ? 'flex' : 'none';
  document.getElementById('inv-dims-trunc').style.display  = shape==='truncated' ? 'flex' : 'none';
  document.getElementById('inv-dims-sq').style.display     = shape==='square'    ? 'flex' : 'none';
}

function invSubstrateChange() {
  const val = document.getElementById('inv-substrate').value;
  const customDiv = document.getElementById('inv-sub-custom');
  if (val === 'custom') {
    customDiv.style.display = 'block';
    if (!document.getElementById('inv-sub-sliders').children.length) invBuildSubSliders();
  } else {
    customDiv.style.display = 'none';
  }
}

function invBuildSubSliders() {
  const container = document.getElementById('inv-sub-sliders');
  container.innerHTML = wSubstrates.map(s => `
    <div class="sub-row">
      <span class="sub-name" title="${s.name}" style="width:120px;font-size:11px">${s.name}</span>
      <input type="range" class="sub-slider" id="invs-${s.id}" min="0" max="100" value="0"
        oninput="invSubSliderChange('${s.id}')" style="accent-color:${s.color}">
      <span class="sub-val" id="invsv-${s.id}" style="width:36px;text-align:right;font-size:12px;font-weight:500;color:var(--accent)">0%</span>
    </div>`).join('');
}

function invSubSliderChange(id) {
  document.getElementById('invsv-'+id).textContent = document.getElementById('invs-'+id).value + '%';
  invSubUpdateTotal();
}

function invSubUpdateTotal() {
  const total = wSubstrates.reduce((s, sub) => {
    const el = document.getElementById('invs-'+sub.id);
    return s + (el ? +el.value : 0);
  }, 0);
  const el = document.getElementById('inv-sub-total');
  el.textContent = 'Totale: ' + total + '%';
  el.className = 'sub-total ' + (Math.abs(total-100) <= 2 ? 'ok' : 'warn');
  if (Math.abs(total-100) > 2) el.textContent += ' ⚠️ deve essere 100%';
}

function invSubSetSlider(id, val) {
  const slider = document.getElementById('invs-'+id);
  const label = document.getElementById('invsv-'+id);
  if (slider) { slider.value = val; }
  if (label) { label.textContent = val + '%'; }
}

function invSubGetMix() {
  const mix = {};
  wSubstrates.forEach(s => {
    const el = document.getElementById('invs-'+s.id);
    const val = el ? +el.value : 0;
    if (val > 0) mix[s.id] = val;
  });
  return mix;
}

function invSubLoadMix(mix) {
  if (!document.getElementById('inv-sub-sliders').children.length) invBuildSubSliders();
  wSubstrates.forEach(s => invSubSetSlider(s.id, 0));
  if (mix) Object.entries(mix).forEach(([id, val]) => invSubSetSlider(id, val));
  invSubUpdateTotal();
}

async function invInit() {
  // Ping API
  await invPingAPI();
  await invLoadFromAPI();
  // Carico le piante custom prima di popolare la dropdown.
  // Senza questa chiamata, se l'utente apre la sezione Vasi prima che
  // loadCustomPlants() iniziale sia completato, la dropdown mostrerebbe
  // solo le 26 native e i vasi che riferiscono custom non verrebbero
  // renderizzati (getPlantById restituisce null).
  // La funzione è idempotente, quindi chiamarla più volte non duplica nulla.
  if (typeof loadCustomPlants === 'function') {
    await loadCustomPlants();
  }
  // Populate plant type dropdown.
  // IMPORTANTE: il value dell'option è p.id (l'identificativo reale della
  // pianta), NON l'indice di posizione nell'array. Per le 26 native questi
  // due valori coincidono per coincidenza storica, ma per le piante custom
  // sono diversi perché il backend le restituisce ordinate per nome. Usare
  // l'id reale garantisce coerenza in ogni situazione e con qualsiasi ordine.
  const sel = document.getElementById('inv-plant-type');
  sel.innerHTML = '<option value="">— Seleziona —</option>' + sPlants.map(p =>
    `<option value="${p.id}">${p.icon} ${p.name}</option>`
  ).join('');
  // Populate fertilizer grid
  invRenderFertGrid();
  invRender();
}

function invRenderFertGrid(filter='') {
  const grid = document.getElementById('inv-fert-grid');
  const fl = filter.toLowerCase();
  grid.innerHTML = FERT_DB.filter(f =>
    !fl || f.name.toLowerCase().includes(fl) || f.brand.toLowerCase().includes(fl) || f.cat.toLowerCase().includes(fl)
  ).map(f => {
    const info = f.type==='liquido' ? f.dose+' '+f.unit : f.type;
    return `<div class="inv-fert-opt" id="invf-${f.id}" onclick="invToggleFert('${f.id}')">
      <span>${f.name}</span><span class="fert-brand">${f.brand} · NPK ${f.npk}</span>
    </div>`;
  }).join('');
}

function invFilterFerts() {
  const q = document.getElementById('inv-fert-search').value;
  invRenderFertGrid(q);
  // Re-highlight selected
  const selFerts = invGetSelectedFerts();
  selFerts.forEach(id => { const el=document.getElementById('invf-'+id); if(el) el.classList.add('selected'); });
}

function invToggleFert(id) {
  const el = document.getElementById('invf-'+id);
  if (el) el.classList.toggle('selected');
}

function invGetSelectedFerts() {
  return [...document.querySelectorAll('.inv-fert-opt.selected')].map(el => el.id.replace('invf-',''));
}

function invAddDisease() {
  const type = document.getElementById('inv-disease-type').value;
  if (!type) return;
  const note = document.getElementById('inv-disease-note').value.trim();
  const today = new Date();
  const dateStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  invTempDiseases.push({type, note, date:dateStr, resolved:false});
  document.getElementById('inv-disease-type').value = '';
  document.getElementById('inv-disease-note').value = '';
  invRenderDiseaseList();
}

function invRemoveDisease(idx) {
  invTempDiseases.splice(idx,1);
  invRenderDiseaseList();
}

function invToggleResolved(idx) {
  invTempDiseases[idx].resolved = !invTempDiseases[idx].resolved;
  invRenderDiseaseList();
}

function invRenderDiseaseList() {
  const list = document.getElementById('inv-disease-list');
  if (!invTempDiseases.length) { list.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:4px 0">Nessuna malattia registrata</div>'; return; }
  list.innerHTML = invTempDiseases.map((d,i) => {
    const label = INV_DISEASE_LABELS[d.type]||d.type;
    const cls = d.resolved ? 'resolved' : 'active';
    return `<div class="inv-disease-row">
      <span class="inv-disease-chip ${cls}">${d.resolved?'✅':'⚠️'} ${label}</span>
      <span style="font-size:10px;color:var(--muted)">${d.date}</span>
      <span style="flex:1;font-size:10px;color:var(--text)">${d.note||''}</span>
      <button class="ctrl-btn" onclick="invToggleResolved(${i})" style="font-size:9px;padding:2px 6px">${d.resolved?'Riapri':'Risolto'}</button>
      <button class="ctrl-btn" onclick="invRemoveDisease(${i})" style="font-size:9px;padding:2px 6px;color:#b04040">✕</button>
    </div>`;
  }).join('');
}

function invOpenAdd() {
  document.getElementById('inv-form-title').textContent = 'Aggiungi vaso';
  document.getElementById('inv-edit-id').value = '';
  document.getElementById('inv-plant-type').value = '';
  document.getElementById('inv-qty').value = 1;
  document.getElementById('inv-nickname').value = '';
  document.getElementById('inv-location').value = 'indoor';
  document.getElementById('inv-pot-shape').value = 'cylinder';
  document.getElementById('inv-pot-mat').value = 'plastica';
  // Cylinder
  document.getElementById('inv-pot-diam').value = 25;
  document.getElementById('inv-pot-h').value = 22;
  document.getElementById('inv-pot-vol').value = '';
  // Truncated
  document.getElementById('inv-pot-diam-top').value = 25;
  document.getElementById('inv-pot-diam-bot').value = 18;
  document.getElementById('inv-pot-h-trunc').value = 22;
  document.getElementById('inv-pot-vol-trunc').value = '';
  // Square
  document.getElementById('inv-pot-w').value = 25;
  document.getElementById('inv-pot-d').value = 25;
  document.getElementById('inv-pot-h-sq').value = 22;
  document.getElementById('inv-pot-vol-sq').value = '';
  invShapeChange();
  document.getElementById('inv-substrate').value = 'universale_mix';
  invSubstrateChange();
  document.getElementById('inv-wh51-ch').value = '';
  document.getElementById('inv-wh51-cat').value = 'universale';
  document.getElementById('inv-sensor-type').value = 'wh51';
  // Nuovi campi monitoraggio idrico
  document.getElementById('inv-last-watered').value = '';
  document.getElementById('inv-has-mulch').checked = false;
  document.getElementById('inv-has-saucer').checked = false;
  document.getElementById('inv-del-btn').style.display = 'none';
  // Reset ferts
  document.querySelectorAll('.inv-fert-opt.selected').forEach(el=>el.classList.remove('selected'));
  document.getElementById('inv-fert-search').value = '';
  invRenderFertGrid();
  // Reset diseases
  invTempDiseases = [];
  invRenderDiseaseList();
  // Open
  document.getElementById('inv-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function invOpenEdit(id) {
  const items = invLoad();
  const item = items.find(i=>i.id===id);
  if (!item) return;
  document.getElementById('inv-form-title').textContent = 'Modifica vaso';
  document.getElementById('inv-edit-id').value = id;
  document.getElementById('inv-plant-type').value = item.plantTypeIdx;
  document.getElementById('inv-qty').value = item.qty||1;
  document.getElementById('inv-nickname').value = item.nickname||'';
  document.getElementById('inv-location').value = item.location||'indoor';
  document.getElementById('inv-pot-shape').value = item.potShape||'cylinder';
  document.getElementById('inv-pot-mat').value = item.potMat||'plastica';
  // Cylinder fields
  document.getElementById('inv-pot-diam').value = item.potDiam||25;
  document.getElementById('inv-pot-h').value = item.potH||22;
  document.getElementById('inv-pot-vol').value = item.potVol||'';
  // Truncated fields
  document.getElementById('inv-pot-diam-top').value = item.potDiamTop||item.potDiam||25;
  document.getElementById('inv-pot-diam-bot').value = item.potDiamBot||18;
  document.getElementById('inv-pot-h-trunc').value = item.potHTrunc||item.potH||22;
  document.getElementById('inv-pot-vol-trunc').value = item.potVolTrunc||'';
  // Square fields
  document.getElementById('inv-pot-w').value = item.potW||25;
  document.getElementById('inv-pot-d').value = item.potD||25;
  document.getElementById('inv-pot-h-sq').value = item.potHSq||item.potH||22;
  document.getElementById('inv-pot-vol-sq').value = item.potVolSq||'';
  invShapeChange();
  document.getElementById('inv-substrate').value = item.substrate||'universale_mix';
  invSubstrateChange();
  if (item.substrate === 'custom' && item.customSubstrate) {
    invSubLoadMix(item.customSubstrate);
  }
  document.getElementById('inv-wh51-ch').value = item.wh51Ch||'';
  document.getElementById('inv-wh51-cat').value = item.wh51Cat||'universale';
  document.getElementById('inv-sensor-type').value = item.sensorType||'wh51';
  // Nuovi campi monitoraggio idrico
  document.getElementById('inv-last-watered').value = item.lastWatered || '';
  document.getElementById('inv-has-mulch').checked = !!item.hasMulch;
  document.getElementById('inv-has-saucer').checked = !!item.hasSaucer;
  document.getElementById('inv-del-btn').style.display = 'inline-flex';
  // Ferts
  document.getElementById('inv-fert-search').value = '';
  invRenderFertGrid();
  (item.fertilizers||[]).forEach(fid => { const el=document.getElementById('invf-'+fid); if(el) el.classList.add('selected'); });
  // Diseases
  invTempDiseases = JSON.parse(JSON.stringify(item.diseases||[]));
  invRenderDiseaseList();
  // Open
  document.getElementById('inv-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function invCloseForm() {
  document.getElementById('inv-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function invSave() {
  const plantIdx = document.getElementById('inv-plant-type').value;
  if (plantIdx === '') { alert('Seleziona una pianta!'); return; }
  const editId = document.getElementById('inv-edit-id').value;
  const shape = document.getElementById('inv-pot-shape').value;
  const entry = {
    plantTypeIdx: +plantIdx,
    qty: +(document.getElementById('inv-qty').value)||1,
    nickname: document.getElementById('inv-nickname').value.trim(),
    location: document.getElementById('inv-location').value,
    potShape: shape,
    potMat: document.getElementById('inv-pot-mat').value,
    potDiam: +(document.getElementById('inv-pot-diam').value)||25,
    potH: +(document.getElementById('inv-pot-h').value)||22,
    potVol: document.getElementById('inv-pot-vol').value ? +(document.getElementById('inv-pot-vol').value) : null,
    potDiamTop: +(document.getElementById('inv-pot-diam-top').value)||25,
    potDiamBot: +(document.getElementById('inv-pot-diam-bot').value)||18,
    potHTrunc: +(document.getElementById('inv-pot-h-trunc').value)||22,
    potVolTrunc: document.getElementById('inv-pot-vol-trunc').value ? +(document.getElementById('inv-pot-vol-trunc').value) : null,
    potW: +(document.getElementById('inv-pot-w').value)||25,
    potD: +(document.getElementById('inv-pot-d').value)||25,
    potHSq: +(document.getElementById('inv-pot-h-sq').value)||22,
    potVolSq: document.getElementById('inv-pot-vol-sq').value ? +(document.getElementById('inv-pot-vol-sq').value) : null,
    substrate: document.getElementById('inv-substrate').value,
    customSubstrate: document.getElementById('inv-substrate').value === 'custom' ? invSubGetMix() : null,
    wh51Ch: document.getElementById('inv-wh51-ch').value || null,
    wh51Cat: document.getElementById('inv-wh51-cat').value || 'universale',
    sensorType: document.getElementById('inv-sensor-type').value || 'wh51',
    // Campi monitoraggio idrico / simulazione
    lastWatered: document.getElementById('inv-last-watered').value || null,
    hasMulch: document.getElementById('inv-has-mulch').checked,
    hasSaucer: document.getElementById('inv-has-saucer').checked,
    fertilizers: invGetSelectedFerts(),
    diseases: invTempDiseases,
  };
  // Preserva i simParams eventualmente già salvati per questo vaso
  // (l'utente può averli impostati dal modal simulatore senza modificarli qui)
  if (editId) {
    const existing = invLoad().find(x => x.id === +editId);
    if (existing && existing.simParams) entry.simParams = existing.simParams;
  }
  if (editId) {
    await invAPIUpdate(+editId, entry);
  } else {
    await invAPIAdd(entry);
  }
  invCache = null;
  await invLoadFromAPI();
  // Garantisco che sPlants contenga le piante custom prima di renderizzare.
  // Questo è cruciale perché invRender chiama getPlantById per ogni vaso,
  // e se la pianta custom non è in sPlants la card non viene disegnata
  // (l'utente vedrebbe la lista vuota anche se il vaso è stato salvato).
  // loadCustomPlants è idempotente: chiamarla qui non causa duplicazioni.
  if (typeof loadCustomPlants === 'function') {
    await loadCustomPlants();
  }
  invCloseForm();
  invRender();
  if (typeof buildCurativeEvents === 'function') buildCurativeEvents();
}

async function invDelete() {
  const editId = +document.getElementById('inv-edit-id').value;
  if (!editId || !confirm('Eliminare questo vaso?')) return;
  await invAPIDelete(editId);
  invCache = null;
  await invLoadFromAPI();
  // Stesso pattern di invSave: garantisco che sPlants contenga le custom
  // prima di renderizzare. Non strettamente necessario per il delete, ma
  // mantiene la coerenza del codice e protegge da scenari di edge case.
  if (typeof loadCustomPlants === 'function') {
    await loadCustomPlants();
  }
  invCloseForm();
  invRender();
  if (typeof buildCurativeEvents === 'function') buildCurativeEvents();
}

function invCalcVol(shape, diam, h) {
  const r = diam/2;
  if (shape==='square') return (diam*diam*h)/1000*0.85;
  return (Math.PI*r*r*h)/1000*0.85;
}

function invGetVolFromItem(it) {
  const shape = it.potShape || 'cylinder';
  if (shape === 'square') {
    if (it.potVolSq) return it.potVolSq;
    const w = it.potW || 25, d = it.potD || 25, h = it.potHSq || 22;
    return (w * d * h) / 1000 * 0.85;
  }
  if (shape === 'truncated') {
    if (it.potVolTrunc) return it.potVolTrunc;
    const r1 = (it.potDiamTop || 25) / 2, r2 = (it.potDiamBot || 18) / 2, h = it.potHTrunc || 22;
    return (Math.PI / 3 * h * (r1*r1 + r1*r2 + r2*r2)) / 1000 * 0.85;
  }
  // cylinder
  if (it.potVol) return it.potVol;
  return invCalcVol('cylinder', it.potDiam || 25, it.potH || 22);
}

function invGetDimsLabel(it) {
  const shape = it.potShape || 'cylinder';
  if (shape === 'square') {
    return `${it.potW||25}×${it.potD||25}×${it.potHSq||22} cm`;
  }
  if (shape === 'truncated') {
    return `Ø${it.potDiamTop||25}/${it.potDiamBot||18}×${it.potHTrunc||22} cm`;
  }
  return `Ø${it.potDiam||25}×${it.potH||22} cm`;
}

const INV_LOC_LABELS = {indoor:'🏠 Interno',outdoor:'☀️ Esterno',balcone:'🏗️ Balcone'};
const INV_SUB_LABELS = {universale_mix:'Universale',succulente_mix:'Succulente',orchidee_mix:'Orchidee',agrumi_mix:'Agrumi',bonsai_mix:'Bonsai',mediterranee_mix:'Mediterranee',tropicali_mix:'Tropicali',acidofile_mix:'Acidofile',arbusti_mix:'Arbusti',custom:'Personalizzato'};

function invRender() {
  const items = invLoad();
  const search = (document.getElementById('inv-search')?.value||'').toLowerCase();
  const locFilter = document.getElementById('inv-filter-loc')?.value||'';
  const filtered = items.filter(it => {
    const p = getPlantById(it.plantTypeIdx);
    if (!p) return false;
    const nameMatch = !search || p.name.toLowerCase().includes(search) || (it.nickname||'').toLowerCase().includes(search);
    const locMatch = !locFilter || it.location === locFilter;
    return nameMatch && locMatch;
  });
  const countEl = document.getElementById('inv-count');
  const totalPots = filtered.reduce((s,it)=>s+(it.qty||1),0);
  if (countEl) countEl.textContent = filtered.length+' piante · '+totalPots+' vasi';
  const grid = document.getElementById('inv-grid');
  let html = '';
  filtered.forEach(it => {
    const p = getPlantById(it.plantTypeIdx);
    if (!p) return;
    const vol = invGetVolFromItem(it);
    const dimsLabel = invGetDimsLabel(it);
    const activeDiseases = (it.diseases||[]).filter(d=>!d.resolved);
    const ferts = (it.fertilizers||[]).slice(0,4).map(fid => {
      const f = FERT_DB.find(x=>x.id===fid);
      return f ? `<span class="inv-fert-chip">${f.name}</span>` : '';
    }).join('');
    const moreFerts = (it.fertilizers||[]).length > 4 ? `<span class="inv-fert-chip">+${it.fertilizers.length-4}</span>` : '';
    html += `<div class="inv-card" onclick="invOpenEdit(${it.id})">
      <div class="inv-card-head">
        <div class="inv-card-icon">${p.icon}</div>
        <div>
          <div class="inv-card-title">${it.nickname || p.name}</div>
          <div class="inv-card-sub">${p.name}${p.latin?' · '+p.latin:''}</div>
        </div>
      </div>
      ${it.qty>1?`<div class="inv-card-qty">×${it.qty} vasi</div>`:''}
      <div class="inv-detail-row"><span class="inv-lbl">Posizione</span><span class="inv-val">${INV_LOC_LABELS[it.location]||it.location}</span></div>
      <div class="inv-detail-row"><span class="inv-lbl">Vaso</span><span class="inv-val">${dimsLabel} · ${vol.toFixed(1)} L · ${it.potMat}</span></div>
      <div class="inv-detail-row"><span class="inv-lbl">Substrato</span><span class="inv-val">${it.substrate==='custom'&&it.customSubstrate ? 'Personalizzato: '+Object.entries(it.customSubstrate).map(([k,v])=>{const s=wSubstrates.find(x=>x.id===k);return (s?s.name:k)+' '+v+'%';}).join(', ') : INV_SUB_LABELS[it.substrate]||it.substrate}</span></div>
      ${ferts?`<div style="margin-top:4px">${ferts}${moreFerts}</div>`:''}
      ${activeDiseases.length?`<div style="margin-top:4px">${activeDiseases.map(d=>`<span class="inv-disease-chip active">⚠️ ${INV_DISEASE_LABELS[d.type]||d.type}</span>`).join(' ')}</div>`:''}
      ${it.wh51Ch?`<div class="inv-soil-badge offline" id="inv-soil-${it.id}">📡 CH${it.wh51Ch} · in attesa dati...</div>`:''}
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap" onclick="event.stopPropagation()">
        <button class="ctrl-btn" style="flex:1;padding:6px 10px;font-size:11px;background:#edf5ff;border-color:#b0c8e8;color:#2a5a8a;border-radius:8px;cursor:pointer" onclick="event.stopPropagation();simOpen(${it.id})">🔮 Simula bilancio idrico</button>
      </div>
    </div>`;
  });
  // Add button
  html += `<div class="inv-add-btn" onclick="invOpenAdd()">
    <div style="font-size:28px;margin-bottom:4px">+</div>
    Aggiungi vaso
  </div>`;
  if (!filtered.length && items.length) {
    html = `<div class="inv-empty"><span class="empty-icon">🔍</span>Nessun risultato per i filtri attuali</div>` + html;
  } else if (!items.length) {
    html = `<div class="inv-empty"><span class="empty-icon">📦</span>Nessun vaso ancora registrato.<br>Inizia ad aggiungere le tue piante!</div>` + html;
  }
  grid.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════
// ⑪ METEO E SENSORI ECOWITT
// ══════════════════════════════════════════════════════════════════════

const METEO_API = '/api/ecowitt';
let meteoData = null;
let meteoConfig = null;
let meteoTimer = null;

const SOGLIE_DEFAULT = {
  succulente:   {secco:10, ok_min:10, ok_max:35, umido:40},
  tropicali:    {secco:25, ok_min:25, ok_max:55, umido:65},
  mediterranee: {secco:15, ok_min:15, ok_max:40, umido:50},
  agrumi:       {secco:20, ok_min:20, ok_max:50, umido:60},
  bonsai:       {secco:20, ok_min:20, ok_max:50, umido:60},
  orchidee:     {secco:15, ok_min:15, ok_max:40, umido:50},
  aromatiche:   {secco:8,  ok_min:8,  ok_max:30, umido:35},
  universale:   {secco:20, ok_min:20, ok_max:50, umido:60},
};

async function meteoInit() {
  try {
    const res = await apiFetch(METEO_API+'/config');
    meteoConfig = await res.json();
  } catch { meteoConfig = {configured:false, soglie:SOGLIE_DEFAULT}; }
}

async function meteoRefresh() {
  const statusEl = document.getElementById('meteo-status');
  if (!meteoConfig || !meteoConfig.configured) {
    statusEl.innerHTML = '⚠️ Ecowitt non configurato — inserisci le chiavi API in <b>config.json</b> e riavvia il server';
    document.getElementById('meteo-weather').innerHTML = meteoPlaceholderWidgets();
    document.getElementById('meteo-soil').innerHTML = '<div style="text-align:center;color:var(--muted);padding:1rem;font-size:12px">Configura Ecowitt per vedere i dati dei sensori WH51</div>';
    document.getElementById('meteo-alerts').innerHTML = '';
    // Le previsioni Open-Meteo funzionano anche senza Ecowitt
    meteoFetchForecast();
    return;
  }
  statusEl.textContent = '⏳ Caricamento dati...';
  try {
    const res = await apiFetch(METEO_API+'/realtime');
    meteoData = await res.json();
    if (meteoData.code !== 0 && meteoData.code !== undefined) {
      statusEl.textContent = '❌ Errore API: '+(meteoData.msg||meteoData.message||'sconosciuto');
      return;
    }
    const now = new Date();
    statusEl.textContent = '🟢 Ultimo aggiornamento: '+now.toLocaleTimeString('it-IT');
    meteoRenderWeather();
    meteoRenderSoil();
    meteoRenderAlerts();
    meteoUpdateInvBadges();
    meteoFetchForecast();
    meteoRenderHistory();
    // Auto-refresh ogni 5 minuti
    if (meteoTimer) clearInterval(meteoTimer);
    meteoTimer = setInterval(meteoRefresh, 300000);
  } catch(e) {
    statusEl.textContent = '❌ Server non raggiungibile — avvia server.py';
  }
}

function meteoPlaceholderWidgets() {
  const items = [
    {icon:'🌡️',label:'Temperatura',val:'--°C'},
    {icon:'💧',label:'Umidità',val:'--%'},
    {icon:'🌧️',label:'Pioggia oggi',val:'-- mm'},
    {icon:'☀️',label:'Radiazione',val:'-- W/m²'},
    {icon:'💨',label:'Vento',val:'-- km/h'},
    {icon:'🏠',label:'Temp. interna',val:'--°C'},
  ];
  return items.map(i=>`<div class="meteo-widget"><div class="mw-icon">${i.icon}</div><div class="mw-val">${i.val}</div><div class="mw-label">${i.label}</div></div>`).join('');
}

function meteoGetVal(data, section, key) {
  try {
    const s = data.data[section];
    if (!s) return null;
    const item = s[key];
    if (!item) return null;
    return item.value !== undefined ? item.value : item;
  } catch { return null; }
}

// ── Lettura dati WH52 (moisture + temperatura + EC) ──────────────────
// Le API Ecowitt per WH52 restituiscono:
// - soilmoisture<ch>   (come WH51) → %
// - tf_ch<ch> oppure soil_temperature<ch> → °C
// - soilad<ch> oppure ec_ch<ch> → µS/cm
function meteoGetSoilData(data, ch) {
  const result = {moisture: null, temp: null, ec: null};
  if (!data || !data.data) return result;

  // Moisture: cerca in section 'soil'
  const getV = (sec, key) => {
    try {
      const s = data.data[sec]; if (!s) return null;
      const item = s[key]; if (!item) return null;
      const v = item.value !== undefined ? item.value : item;
      return v === null || v === '' || v === '--' ? null : parseFloat(v);
    } catch { return null; }
  };

  result.moisture = getV('soil', 'soilmoisture'+ch) || getV('soil_ch'+ch, 'soilmoisture') || getV('soil', 'soil_ch'+ch);

  // Temp: il WH52 usa tf_ch<N> nella sezione temp_and_humidity_ch<N> oppure soil section
  result.temp = getV('soil', 'soiltemp'+ch) || getV('soil', 'tf_ch'+ch) || getV('tf_ch'+ch, 'temperature') || getV('temp_and_humidity_ch'+ch, 'temperature');

  // EC: soilad<N> o ec_ch<N>
  result.ec = getV('soil', 'soilad'+ch) || getV('soil', 'ec_ch'+ch) || getV('soil', 'soilec'+ch) || getV('soil_ch'+ch, 'ec');

  return result;
}

// ── Lettura dati sensore interno WN31 (temp + umidità ambiente) ───────
// Il WN31 CH1 è il sensore ambiente interno. L'API Ecowitt espone i dati in
// 'temp_and_humidity_ch1' (formato cloud), con fallback a 'indoor' per la
// stazione base principale (HP2551/GW2000 integrati).
function meteoGetIndoorData(data, ch) {
  ch = ch || 1;  // Default CH1
  const result = {temp: null, humidity: null};
  if (!data || !data.data) return result;
  const getV = (sec, key) => {
    try {
      const s = data.data[sec]; if (!s) return null;
      const item = s[key]; if (!item) return null;
      const v = item.value !== undefined ? item.value : item;
      return v === null || v === '' || v === '--' ? null : parseFloat(v);
    } catch { return null; }
  };

  // Prima prova il canale WN31 specifico
  result.temp = getV('temp_and_humidity_ch'+ch, 'temperature');
  result.humidity = getV('temp_and_humidity_ch'+ch, 'humidity');

  // Fallback: sensore 'indoor' della stazione base
  if (result.temp === null) result.temp = getV('indoor', 'temperature');
  if (result.humidity === null) result.humidity = getV('indoor', 'humidity');

  return result;
}

// ── Selettore meteo per pianta: indoor (WN31) o outdoor (Ecowitt+Open-Meteo) ──
// Restituisce sempre un set di valori utilizzabili per ET₀ e simulazione.
// Per piante indoor, radiazione solare e vento usano valori FAO surrogati.
function meteoPickForLocation(data, location) {
  const isIndoor = location === 'indoor';
  if (isIndoor) {
    const indoor = meteoGetIndoorData(data, 1);
    return {
      isIndoor: true,
      temp: indoor.temp,
      humidity: indoor.humidity,
      // Surrogati FAO per ambienti chiusi:
      // vento bassissimo (ambiente stagnante), radiazione ridotta (luce indiretta)
      windKmh: 2,       // ≈0.55 m/s — raccomandazione FAO per interni
      solarWm2: 300,    // luce diffusa tipica vicino a finestra luminosa
      rainMm: 0,        // mai pioggia indoor
      source: 'wn31',
    };
  }
  // Outdoor: usa dati Ecowitt esterni
  const getV = (sec, key) => {
    try {
      const s = data && data.data && data.data[sec]; if (!s) return null;
      const item = s[key]; if (!item) return null;
      const v = item.value !== undefined ? item.value : item;
      return v === null || v === '' || v === '--' ? null : parseFloat(v);
    } catch { return null; }
  };
  return {
    isIndoor: false,
    temp: getV('outdoor', 'temperature'),
    humidity: getV('outdoor', 'humidity'),
    windKmh: getV('wind', 'wind_speed'),
    solarWm2: getV('solar_and_uvi', 'solar'),
    rainMm: getV('rainfall', 'daily'),
    source: 'ecowitt_outdoor',
  };
}

function meteoRenderWeather() {
  if (!meteoData || !meteoData.data) return;
  const d = meteoData.data;
  const widgets = [];

  // Temperatura esterna
  const tempOut = meteoGetVal(meteoData,'outdoor','temperature');
  const feelsLike = meteoGetVal(meteoData,'outdoor','feels_like');
  widgets.push({icon:'🌡️', val:tempOut!==null?parseFloat(tempOut).toFixed(1)+'°C':'--', label:'Temperatura', sub:feelsLike?'Percepita: '+parseFloat(feelsLike).toFixed(1)+'°C':''});

  // Umidità esterna
  const humOut = meteoGetVal(meteoData,'outdoor','humidity');
  widgets.push({icon:'💧', val:humOut!==null?humOut+'%':'--', label:'Umidità'});

  // Pioggia
  const rainDay = meteoGetVal(meteoData,'rainfall','daily');
  const rainRate = meteoGetVal(meteoData,'rainfall','rain_rate');
  widgets.push({icon:'🌧️', val:rainDay!==null?parseFloat(rainDay).toFixed(1)+' mm':'--', label:'Pioggia oggi', sub:rainRate&&parseFloat(rainRate)>0?'In corso: '+rainRate+' mm/h':''});

  // Solare
  const solar = meteoGetVal(meteoData,'solar_and_uvi','solar');
  const uvi = meteoGetVal(meteoData,'solar_and_uvi','uvi');
  widgets.push({icon:'☀️', val:solar!==null?parseFloat(solar).toFixed(0)+' W/m²':'--', label:'Radiazione solare', sub:uvi?'UV: '+uvi:''});

  // Vento
  const wind = meteoGetVal(meteoData,'wind','wind_speed');
  const gust = meteoGetVal(meteoData,'wind','wind_gust');
  widgets.push({icon:'💨', val:wind!==null?parseFloat(wind).toFixed(1)+' km/h':'--', label:'Vento', sub:gust?'Raffica: '+parseFloat(gust).toFixed(1)+' km/h':''});

  // Temperatura interna
  const tempIn = meteoGetVal(meteoData,'indoor','temperature');
  const humIn = meteoGetVal(meteoData,'indoor','humidity');
  widgets.push({icon:'🏠', val:tempIn!==null?parseFloat(tempIn).toFixed(1)+'°C':'--', label:'Temp. interna', sub:humIn?'Umidità: '+humIn+'%':''});

  // Pressione
  const press = meteoGetVal(meteoData,'pressure','relative');
  widgets.push({icon:'🌀', val:press!==null?parseFloat(press).toFixed(1)+' hPa':'--', label:'Pressione'});

  document.getElementById('meteo-weather').innerHTML = widgets.map(w =>
    `<div class="meteo-widget"><div class="mw-icon">${w.icon}</div><div class="mw-val">${w.val}</div><div class="mw-label">${w.label}</div>${w.sub?`<div style="font-size:9px;color:var(--muted);margin-top:2px">${w.sub}</div>`:''}</div>`
  ).join('');
}

function meteoRenderSoil() {
  if (!meteoData || !meteoData.data) return;
  const inv = invLoad();
  const soglie = PARAMS.soglie || SOGLIE_DEFAULT;
  const sogliEC = PARAMS.sogliEC || {};

  // Raccogli tutti i dati soil (moisture + temp + EC) per canale
  const soilByCh = {};
  for (let ch=1; ch<=16; ch++) {
    const d = meteoGetSoilData(meteoData, ch);
    if (d.moisture !== null || d.temp !== null || d.ec !== null) {
      soilByCh[ch] = d;
    }
  }

  // Associa ogni sensore al vaso corrispondente
  const cards = [];
  inv.forEach(it => {
    if (!it.wh51Ch) return;
    const ch = parseInt(it.wh51Ch);
    const data = soilByCh[ch] || {moisture:null, temp:null, ec:null};
    const p = getPlantById(it.plantTypeIdx);
    if (!p) return;
    const cat = it.wh51Cat || 'universale';
    const thresh = soglie[cat] || SOGLIE_DEFAULT.universale;
    const ecThresh = sogliEC[cat] || sogliEC.universale || {min:400, target:800, max:2000};
    const isWH52 = it.sensorType === 'wh52';

    let status, statusText, barColor;
    if (data.moisture === null) {
      status = 'offline'; statusText = 'Sensore offline'; barColor = '#ccc';
    } else if (data.moisture < thresh.secco) {
      status = 'dry'; statusText = '🔴 Troppo secco — annaffia!'; barColor = '#c04040';
    } else if (data.moisture <= thresh.ok_max) {
      status = 'ok'; statusText = '🟢 Umidità ottimale'; barColor = '#5a7a4a';
    } else {
      status = 'wet'; statusText = '🔵 Troppo umido — aspetta'; barColor = '#3a6abf';
    }

    cards.push({it, p, ch, data, status, statusText, barColor, thresh, ecThresh, isWH52, cat});
  });

  // Aggiungi anche i canali attivi senza associazione
  Object.entries(soilByCh).forEach(([ch, data]) => {
    if (!cards.find(c => c.ch === parseInt(ch))) {
      cards.push({it:null, p:null, ch:parseInt(ch), data, status:'ok', statusText:'Non associato a un vaso', barColor:'#aaa', thresh:SOGLIE_DEFAULT.universale, isWH52: data.temp !== null || data.ec !== null});
    }
  });

  if (!cards.length) {
    document.getElementById('meteo-soil').innerHTML = '<div style="text-align:center;color:var(--muted);padding:1rem;font-size:12px">Nessun sensore WH51/WH52 rilevato. Associa i canali nella sezione 📦 Vasi.</div>';
    return;
  }

  document.getElementById('meteo-soil').innerHTML = cards.map(c => {
    const name = c.p ? (c.it.nickname || c.p.name) : 'Canale '+c.ch;
    const icon = c.p ? c.p.icon : '📡';
    const mVal = c.data.moisture !== null ? c.data.moisture.toFixed(0)+'%' : '--';
    const barW = c.data.moisture !== null ? Math.min(100, c.data.moisture) : 0;
    const sensorBadge = c.isWH52 ? '<span style="font-size:8px;background:#6a4a9a;color:#fff;padding:1px 5px;border-radius:8px;font-weight:600;margin-left:4px">WH52</span>' : '';

    // Sezione temp + EC (solo se WH52)
    let extraInfo = '';
    if (c.isWH52 && (c.data.temp !== null || c.data.ec !== null)) {
      const parts = [];
      if (c.data.temp !== null) {
        const tempColor = c.data.temp < PARAMS.tempRadiciMin ? '#3a6abf' :
                          c.data.temp > PARAMS.tempRadiciMax ? '#c04040' : '#5a7a4a';
        const tempIcon = c.data.temp < PARAMS.tempRadiciMin ? '❄️' :
                          c.data.temp > PARAMS.tempRadiciMax ? '🔥' : '🌡️';
        parts.push(`<span style="font-size:10px;color:${tempColor};font-weight:600">${tempIcon} ${c.data.temp.toFixed(1)}°C</span>`);
      }
      if (c.data.ec !== null) {
        let ecColor = '#5a7a4a', ecStatus = '';
        if (c.ecThresh) {
          if (c.data.ec < c.ecThresh.min) { ecColor = '#c08040'; ecStatus = '· scarso'; }
          else if (c.data.ec > c.ecThresh.max) { ecColor = '#c04040'; ecStatus = '· lavaggio!'; }
          else if (c.data.ec > c.ecThresh.target * 1.3) { ecColor = '#c08040'; ecStatus = '· alto'; }
        }
        // Affidabilità: se moisture bassa, mostra avviso
        const unreliable = c.data.moisture !== null && c.data.moisture < PARAMS.ecMoistureMin;
        parts.push(`<span style="font-size:10px;color:${unreliable ? '#aaa' : ecColor};font-weight:600" title="${unreliable ? 'Lettura inaffidabile: terreno troppo secco' : ''}">⚡ ${Math.round(c.data.ec)} µS/cm ${unreliable ? '<span style=\"opacity:.7\">(instabile)</span>' : ecStatus}</span>`);
      }
      extraInfo = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;padding:4px 0;border-top:1px dashed var(--border)">${parts.join('')}</div>`;
    }

    return `<div class="soil-card">
      <div class="soil-card-head">
        <span class="soil-card-icon">${icon}</span>
        <span class="soil-card-name">${name}${sensorBadge}</span>
        <span class="soil-card-ch">CH${c.ch}</span>
      </div>
      <div class="soil-bar">
        <div class="soil-bar-fill" style="width:${barW}%;background:${c.barColor}"></div>
        <div class="soil-bar-label">${mVal}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="soil-status ${c.status}">${c.statusText}</span>
        ${c.thresh?`<span style="font-size:9px;color:var(--muted)">Soglie: ${c.thresh.secco}% – ${c.thresh.ok_max}%</span>`:''}
      </div>
      ${extraInfo}
    </div>`;
  }).join('');
}

function meteoRenderAlerts() {
  if (!meteoData || !meteoData.data) return;
  const inv = invLoad();
  const soglie = PARAMS.soglie || SOGLIE_DEFAULT;
  const alerts = [];

  // Temp esterna
  const tempOut = meteoGetVal(meteoData,'outdoor','temperature');
  if (tempOut !== null) {
    const t = parseFloat(tempOut);
    if (t < PARAMS.alertFrost) alerts.push({type:'danger', icon:'🥶', text:`<b>Temperatura ${t.toFixed(1)}°C!</b> Porta dentro Carmona (<12°C), Stella di Natale, Tradescantia, e proteggi il Limone (<5°C).`});
    else if (t < PARAMS.alertFrost + 5) alerts.push({type:'warn', icon:'❄️', text:`<b>Temperatura ${t.toFixed(1)}°C</b> — il Carmona Bonsai e la Stella di Natale non devono stare fuori sotto i 12°C.`});
    else if (t > PARAMS.alertHeat) alerts.push({type:'warn', icon:'🔥', text:`<b>Temperatura ${t.toFixed(1)}°C!</b> Sposta le piante in ombra e aumenta le annaffiature. Nebulizza le foglie la sera.`});
  }

  // Pioggia
  const rainDay = meteoGetVal(meteoData,'rainfall','daily');
  if (rainDay !== null && parseFloat(rainDay) > PARAMS.rainSkip) {
    alerts.push({type:'info', icon:'🌧️', text:`<b>Pioggia oggi: ${parseFloat(rainDay).toFixed(1)} mm</b> — puoi saltare l'annaffiatura delle piante all'esterno.`});
  }

  // Vento forte
  const gust = meteoGetVal(meteoData,'wind','wind_gust');
  if (gust !== null && parseFloat(gust) > PARAMS.alertWind) {
    alerts.push({type:'warn', icon:'💨', text:`<b>Raffiche a ${parseFloat(gust).toFixed(0)} km/h!</b> Proteggi i bonsai e le piante alte. Ripara i vasi leggeri.`});
  }

  // Umidità interna bassa
  const humIn = meteoGetVal(meteoData,'indoor','humidity');
  if (humIn !== null && parseInt(humIn) < PARAMS.alertHumIn) {
    alerts.push({type:'info', icon:'🏠', text:`<b>Umidità interna ${humIn}%</b> — bassa per orchidee e Carmona (ideale >50%). Nebulizza o usa un vassoio con argilla espansa.`});
  }

  // Suolo secco per piante con sensore
  const soilData = {};
  for (let ch=1; ch<=16; ch++) {
    let val = meteoGetVal(meteoData,'soil','soilmoisture'+ch);
    if (val === null) val = meteoGetVal(meteoData,'soil','soil_ch'+ch);
    if (val !== null) soilData[ch] = parseFloat(val);
  }

  const dryPlants = [];
  const wetPlants = [];
  inv.forEach(it => {
    if (!it.wh51Ch) return;
    const ch = parseInt(it.wh51Ch);
    const m = soilData[ch];
    if (m === undefined) return;
    const p = getPlantById(it.plantTypeIdx);
    if (!p) return;
    const cat = it.wh51Cat || 'universale';
    const thresh = soglie[cat] || SOGLIE_DEFAULT.universale;
    const name = it.nickname || p.name;
    if (m < thresh.secco) dryPlants.push(`${p.icon} ${name} (${m}%)`);
    if (m > thresh.umido) wetPlants.push(`${p.icon} ${name} (${m}%)`);
  });

  if (dryPlants.length) {
    alerts.push({type:'danger', icon:'🏜️', text:`<b>Terreno troppo secco!</b> Annaffia: ${dryPlants.join(', ')}`});
  }
  if (wetPlants.length) {
    alerts.push({type:'info', icon:'💦', text:`<b>Terreno troppo umido</b> — aspetta prima di annaffiare: ${wetPlants.join(', ')}`});
  }

  if (!alerts.length) {
    alerts.push({type:'good', icon:'✅', text:'Tutto nella norma — nessuna allerta attiva.'});
  }

  document.getElementById('meteo-alerts').innerHTML = alerts.map(a =>
    `<div class="alert-card ${a.type}"><span class="alert-icon">${a.icon}</span><span class="alert-text">${a.text}</span></div>`
  ).join('');
}

function meteoUpdateInvBadges() {
  if (!meteoData || !meteoData.data) return;
  const inv = invLoad();
  const soglie = PARAMS.soglie || SOGLIE_DEFAULT;

  const soilData = {};
  for (let ch=1; ch<=16; ch++) {
    let val = meteoGetVal(meteoData,'soil','soilmoisture'+ch);
    if (val === null) val = meteoGetVal(meteoData,'soil','soil_ch'+ch);
    if (val !== null) soilData[ch] = parseFloat(val);
  }

  inv.forEach(it => {
    const badge = document.getElementById('inv-soil-'+it.id);
    if (!badge || !it.wh51Ch) return;
    const ch = parseInt(it.wh51Ch);
    const m = soilData[ch];
    const cat = it.wh51Cat || 'universale';
    const thresh = soglie[cat] || SOGLIE_DEFAULT.universale;

    if (m === undefined) {
      badge.className = 'inv-soil-badge offline';
      badge.textContent = '📡 CH'+ch+' · sensore offline';
      return;
    }

    let cls, text;
    if (m < thresh.secco) { cls='dry'; text=`🔴 ${m}% — annaffia!`; }
    else if (m <= thresh.ok_max) { cls='ok'; text=`🟢 ${m}% — OK`; }
    else { cls='wet'; text=`🔵 ${m}% — troppo umido`; }
    badge.className = 'inv-soil-badge '+cls;
    badge.textContent = '📡 CH'+ch+' · '+text;
  });
}

// ── Previsioni 7 giorni (Open-Meteo) ─────────────────────────────────
const WMO_ICONS = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌧️',55:'🌧️',56:'🌨️',57:'🌨️',61:'🌧️',63:'🌧️',65:'🌧️',66:'🌨️',67:'🌨️',71:'🌨️',73:'❄️',75:'❄️',77:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',85:'❄️',86:'❄️',95:'⛈️',96:'⛈️',99:'⛈️'};
const WMO_LABELS = {0:'Sereno',1:'Prev. sereno',2:'Parz. nuvoloso',3:'Coperto',45:'Nebbia',48:'Nebbia gelata',51:'Pioggerella',53:'Pioggia leggera',55:'Pioggia',61:'Pioggia leggera',63:'Pioggia moderata',65:'Pioggia forte',66:'Pioggia gelata',71:'Neve leggera',73:'Neve',75:'Neve forte',80:'Rovesci',81:'Rovesci forti',82:'Temporale',85:'Neve a rovesci',95:'Temporale',96:'Temporale con grandine',99:'Temporale violento'};
const FC_DAYS_IT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];

// ── Trend grafici WH52 (EC + temp radici, ultime 24h) ───────────────
async function meteoRenderHistory() {
  const el = document.getElementById('meteo-history');
  if (!el) return;

  const inv = invLoad();
  const wh52Items = inv.filter(it => it.sensorType === 'wh52' && it.wh51Ch);

  if (!wh52Items.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1rem;font-size:11px">Nessun sensore WH52 configurato — i grafici trend sono disponibili solo per i sensori 3-in-1</div>';
    return;
  }

  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1rem;font-size:11px">⏳ Caricamento storico...</div>';

  // Fetch dati storici ultime 24h
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const dateStr = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');

  try {
    const res = await apiFetch(`/api/ecowitt/history?start_date=${dateStr(yesterday)}&end_date=${dateStr(today)}&call_back=soil`);
    const json = await res.json();
    if (!json.configured || json.code !== 0) {
      el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1rem;font-size:11px">Storico non disponibile — verifica configurazione Ecowitt</div>';
      return;
    }

    const soilHistory = json.data && json.data.soil ? json.data.soil : {};

    // Per ogni sensore WH52: estrai serie EC e temp
    let html = '';
    wh52Items.forEach(it => {
      const ch = parseInt(it.wh51Ch);
      const p = getPlantById(it.plantTypeIdx);
      if (!p) return;
      const name = it.nickname || p.name;
      const cat = it.wh51Cat || 'universale';
      const ecThresh = (PARAMS.sogliEC || {})[cat] || {min:400, target:800, max:2000};

      // Cerca le serie nei dati: possibili chiavi
      const ecKeys = [`soilad${ch}`, `ec_ch${ch}`, `soilec${ch}`];
      const tempKeys = [`soiltemp${ch}`, `tf_ch${ch}`];
      const moistKeys = [`soilmoisture${ch}`, `soil_ch${ch}`];

      const findSeries = keys => {
        for (const k of keys) {
          if (soilHistory[k] && soilHistory[k].list) return soilHistory[k].list;
          if (json.data[k] && json.data[k].list) return json.data[k].list;
        }
        return null;
      };

      const ecSeries = findSeries(ecKeys);
      const tempSeries = findSeries(tempKeys);
      const moistSeries = findSeries(moistKeys);

      html += `<div class="soil-card" style="margin-bottom:8px">
        <div class="soil-card-head">
          <span class="soil-card-icon">${p.icon}</span>
          <span class="soil-card-name">${name} <span style="font-size:8px;background:#6a4a9a;color:#fff;padding:1px 5px;border-radius:8px;font-weight:600;margin-left:4px">WH52</span></span>
          <span class="soil-card-ch">CH${ch}</span>
        </div>
        ${renderTrendChart(ecSeries, moistSeries, ecThresh, 'EC', 'µS/cm', '#9a7a20')}
        ${renderTrendChart(tempSeries, null, {min:PARAMS.tempRadiciMin, max:PARAMS.tempRadiciMax}, 'Temp radici', '°C', '#c06040')}
      </div>`;
    });

    el.innerHTML = html || '<div style="text-align:center;color:var(--muted);padding:1rem;font-size:11px">Dati storici in attesa — i sensori devono aver trasmesso per almeno 1-2 ore</div>';

  } catch(e) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1rem;font-size:11px">Errore caricamento storico: server non raggiungibile</div>';
  }
}

function renderTrendChart(series, moistSeries, thresh, label, unit, color) {
  if (!series || typeof series !== 'object') {
    return `<div style="font-size:10px;color:var(--muted);padding:6px 0">${label}: nessun dato storico disponibile</div>`;
  }

  // series è un oggetto {timestamp: value} o {list:{...}} — normalizza
  let entries = [];
  const listObj = series.list || series;
  if (typeof listObj === 'object') {
    entries = Object.entries(listObj)
      .map(([ts, v]) => ({ts: parseInt(ts), val: parseFloat(v)}))
      .filter(e => !isNaN(e.val) && !isNaN(e.ts))
      .sort((a,b) => a.ts - b.ts);
  }

  if (!entries.length) return `<div style="font-size:10px;color:var(--muted);padding:6px 0">${label}: nessun dato</div>`;

  // Filtra solo le ultime 24h
  const nowTs = Date.now() / 1000;
  entries = entries.filter(e => e.ts > nowTs - 86400);
  if (!entries.length) return `<div style="font-size:10px;color:var(--muted);padding:6px 0">${label}: nessun dato nelle ultime 24h</div>`;

  // Moisture series per affidabilità EC (se label === 'EC')
  let moistMap = {};
  if (moistSeries) {
    const mList = moistSeries.list || moistSeries;
    Object.entries(mList).forEach(([ts, v]) => { moistMap[parseInt(ts)] = parseFloat(v); });
  }

  const vals = entries.map(e => e.val);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(0.1, max - min);
  const W = 400, H = 80, padL = 40, padR = 10, padT = 10, padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const tsMin = entries[0].ts;
  const tsMax = entries[entries.length - 1].ts;
  const tsRange = Math.max(1, tsMax - tsMin);

  // Threshold lines
  let threshLines = '';
  if (thresh) {
    if (thresh.min !== undefined) {
      const y = padT + plotH - ((thresh.min - min) / range) * plotH;
      if (y >= padT && y <= padT + plotH) {
        threshLines += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#c08040" stroke-width="1" stroke-dasharray="3,2" opacity="0.5"/>`;
        threshLines += `<text x="${W-padR-2}" y="${y-2}" font-size="8" fill="#c08040" text-anchor="end">min ${thresh.min}</text>`;
      }
    }
    if (thresh.max !== undefined) {
      const y = padT + plotH - ((thresh.max - min) / range) * plotH;
      if (y >= padT && y <= padT + plotH) {
        threshLines += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#c04040" stroke-width="1" stroke-dasharray="3,2" opacity="0.5"/>`;
        threshLines += `<text x="${W-padR-2}" y="${y-2}" font-size="8" fill="#c04040" text-anchor="end">max ${thresh.max}</text>`;
      }
    }
    if (thresh.target !== undefined) {
      const y = padT + plotH - ((thresh.target - min) / range) * plotH;
      if (y >= padT && y <= padT + plotH) {
        threshLines += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#5a7a4a" stroke-width="1" stroke-dasharray="2,3" opacity="0.4"/>`;
      }
    }
  }

  // Path
  const points = entries.map(e => {
    const x = padL + ((e.ts - tsMin) / tsRange) * plotW;
    const y = padT + plotH - ((e.val - min) / range) * plotH;
    return {x, y, val: e.val, ts: e.ts, moist: moistMap[e.ts]};
  });
  const pathD = 'M' + points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');

  // Dots con indicazione affidabilità EC
  let dots = '';
  points.forEach((p, i) => {
    const unreliable = label === 'EC' && p.moist !== undefined && p.moist < PARAMS.ecMoistureMin;
    const dotColor = unreliable ? '#ccc' : color;
    dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="${dotColor}" opacity="${unreliable ? 0.4 : 0.8}"/>`;
  });

  // Y-axis labels
  const yTicks = [min, (min+max)/2, max];
  let yLabels = yTicks.map(v => {
    const y = padT + plotH - ((v - min) / range) * plotH;
    return `<text x="${padL-4}" y="${y+3}" font-size="9" fill="var(--muted)" text-anchor="end">${v.toFixed(unit === '°C' ? 1 : 0)}</text>`;
  }).join('');

  // X-axis (ora)
  const fmtHour = ts => { const d = new Date(ts*1000); return d.getHours()+':'+String(d.getMinutes()).padStart(2,'0'); };
  const xLabels = `<text x="${padL}" y="${H-4}" font-size="9" fill="var(--muted)">${fmtHour(tsMin)}</text>
                   <text x="${W-padR}" y="${H-4}" font-size="9" fill="var(--muted)" text-anchor="end">${fmtHour(tsMax)}</text>`;

  const latest = entries[entries.length - 1].val;
  return `<div style="padding:8px 4px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
      <span style="font-size:11px;color:var(--text);font-weight:500">${label}</span>
      <span style="font-size:11px;color:${color};font-weight:600">${latest.toFixed(unit === '°C' ? 1 : 0)} ${unit}</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:90px;background:#fafaf6;border-radius:4px">
      ${threshLines}
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.5"/>
      ${dots}
      ${yLabels}
      ${xLabels}
    </svg>
  </div>`;
}

async function meteoFetchForecast() {
  const fcEl = document.getElementById('meteo-forecast');
  const alertsEl = document.getElementById('meteo-forecast-alerts');
  if (!fcEl) return;

  try {
    const res = await apiFetch('/api/forecast');
    const data = await res.json();
    if (data.error) {
      fcEl.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:11px;padding:1rem">❌ ${data.error}</div>`;
      return;
    }

    const daily = data.daily;
    if (!daily || !daily.time) {
      fcEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:11px;padding:1rem">Nessun dato previsione disponibile</div>';
      return;
    }

    const todayStr = new Date().toISOString().slice(0,10);

    // Render forecast cards
    let html = '<div class="fc-grid">';
    for (let i = 0; i < daily.time.length; i++) {
      const d = new Date(daily.time[i] + 'T12:00');
      const dayName = FC_DAYS_IT[d.getDay()];
      const dateStr = d.getDate() + '/' + (d.getMonth()+1);
      const tMax = daily.temperature_2m_max[i];
      const tMin = daily.temperature_2m_min[i];
      const rain = daily.precipitation_sum[i];
      const rainProb = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null;
      const windMax = daily.wind_speed_10m_max ? daily.wind_speed_10m_max[i] : null;
      const gustMax = daily.wind_gusts_10m_max ? daily.wind_gusts_10m_max[i] : null;
      const wcode = daily.weather_code ? daily.weather_code[i] : 0;
      const icon = WMO_ICONS[wcode] || '🌡️';
      const isToday = daily.time[i] === todayStr;

      // Alert classes
      let alertClass = '';
      if (tMin < PARAMS.alertFrost) alertClass = 'alert-frost';
      else if (tMax > PARAMS.alertHeat) alertClass = 'alert-heat';
      else if (rain > PARAMS.rainSure) alertClass = 'alert-rain';

      html += `<div class="fc-day ${isToday?'today':''} ${alertClass}">
        <div class="fc-day-name">${dayName}</div>
        <div class="fc-day-date">${dateStr}</div>
        <div class="fc-day-icon">${icon}</div>
        <div class="fc-day-temps">
          <span class="fc-day-max">${Math.round(tMax)}°</span>
          <span class="fc-day-min">${Math.round(tMin)}°</span>
        </div>
        ${rain > 0.1 ? `<div class="fc-day-rain">🌧️ ${rain.toFixed(1)}mm${rainProb?' ('+Math.round(rainProb)+'%)':''}</div>` : ''}
        ${windMax && windMax > 30 ? `<div class="fc-day-wind">💨 ${Math.round(windMax)} km/h</div>` : ''}
      </div>`;
    }
    html += '</div>';
    fcEl.innerHTML = html;

    // Generate predictive alerts
    const alerts = [];

    // Check frost in next 7 days
    for (let i = 0; i < daily.time.length; i++) {
      const tMin = daily.temperature_2m_min[i];
      const d = new Date(daily.time[i] + 'T12:00');
      const dayLabel = i === 0 ? 'Oggi' : i === 1 ? 'Domani' : FC_DAYS_IT[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1);

      if (tMin < 0) {
        alerts.push({type:'danger', icon:'🥶', text:`<b>GELO PREVISTO ${dayLabel}: ${Math.round(tMin)}°C</b> — temperatura sotto zero! Porta dentro tutte le piante tropicali (Carmona, Stella di Natale, Tradescantia), copri Limone e Oleandro con tessuto non tessuto.`});
      } else if (tMin < PARAMS.alertFrost) {
        alerts.push({type:'warn', icon:'❄️', text:`<b>Freddo ${dayLabel}: min ${Math.round(tMin)}°C</b> — porta al riparo Carmona (<12°C) e le piante tropicali. Controlla che il Limone sia protetto.`});
      }
    }

    // Check heat waves (3+ days above threshold)
    let heatDays = 0;
    for (let i = 0; i < daily.time.length; i++) {
      if (daily.temperature_2m_max[i] > PARAMS.alertHeat) heatDays++;
    }
    if (heatDays >= 3) {
      alerts.push({type:'warn', icon:'🔥', text:`<b>Ondata di calore in arrivo: ${heatDays} giorni sopra ${PARAMS.alertHeat}°C</b> — prepara ombreggiatura, aumenta frequenza annaffiature, nebulizza le foglie la sera. Le piante in vasi piccoli (bonsai) soffrono di più.`});
    } else if (heatDays >= 1) {
      const maxT = Math.max(...daily.temperature_2m_max);
      alerts.push({type:'info', icon:'☀️', text:`<b>Giornate calde previste: max ${Math.round(maxT)}°C</b> — monitora l'umidità del terreno con i sensori WH51 e annaffia nelle ore fresche.`});
    }

    // Check heavy rain
    const totalRain = daily.precipitation_sum.reduce((s,v) => s + v, 0);
    const maxDayRain = Math.max(...daily.precipitation_sum);
    if (maxDayRain > 30) {
      const rainDay = daily.time[daily.precipitation_sum.indexOf(maxDayRain)];
      const rd = new Date(rainDay + 'T12:00');
      alerts.push({type:'warn', icon:'⛈️', text:`<b>Pioggia intensa prevista ${FC_DAYS_IT[rd.getDay()]} ${rd.getDate()}/${rd.getMonth()+1}: ${maxDayRain.toFixed(0)}mm</b> — rischio ristagno. Verifica il drenaggio dei vasi e proteggi le piante sensibili.`});
    } else if (totalRain > 40) {
      alerts.push({type:'info', icon:'🌧️', text:`<b>Settimana piovosa: ${totalRain.toFixed(0)}mm totali</b> — riduci le annaffiature delle piante all'esterno. Attento al rischio oidio con umidità prolungata.`});
    }

    // Check strong wind
    if (daily.wind_gusts_10m_max) {
      const maxGust = Math.max(...daily.wind_gusts_10m_max);
      if (maxGust > PARAMS.alertWind) {
        const gustDay = daily.time[daily.wind_gusts_10m_max.indexOf(maxGust)];
        const gd = new Date(gustDay + 'T12:00');
        alerts.push({type:'warn', icon:'💨', text:`<b>Raffiche fino a ${Math.round(maxGust)} km/h previste ${FC_DAYS_IT[gd.getDay()]} ${gd.getDate()}/${gd.getMonth()+1}</b> — metti al riparo i bonsai, ancora i vasi alti e leggeri.`});
      }
    }

    // Late/early frost detection (spring/autumn context)
    const month = new Date().getMonth() + 1;
    if ((month >= 3 && month <= 5) || (month >= 9 && month <= 11)) {
      for (let i = 0; i < daily.time.length; i++) {
        if (daily.temperature_2m_min[i] < 2 && daily.temperature_2m_min[i] >= 0) {
          const d = new Date(daily.time[i] + 'T12:00');
          const label = month <= 5 ? 'tardiva' : 'precoce';
          alerts.push({type:'warn', icon:'🌡️', text:`<b>Possibile gelata ${label} ${FC_DAYS_IT[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}: ${daily.temperature_2m_min[i].toFixed(1)}°C</b> — prossimo allo zero! Se hai piante appena rinvasate o talee in radicazione, proteggile.`});
          break; // solo una allerta gelata tardiva/precoce
        }
      }
    }

    // No alerts
    if (!alerts.length) {
      alerts.push({type:'good', icon:'✅', text:'Nessun evento meteo estremo previsto nei prossimi 7 giorni.'});
    }

    if (alertsEl) {
      alertsEl.innerHTML = '<div style="font-family:\'Playfair Display\',serif;font-size:14px;font-weight:500;margin-bottom:6px">🔮 Allerte predittive</div>' +
        alerts.map(a => `<div class="alert-card ${a.type}"><span class="alert-icon">${a.icon}</span><span class="alert-text">${a.text}</span></div>`).join('');
    }

  } catch(e) {
    fcEl.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:11px;padding:1rem">❌ Errore caricamento previsioni</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════
// ⑥ CALENDARIO BIOBIZZ
// ══════════════════════════════════════════════════════════════════════
const BB_PRODUCTS = {
  grow:   {label:'Bio·Grow',  color:'#4a8a3a', abbr:'G'},
  bloom:  {label:'Bio·Bloom', color:'#c05a20', abbr:'B'},
  alg:    {label:'Alg·A·Mic', color:'#0f7a60', abbr:'A'},
  fish:   {label:'Fish·Mix',  color:'#185fa5', abbr:'F'},
  calmag: {label:'CalMag',    color:'#7b3fa0', abbr:'Ca'},
  topmax: {label:'Top·Max',   color:'#b08010', abbr:'T'},
  root:   {label:'Root·Juice',color:'#7a4820', abbr:'R'},
};

// bbPlants è esteso a runtime ma le piante custom non generano schedule
// BioBizz automatici (l'utente può aggiungere voci al diario manualmente
// se serve). Restano comunque elencate qui per coerenza degli id.
// Calendario BioBizz — popolato dinamicamente da loadCustomPlants(). Le
// piante custom non producono automaticamente eventi BioBizz dettagliati
// (servirebbe un livello di dettaglio che il form non chiede), quindi
// questo array di solito resta minimale.
let bbPlants = [];

// ══════════════════════════════════════════════════════════════════════
// ⑦ TRATTAMENTI PREVENTIVI
// ══════════════════════════════════════════════════════════════════════
const TR_PRODUCTS = {
  neem:    {label:'Olio di Neem',     color:'#2d8a4e', abbr:'N'},
  rame:    {label:'Rame/Polt.Bord.',  color:'#1a7a8a', abbr:'Cu'},
  zolfo:   {label:'Zolfo bagnabile',  color:'#b0960a', abbr:'S'},
  sapone:  {label:'Sapone molle K',   color:'#5a8a6a', abbr:'Sk'},
  obianco: {label:'Olio bianco',      color:'#7a7a7a', abbr:'Ob'},
};

// trPlants segue la stessa logica di bbPlants per le piante custom.
// Calendario trattamenti preventivi — popolato dinamicamente. Stesso
// discorso di bbPlants: per le custom non generiamo automaticamente
// trattamenti programmati, quindi normalmente l'array resta vuoto.
let trPlants = [];

const trDateMap = {};
let trHiddenProds = new Set();

// ── Protocolli curativi per malattia/parassita ──
const CURE_PROTOCOLS = {
  cocciniglia:          {steps:[{prod:'obianco',dose:'15 ml/L',note:'Trattamento d\'urto — coprire bene pagina inferiore foglie'},{prod:'sapone',dose:'10 g/L',note:'Lavaggio dopo 3gg dal trattamento olio'},{prod:'obianco',dose:'15 ml/L',note:'Secondo trattamento — eliminare le ninfatrici'}], interval:7, total:3, color:'#a04040'},
  cocciniglia_cotonosa: {steps:[{prod:'obianco',dose:'15 ml/L',note:'Coprire zona colpita e ascelle foglie'},{prod:'sapone',dose:'10 g/L',note:'Rimuovere manualmente i batuffoli con cotton fioc + alcol'},{prod:'obianco',dose:'15 ml/L',note:'Ripetere — controllare anche radici e fusto'}], interval:7, total:3, color:'#a04040'},
  ragnetto_rosso:       {steps:[{prod:'neem',dose:'5 ml/L',note:'Nebulizzare su tutta la chioma, pagina inf. foglie'},{prod:'sapone',dose:'8 g/L',note:'Alternare con neem — aumentare umidità ambiente'},{prod:'neem',dose:'5 ml/L',note:'Terzo passaggio — verificare assenza ragnatele'}], interval:5, total:3, color:'#c06030'},
  afidi:                {steps:[{prod:'sapone',dose:'10 g/L',note:'Spruzzare su colonie — getto forte d\'acqua prima del trattamento'},{prod:'neem',dose:'5 ml/L',note:'Trattamento sistemico dopo il lavaggio'}], interval:5, total:2, color:'#6a8a30'},
  mosca_bianca:         {steps:[{prod:'neem',dose:'5 ml/L',note:'Trattare la sera — le mosche bianche sono più attive di giorno'},{prod:'sapone',dose:'8 g/L',note:'Alternare con neem'},{prod:'neem',dose:'5 ml/L',note:'Terzo passaggio — posizionare trappole gialle adesive'}], interval:7, total:3, color:'#b0a020'},
  oidio:                {steps:[{prod:'zolfo',dose:'3 g/L',note:'Non trattare sopra i 32°C — rischio fitotossicità'},{prod:'rame',dose:'Polt. bordolese 10 g/L',note:'Alternare con zolfo'},{prod:'zolfo',dose:'3 g/L',note:'Ripetere — rimuovere foglie molto colpite'},{prod:'rame',dose:'Polt. bordolese 10 g/L',note:'Quarto passaggio se necessario'}], interval:10, total:4, color:'#8a6a20'},
  fumaggine:            {steps:[{prod:'sapone',dose:'10 g/L',note:'Lavare le foglie dalla fumaggine nera — trattare poi la causa (cocciniglia/afidi)'},{prod:'sapone',dose:'10 g/L',note:'Secondo lavaggio — controllare l\'insetto causa'}], interval:10, total:2, color:'#4a4a4a'},
  clorosi_ferrica:      {steps:[{prod:'ferro',dose:'Ferro chelato 2 ml/L',note:'Trattamento fogliare + irrigazione. Controllare pH substrato (deve essere <7)'},{prod:'ferro',dose:'Ferro chelato 2 ml/L',note:'Ripetere dopo 15gg se le foglie sono ancora gialle'}], interval:15, total:2, color:'#8a8a20'},
  minatore_fogliare:    {steps:[{prod:'neem',dose:'5 ml/L',note:'Trattamento sistemico — rimuovere le foglie con gallerie visibili'},{prod:'neem',dose:'5 ml/L',note:'Secondo trattamento'},{prod:'neem',dose:'5 ml/L',note:'Terzo passaggio — le larve hanno cicli di 2-3 settimane'}], interval:10, total:3, color:'#5a7a3a'},
  alternaria:           {steps:[{prod:'rame',dose:'Polt. bordolese 10 g/L',note:'Rimuovere tutte le foglie con macchie — non compostare'},{prod:'rame',dose:'Polt. bordolese 10 g/L',note:'Ripetere — ridurre bagnatura fogliare'},{prod:'rame',dose:'Polt. bordolese 10 g/L',note:'Terzo passaggio'}], interval:10, total:3, color:'#6a4a20'},
  marciume_radicale:    {steps:[{prod:'rame',dose:'Rame in irrigazione 3 g/L',note:'⚠️ Rinvasare subito: rimuovere radici marce, substrato drenante, vaso pulito. Ridurre annaffiature drasticamente'},{prod:'rame',dose:'Rame in irrigazione 3 g/L',note:'Seconda irrigazione con rame dopo 15gg — non annaffiare fino a substrato quasi asciutto'}], interval:15, total:2, color:'#6a3a20'},
};

// Prodotti aggiuntivi per cure (non nei preventivi)
const CURE_EXTRA_PRODUCTS = {
  ferro: {label:'Ferro chelato', color:'#8a8a20', abbr:'Fe'},
};

const cureDateMap = {};

function buildCurativeEvents() {
  // Pulisci la mappa
  Object.keys(cureDateMap).forEach(k => delete cureDateMap[k]);

  const inv = invLoad();
  if (!inv.length) return;

  const today = new Date();
  today.setHours(0,0,0,0);

  inv.forEach(it => {
    const diseases = it.diseases || [];
    const activeDiseases = diseases.filter(d => !d.resolved && d.date);
    if (!activeDiseases.length) return;

    const p = getPlantById(it.plantTypeIdx);
    if (!p) return;

    activeDiseases.forEach(disease => {
      const protocol = CURE_PROTOCOLS[disease.type];
      if (!protocol) return;

      const startDate = new Date(disease.date + 'T00:00:00');
      if (isNaN(startDate.getTime())) return;

      // Genera le date dei trattamenti
      for (let step = 0; step < protocol.total; step++) {
        const treatDate = new Date(startDate.getTime() + step * protocol.interval * 86400000);
        // Solo date da oggi in poi (o max 3 giorni nel passato per recuperare)
        const threeDaysAgo = new Date(today.getTime() - 3 * 86400000);
        if (treatDate < threeDaysAgo) continue;
        // Max 3 mesi in avanti
        const threeMonths = new Date(today.getTime() + 90 * 86400000);
        if (treatDate > threeMonths) continue;

        const key = gDateKey(treatDate);
        if (!cureDateMap[key]) cureDateMap[key] = [];

        const stepInfo = protocol.steps[Math.min(step, protocol.steps.length - 1)];
        cureDateMap[key].push({
          plant: {id: it.plant_type_idx !== undefined ? it.plant_type_idx : it.plantTypeIdx, name: it.nickname || p.name, icon: p.icon, latin: p.latin},
          disease: disease,
          diseaseLabel: INV_DISEASE_LABELS[disease.type] || disease.type,
          prod: stepInfo.prod,
          dose: stepInfo.dose,
          note: stepInfo.note,
          step: step + 1,
          totalSteps: protocol.total,
          color: protocol.color,
          invId: it.id,
        });
      }
    });
  });
}

function cureCompKey(d, invId, diseaseType) {
  return 'cure_' + d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate() + '_' + invId + '_' + diseaseType;
}
function cureIsDone(d, invId, diseaseType) {
  try { return localStorage.getItem(cureCompKey(d, invId, diseaseType)) === '1'; } catch { return false; }
}
function cureSetDone(d, invId, diseaseType, v) {
  try { if(v) localStorage.setItem(cureCompKey(d, invId, diseaseType), '1'); else localStorage.removeItem(cureCompKey(d, invId, diseaseType)); } catch {}
}
function cureToggleDone(dy, dm, dd, invId, diseaseType) {
  const date = new Date(dy, dm, dd);
  const wasDone = cureIsDone(date, invId, diseaseType);
  cureSetDone(date, invId, diseaseType, !wasDone);
  if (!wasDone) {
    const evs = cureDateMap[gDateKey(date)] || [];
    const ev = evs.find(e => e.invId === invId && e.disease.type === diseaseType);
    if (ev) {
      const prodLabel = TR_PRODUCTS[ev.prod]?.label || CURE_EXTRA_PRODUCTS[ev.prod]?.label || ev.prod;
      _autoDiary(date, ev.plant.name, 'trattamento curativo', '🔴 ' + ev.diseaseLabel + ' — ' + prodLabel + ' ' + ev.dose + (ev.note ? ' — ' + ev.note : ''));
    }
  }
  gRenderCalendar();
  if (document.getElementById('g-overlay').classList.contains('open')) {
    const k = gDateKey(date);
    const fe = (gFilter==='all'||gFilter==='fert') ? (gDateMap[k]||[]).filter(e=>!gIsHiddenEvent(e)) : [];
    const be = (gFilter==='all'||gFilter==='biobizz') ? (bbDateMap[k]||[]).filter(e=>!bbHiddenProds.has(e.prod)) : [];
    const te = (gFilter==='all'||gFilter==='tratt') ? (trDateMap[k]||[]).filter(e=>!trHiddenProds.has(e.prod)) : [];
    const we = (gFilter==='all'||gFilter==='acqua') ? (waDateMap[k]||[]).filter(e=>!waHiddenPlants.has(e.plant.id)) : [];
    gOpenDay(date, fe, be, te, we);
  }
}

function trDateKey(d){return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();}
function trCompKey(d,pid,prod){return 'tr_'+trDateKey(d)+'_'+pid+'_'+prod;}
function trIsDone(d,pid,prod){try{return localStorage.getItem(trCompKey(d,pid,prod))==='1';}catch{return false;}}
function trSetDone(d,pid,prod,v){try{if(v)localStorage.setItem(trCompKey(d,pid,prod),'1');else localStorage.removeItem(trCompKey(d,pid,prod));}catch{}}
function trToggleDone(dy,dm,dd,pid,prod){
  const date=new Date(dy,dm,dd);
  const wasDone=trIsDone(date,pid,prod);
  trSetDone(date,pid,prod,!wasDone);
  if(!wasDone){
    const ev=(trDateMap[gDateKey(date)]||[]).find(e=>e.plant.id===pid&&e.prod===prod);
    if(ev){
      const pLabel=TR_PRODUCTS[prod]?.label||prod;
      _autoDiary(date, ev.plant.name, 'trattamento', '🛡️ '+pLabel+' — '+ev.sched.dose+(ev.sched.note?' — '+ev.sched.note:''));
    }
  }
  gRenderCalendar();
  if(document.getElementById('g-overlay').classList.contains('open')){
    const k=gDateKey(date);
    const fe=(gFilter==='all'||gFilter==='fert')?(gDateMap[k]||[]).filter(e=>!gIsHiddenEvent(e)):[];
    const be=(gFilter==='all'||gFilter==='biobizz')?(bbDateMap[k]||[]).filter(e=>!bbHiddenProds.has(e.prod)):[];
    const te=(gFilter==='all'||gFilter==='tratt')?(trDateMap[k]||[]).filter(e=>!trHiddenProds.has(e.prod)):[];
    gOpenDay(date,fe,be,te);
  }
}

// ══════════════════════════════════════════════════════════════════════
// ⑧ CALENDARIO ANNAFFIATURE
// ══════════════════════════════════════════════════════════════════════
const WA_COLOR = '#3a8abf';
// waPlants è esteso a runtime con le piante custom (vedi loadCustomPlants).
// Per ogni pianta custom viene generato un record con schedules stagionali
// dedotti dal gruppo simulazione. Le 26 native restano hard-coded qui sotto
// con i loro programmi di annaffiatura curati a mano stagione per stagione.
// Calendario annaffiature — popolato dinamicamente da loadCustomPlants()
// a partire dai parametri di ogni pianta custom. Le 26 native originali
// avevano questo array pre-popolato a mano con programmi stagionali curati
// uno per uno; oggi nasce vuoto e viene riempito dal sistema custom
// tramite buildCustomWaPlant.
let waPlants = [];

const waDateMap = {};
let waHiddenPlants = new Set();

function waCompKey(d,pid){return 'wa_'+d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()+'_'+pid;}
function waIsDone(d,pid){try{return localStorage.getItem(waCompKey(d,pid))==='1';}catch{return false;}}
function waSetDone(d,pid,v){try{if(v)localStorage.setItem(waCompKey(d,pid),'1');else localStorage.removeItem(waCompKey(d,pid));}catch{}}
function waToggleDone(dy,dm,dd,pid){
  const date=new Date(dy,dm,dd);
  const wasDone=waIsDone(date,pid);
  waSetDone(date,pid,!wasDone);
  if(!wasDone){
    const ev=(waDateMap[gDateKey(date)]||[]).find(e=>e.plant.id===pid);
    if(ev) _autoDiary(date, ev.plant.name, 'annaffiatura', '💧 '+ev.plant.method+(ev.note?' — '+ev.note:''));
  }
  gRenderCalendar();
  if(document.getElementById('g-overlay').classList.contains('open')){
    const k=gDateKey(date);
    const fe=(gFilter==='all'||gFilter==='fert')?(gDateMap[k]||[]).filter(e=>!gIsHiddenEvent(e)):[];
    const be=(gFilter==='all'||gFilter==='biobizz')?(bbDateMap[k]||[]).filter(e=>!bbHiddenProds.has(e.prod)):[];
    const te=(gFilter==='all'||gFilter==='tratt')?(trDateMap[k]||[]).filter(e=>!trHiddenProds.has(e.prod)):[];
    const we=(gFilter==='all'||gFilter==='acqua')?(waDateMap[k]||[]).filter(e=>!waHiddenPlants.has(e.plant.id)):[];
    gOpenDay(date,fe,be,te,we);
  }
}

// ── Analisi meteo intelligente per annaffiature ──────────────────────
async function waAnalyzeMeteo(waEvs, date) {
  const banner = document.getElementById('wa-meteo-banner');
  if (!banner) return;

  let ewData = null;
  try {
    const res = await apiFetch('/api/ecowitt/realtime');
    const json = await res.json();
    if (json.configured && json.code === 0) ewData = json.data;
  } catch {}

  if (!ewData) {
    banner.innerHTML = '📡 Stazione Ecowitt non disponibile — intervalli statici';
    banner.style.background = '#f5f3ee'; banner.style.color = '#9a9082';
    return;
  }

  const inv = invLoad();

  // Estrai dati meteo
  const getVal = (sec, key) => {
    try { const v = ewData[sec][key]; return v ? parseFloat(v.value||v) : null; } catch { return null; }
  };
  const temp = getVal('outdoor','temperature');
  const hum = getVal('outdoor','humidity');
  const solar = getVal('solar_and_uvi','solar');
  const windKmh = getVal('wind','wind_speed');
  const rainDay = getVal('rainfall','daily');

  // Soil moisture per canale
  const soilData = {};
  // Raccogli tutti i dati soil (moisture + temp + EC) per canale
  const soilByCh = {};
  for (let ch=1; ch<=16; ch++) {
    const d = meteoGetSoilData({data: ewData}, ch);
    if (d.moisture !== null || d.temp !== null || d.ec !== null) soilByCh[ch] = d;
  }

  // Calcola ET₀
  const et0Result = (typeof calcET0 === 'function') ? calcET0(temp||20, hum||60, solar||200, windKmh||5) : {et0:3, factor:1};

  // Banner globale
  const bannerParts = [];
  if (temp !== null) bannerParts.push(`🌡️ ${temp.toFixed(1)}°C`);
  if (hum !== null) bannerParts.push(`💧 ${Math.round(hum)}%`);
  if (rainDay !== null && rainDay > 0) bannerParts.push(`🌧️ ${rainDay.toFixed(1)}mm`);
  bannerParts.push(`ET₀ ${et0Result.et0.toFixed(1)}mm/g (${et0Result.factor.toFixed(2)}×)`);

  let bannerClass = '#edf5ff'; let bannerColor = '#2a5a8a';
  if (rainDay && rainDay > 5) { bannerClass = '#ddf0dd'; bannerColor = '#2a6a2a'; }
  else if (et0Result.factor > 1.5) { bannerClass = '#fdf5e0'; bannerColor = '#8a6a20'; }
  banner.innerHTML = bannerParts.join(' · ');
  banner.style.background = bannerClass; banner.style.color = bannerColor;

  // Pioggia globale: se > soglia salta piante esterne
  const rainSkip = rainDay && rainDay > PARAMS.rainSkip;
  const rainHeavy = rainDay && rainDay > PARAMS.rainSure;

  // Soglie umidità e EC
  const soglie = PARAMS.soglie || SOGLIE_DEFAULT;
  const sogliEC = PARAMS.sogliEC || {};

  // Dati indoor (WN31 CH1) se servono per piante interne
  const indoorData = meteoGetIndoorData({data: ewData}, 1);

  // Per ogni annaffiatura: analizza e aggiorna badge
  waEvs.forEach(e => {
    const badgeEl = document.getElementById('wa-badge-'+e.plant.id);
    if (!badgeEl) return;

    const badges = [];

    // Cerca il vaso nell'inventario per determinare la location
    const invItem = inv.find(it => {
      const p = getPlantById(it.plantTypeIdx);
      return p && p.name === e.plant.name;
    });
    const plantIsIndoor = invItem && invItem.location === 'indoor';
    const plantIsOutdoor = !plantIsIndoor;

    // 1. Check sensore terreno (WH51/WH52) — vale per indoor e outdoor
    const invItemWithSensor = inv.find(it => {
      const p = getPlantById(it.plantTypeIdx);
      return p && p.name === e.plant.name && it.wh51Ch;
    });

    if (invItemWithSensor && invItemWithSensor.wh51Ch) {
      const ch = parseInt(invItemWithSensor.wh51Ch);
      const sensorData = soilByCh[ch] || {moisture:null, temp:null, ec:null};
      const moisture = sensorData.moisture;
      const cat = invItemWithSensor.wh51Cat || 'universale';
      const thresh = soglie[cat] || {secco:20, ok_min:20, ok_max:50, umido:60};
      const ecThresh = sogliEC[cat] || sogliEC.universale || {min:400, target:800, max:2000};
      const isWH52 = invItemWithSensor.sensorType === 'wh52';

      if (moisture !== null) {
        if (moisture > thresh.ok_max) {
          badges.push(`<span class="wa-smart-badge skip">📡 ${moisture.toFixed(0)}% — terreno umido, salta</span>`);
        } else if (moisture > thresh.secco) {
          badges.push(`<span class="wa-smart-badge ok">📡 ${moisture.toFixed(0)}% — OK, può aspettare</span>`);
        } else if (moisture < thresh.secco * 0.5) {
          badges.push(`<span class="wa-smart-badge urgent">📡 ${moisture.toFixed(0)}% — critico, annaffia subito!</span>`);
        } else {
          badges.push(`<span class="wa-smart-badge urgent">📡 ${moisture.toFixed(0)}% — secco, annaffia oggi</span>`);
        }
      }

      // WH52: temperatura substrato
      if (isWH52 && sensorData.temp !== null) {
        if (sensorData.temp < PARAMS.tempRadiciMin) {
          badges.push(`<span class="wa-smart-badge urgent">🌡️ Radici ${sensorData.temp.toFixed(1)}°C — troppo freddo, riduci acqua</span>`);
        } else if (sensorData.temp > PARAMS.tempRadiciMax) {
          badges.push(`<span class="wa-smart-badge adjust">🌡️ Radici ${sensorData.temp.toFixed(1)}°C — caldo, pacciamatura utile</span>`);
        }
      }

      // WH52: EC
      if (isWH52 && sensorData.ec !== null) {
        const reliable = moisture !== null && moisture >= PARAMS.ecMoistureMin;
        if (reliable) {
          if (sensorData.ec > ecThresh.max) {
            badges.push(`<span class="wa-smart-badge urgent">⚡ EC ${Math.round(sensorData.ec)} µS/cm — accumulo sali! Lavaggio substrato necessario</span>`);
          } else if (sensorData.ec > ecThresh.target * 1.3) {
            badges.push(`<span class="wa-smart-badge adjust">⚡ EC ${Math.round(sensorData.ec)} µS/cm — alto, salta fertirrigazione</span>`);
          } else if (sensorData.ec < ecThresh.min) {
            badges.push(`<span class="wa-smart-badge info">⚡ EC ${Math.round(sensorData.ec)} µS/cm — scarso, serve fertilizzazione</span>`);
          }
        }
      }
    }

    // ── Badge specifici per location ─────────────────────────────────
    if (plantIsIndoor) {
      // PIANTA INDOOR: usa dati WN31, ignora pioggia/ET₀/gelo esterni
      badges.push(`<span class="wa-smart-badge info">🏠 Indoor — meteo esterno ignorato</span>`);

      // Umidità ambiente interno bassa → secca più in fretta
      if (indoorData.humidity !== null && indoorData.humidity < PARAMS.alertHumIn) {
        badges.push(`<span class="wa-smart-badge adjust">💨 Aria secca ${Math.round(indoorData.humidity)}% — nebulizza o avvicina umidificatore</span>`);
      }
      // Temperatura ambiente molto alta (es. caloriferi) → ET₀ indoor più alta
      if (indoorData.temp !== null && indoorData.temp > 26) {
        badges.push(`<span class="wa-smart-badge adjust">🌡️ ${indoorData.temp.toFixed(0)}°C in casa — controlla più spesso</span>`);
      }
    } else {
      // PIANTA OUTDOOR/BALCONE: applica logica pioggia + ET₀ + temperatura esterna
      if (rainSkip) {
        if (rainHeavy) {
          badges.push(`<span class="wa-smart-badge skip">🌧️ Pioggia ${rainDay.toFixed(0)}mm — salta sicuramente</span>`);
        } else {
          badges.push(`<span class="wa-smart-badge skip">🌧️ Pioggia ${rainDay.toFixed(0)}mm — probabilmente non serve</span>`);
        }
      }

      // ET₀ esterna: suggerisci anticipo/ritardo
      if (et0Result.factor > PARAMS.et0Anticipa) {
        badges.push(`<span class="wa-smart-badge adjust">☀️ ET₀ alta (${et0Result.factor.toFixed(1)}×) — anticipa la prossima</span>`);
      } else if (et0Result.factor < PARAMS.et0Ritarda) {
        badges.push(`<span class="wa-smart-badge adjust">☁️ ET₀ bassa (${et0Result.factor.toFixed(1)}×) — puoi ritardare</span>`);
      }

      // Temperatura estrema esterna
      if (temp !== null) {
        if (temp > PARAMS.alertHeat) badges.push(`<span class="wa-smart-badge urgent">🔥 ${temp.toFixed(0)}°C — annaffia sera/mattina</span>`);
        else if (temp < PARAMS.alertFrost) badges.push(`<span class="wa-smart-badge info">❄️ ${temp.toFixed(0)}°C — riduci acqua, terreno asciuga lento</span>`);
      }
    }

    // Render badges
    if (badges.length) {
      badgeEl.innerHTML = badges.join('');
    } else {
      badgeEl.innerHTML = `<span class="wa-smart-badge ok">✅ Condizioni normali</span>`;
    }
  });
}

let bbHiddenProds  = new Set();
let bbHiddenPlants = new Set();
let bbCurrentMonth = new Date().getMonth();
let bbCurrentYear  = new Date().getFullYear();
const bbToday = new Date();
const bbDateMap = {};

function bbDateKey(d){return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();}
function bbCompKey(d,pid,prod){return 'bb_'+bbDateKey(d)+'_'+pid+'_'+prod;}
function bbIsDone(d,pid,prod){try{return localStorage.getItem(bbCompKey(d,pid,prod))==='1';}catch{return false;}}
function bbSetDone(d,pid,prod,v){try{if(v)localStorage.setItem(bbCompKey(d,pid,prod),'1');else localStorage.removeItem(bbCompKey(d,pid,prod));}catch{}}
function bbToggleDone(dy,dm,dd,pid,prod){
  const date=new Date(dy,dm,dd);
  const wasDone=bbIsDone(date,pid,prod);
  bbSetDone(date,pid,prod,!wasDone);
  if(!wasDone){
    const ev=(bbDateMap[gDateKey(date)]||[]).find(e=>e.plant.id===pid&&e.prod===prod);
    if(ev){
      const pLabel=BB_PRODUCTS[prod]?.label||prod;
      _autoDiary(date, ev.plant.name, 'concimazione', '💚 BioBizz '+pLabel+' — '+ev.sched.dose+(ev.sched.note?' — '+ev.sched.note:''));
    }
  }
  gRenderCalendar();
  if(document.getElementById('g-overlay').classList.contains('open')){
    const k=gDateKey(date);
    const fe=(gFilter==='all'||gFilter==='fert')?(gDateMap[k]||[]).filter(e=>!gIsHiddenEvent(e)):[];
    const be=(gFilter==='all'||gFilter==='biobizz')?(bbDateMap[k]||[]).filter(e=>!bbHiddenProds.has(e.prod)):[];
    const te=(gFilter==='all'||gFilter==='tratt')?(trDateMap[k]||[]).filter(e=>!trHiddenProds.has(e.prod)):[];
    gOpenDay(date,fe,be,te);
  }
}

function bbVisibleEvents(date){
  return (bbDateMap[bbDateKey(date)]||[]).filter(e=>!bbHiddenPlants.has(e.plant.id)&&!bbHiddenProds.has(e.prod));
}

// ══════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════
// ⑬ PARAMETRI CONFIGURABILI
// ══════════════════════════════════════════════════════════════════════

const PARAMS_DEFAULTS = {
  // Calcolatore Acqua
  drenaggio: 1.20,
  freqBase: 7,
  // ET₀
  et0Ref: 3.0,
  solarConv: 0.032,
  et0Min: 0.25,
  et0Max: 2.5,
  // Fertirrigazione
  fertiReduction: 70,
  // Allerte meteo
  alertFrost: 5,
  alertHeat: 35,
  alertWind: 50,
  alertHumIn: 40,
  // Irrigazione smart
  rainSkip: 5,
  rainSure: 15,
  et0Anticipa: 1.4,
  et0Ritarda: 0.5,
  // Soglie umidità terreno
  soglie: {
    succulente:   {secco:10, ok_max:35, umido:40},
    tropicali:    {secco:25, ok_max:55, umido:65},
    mediterranee: {secco:15, ok_max:40, umido:50},
    agrumi:       {secco:20, ok_max:50, umido:60},
    bonsai:       {secco:20, ok_max:50, umido:60},
    orchidee:     {secco:15, ok_max:40, umido:50},
    aromatiche:   {secco:8,  ok_max:30, umido:35},
    universale:   {secco:20, ok_max:50, umido:60},
  },
  // Soglie EC (µS/cm) — WH52. Min = sotto cui manca nutrienti, Max = sopra cui accumulo tossico
  // Letture affidabili solo quando moisture ≥ ecMoistureMin
  sogliEC: {
    succulente:   {min:200,  target:500,  max:1500},
    tropicali:    {min:500,  target:1000, max:2500},
    mediterranee: {min:300,  target:700,  max:1800},
    agrumi:       {min:600,  target:1100, max:2200},
    bonsai:       {min:400,  target:800,  max:1800},
    orchidee:     {min:300,  target:600,  max:1200},
    aromatiche:   {min:200,  target:500,  max:1400},
    universale:   {min:400,  target:800,  max:2000},
  },
  // Soglie temperatura substrato (°C)
  tempRadiciMin: 12,  // Sotto: radici non assorbono bene → blocca fertirrigazione
  tempRadiciMax: 30,  // Sopra: rischio bruciature radici → allerta
  ecMoistureMin: 30,  // Sotto umidità %: letture EC inaffidabili
  useSimScheduling: true,  // Usa simulazione per calendario annaffiature
};

const SOGLIE_LABELS = {
  succulente:'🌵 Succulente/Cactus', tropicali:'🌳 Tropicali', mediterranee:'🌿 Mediterranee',
  agrumi:'🍋 Agrumi', bonsai:'💜 Bonsai', orchidee:'🌸 Orchidee',
  aromatiche:'🌿 Aromatiche', universale:'🌱 Universale'
};

let PARAMS = {};

function paramsLoad() {
  try {
    const saved = JSON.parse(localStorage.getItem('giardino_params') || '{}');
    PARAMS = {...JSON.parse(JSON.stringify(PARAMS_DEFAULTS))};
    // Merge saved over defaults (shallow for simple, deep for soglie)
    Object.keys(PARAMS_DEFAULTS).forEach(k => {
      if (k === 'soglie' || k === 'sogliEC') {
        if (saved[k]) {
          Object.keys(PARAMS[k]).forEach(cat => {
            if (saved[k][cat]) Object.assign(PARAMS[k][cat], saved[k][cat]);
          });
        }
      } else if (saved[k] !== undefined) {
        PARAMS[k] = saved[k];
      }
    });
  } catch {
    PARAMS = JSON.parse(JSON.stringify(PARAMS_DEFAULTS));
  }
}

function paramsSaveToStorage() {
  try { localStorage.setItem('giardino_params', JSON.stringify(PARAMS)); } catch {}
}

function paramsInit() {
  // Fill inputs from PARAMS
  document.getElementById('p-drenaggio').value = PARAMS.drenaggio;
  document.getElementById('p-freq-base').value = PARAMS.freqBase;
  document.getElementById('p-et0-ref').value = PARAMS.et0Ref;
  document.getElementById('p-solar-conv').value = PARAMS.solarConv;
  document.getElementById('p-et0-min').value = PARAMS.et0Min;
  document.getElementById('p-et0-max').value = PARAMS.et0Max;
  document.getElementById('p-ferti-reduction').value = PARAMS.fertiReduction;
  document.getElementById('p-alert-frost').value = PARAMS.alertFrost;
  document.getElementById('p-alert-heat').value = PARAMS.alertHeat;
  document.getElementById('p-alert-wind').value = PARAMS.alertWind;
  document.getElementById('p-alert-hum-in').value = PARAMS.alertHumIn;
  document.getElementById('p-rain-skip').value = PARAMS.rainSkip;
  document.getElementById('p-rain-sure').value = PARAMS.rainSure;
  document.getElementById('p-et0-anticipa').value = PARAMS.et0Anticipa;
  document.getElementById('p-et0-ritarda').value = PARAMS.et0Ritarda;
  document.getElementById('p-temp-radici-min').value = PARAMS.tempRadiciMin;
  document.getElementById('p-temp-radici-max').value = PARAMS.tempRadiciMax;
  document.getElementById('p-ec-moisture-min').value = PARAMS.ecMoistureMin;
  document.getElementById('p-use-sim-sched').checked = PARAMS.useSimScheduling !== false;

  // Soglie grid
  const grid = document.getElementById('p-soglie-grid');
  grid.innerHTML = Object.entries(SOGLIE_LABELS).map(([cat, label]) => {
    const s = PARAMS.soglie[cat] || PARAMS_DEFAULTS.soglie[cat];
    // Layout a due piani verticali per essere mobile-friendly:
    // 1) Riga superiore: nome categoria a tutta larghezza
    // 2) Riga inferiore: tre input flessibili che si adattano allo schermo
    // Su desktop sembrano uguali a prima, su mobile non escono dallo schermo.
    return `<div style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--border)">
      <div style="font-size:12px;font-weight:600;color:var(--text)">${label}</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted)">
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <span>Secco &lt;</span>
          <input type="number" id="ps-${cat}-secco" value="${s.secco}" min="0" max="50" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:4px;font-size:12px;text-align:center;box-sizing:border-box">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <span>OK &lt;</span>
          <input type="number" id="ps-${cat}-ok" value="${s.ok_max}" min="10" max="80" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:4px;font-size:12px;text-align:center;box-sizing:border-box">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <span>Umido &gt;</span>
          <input type="number" id="ps-${cat}-umido" value="${s.umido}" min="20" max="90" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:4px;font-size:12px;text-align:center;box-sizing:border-box">
        </div>
        <span style="min-width:14px;text-align:right">%</span>
      </div>
    </div>`;
  }).join('');

  // Soglie EC grid
  const ecGrid = document.getElementById('p-soglie-ec-grid');
  ecGrid.innerHTML = Object.entries(SOGLIE_LABELS).map(([cat, label]) => {
    const s = PARAMS.sogliEC[cat] || PARAMS_DEFAULTS.sogliEC[cat];
    // Stesso layout a due piani della grid umidità, ma con campi più larghi
    // perché i valori EC vanno fino a 5000 (4 cifre).
    return `<div style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--border)">
      <div style="font-size:12px;font-weight:600;color:var(--text)">${label}</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted)">
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <span>Min</span>
          <input type="number" id="pec-${cat}-min" value="${s.min}" min="0" max="3000" step="50" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:4px;font-size:12px;text-align:center;box-sizing:border-box">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <span>Target</span>
          <input type="number" id="pec-${cat}-target" value="${s.target}" min="0" max="3000" step="50" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:4px;font-size:12px;text-align:center;box-sizing:border-box">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <span>Max</span>
          <input type="number" id="pec-${cat}-max" value="${s.max}" min="0" max="5000" step="50" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:4px;font-size:12px;text-align:center;box-sizing:border-box">
        </div>
        <span style="min-width:38px;text-align:right;font-size:9px">µS/cm</span>
      </div>
    </div>`;
  }).join('');

  // Carica la configurazione server-side (Ecowitt + posizione) e popola
  // i nuovi pannelli. La fetch è asincrona ma non blocco paramsInit
  // perché gli altri campi della sezione (PARAMS dal localStorage)
  // sono già stati popolati e l'utente può lavorare con loro.
  paramsLoadServerConfig();
}

// Carica la configurazione lato server (config.json) e riempie i campi
// dei pannelli Posizione ed Ecowitt. Viene chiamata sia all'apertura
// della sezione Parametri sia dopo un salvataggio per riallineare i
// campi con i valori effettivamente persistiti.
async function paramsLoadServerConfig() {
  try {
    const res = await apiFetch('/api/config');
    if (!res.ok) return;
    const cfg = await res.json();
    // Posizione
    const pos = cfg.posizione || {};
    document.getElementById('p-pos-lat').value  = pos.latitudine  || '';
    document.getElementById('p-pos-lng').value  = pos.longitudine || '';
    document.getElementById('p-pos-name').value = pos.nome || '';
    // Ecowitt
    const eco = cfg.ecowitt || {};
    document.getElementById('p-ecowitt-app').value = eco.application_key || '';
    document.getElementById('p-ecowitt-api').value = eco.api_key || '';
    document.getElementById('p-ecowitt-mac').value = eco.mac || '';
  } catch (e) {
    console.warn('paramsLoadServerConfig fallita:', e);
  }
}

// Salva la configurazione lato server (config.json) tramite POST /api/config.
// Mostra feedback all'utente nello span p-config-status: messaggio di successo
// o errore, che svanisce dopo qualche secondo per non restare a schermo.
async function paramsSaveConfig() {
  const status = document.getElementById('p-config-status');
  status.textContent = 'Salvataggio in corso...';
  status.style.color = 'var(--muted)';

  const payload = {
    ecowitt: {
      application_key: document.getElementById('p-ecowitt-app').value.trim(),
      api_key:         document.getElementById('p-ecowitt-api').value.trim(),
      mac:             document.getElementById('p-ecowitt-mac').value.trim(),
    },
    posizione: {
      latitudine:  document.getElementById('p-pos-lat').value,
      longitudine: document.getElementById('p-pos-lng').value,
      nome:        document.getElementById('p-pos-name').value.trim(),
    }
  };

  try {
    const res = await apiFetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({error: 'Errore sconosciuto'}));
      throw new Error(err.error || 'Errore nel salvataggio');
    }
    const result = await res.json();
    status.textContent = result.ecowitt_enabled
      ? '✅ Configurazione salvata, Ecowitt attivo'
      : '✅ Configurazione salvata';
    status.style.color = '#5a8050';
  } catch (e) {
    status.textContent = '❌ ' + e.message;
    status.style.color = '#c04030';
  }

  // Il messaggio svanisce dopo 5 secondi per non restare a schermo.
  setTimeout(() => { status.textContent = ''; }, 5000);
}

// Chiede al browser di rilevare la posizione corrente tramite l'API
// geolocation, e popola i campi latitudine/longitudine con i valori
// rilevati. Il browser chiede il permesso all'utente la prima volta.
function paramsUseGeoLocation() {
  const status = document.getElementById('p-config-status');
  if (!navigator.geolocation) {
    status.textContent = '❌ Geolocalizzazione non supportata dal browser';
    status.style.color = '#c04030';
    setTimeout(() => { status.textContent = ''; }, 4000);
    return;
  }
  status.textContent = '📡 Rilevamento posizione...';
  status.style.color = 'var(--muted)';

  // Verifica preliminare: la Geolocation API è disponibile solo in
  // contesti sicuri (HTTPS o localhost). Se la pagina è servita via
  // http:// su un IP della rete locale o tramite un tunnel HTTP non
  // cifrato, il browser nega il permesso senza nemmeno chiedere
  // all'utente, e arriverebbe al callback di errore con err.code === 1
  // senza informazioni utili. Intercettiamo il caso prima di chiamare
  // l'API per dare un messaggio specifico che spiega la causa vera.
  // Questo è particolarmente importante per chi usa l'app da remoto
  // tramite Tailscale, Cloudflare Tunnel, o IP della LAN: in tutti
  // questi casi il problema non è il permesso ma il protocollo, e la
  // soluzione è configurare HTTPS, non cliccare "Consenti" sul popup.
  if (!window.isSecureContext) {
    status.textContent = '🔒 Geolocalizzazione disponibile solo via HTTPS o localhost. Inserisci le coordinate manualmente.';
    status.style.color = '#c04030';
    setTimeout(() => { status.textContent = ''; }, 7000);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Limito a 4 cifre decimali (precisione ~10 metri, più che
      // sufficiente per il nostro uso e più leggibile)
      document.getElementById('p-pos-lat').value = pos.coords.latitude.toFixed(4);
      document.getElementById('p-pos-lng').value = pos.coords.longitude.toFixed(4);
      status.textContent = '✅ Posizione rilevata, ricorda di salvare';
      status.style.color = '#5a8050';
      setTimeout(() => { status.textContent = ''; }, 4000);
    },
    (err) => {
      // Errori tipici: utente nega il permesso, GPS non disponibile,
      // timeout. Mostro un messaggio chiaro per ognuno. Per il caso 1
      // (PERMISSION_DENIED), che già ha escluso il problema secure
      // context grazie al check sopra, le cause residue sono due:
      // l'utente ha cliccato "Nega" sul popup nel passato e il browser
      // ricorda quella scelta, oppure i servizi di localizzazione del
      // sistema operativo sono spenti. Diamo all'utente un suggerimento
      // pratico di come ripristinare il permesso, perché il messaggio
      // "permesso negato" da solo non gli direbbe come uscire dallo
      // stallo.
      const messages = {
        1: 'Permesso negato. Controlla le impostazioni del sito (icona del lucchetto nella barra indirizzi) o i servizi di localizzazione del sistema. Oppure inserisci manualmente.',
        2: 'Posizione non disponibile. Il dispositivo non ha modo di determinarla in questo momento. Inserisci manualmente.',
        3: 'Timeout: il sistema ha impiegato troppo tempo a rispondere. Riprova o inserisci manualmente.',
      };
      status.textContent = '❌ ' + (messages[err.code] || err.message);
      status.style.color = '#c04030';
      setTimeout(() => { status.textContent = ''; }, 7000);
    },
    {timeout: 8000, enableHighAccuracy: false}
  );
}

// Pulsante "occhio" per rivelare/nascondere il contenuto di un campo
// password. Cambia type da "password" a "text" e viceversa, mantenendo
// invariato il contenuto. Utile per verificare di aver inserito le
// credenziali Ecowitt corrette senza dover cancellare e reinserire.
function paramsToggleSecret(inputId) {
  const el = document.getElementById(inputId);
  el.type = el.type === 'password' ? 'text' : 'password';
}

function paramsSave() {
  PARAMS.drenaggio = +(document.getElementById('p-drenaggio').value) || PARAMS_DEFAULTS.drenaggio;
  PARAMS.freqBase = +(document.getElementById('p-freq-base').value) || PARAMS_DEFAULTS.freqBase;
  PARAMS.et0Ref = +(document.getElementById('p-et0-ref').value) || PARAMS_DEFAULTS.et0Ref;
  PARAMS.solarConv = +(document.getElementById('p-solar-conv').value) || PARAMS_DEFAULTS.solarConv;
  PARAMS.et0Min = +(document.getElementById('p-et0-min').value) || PARAMS_DEFAULTS.et0Min;
  PARAMS.et0Max = +(document.getElementById('p-et0-max').value) || PARAMS_DEFAULTS.et0Max;
  PARAMS.fertiReduction = +(document.getElementById('p-ferti-reduction').value) || PARAMS_DEFAULTS.fertiReduction;
  PARAMS.alertFrost = +(document.getElementById('p-alert-frost').value);
  PARAMS.alertHeat = +(document.getElementById('p-alert-heat').value) || PARAMS_DEFAULTS.alertHeat;
  PARAMS.alertWind = +(document.getElementById('p-alert-wind').value) || PARAMS_DEFAULTS.alertWind;
  PARAMS.alertHumIn = +(document.getElementById('p-alert-hum-in').value) || PARAMS_DEFAULTS.alertHumIn;
  PARAMS.rainSkip = +(document.getElementById('p-rain-skip').value) || PARAMS_DEFAULTS.rainSkip;
  PARAMS.rainSure = +(document.getElementById('p-rain-sure').value) || PARAMS_DEFAULTS.rainSure;
  PARAMS.et0Anticipa = +(document.getElementById('p-et0-anticipa').value) || PARAMS_DEFAULTS.et0Anticipa;
  PARAMS.et0Ritarda = +(document.getElementById('p-et0-ritarda').value) || PARAMS_DEFAULTS.et0Ritarda;
  PARAMS.tempRadiciMin = +(document.getElementById('p-temp-radici-min').value);
  if (isNaN(PARAMS.tempRadiciMin)) PARAMS.tempRadiciMin = PARAMS_DEFAULTS.tempRadiciMin;
  PARAMS.tempRadiciMax = +(document.getElementById('p-temp-radici-max').value) || PARAMS_DEFAULTS.tempRadiciMax;
  PARAMS.ecMoistureMin = +(document.getElementById('p-ec-moisture-min').value) || PARAMS_DEFAULTS.ecMoistureMin;
  PARAMS.useSimScheduling = document.getElementById('p-use-sim-sched').checked;

  // Soglie moisture
  Object.keys(SOGLIE_LABELS).forEach(cat => {
    PARAMS.soglie[cat] = {
      secco: +(document.getElementById(`ps-${cat}-secco`).value) || 20,
      ok_max: +(document.getElementById(`ps-${cat}-ok`).value) || 50,
      umido: +(document.getElementById(`ps-${cat}-umido`).value) || 60,
    };
  });

  // Soglie EC
  Object.keys(SOGLIE_LABELS).forEach(cat => {
    PARAMS.sogliEC[cat] = {
      min: +(document.getElementById(`pec-${cat}-min`).value) || 200,
      target: +(document.getElementById(`pec-${cat}-target`).value) || 800,
      max: +(document.getElementById(`pec-${cat}-max`).value) || 2000,
    };
  });

  paramsSaveToStorage();
  const msg = document.getElementById('p-save-msg');
  msg.style.display = 'block';
  setTimeout(() => msg.style.display = 'none', 2500);
}

function paramsReset() {
  if (!confirm('Ripristinare tutti i parametri ai valori di fabbrica?')) return;
  PARAMS = JSON.parse(JSON.stringify(PARAMS_DEFAULTS));
  paramsSaveToStorage();
  paramsInit();
  const msg = document.getElementById('p-save-msg');
  msg.textContent = '🔄 Parametri ripristinati ai valori default';
  msg.style.display = 'block';
  setTimeout(() => { msg.style.display = 'none'; msg.textContent = '✅ Parametri salvati!'; }, 2500);
}

// Carica parametri all'avvio
paramsLoad();

// ══════════════════════════════════════════════════════════════════════
// ⑭ SIMULATORE BILANCIO IDRICO (FAO-56)
// ══════════════════════════════════════════════════════════════════════

// Kc (coefficiente colturale) per gruppo di piante e stadio
const SIM_KC_BY_GROUP = {
  succulenta:    {initial:0.25, dev:0.35, mid:0.50, late:0.40, dormant:0.20},
  orchidea:      {initial:0.40, dev:0.50, mid:0.60, late:0.50, dormant:0.35},
  tropicale:     {initial:0.60, dev:0.75, mid:0.90, late:0.75, dormant:0.60},
  agrume:        {initial:0.55, dev:0.70, mid:0.85, late:0.70, dormant:0.60},
  mediterranea:  {initial:0.50, dev:0.65, mid:0.80, late:0.65, dormant:0.45},
  bonsai:        {initial:0.45, dev:0.55, mid:0.70, late:0.55, dormant:0.35},
  arbusto:       {initial:0.55, dev:0.70, mid:0.85, late:0.70, dormant:0.45},
  albero:        {initial:0.60, dev:0.75, mid:0.90, late:0.75, dormant:0.55},
  aromatica:     {initial:0.40, dev:0.55, mid:0.70, late:0.55, dormant:0.40},
  fiorita:       {initial:0.60, dev:0.75, mid:0.95, late:0.70, dormant:0.40},
};

// Parametri simulazione per pianta: gruppo, profondità radicale (cm), p coefficient
// SIM_PLANT_PARAMS è esteso a runtime: per ogni pianta custom viene aggiunta
// una entry con il sim_group scelto e, se l'utente ha compilato il livello
// esperto del form, anche root_depth_cm e p_coef personalizzati.
// Parametri di simulazione per ID pianta — popolato dinamicamente. Le
// piante custom usano i default del proprio gruppo (sim_group) finché
// l'utente non sovrascrive manualmente i Kc dal livello esperto del form.
let SIM_PLANT_PARAMS = {};

// ════════════════════════════════════════════════════════════════════════
// SISTEMA PIANTE CUSTOM
// ════════════════════════════════════════════════════════════════════════
// Le piante custom sono salvate in custom_plants nel database e fuse a
// runtime con le 5 strutture native (sPlants, gPlants, bbPlants, trPlants,
// SIM_PLANT_PARAMS). La fusione avviene tramite loadCustomPlants() chiamata
// all'avvio dell'app e dopo ogni operazione di add/edit/delete pianta.
//
// Gli ID delle piante custom partono da 26 per non collidere con le 26
// native (id 0-25). Il backend assegna l'ID via AUTOINCREMENT seedato a 25.

// Cache dell'ultimo elenco caricato dal server. Serve per due motivi:
// 1) Il pannello "Le mie piante" può mostrare la lista senza rifare la query
// 2) Quando l'utente elimina una pianta dobbiamo sapere quali sono custom
//    per poterle rimuovere correttamente dalle strutture native
let customPlantsCache = [];

// Mappa colori associati ai gruppi simulazione. Ogni pianta custom riceve
// il colore del suo gruppo, così piante simili hanno tonalità coerenti nel
// calendario. Le native hanno colori scelti uno ad uno e non passano da qui.
const CUSTOM_GROUP_COLORS = {
  succulenta:   '#7a8a4a',
  orchidea:     '#a06aa8',
  tropicale:    '#3d6b30',
  agrume:       '#c79a2c',
  mediterranea: '#7a6b3a',
  bonsai:       '#5a4a3a',
  arbusto:      '#5a7a4a',
  albero:       '#3a5a2a',
  aromatica:    '#6a8a5a',
  fiorita:      '#c45a7a',
};

// ── Schema colori per i tag derivati dal sim_group ─────────────────────
// Le piante native hanno tag scelti a mano con classi colore (.pg verde, .pa
// arancione, .pb blu, .pgr grigio, .pc corallo, .pt turchese) — sono solo
// decorazioni visive, non hanno semantica funzionale. Per le custom non
// chiediamo all'utente di sceglierli: li deriviamo dal gruppo di simulazione
// scelto nel form, in modo che piante dello stesso gruppo abbiano un colpo
// d'occhio coerente nella griglia delle schede.
const CUSTOM_GROUP_TAG = {
  succulenta:   { label: 'Succulenta',   tc: 'pa'  },  // arancione/deserto
  orchidea:     { label: 'Orchidea',     tc: 'pc'  },  // corallo/delicata
  tropicale:    { label: 'Tropicale',    tc: 'pb'  },  // blu/umido
  agrume:       { label: 'Agrume',       tc: 'pa'  },  // arancione
  mediterranea: { label: 'Mediterranea', tc: 'pa'  },  // arancione/sole
  bonsai:       { label: 'Bonsai',       tc: 'pgr' },  // grigio/zen
  arbusto:      { label: 'Arbusto',      tc: 'pg'  },  // verde
  albero:       { label: 'Albero',       tc: 'pg'  },  // verde
  aromatica:    { label: 'Aromatica',    tc: 'pg'  },  // verde
  fiorita:      { label: 'Fiorita',      tc: 'pc'  },  // corallo/fiore
};

// Costruisce un record sPlants a partire da un row del database custom_plants.
// Il cuore della conversione è leggere row.card_data — un oggetto strutturato
// in cinque sezioni (con, sub, esp, cur, bio) che il backend ci consegna già
// parsato come dizionario JS — e mapparlo direttamente alla forma che il
// renderer della scheda (sOpenDetail) si aspetta. Il renderer fa
//     p[sezione][campo] || '—'
// quindi va bene se alcune sezioni o sotto-campi sono vuoti: la scheda
// mostrerà semplicemente un trattino al loro posto, senza sollevare errori.
function buildCustomSPlant(row) {
  // Tag derivato dal gruppo di simulazione. Storicamente qui aggiungevamo
  // anche un secondo tag "Personalizzata" per distinguere le piante custom
  // dalle 26 native, ma adesso che tutte le piante sono custom quel tag
  // diventava una scritta ridondante presente su ogni card senza dare
  // informazione, quindi l'ho rimosso. Resta solo il tag di gruppo
  // (Albero, Succulenta, eccetera) che è genuinamente informativo.
  const groupInfo = CUSTOM_GROUP_TAG[row.sim_group] || { label: 'Pianta', tc: 'pgr' };
  const tags = [groupInfo.label];
  const tc   = [groupInfo.tc];

  // Le cinque sezioni della scheda. Le leggo da row.card_data, che il backend
  // garantisce essere sempre presente con tutte e cinque le chiavi (anche se
  // vuote come {}). Faccio comunque un fallback difensivo per il caso in cui
  // una versione futura del server o un proxy strano consegnasse un payload
  // parziale: senza fallback, una p.con undefined romperebbe il renderer.
  const card = row.card_data || {};

  return {
    id:        row.id,        // Identificativo standard usato da getPlantById
                              // e dalle dropdown del simulatore. Coincide con
                              // l'id auto-incrementato dal database.
    name:      row.name,
    latin:     row.latin || '',
    icon:      row.icon || '🌱',
    isNew:     false,
    tags:      tags,
    tc:        tc,
    // Storicamente qui c'erano due campi aggiuntivi: isCustom (flag che
    // distingueva le piante create dall'utente dalle 26 native cablate
    // nel codice) e customId (alias di id). Adesso che la distinzione
    // native/custom è stata abolita e che id è il campo standard usato
    // ovunque, entrambi sono stati rimossi: il flag era sempre true e il
    // campo customId era un duplicato di id.

    // Le cinque sezioni native. Se card[sezione] è {} (perché l'utente non ha
    // compilato nessun campo di quella sezione), il renderer mostrerà la
    // sezione come una colonna di trattini — non è bellissimo ma è lo stesso
    // comportamento delle native quando un sotto-campo è vuoto, quindi la UX
    // è coerente. In una iterazione futura potremmo nascondere i tab le cui
    // sezioni sono completamente vuote (basta filtrare sTabDefs prima del
    // rendering), ma per ora tieniamo il comportamento più semplice.
    con: card.con || {},
    sub: card.sub || {},
    esp: card.esp || {},
    cur: card.cur || {},
    bio: card.bio || {},
  };
}

// Helper: converte una stringa CSV di mesi "3,4,5,6,7,8,9,10" in una
// descrizione testuale leggibile come "Marzo – Ottobre" oppure "Mar–Mag, Set".
// Per il manuale utente questa è una piccola gentilezza estetica.
function _monthsToPeriod(monthsStr) {
  if (!monthsStr) return '';
  const months = monthsStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 12).sort((a,b)=>a-b);
  if (!months.length) return '';
  const names = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  // Caso più comune: mesi consecutivi → "Aprile – Settembre"
  let allConsecutive = true;
  for (let i = 1; i < months.length; i++) {
    if (months[i] !== months[i-1] + 1) { allConsecutive = false; break; }
  }
  if (allConsecutive && months.length >= 3) {
    return `${names[months[0]-1]} – ${names[months[months.length-1]-1]}`;
  }
  // Altrimenti elenco diretto
  return months.map(m => names[m-1]).join(', ');
}

// Costruisce un record gPlants per il calendario fertilizzazione.
// schedules deve avere months come array di numeri (non stringa CSV) e
// interval come numero. La startDate è il primo giorno del primo mese attivo.
function buildCustomGPlant(row) {
  const months = row.fert_months
    ? row.fert_months.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 12)
    : [4,5,6,7,8,9];
  const firstMonth = months[0] || 4;
  return {
    id: row.id,
    name: row.name,
    latin: row.latin || '',
    icon: row.icon || '🌱',
    color: CUSTOM_GROUP_COLORS[row.sim_group] || '#5a7a4a',
    concime: row.fert_product || `Concime gruppo ${row.sim_group}`,
    schedules: [{
      months: months,
      interval: row.fert_interval || 21,
    }],
    startDate: new Date(2026, firstMonth - 1, 5),
  };
}

// Costruisce un record per bbPlants leggendo gli schedule BioBizz dalla
// nuova chiave annidata row.bb_schedules che il backend allega a ogni
// pianta. Il backend invia gli schedule come array di oggetti con campi
//   { prod, months, interval_days, start_date, dose, note, sort_order }
// dove `months` è già un array di interi 1-12 (parsato dal CSV) e
// `start_date` è una stringa ISO "YYYY-MM-DD" o null.
//
// Il loop che genera gli eventi del calendario in gRenderCalendar() si
// aspetta invece schedule con la forma più semplice
//   { prod, months, interval, start }
// dove `interval` è in giorni (lo stesso valore di interval_days, solo
// rinominato per coerenza storica con le strutture native), e `start` è
// un vero oggetto Date.
//
// Quindi qui faccio l'adattamento riga per riga: rinomino interval_days
// in interval, parso la stringa ISO in oggetto Date con il helper
// _parseISO che gestisce anche il caso start_date null restituendo
// l'inizio dell'anno corrente come fallback ragionevole.
function buildCustomBbPlant(row) {
  return {
    id: row.id,
    name: row.name,
    latin: row.latin || '',
    icon: row.icon || '🌱',
    color: CUSTOM_GROUP_COLORS[row.sim_group] || '#5a7a4a',
    schedules: (row.bb_schedules || []).map(s => ({
      prod: s.prod,
      months: s.months || [],
      interval: s.interval_days,
      start: _parseISO(s.start_date),
      // I campi dose/note/sort_order non sono usati dai loop di rendering
      // del calendario ma li conservo nel record per usi futuri (tooltip,
      // tabella di dettaglio, esportazioni).
      dose: s.dose || '',
      note: s.note || '',
    })),
  };
}

// Costruisce un record per trPlants leggendo gli schedule trattamenti
// dalla chiave annidata row.tr_schedules. La logica è identica a
// buildCustomBbPlant — l'unica differenza è la sorgente dei dati. Le
// tengo separate invece di unificarle in una funzione parametrizzata
// (es. `buildCustomScheduledPlant(row, 'bb')`) per due ragioni:
// (a) la simmetria con backend e database, dove biobizz e trattamenti
// sono entità distinte; (b) in futuro se le due strutture divergono
// (campi specifici per i trattamenti come target_pest), le modifiche
// restano locali senza dover toccare la firma di una funzione condivisa.
function buildCustomTrPlant(row) {
  return {
    id: row.id,
    name: row.name,
    latin: row.latin || '',
    icon: row.icon || '🌱',
    color: CUSTOM_GROUP_COLORS[row.sim_group] || '#5a7a4a',
    schedules: (row.tr_schedules || []).map(s => ({
      prod: s.prod,
      months: s.months || [],
      interval: s.interval_days,
      start: _parseISO(s.start_date),
      dose: s.dose || '',
      note: s.note || '',
    })),
  };
}

// Helper di conversione da stringa ISO "YYYY-MM-DD" a oggetto Date.
// Gestisce robustamente i tre casi pratici:
// 1) Stringa valida "2026-04-10" → oggetto Date corrispondente
// 2) null o undefined → 1° gennaio dell'anno corrente come fallback
//    (così il generatore di eventi non esplode con NaN — capita per
//    schedule storici creati senza data di ancoraggio)
// 3) Stringa malformata → stesso fallback dell'anno corrente, con
//    un warning su console che aiuta il debug se mai succedesse
//
// Uso il costruttore Date(year, monthIndex, day) invece di passare la
// stringa direttamente a `new Date(s)` perché quest'ultimo interpreta
// la stringa come UTC e in fusi orari diversi dall'UTC restituisce il
// giorno sbagliato (es. "2026-04-10" diventa il 9 aprile alle 22:00 in
// Italia in ora legale). Il costruttore con argomenti separati invece
// crea sempre la data nel fuso orario locale, che è quello che vuoi
// per un calendario di giardinaggio.
function _parseISO(isoStr) {
  if (!isoStr) {
    return new Date(new Date().getFullYear(), 0, 1);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoStr).trim());
  if (!m) {
    console.warn('Data di schedule non valida, fallback a inizio anno:', isoStr);
    return new Date(new Date().getFullYear(), 0, 1);
  }
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

// Costruisce l'entry SIM_PLANT_PARAMS per il simulatore FAO-56.
// I parametri esperti (root_depth_cm, p_coef, kc_*) sono opzionali nel
// database. Se l'utente li ha compilati nel form esperto, li uso. Altrimenti
// uso i default del gruppo presi da SIM_KC_BY_GROUP.
function buildCustomSimParams(row) {
  // Default: profondità radicale ragionevole per il gruppo
  const groupDefaults = {
    succulenta:18, orchidea:10, tropicale:25, agrume:30, mediterranea:30,
    bonsai:15, arbusto:30, albero:45, aromatica:25, fiorita:25
  };
  const groupP = {
    succulenta:0.60, orchidea:0.35, tropicale:0.40, agrume:0.50, mediterranea:0.45,
    bonsai:0.40, arbusto:0.50, albero:0.55, aromatica:0.50, fiorita:0.50
  };
  return {
    group: row.sim_group || 'arbusto',
    root: row.root_depth_cm != null ? row.root_depth_cm : (groupDefaults[row.sim_group] || 25),
    p:    row.p_coef        != null ? row.p_coef        : (groupP[row.sim_group]        || 0.45),
  };
}

// Costruisce un record cPlants per la sezione Mensile. Questa è la funzione
// più sottile delle 5 builder perché cPlants ha una struttura "ricca" che le
// piante native compilano a mano per ogni mese.
//
// Strategia a due percorsi:
//
// PERCORSO 1 — Calendario manuale: l'utente ha compilato monthly_states
// nel form (livello "Calendario annuale"). In questo caso usiamo i suoi
// valori esatti, sia per gli stati che per le note mensili.
//
// PERCORSO 2 — Deduzione automatica: l'utente non ha toccato il calendario
// annuale. Deduciamo gli stati dai fert_months (mese in fert → stato 1
// "concimazione attiva", mese fuori → stato 0 "riposo"). Le note restano
// vuote: meglio uno spazio pulito che placeholder generici tipo
// "Concimazione regolare" che apparirebbero come segnaposto vuoti.
//
// I campi accessori freq e concime li costruiamo dai dati base che la
// pianta ha sempre: fert_interval e fert_product. Per freq scegliamo una
// formulazione naturale stile "ogni X giorni", coerente con quanto
// scritto a mano nelle 26 native.
function buildCustomCPlant(row) {
  // ── Stati mensili ──────────────────────────────────────────────
  let months;
  if (row.monthly_states && row.monthly_states.trim()) {
    // PERCORSO 1: parsing della stringa CSV salvata.
    // Validazione difensiva: se per qualche motivo non ho 12 valori
    // o ho valori fuori range, fallback alla deduzione automatica.
    const parsed = row.monthly_states.split(',').map(s => parseInt(s.trim()));
    const allValid = parsed.length === 12 && parsed.every(v => v >= 0 && v <= 3 && !isNaN(v));
    months = allValid ? parsed : null;
  }
  if (!months) {
    // PERCORSO 2: deduzione automatica dai fert_months.
    const fertSet = new Set(
      (row.fert_months || '')
        .split(',')
        .map(s => parseInt(s.trim()))
        .filter(n => n >= 1 && n <= 12)
    );
    // Costruisco l'array di 12 elementi: il mese i (1-12) ha stato 1
    // se è in fertSet, altrimenti 0. Nota che l'array è 0-indexed
    // mentre i mesi sono 1-indexed, da qui il +1.
    months = Array.from({length: 12}, (_, i) => fertSet.has(i + 1) ? 1 : 0);
  }

  // ── Note mensili ───────────────────────────────────────────────
  // monthly_notes arriva già deserializzato dal backend come oggetto.
  // Le chiavi sono stringhe "1"-"12" (mese), i valori sono i testi.
  // cPlants nativo usa lo stesso formato (chiavi 1-12), quindi posso
  // passarlo direttamente — basta solo difendersi da valori sporchi.
  const notes = {};
  if (row.monthly_notes && typeof row.monthly_notes === 'object') {
    for (const [k, v] of Object.entries(row.monthly_notes)) {
      const monthNum = parseInt(k);
      if (monthNum >= 1 && monthNum <= 12 && v && typeof v === 'string') {
        notes[monthNum] = v;
      }
    }
  }

  // ── Frequenza testuale ─────────────────────────────────────────
  // Costruisco una formulazione naturale dal valore numerico di
  // fert_interval, scegliendo la dicitura più appropriata per range.
  // Le 26 native usano stili variabili: "1× al mese", "ogni 2 settimane",
  // "Ogni 3-4 settimane". Imito quello stile con scaglioni sensati.
  const interval = row.fert_interval || 21;
  let freq;
  if (interval <= 7)        freq = 'Settimanale';
  else if (interval <= 10)  freq = 'Ogni 7-10 giorni';
  else if (interval <= 16)  freq = 'Ogni 2 settimane';
  else if (interval <= 24)  freq = 'Ogni 3 settimane';
  else if (interval <= 35)  freq = 'Mensile';
  else                      freq = `Ogni ${interval} giorni`;

  // ── Concime ────────────────────────────────────────────────────
  // Se l'utente ha specificato un prodotto, usiamo quello. Altrimenti
  // un fallback generico ma onesto basato sul gruppo simulazione.
  const groupConcimeDefaults = {
    succulenta:   'Liquido per succulente, ½ dose',
    orchidea:     'Specifico orchidee, ¼ dose',
    tropicale:    'Universale bilanciato, ½ dose',
    agrume:       'Granulare specifico agrumi',
    mediterranea: 'Universale o specifico mediterranee',
    bonsai:       'Liquido bonsai, dose ridotta',
    arbusto:      'Universale bilanciato',
    albero:       'Universale a lenta cessione',
    aromatica:    'Leggero P-K per aromatiche',
    fiorita:      'Specifico piante da fiore P-K',
  };
  const concime = row.fert_product
    || groupConcimeDefaults[row.sim_group]
    || 'Universale bilanciato';

  return {
    id:      row.id,    // Identificativo standard. Necessario perché la sezione
                        // Mensile, come tutte le altre, usa getPlantById per
                        // recuperare la pianta corrispondente. Storicamente
                        // qui c'erano anche isCustom (sempre true) e customId
                        // (duplicato di id), entrambi rimossi col refactor
                        // che ha abolito la distinzione native/custom.
    name:    row.name,
    latin:   row.latin || '',
    icon:    row.icon || '🌱',
    months:  months,
    freq:    freq,
    concime: concime,
    notes:   notes,
  };
}

// Costruisce un record waPlants per il calendario annaffiature. Questa è
// la struttura più ricca delle 26 native: ogni pianta ha 1-3 schedules
// stagionali con intervalli, mesi e note specifiche. Per le custom non
// chiediamo all'utente di compilare tutto questo: deduciamo dal gruppo
// simulazione dei valori sensati che siano almeno un buon punto di partenza.
//
// La filosofia è la stessa di buildCustomCPlant: meglio una stima ragionevole
// dedotta che un campo vuoto. L'utente può sempre raffinare il proprio
// calendario annaffiature osservando la pianta nel tempo, e in futuro
// potremmo aggiungere un livello dedicato nel form se servisse controllo fine.
function buildCustomWaPlant(row) {
  // Mappa di profili di annaffiatura per gruppo simulazione. Ogni profilo
  // ha 3 schedules che coprono tutti e 12 i mesi: estate calda, mezze stagioni,
  // inverno. I valori sono basati su come sono strutturate le 26 native
  // — Sanseviera per le succulente, Ficus per le tropicali, ecc.
  const profiles = {
    succulenta: {
      method: 'Soak & dry — completamente asciutto tra una annaffiatura e l\'altra',
      schedules: [
        {months:[5,6,7,8,9],   interval:14, note:'Soak & dry: bagno abbondante, poi asciugatura completa'},
        {months:[10,11,12,1,2,3,4], interval:28, note:'Inverno: 1× al mese o meno. Eccesso d\'acqua = morte'},
      ],
    },
    orchidea: {
      method: 'Immersione 15 minuti, poi scolo completo',
      schedules: [
        {months:[5,6,7,8],     interval:7,  note:'Immergere il vaso 15 min, scolare completamente'},
        {months:[3,4,9,10],    interval:10, note:'Radici grigie = vuole acqua, radici verdi = idratata'},
        {months:[11,12,1,2],   interval:14, note:'Inverno: ogni 2 settimane'},
      ],
    },
    tropicale: {
      method: 'Terreno leggermente umido, mai saturo',
      schedules: [
        {months:[6,7,8],       interval:5,  note:'Estate: terreno leggermente umido, mai saturo'},
        {months:[3,4,5,9,10],  interval:7,  note:'Annaffiare quando i primi 2-3 cm sono asciutti'},
        {months:[11,12,1,2],   interval:12, note:'Inverno: ridurre molto. Nebulizzare con riscaldamenti'},
      ],
    },
    agrume: {
      method: 'Regolare e abbondante, no ristagni',
      schedules: [
        {months:[6,7,8],       interval:3,  note:'Estate: abbondante. Preferire acqua piovana o decantata'},
        {months:[3,4,5,9,10],  interval:5,  note:'Mantenere il terreno fresco'},
        {months:[11,12,1,2],   interval:10, note:'Inverno: ridurre ma non sospendere'},
      ],
    },
    mediterranea: {
      method: 'Solo terreno completamente asciutto',
      schedules: [
        {months:[6,7,8],       interval:7,  note:'Estate: solo quando completamente asciutto. Tollera siccità'},
        {months:[3,4,5,9,10],  interval:12, note:'Mezze stagioni: molto moderata'},
      ],
    },
    bonsai: {
      method: 'Controllare ogni giorno — il vaso bonsai asciuga rapidamente',
      schedules: [
        {months:[6,7,8],       interval:2,  note:'Estate: il bonsai asciuga in fretta! Controllare ogni giorno'},
        {months:[4,5,9,10],    interval:3,  note:'Primavera/autunno: ogni 2-3 giorni'},
        {months:[11,12,1,2,3], interval:7,  note:'Inverno: ridurre ma non far seccare le radici'},
      ],
    },
    arbusto: {
      method: 'Moderata, regolare in vaso',
      schedules: [
        {months:[6,7,8],       interval:5,  note:'Estate: regolare in vaso, abbondante'},
        {months:[3,4,5,9,10],  interval:8,  note:'Primavera/autunno: moderata'},
        {months:[11,12,1,2],   interval:14, note:'Inverno: ridurre sensibilmente'},
      ],
    },
    albero: {
      method: 'Regolare nei primi anni, poi autonomo',
      schedules: [
        {months:[6,7,8],       interval:5,  note:'Estate: regolare nei primi 3 anni'},
        {months:[4,5,9,10],    interval:8,  note:'Primavera/autunno: moderata'},
      ],
    },
    aromatica: {
      method: 'Solo terreno completamente asciutto — meglio poca che troppa',
      schedules: [
        {months:[6,7,8],       interval:7,  note:'Estate: solo quando completamente asciutto'},
        {months:[3,4,5,9,10],  interval:12, note:'Molto moderata. Troppo poco > troppo!'},
      ],
    },
    fiorita: {
      method: 'Moderata e costante in fioritura',
      schedules: [
        {months:[5,6,7,8],     interval:4,  note:'Fioritura: terreno leggermente umido, mai saturo'},
        {months:[3,4,9,10],    interval:7,  note:'Primavera/autunno: moderata'},
        {months:[11,12,1,2],   interval:12, note:'Inverno: ridurre'},
      ],
    },
  };

  // Selezione del profilo: gruppo richiesto, fallback ad arbusto se gruppo
  // sconosciuto. arbusto è il "default più ragionevole" perché ha esigenze medie.
  const profile = profiles[row.sim_group] || profiles.arbusto;

  // Se l'utente ha compilato il campo testuale "watering" nel form, lo
  // preferiamo come metodo descrittivo perché è specifico per quella pianta.
  // Altrimenti usiamo il metodo del profilo.
  const method = (row.watering && row.watering.trim()) || profile.method;

  return {
    id:        row.id,
    name:      row.name,
    icon:      row.icon || '🌱',
    color:     CUSTOM_GROUP_COLORS[row.sim_group] || '#5a7a4a',
    method:    method,
    schedules: profile.schedules.map(s => ({...s})),  // Copia per evitare mutation indiretta
  };
}

// Costruisce un record FI_PLANTS per il calcolatore di fertirrigazione.
// Anche qui: deduciamo dal gruppo simulazione dei valori sensati. Per loc
// (indoor/outdoor) c'è un'opzione in più rispetto a cPlants/waPlants: se
// l'utente ha registrato vasi per questa pianta nell'inventario, possiamo
// leggere la location dal primo vaso. Questo è il dato più accurato perché
// tiene conto di dove l'utente ha effettivamente messo la pianta.
//
// waterMl e doseFactor seguono invece tabelle per gruppo simulazione, perché
// dipendono da caratteristiche fisiologiche della pianta (succulente bevono
// poco e tollerano poco concime, alberi grandi vogliono volumi imponenti).
function buildCustomFIPlant(row) {
  // Profilo per gruppo: waterMl per dose tipica, doseFactor (concentrazione).
  // I valori sono presi mediando le 26 native dello stesso "tipo".
  const groupProfiles = {
    succulenta:   {waterMl: 200, doseFactor: 0.25},
    orchidea:     {waterMl: 200, doseFactor: 0.25},
    tropicale:    {waterMl: 400, doseFactor: 0.5},
    agrume:       {waterMl: 1500, doseFactor: 1.0},
    mediterranea: {waterMl: 600, doseFactor: 0.5},
    bonsai:       {waterMl: 250, doseFactor: 0.5},
    arbusto:      {waterMl: 800, doseFactor: 0.5},
    albero:       {waterMl: 2000, doseFactor: 1.0},
    aromatica:    {waterMl: 300, doseFactor: 0.5},
    fiorita:      {waterMl: 500, doseFactor: 1.0},
  };
  const profile = groupProfiles[row.sim_group] || groupProfiles.arbusto;

  // Tentativo di lettura della location dai vasi: se invLoad è disponibile
  // e l'utente ha già un vaso per questa pianta, usiamo quella info.
  // Altrimenti default 'outdoor' che è il caso più frequente per le piante
  // che un utente potrebbe aggiungere come custom (acquisti vivaio).
  let loc = 'outdoor';
  try {
    if (typeof invLoad === 'function') {
      const inv = invLoad();
      const pot = inv.find(it => it.plantTypeIdx === row.id);
      if (pot && pot.location) loc = pot.location;
    }
  } catch (e) {
    // Lettura inventario fallita: uso il default. Non bloccare il rendering.
  }

  return {
    id:         row.id,
    name:       row.name,
    icon:       row.icon || '🌱',
    loc:        loc,
    waterMl:    profile.waterMl,
    doseFactor: profile.doseFactor,
  };
}

// Funzione principale: carica le piante custom dal database e le fonde
// nelle 8 strutture native (7 array + SIM_PLANT_PARAMS oggetto).
// È idempotente: chiamandola più volte non duplica i record (rimuove prima
// quelli custom precedenti, poi aggiunge i nuovi).
//
// Questo è importante perché viene chiamata sia all'avvio sia dopo ogni
// add/edit/delete, e dobbiamo sempre avere lo stato in memoria coerente
// con quello del database.
async function loadCustomPlants() {
  let items = [];
  try {
    const res = await apiFetch('/api/plants');
    if (res.ok) {
      const data = await res.json();
      items = data.items || [];
    }
  } catch (e) {
    // Se il backend non risponde, l'app continua a funzionare ma con
    // un giardino vuoto. Il fallimento qui non deve bloccare l'avvio:
    // l'utente vedrà lo stato vuoto e potrà comunque navigare le altre
    // sezioni che non dipendono dalla lista piante (Meteo, Parametri).
    console.warn('Impossibile caricare piante custom:', e);
    return;
  }

  // STEP 1: Svuota le strutture in memoria prima di rifusare i dati nuovi.
  // Storicamente queste strutture erano popolate sia da 26 piante "native"
  // (dichiarate cablate nel codice JavaScript) sia dalle piante custom
  // che l'utente aveva aggiunto via form. Il refresh doveva quindi
  // essere selettivo: rimuovere solo le custom (filtrando per il flag
  // isCustom) e lasciare intatte le native, perché altrimenti dopo il
  // refresh le 26 piante predefinite sarebbero scomparse.
  //
  // Adesso che tutte le piante vivono nel database e nessuna è cablata
  // nel codice, le strutture si svuotano completamente prima del refusione
  // dei dati appena caricati. Il flag isCustom è stato rimosso dalle
  // builder e questa logica selettiva non serve più.
  //
  // Uso `arr.length = 0` invece di `arr = []` per preservare l'identità
  // dell'array. Le strutture sPlants, gPlants e simili sono dichiarate
  // come `let` ma altre parti del codice potrebbero aver salvato
  // riferimenti a quegli array (per esempio sFilteredPlants = sPlants
  // alla riga 122), e la sostituzione totale invaliderebbe quei
  // riferimenti. Lo svuotamento sul posto invece preserva tutto.
  sPlants.length   = 0;
  gPlants.length   = 0;
  bbPlants.length  = 0;
  trPlants.length  = 0;
  cPlants.length   = 0;
  waPlants.length  = 0;
  FI_PLANTS.length = 0;
  // SIM_PLANT_PARAMS è un oggetto, non un array. Lo svuoto cancellando
  // tutte le chiavi. Storicamente cancellavamo solo quelle con id >= 26
  // per preservare le 26 native. Adesso le cancello tutte.
  Object.keys(SIM_PLANT_PARAMS).forEach(k => delete SIM_PLANT_PARAMS[k]);

  // STEP 2: Per ogni pianta custom, crea gli 8 record e fondili nelle strutture.
  items.forEach(row => {
    sPlants.push(buildCustomSPlant(row));
    gPlants.push(buildCustomGPlant(row));
    // bbPlants e trPlants ora hanno builder separati che leggono i nuovi
    // campi annidati row.bb_schedules e row.tr_schedules forniti dal
    // backend. Prima del refactor a tabelle figlie usavamo una singola
    // buildCustomMinimalPlant che ritornava sempre schedules vuoti,
    // perché gli schedule non avevano un posto dove vivere nel database.
    // Adesso popolano correttamente i calendari BioBizz e trattamenti.
    bbPlants.push(buildCustomBbPlant(row));
    trPlants.push(buildCustomTrPlant(row));
    cPlants.push(buildCustomCPlant(row));
    waPlants.push(buildCustomWaPlant(row));
    FI_PLANTS.push(buildCustomFIPlant(row));
    SIM_PLANT_PARAMS[row.id] = buildCustomSimParams(row);
  });

  // STEP 3: Aggiorna la cache locale per il pannello "Le mie piante".
  customPlantsCache = items;

  // STEP 3b: Aggiorna i tre <select> del diario perché le sue option
  // di pianta sono ora popolate dinamicamente leggendo da customPlantsCache.
  // La chiamata è guardata da typeof per non rompere se il diario è stato
  // disabilitato o non ancora caricato (succede se la sezione Schede è
  // attiva e quella del Diario non è ancora stata visitata: gli elementi
  // <select> del diario esistono comunque nell'HTML, ma per sicurezza il
  // typeof copre anche scenari futuri di lazy-loading dell'HTML).
  if (typeof dPopulatePlantSelects === 'function') {
    dPopulatePlantSelects();
  }

  // STEP 4: Invalida le sezioni che dipendono dalle piante.
  // Quando l'utente le riaprirà, verranno re-inizializzate con i dati nuovi.
  // Questo meccanismo sfrutta sectionInited già esistente.
  if (typeof sectionInited !== 'undefined') {
    sectionInited.schede  = false;
    sectionInited.mensile = false;
    sectionInited.giorni  = false;
    sectionInited.vasi    = false;
    sectionInited.diario  = false;  // Il filtro pianta del diario deve aggiornarsi
  }
  // Il calcolatore di fertirrigazione ha un suo flag separato perché viene
  // inizializzato fuori dal sistema sectionInited centrale. Resetto anche
  // lui così le custom appaiono nella lista al prossimo accesso.
  if (typeof fiInited !== 'undefined') {
    fiInited = false;
  }

  // Inoltre invalida le date map che il calendario usa, così alla prossima
  // visita di Giorni vengano rigenerate con le piante custom incluse.
  if (typeof gDateMap !== 'undefined') {
    Object.keys(gDateMap).forEach(k => delete gDateMap[k]);
    Object.keys(bbDateMap).forEach(k => delete bbDateMap[k]);
    Object.keys(trDateMap).forEach(k => delete trDateMap[k]);
  }

  console.log(`✅ Caricate ${items.length} piante custom (id 26-${items.length ? Math.max(...items.map(i=>i.id)) : 25})`);
}

// State
let _simPotId = null;
let _simForecast = null;
let _simLiveMoisture = null;
let _simIndoorLive = null;  // Dati live dal WN31 CH1 per piante indoor

// ════════════════════════════════════════════════════════════════════════
// UI DI GESTIONE PIANTE CUSTOM
// ════════════════════════════════════════════════════════════════════════
// Stato del form. cpEditingId è null in modalità "aggiunta" e contiene
// l'id della pianta in modalità "modifica". Distinguere serve per sapere
// se chiamare POST o PUT al salvataggio, e per mostrare/nascondere il
// pulsante "elimina".
let cpEditingId = null;
let cpFertMonths = new Set();  // Set dei mesi attivi nel selettore
let cpDirty = false;            // True se l'utente ha modificato qualcosa
let cpSectionStates = {advanced: false, monthly: false, expert: false};  // Persistenza espansioni
// Stato del calendario annuale (sezione Mensile). Array di 12 numeri 0-3
// (0=auto/riposo, 1=attivo, 2=ridotto, 3=speciale) e dict {mese: nota}.
// All'apertura del form questi due valori vengono inizializzati da cpResetForm
// o da cpPopulateForm a seconda che si stia creando o modificando una pianta.
let cpMonthlyStates = new Array(12).fill(0);
let cpMonthlyNotes = {};
// Flag: true se l'utente ha esplicitamente toccato il calendario annuale.
// Lo uso per decidere se la deduzione automatica dai fert_months deve
// ancora aggiornarsi quando l'utente modifica il selettore mesi del livello
// avanzato. Una volta che l'utente ha customizzato, smetto di sovrascrivere.
let cpMonthlyTouched = false;

// ── Tabella di mappatura form ↔ scheda colturale ─────────────────────
// Descrive, in un solo posto, la corrispondenza tra le cinque sezioni
// della scheda colturale (così come definite in sTabDefs e così come si
// aspetta il renderer della scheda nativa) e gli id degli elementi HTML
// del form di creazione/modifica pianta. Le tre funzioni cpResetForm,
// cpPopulateForm e cpSavePlant iterano questa stessa tabella anziché
// elencare i campi a mano una per una. Il giorno in cui aggiungeremo o
// cambieremo un campo, basterà aggiornare questa singola tabella e tutte
// le funzioni si adegueranno automaticamente, senza il rischio di tenere
// le tre liste fuori sincrono.
//
// Per ogni sezione l'array elenca le coppie (chiave, idHtml). La chiave
// è il nome del sotto-campo letto dal renderer (p.con.periodo, p.sub.ph,
// ecc.); l'idHtml è l'id dell'<input> o <textarea> nel form HTML.
const CP_CARD_FIELDS = {
  con: [
    { key: 'periodo',    id: 'cp-con-periodo'     },
    { key: 'frequenza',  id: 'cp-con-frequenza'   },
    { key: 'concime',    id: 'cp-con-concime'     },
    { key: 'stop',       id: 'cp-con-stop'        },
    { key: 'note',       id: 'cp-con-note'        },
  ],
  sub: [
    { key: 'terreno',    id: 'cp-sub-terreno'     },
    { key: 'ph',         id: 'cp-sub-ph'          },
    { key: 'vaso',       id: 'cp-sub-vaso'        },
    { key: 'rinvaso',    id: 'cp-sub-rinvaso'     },
    { key: 'vivo',       id: 'cp-sub-vivo'        },
  ],
  esp: [
    { key: 'luce',        id: 'cp-esp-luce'        },
    { key: 'sole',        id: 'cp-esp-sole'        },
    { key: 'temperatura', id: 'cp-esp-temperatura' },
    { key: 'umidita',     id: 'cp-esp-umidita'     },
  ],
  cur: [
    { key: 'acqua',      id: 'cp-cur-acqua'       },
    { key: 'potatura',   id: 'cp-cur-potatura'    },
    { key: 'parassiti',  id: 'cp-cur-parassiti'   },
    { key: 'extra',      id: 'cp-cur-extra'       },
  ],
  bio: [
    { key: 'prodotti',   id: 'cp-bio-prodotti'    },
    { key: 'primavera',  id: 'cp-bio-primavera'   },
    { key: 'estate',     id: 'cp-bio-estate'      },
    { key: 'autunno',    id: 'cp-bio-autunno'     },
    { key: 'rinvaso',    id: 'cp-bio-rinvaso'     },
    { key: 'note',       id: 'cp-bio-note'        },
  ],
};

// ── Pannello "Le mie piante personalizzate" — RIMOSSO ───────────────
// Il pannello cpRenderPanel viveva qui e disegnava una griglia separata
// di piante con un pulsante "Aggiungi" e card cliccabili per la modifica.
// È stato rimosso quando la griglia principale della sezione Schede ha
// ricevuto i pulsanti modifica (✏️) e rimuovi (🗑️) direttamente sulle
// card, rendendo il pannello una duplicazione visiva e funzionale.
// Il pulsante "Aggiungi pianta" che era nell'header del pannello è stato
// spostato accanto al contatore "N piante" della sezione Schede.

// Helper per l'escape HTML. Necessario perché usiamo innerHTML con dati
// dell'utente (nome, latino) che potrebbero contenere caratteri speciali.
// Senza escape, un nome del tipo "Pianta <con tag>" romperebbe il rendering.
function cpEscape(text) {
  if (text == null) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Apertura del form in modalità "aggiungi" ─────────────────────────
// Resetta tutti i campi e mostra il modal. Il pulsante "elimina" resta
// nascosto perché non c'è nulla da eliminare in modalità aggiunta.
function cpOpenAddForm() {
  cpEditingId = null;
  cpDirty = false;
  cpResetForm();
  document.getElementById('cp-form-title').textContent = '🌱 Nuova pianta';
  document.getElementById('cp-form-sub').textContent = 'Compila i campi base, il resto è opzionale.';
  document.getElementById('cp-delete-btn').style.display = 'none';
  document.getElementById('cp-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Focus automatico sul primo campo: nice-to-have per UX da tastiera
  setTimeout(() => document.getElementById('cp-name').focus(), 50);
}

// ── Apertura del form in modalità "modifica" ─────────────────────────
// Carica la pianta dalla cache, popola tutti i campi del form, mostra
// il pulsante elimina.
function cpOpenEditForm(plantId) {
  const plant = customPlantsCache.find(p => p.id === plantId);
  if (!plant) {
    cpToast('Pianta non trovata', 'error');
    return;
  }
  cpEditingId = plantId;
  cpDirty = false;
  cpResetForm();
  cpPopulateForm(plant);
  document.getElementById('cp-form-title').textContent = `✏️ Modifica: ${plant.name}`;
  document.getElementById('cp-form-sub').textContent = 'Modifica i campi che vuoi aggiornare.';
  document.getElementById('cp-delete-btn').style.display = 'inline-flex';
  document.getElementById('cp-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ── Reset del form a valori vuoti ────────────────────────────────────
function cpResetForm() {
  // Livello base: i pochi campi che hanno valori di default sensati ben
  // distinti dal "vuoto" (icona, gruppo, categoria sensore) li resetto
  // singolarmente perché ognuno ha il suo valore iniziale specifico.
  document.getElementById('cp-name').value = '';
  document.getElementById('cp-latin').value = '';
  document.getElementById('cp-icon').value = '🌱';
  document.getElementById('cp-sim-group').value = 'arbusto';
  document.getElementById('cp-sensor-cat').value = 'universale';

  // Scheda colturale: itero la tabella di mappatura CP_CARD_FIELDS e svuoto
  // tutti i 24 campi delle cinque sezioni (con/sub/esp/cur/bio). Se in
  // futuro aggiungeremo un campo nuovo alla tabella, questo loop lo gestirà
  // automaticamente senza modifiche.
  for (const section of Object.values(CP_CARD_FIELDS)) {
    for (const field of section) {
      const el = document.getElementById(field.id);
      if (el) el.value = '';
    }
  }

  // Calendario fertilizzazione: torniamo ai mesi di default (primavera-
  // autunno tipico per piante mediterranee) e ai valori suggeriti.
  cpFertMonths = new Set([3,4,5,6,7,8,9,10]);
  cpRenderFertMonths();
  document.getElementById('cp-fert-interval').value = 21;
  document.getElementById('cp-fert-product').value = '';
  document.getElementById('cp-fert-note').value = '';

  // Livello esperto — parametri Kc (vuoti = usa default del gruppo)
  ['root-depth','p-coef','kc-initial','kc-dev','kc-mid','kc-late','kc-dormant'].forEach(id => {
    document.getElementById('cp-' + id).value = '';
  });

  // Livello calendario annuale: parto con tutti gli stati a 0 (auto/riposo)
  // e nessuna nota. La griglia verrà popolata dalla deduzione automatica
  // quando l'utente apre la sezione, oppure dai dati salvati in cpPopulateForm
  // se sta modificando una pianta esistente.
  cpMonthlyStates = new Array(12).fill(0);
  cpMonthlyNotes = {};
  cpMonthlyTouched = false;
  // Pre-deduco una volta dai fert_months di default (3-10) così la griglia,
  // se l'utente la apre subito, mostra già una proposta sensata.
  cpDeduceFromFertMonths(true);  // silent=true, niente toast

  // Sezioni: ripristina lo stato espansione preferito dell'utente
  document.getElementById('cp-section-advanced').style.display = cpSectionStates.advanced ? 'block' : 'none';
  document.getElementById('cp-section-monthly').style.display = cpSectionStates.monthly ? 'block' : 'none';
  document.getElementById('cp-section-expert').style.display = cpSectionStates.expert ? 'block' : 'none';
  document.getElementById('cp-toggle-advanced').textContent = cpSectionStates.advanced ? '▲' : '▼';
  document.getElementById('cp-toggle-monthly').textContent = cpSectionStates.monthly ? '▲' : '▼';
  document.getElementById('cp-toggle-expert').textContent = cpSectionStates.expert ? '▲' : '▼';
}

// ── Popolamento del form con i dati di una pianta esistente ─────────
function cpPopulateForm(plant) {
  // Livello base — campi singoli che non vivono in card_data
  document.getElementById('cp-name').value       = plant.name || '';
  document.getElementById('cp-latin').value      = plant.latin || '';
  document.getElementById('cp-icon').value       = plant.icon || '🌱';
  document.getElementById('cp-sim-group').value  = plant.sim_group || 'arbusto';
  document.getElementById('cp-sensor-cat').value = plant.sensor_cat || 'universale';

  // Scheda colturale: leggo dall'oggetto card_data che il backend ci consegna
  // già parsato come dizionario con cinque chiavi (con/sub/esp/cur/bio).
  // Difensivamente accetto anche un card_data assente (oggetto vuoto) — può
  // capitare se il record è stato creato in una versione molto vecchia dello
  // schema o se per qualche motivo il backend ha consegnato un payload
  // parziale. In quel caso tutti i campi del form restano vuoti, che è il
  // comportamento più ragionevole quando non sappiamo cosa scriverci.
  const card = plant.card_data || {};
  for (const [sectionKey, fields] of Object.entries(CP_CARD_FIELDS)) {
    const sectionData = card[sectionKey] || {};
    for (const field of fields) {
      const el = document.getElementById(field.id);
      if (el) el.value = sectionData[field.key] || '';
    }
  }

  // Calendario fertilizzazione
  if (plant.fert_months) {
    cpFertMonths = new Set(plant.fert_months.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 12));
  } else {
    cpFertMonths = new Set([3,4,5,6,7,8,9,10]);
  }
  cpRenderFertMonths();
  document.getElementById('cp-fert-interval').value = plant.fert_interval || 21;
  document.getElementById('cp-fert-product').value  = plant.fert_product || '';
  document.getElementById('cp-fert-note').value     = plant.fert_note || '';

  // Livello esperto — usa stringa vuota se null per non mostrare "null" nel campo
  const setNum = (id, val) => {
    document.getElementById(id).value = (val == null) ? '' : val;
  };
  setNum('cp-root-depth', plant.root_depth_cm);
  setNum('cp-p-coef',     plant.p_coef);
  setNum('cp-kc-initial', plant.kc_initial);
  setNum('cp-kc-dev',     plant.kc_dev);
  setNum('cp-kc-mid',     plant.kc_mid);
  setNum('cp-kc-late',    plant.kc_late);
  setNum('cp-kc-dormant', plant.kc_dormant);

  // Se ci sono dati esperti compilati, espando automaticamente quella sezione
  // perché altrimenti l'utente potrebbe non accorgersi che ci sono valori salvati lì
  const hasExpertData = plant.root_depth_cm != null || plant.p_coef != null ||
    plant.kc_initial != null || plant.kc_dev != null || plant.kc_mid != null ||
    plant.kc_late != null || plant.kc_dormant != null;
  if (hasExpertData) {
    cpSectionStates.expert = true;
    document.getElementById('cp-section-expert').style.display = 'block';
    document.getElementById('cp-toggle-expert').textContent = '▲';
  }

  // Stesso ragionamento per la scheda colturale: se l'utente aveva compilato
  // anche solo un sotto-campo qualsiasi, espando la sezione "Scheda colturale"
  // così la modifica non parte con tutto collassato. Itero la tabella di
  // mappatura cercando il primo elemento HTML che ha valore non vuoto.
  let hasCardData = false;
  for (const fields of Object.values(CP_CARD_FIELDS)) {
    for (const field of fields) {
      const el = document.getElementById(field.id);
      if (el && el.value && el.value.trim()) { hasCardData = true; break; }
    }
    if (hasCardData) break;
  }
  if (hasCardData) {
    cpSectionStates.advanced = true;
    document.getElementById('cp-section-advanced').style.display = 'block';
    document.getElementById('cp-toggle-advanced').textContent = '▲';
  }

  // ── Calendario annuale: due percorsi di caricamento ─────────────
  // PERCORSO 1: l'utente aveva già personalizzato (monthly_states non vuoto).
  // Carico i suoi valori esatti e marco touched=true così ulteriori modifiche
  // ai fert_months non sovrascriveranno le sue scelte.
  // PERCORSO 2: l'utente non aveva ancora personalizzato. Deduco dai
  // fert_months appena caricati così la griglia mostra una proposta sensata
  // se l'utente aprirà la sezione, ma touched resta false e le successive
  // modifiche ai mesi di concimazione continueranno a sincronizzare.
  const monthlyStatesStr = (plant.monthly_states || '').trim();
  if (monthlyStatesStr) {
    const parsed = monthlyStatesStr.split(',').map(s => parseInt(s.trim()));
    if (parsed.length === 12 && parsed.every(v => v >= 0 && v <= 3 && !isNaN(v))) {
      cpMonthlyStates = parsed;
      cpMonthlyTouched = true;
    } else {
      // Stati salvati non validi: cado in deduzione automatica
      cpDeduceFromFertMonths(true);
    }
  } else {
    // Nessun calendario manuale salvato: deduco dai fert_months attuali
    cpDeduceFromFertMonths(true);
  }
  // Le note arrivano già come oggetto deserializzato dal backend
  cpMonthlyNotes = (plant.monthly_notes && typeof plant.monthly_notes === 'object')
    ? Object.assign({}, plant.monthly_notes)  // Copia per evitare mutation indiretta
    : {};
  // Se ci sono dati nel calendario annuale, espando la sezione automaticamente
  // così l'utente vede subito il suo lavoro precedente quando riapre la pianta.
  const hasMonthlyData = cpMonthlyTouched || Object.keys(cpMonthlyNotes).length > 0;
  if (hasMonthlyData) {
    cpSectionStates.monthly = true;
    document.getElementById('cp-section-monthly').style.display = 'block';
    document.getElementById('cp-toggle-monthly').textContent = '▲';
  }
  // Aggiorno il rendering della griglia con i dati appena caricati
  cpRenderMonthlyGrid();
}

// ── Rendering del selettore mesi attivi ──────────────────────────────
// Genera 12 piccoli pulsanti, uno per mese. Quelli attivi (presenti in
// cpFertMonths) sono colorati col verde dell'app, gli altri sono grigi.
function cpRenderFertMonths() {
  const container = document.getElementById('cp-fert-months');
  if (!container) return;
  const names = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  let html = '';
  for (let m = 1; m <= 12; m++) {
    const active = cpFertMonths.has(m);
    const bg = active ? 'var(--accent)' : '#f0f0e8';
    const color = active ? 'white' : 'var(--muted)';
    html += `<button type="button" onclick="cpToggleMonth(${m})" style="padding:5px 10px;border-radius:6px;border:1px solid ${active ? 'var(--accent)' : '#d0d0c8'};background:${bg};color:${color};font-size:11px;font-weight:500;cursor:pointer">${names[m-1]}</button>`;
  }
  container.innerHTML = html;
}

function cpToggleMonth(m) {
  if (cpFertMonths.has(m)) cpFertMonths.delete(m);
  else cpFertMonths.add(m);
  cpRenderFertMonths();
  cpDirty = true;
  // Se l'utente non ha ancora customizzato manualmente il calendario annuale,
  // ri-deduco dagli fert_months aggiornati. Questo crea una sincronizzazione
  // bidirezionale gradevole: chi compila solo il livello avanzato vede il
  // calendario annuale aggiornarsi automaticamente, chi vuole controllo fine
  // entra nel livello monthly e da quel momento il sistema rispetta le sue scelte.
  if (!cpMonthlyTouched) {
    cpDeduceFromFertMonths(true);  // silent=true: non avviso l'utente
  }
}

// ── Gestione del calendario annuale per la sezione Mensile ──────────
// Disegna la griglia di 12 righe, una per mese. Ogni riga contiene
// il nome del mese, 4 pillole di stato cliccabili, e un campo testo
// per la nota personalizzata. Lo stato attivo viene evidenziato con
// colore semantico (verde=attivo, giallo=ridotto, rosso=speciale).
function cpRenderMonthlyGrid() {
  const container = document.getElementById('cp-monthly-grid');
  if (!container) return;
  const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                      'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  // Mappa stato → {label breve, colore}. Coerente con i colori usati nella
  // sezione Mensile dalle 26 native, così l'utente trova continuità visiva.
  const stateConfig = [
    {label: 'Auto',      color: '#d8d8d8', textColor: '#666'},     // 0
    {label: 'Attiva',    color: '#7a9a50', textColor: 'white'},    // 1
    {label: 'Ridotta',   color: '#c0a040', textColor: 'white'},    // 2
    {label: 'Speciale',  color: '#c06040', textColor: 'white'},    // 3
  ];

  let html = '';
  for (let m = 0; m < 12; m++) {
    const currentState = cpMonthlyStates[m] || 0;
    const currentNote = cpMonthlyNotes[m + 1] || '';
    // Riga compatta: nome mese a sinistra, pillole stato al centro,
    // campo nota sotto. Su mobile la disposizione si compatta automaticamente
    // grazie a flex-wrap.
    html += `
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #eaeae0">
        <div style="min-width:75px;font-size:12px;font-weight:600;color:#444">${monthNames[m]}</div>
        <div style="display:flex;gap:3px;flex-wrap:wrap">`;
    for (let s = 0; s < 4; s++) {
      const isActive = currentState === s;
      const cfg = stateConfig[s];
      const bg = isActive ? cfg.color : '#f5f5ef';
      const tc = isActive ? cfg.textColor : '#888';
      const border = isActive ? cfg.color : '#d8d8d0';
      html += `<button type="button" onclick="cpSetMonthlyState(${m},${s})" style="padding:3px 8px;border-radius:5px;border:1px solid ${border};background:${bg};color:${tc};font-size:10.5px;font-weight:500;cursor:pointer">${cfg.label}</button>`;
    }
    html += `
        </div>
        <input type="text" placeholder="Nota per ${monthNames[m].toLowerCase()} (opzionale)"
               value="${cpEscape(currentNote).replace(/"/g, '&quot;')}"
               oninput="cpSetMonthlyNote(${m + 1}, this.value)"
               style="flex:1;min-width:180px;padding:4px 8px;font-size:11px;border:1px solid #d0d0c8;border-radius:4px;background:#fafaf6">
      </div>`;
  }
  container.innerHTML = html;
}

// Imposta lo stato di un mese specifico nella griglia mensile.
// Marca cpMonthlyTouched a true così la deduzione automatica dai
// fert_months smette di sovrascrivere le scelte dell'utente.
function cpSetMonthlyState(monthIndex, state) {
  cpMonthlyStates[monthIndex] = state;
  cpMonthlyTouched = true;
  cpDirty = true;
  cpRenderMonthlyGrid();
}

// Salva la nota di un mese specifico. Diversamente dagli stati, le note
// non triggerano cpMonthlyTouched perché possono coesistere benissimo
// con la deduzione automatica degli stati: l'utente potrebbe voler
// dedurre gli stati ma aggiungere note descrittive a mano.
function cpSetMonthlyNote(monthNum, value) {
  if (value && value.trim()) {
    cpMonthlyNotes[monthNum] = value;
  } else {
    delete cpMonthlyNotes[monthNum];
  }
  cpDirty = true;
  // Non chiamo cpRenderMonthlyGrid qui per evitare di perdere il focus
  // del campo input mentre l'utente sta digitando. Il render sincronizzato
  // avverrà al prossimo cambio di stato o alla riapertura del form.
}

// Ricalcola gli stati mensili dai mesi di fertilizzazione del livello
// avanzato. Usato sia automaticamente (quando l'utente modifica i
// fert_months e non ha ancora customizzato il calendario annuale) sia
// manualmente tramite il pulsante "Deduci da concimazione".
function cpDeduceFromFertMonths(silent) {
  const newStates = new Array(12).fill(0);
  cpFertMonths.forEach(m => {
    if (m >= 1 && m <= 12) newStates[m - 1] = 1;  // Mesi attivi → stato 1
  });
  cpMonthlyStates = newStates;
  if (!silent) {
    cpMonthlyTouched = false;  // Reset esplicito: l'utente vuole ripartire
    cpToast('Calendario annuale rigenerato dai mesi di concimazione', 'info');
    cpDirty = true;
  }
  // Se la sezione monthly è aperta, aggiorno il rendering. Se è chiusa,
  // verrà aggiornata alla prossima apertura grazie al salvataggio in stato.
  cpRenderMonthlyGrid();
}

// ── Espansione/compressione delle sezioni del form ──────────────────
// Ricorda lo stato in cpSectionStates per persistenza durante la sessione.
function cpToggleSection(name) {
  cpSectionStates[name] = !cpSectionStates[name];
  document.getElementById('cp-section-' + name).style.display = cpSectionStates[name] ? 'block' : 'none';
  document.getElementById('cp-toggle-' + name).textContent = cpSectionStates[name] ? '▲' : '▼';
}

// ── Chiusura del form ──────────────────────────────────────────────
// Se l'utente ha modificato qualcosa, chiede conferma prima di scartare.
function cpCloseForm() {
  if (cpDirty) {
    if (!confirm('Hai modifiche non salvate. Vuoi davvero chiudere senza salvare?')) {
      return;
    }
  }
  document.getElementById('cp-overlay').classList.remove('open');
  document.body.style.overflow = '';
  cpEditingId = null;
  cpDirty = false;
}

// ── Salvataggio (crea o aggiorna) ──────────────────────────────────
async function cpSavePlant() {
  // Validazione: il nome è l'unico campo obbligatorio
  const name = document.getElementById('cp-name').value.trim();
  if (!name) {
    cpToast('Il nome è obbligatorio', 'error');
    document.getElementById('cp-name').focus();
    return;
  }

  // Costruisco il payload prendendo solo i campi compilati per i parametri
  // numerici opzionali. Una stringa vuota verrà inviata come stringa vuota
  // e il backend la interpreterà come null grazie alla funzione opt_num.
  const numOrEmpty = (id) => {
    const v = document.getElementById(id).value.trim();
    return v === '' ? null : parseFloat(v);
  };

  // Costruisco l'oggetto cardData iterando la tabella di mappatura. Il
  // risultato è la struttura {con:{}, sub:{}, esp:{}, cur:{}, bio:{}} che
  // il backend si aspetta e che salva poi come JSON nella colonna card_data.
  // Salto i sotto-campi vuoti per non spedire stringhe inutili e per produrre
  // JSON più piccolo nel database — il backend fa comunque la stessa pulizia
  // come difesa in profondità, ma farla anche qui rende più leggibile il
  // payload che scorre sulla rete.
  const cardData = {};
  for (const [sectionKey, fields] of Object.entries(CP_CARD_FIELDS)) {
    cardData[sectionKey] = {};
    for (const field of fields) {
      const el = document.getElementById(field.id);
      const value = el ? el.value.trim() : '';
      if (value) cardData[sectionKey][field.key] = value;
    }
  }

  const payload = {
    name: name,
    latin: document.getElementById('cp-latin').value.trim(),
    icon: document.getElementById('cp-icon').value.trim() || '🌱',
    simGroup: document.getElementById('cp-sim-group').value,
    sensorCat: document.getElementById('cp-sensor-cat').value,
    cardData: cardData,
    fertMonths: Array.from(cpFertMonths).sort((a,b) => a-b),
    fertInterval: parseInt(document.getElementById('cp-fert-interval').value) || 21,
    fertProduct: document.getElementById('cp-fert-product').value.trim(),
    fertNote: document.getElementById('cp-fert-note').value.trim(),
    // Calendario annuale: invio gli stati solo se l'utente ha customizzato
    // manualmente (touched=true). Altrimenti mando stringa vuota e il backend
    // saprà che deve dedurre dai fert_months al momento del rendering.
    // Le note invece le mando sempre, perché possono coesistere con la
    // deduzione automatica degli stati.
    monthlyStates: cpMonthlyTouched ? cpMonthlyStates.slice() : [],
    monthlyNotes: Object.assign({}, cpMonthlyNotes),
    rootDepthCm: numOrEmpty('cp-root-depth'),
    pCoef: numOrEmpty('cp-p-coef'),
    kcInitial: numOrEmpty('cp-kc-initial'),
    kcDev: numOrEmpty('cp-kc-dev'),
    kcMid: numOrEmpty('cp-kc-mid'),
    kcLate: numOrEmpty('cp-kc-late'),
    kcDormant: numOrEmpty('cp-kc-dormant'),
  };

  try {
    let res;
    if (cpEditingId) {
      // Modifica: PUT
      res = await apiFetch(`/api/plants/${cpEditingId}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
    } else {
      // Aggiunta: POST
      res = await apiFetch('/api/plants', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({error: 'Errore sconosciuto'}));
      cpToast(err.error || 'Errore nel salvataggio', 'error');
      return;
    }

    cpToast(cpEditingId ? `✅ ${name} aggiornata` : `✅ ${name} aggiunta`, 'success');
    cpDirty = false;

    // Ricarica le piante custom: la fusione è idempotente, quindi questo
    // aggiorna sia la cache che le 5 strutture native in memoria.
    await loadCustomPlants();

    // Re-inizializza la sezione Schede se è quella attiva, così l'utente
    // vede subito il nuovo stato senza dover cambiare sezione e tornare.
    if (typeof sInitSchede === 'function') {
      sInitSchede();
    }

    // Chiudi il form
    document.getElementById('cp-overlay').classList.remove('open');
    document.body.style.overflow = '';
    cpEditingId = null;
  } catch (e) {
    cpToast('Errore di rete: ' + e.message, 'error');
  }
}

// ── Eliminazione protetta ───────────────────────────────────────────
// Se la pianta è in uso da vasi o voci diario, il backend risponde 409
// con la lista dei blocchi. Mostriamo all'utente un messaggio chiaro
// con suggerimento esplicito su cosa fare prima di poter eliminare.
// Cancellazione di una pianta. La logica di base accetta un plantId esplicito
// in modo che possa essere chiamata sia dal pulsante "Elimina" interno al form
// di modifica (caso storico, dove l'id si leggeva implicitamente da cpEditingId)
// sia dal pulsante 🗑️ sulla card della griglia (nuovo, dove l'id viene passato
// come argomento). I due wrapper sotto adattano l'una all'altra.
//
// La funzione gestisce tre esiti possibili dell'API:
//   1) successo → toast verde, ricarica le piante dal backend, chiude eventuali
//      overlay aperti
//   2) 409 Conflict → la pianta è ancora in uso (vasi nell'inventario o voci
//      nel diario): mostra un alert dettagliato che spiega cosa la sta usando
//      e cosa fare per sbloccarla, senza cancellare nulla
//   3) altri errori → toast rosso con il messaggio del backend
async function _cpDeletePlantCore(plantId) {
  const plant = customPlantsCache.find(p => p.id === plantId);
  if (!plant) {
    cpToast('Pianta non trovata', 'error');
    return;
  }

  // Conferma esplicita prima di procedere. Il messaggio è esattamente quello
  // che mostrava il dialog modale precedente — non lo cambio per non rompere
  // il modello mentale dell'utente, ma adesso vive in un solo posto invece
  // che essere duplicato tra form e griglia.
  if (!confirm(`Eliminare definitivamente la pianta "${plant.name}"?\n\nQuesta operazione non può essere annullata.`)) {
    return;
  }

  try {
    const res = await apiFetch(`/api/plants/${plantId}`, {method: 'DELETE'});

    if (res.status === 409) {
      // Eliminazione bloccata: ci sono dipendenze. Mostro lista dettagliata.
      const data = await res.json();
      const pots = data.blocking?.pots || [];
      const diaryCount = data.blocking?.diary_entries || 0;
      let msg = `Non posso eliminare "${plant.name}" perché è ancora in uso.\n\n`;
      if (pots.length) {
        msg += `🪴 Vasi che la usano (${pots.length}):\n`;
        pots.slice(0, 5).forEach(p => msg += `  • ${p.nickname || 'senza nome'} (id ${p.id})\n`);
        if (pots.length > 5) msg += `  ... e altri ${pots.length - 5}\n`;
        msg += '\n';
      }
      if (diaryCount > 0) {
        msg += `📓 Voci diario che la nominano: ${diaryCount}\n\n`;
      }
      msg += `Per eliminare questa pianta, prima rimuovi i vasi associati dalla sezione Vasi.\nLe voci diario possono restare: si riferiranno solo al nome storico.`;
      alert(msg);
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({error: 'Errore'}));
      cpToast(err.error || 'Errore eliminazione', 'error');
      return;
    }

    cpToast(`🗑️ ${plant.name} eliminata`, 'success');

    // Dopo cancellazione: ricarico tutte le strutture dal backend per
    // riflettere lo stato corrente. Faccio anche la chiusura degli overlay
    // del form e del dettaglio scheda nel caso fossero aperti — è difensivo
    // ma costa poco e copre tutti i flussi possibili. Idem per il toggle
    // di cpEditingId: lo azzero se corrisponde alla pianta cancellata,
    // così il prossimo cpOpenEditForm parte da uno stato pulito.
    await loadCustomPlants();
    if (typeof sInitSchede === 'function') {
      sInitSchede();
    }
    const cpOverlay = document.getElementById('cp-overlay');
    if (cpOverlay) {
      cpOverlay.classList.remove('open');
    }
    const sOverlay = document.getElementById('s-overlay');
    if (sOverlay && sOverlay.classList.contains('open') && sCurrentPlant && sCurrentPlant.id === plantId) {
      sOverlay.classList.remove('open');
      sCurrentPlant = null;
    }
    document.body.style.overflow = '';
    if (cpEditingId === plantId) {
      cpEditingId = null;
    }
  } catch (e) {
    cpToast('Errore di rete: ' + e.message, 'error');
  }
}

// Wrapper retrocompatibile per il pulsante "Elimina" dentro il form di modifica.
// Il form usa cpEditingId come id implicito della pianta in lavorazione.
async function cpDeletePlant() {
  if (!cpEditingId) return;
  await _cpDeletePlantCore(cpEditingId);
}

// Wrapper per il pulsante 🗑️ della card della griglia. Riceve l'id
// esplicitamente come argomento perché la card non ha contesto implicito.
async function cpDeletePlantById(plantId) {
  await _cpDeletePlantCore(plantId);
}

// ── Sistema toast (notifiche temporanee) ────────────────────────────
// Riusiamo lo stesso pattern delle notifiche già usate in altre sezioni:
// un piccolo banner che appare in alto, sparisce dopo 3 secondi.
function cpToast(message, type = 'info') {
  // Rimuovi eventuali toast esistenti
  document.querySelectorAll('.cp-toast').forEach(t => t.remove());
  const colors = {
    success: {bg: '#e0f2e0', border: '#7aaa7a', text: '#2a5a2a'},
    error:   {bg: '#fdf0f0', border: '#d8a0a0', text: '#a04040'},
    info:    {bg: '#edf5ff', border: '#a8c8e8', text: '#2a5a8a'},
  };
  const c = colors[type] || colors.info;
  const toast = document.createElement('div');
  toast.className = 'cp-toast';
  toast.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);background:${c.bg};border:1px solid ${c.border};color:${c.text};padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:90vw`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Tracking del flag dirty ─────────────────────────────────────────
// Quando l'utente modifica qualunque campo del form, alziamo il flag
// che ci serve per la conferma di chiusura non salvata. Usiamo event
// delegation sul modal così non dobbiamo attaccarlo a ogni singolo input.
document.addEventListener('input', (e) => {
  if (e.target.closest('#cp-overlay')) {
    cpDirty = true;
  }
});

// ── Gestione tasto Escape ───────────────────────────────────────────
// Aggiungo cpCloseForm() alla lista degli handler del tasto Escape già
// gestita nel codice esistente. Vedere keydown handler globale.

// ── Gestione parametri di simulazione persistenti per vaso ───────────
// Questa funzione è la fonte di verità unica: dato un vaso, ritorna sempre
// un oggetto completo con tutti i parametri, usando i salvati se presenti
// e riempiendo il resto coi default del gruppo pianta.
function simGetParamsForPot(item) {
  const simP = SIM_PLANT_PARAMS[item.plantTypeIdx] || {group:'arbusto', root:25, p:0.45};
  const kcDefault = SIM_KC_BY_GROUP[simP.group] || SIM_KC_BY_GROUP.arbusto;
  const saved = item.simParams || {};
  return {
    group: simP.group,
    rootDepthCm: saved.rootDepthCm != null ? saved.rootDepthCm : simP.root,
    pCoef: saved.pCoef != null ? saved.pCoef : simP.p,
    kcInitial: saved.kcInitial != null ? saved.kcInitial : kcDefault.initial,
    kcDev:     saved.kcDev     != null ? saved.kcDev     : kcDefault.dev,
    kcMid:     saved.kcMid     != null ? saved.kcMid     : kcDefault.mid,
    kcLate:    saved.kcLate    != null ? saved.kcLate    : kcDefault.late,
    kcDormant: saved.kcDormant != null ? saved.kcDormant : kcDefault.dormant,
  };
}

// Ritorna il Kc per lo stadio corrente usando i parametri del vaso
function simGetKcForStage(params, stage) {
  const map = {initial:'kcInitial', dev:'kcDev', mid:'kcMid', late:'kcLate', dormant:'kcDormant'};
  return params[map[stage]] || params.kcMid;
}

// Determina lo stadio corrente in base al mese (per piante esterne)
function simGetCurrentStage(month) {
  if (month <= 2 || month === 12) return 'dormant';
  if (month <= 4) return 'initial';
  if (month === 5 || month >= 10) return 'dev';
  if (month <= 8) return 'mid';
  return 'late';
}

// ── Fallback "ultima annaffiatura" per vasi senza sensore ──────────────
// Cerca la data più recente dell'ultima annaffiatura per questo vaso,
// combinando il campo manuale "lastWatered" del vaso con l'ultima spunta
// nel calendario per quel tipo di pianta.
function simFindLastWateringDate(item) {
  const candidates = [];

  // 1) Campo manuale "ultima annaffiatura" registrato sul vaso
  if (item.lastWatered) {
    const d = new Date(item.lastWatered + 'T12:00');
    if (!isNaN(d.getTime())) candidates.push({date: d, source: 'manual'});
  }

  // 2) Ultima spunta nel calendario per questo tipo di pianta (0-25)
  // Le chiavi hanno formato wa_YYYY-M-D_<plantId> quando waSetDone le salva
  try {
    const plantId = item.plantTypeIdx;
    let mostRecent = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('wa_')) continue;
      if (localStorage.getItem(key) !== '1') continue;
      // Parsing: wa_YYYY-M-D_<plantId>
      const m = key.match(/^wa_(\d{4})-(\d+)-(\d+)_(\d+)$/);
      if (!m) continue;
      const keyPlantId = parseInt(m[4]);
      if (keyPlantId !== plantId) continue;
      const date = new Date(+m[1], +m[2] - 1, +m[3]);
      if (!mostRecent || date > mostRecent) mostRecent = date;
    }
    if (mostRecent) candidates.push({date: mostRecent, source: 'calendar'});
  } catch {}

  // Scegli la più recente tra manuale e calendario
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.date - a.date);
  return candidates[0];
}

// ── Stima umidità attuale da ultima annaffiatura ───────────────────────
// Se non c'è il sensore, usa il motore di simulazione "al contrario":
// parte dal 98% (tipico target post-irrigazione) alla data dell'ultima
// annaffiatura e calcola il consumo idrico fino ad oggi.
function simEstimateMoistureFromLastWater(item, lastWaterInfo, historicalMeteo) {
  if (!lastWaterInfo) return null;

  const today = new Date();
  today.setHours(0,0,0,0);
  const daysSince = Math.floor((today - lastWaterInfo.date) / 86400000);

  if (daysSince < 0) return 98;       // Annaffiatura futura nel DB? Tratta come appena fatta
  if (daysSince === 0) return 98;     // Annaffiato oggi → al target
  if (daysSince > 30) return null;    // Troppo tempo fa, meglio fallback al 65%

  // Prepara meteo retrospettivo: distinguiamo indoor (ambiente stabile) da
  // outdoor (stagionale). Se il chiamante fornisce meteo custom, ha priorità.
  const isIndoorPlant = item.location === 'indoor';
  const meteoBack = historicalMeteo || simBuildHistoricalMeteo(daysSince, isIndoorPlant);

  // Simulazione "headless" identica a simQuickRun ma senza irrigazioni
  // (partiamo subito dopo un'annaffiatura, vediamo come si svuota)
  const params = simGetParamsForPot(item);
  const vol = invGetVolFromItem(item);
  const potHeight = item.potShape === 'square' ? item.potHSq :
                    item.potShape === 'truncated' ? item.potHTrunc : item.potH;
  const maxRoot = (potHeight || 20) - 2;
  const rootDepthCm = Math.min(params.rootDepthCm, maxRoot);

  let whc = SUBSTRATE_WHC[item.substrate] || 0.30;
  if (item.substrate === 'custom' && item.customSubstrate) {
    whc = wSubstrates.reduce((s, sub) => {
      const pct = (item.customSubstrate[sub.id] || 0) / 100;
      return s + pct * sub.whc;
    }, 0) || 0.30;
  }
  const rootFraction = Math.min(1, rootDepthCm / (potHeight || 20));
  const thetaFC_L = whc * vol * rootFraction;

  let areaM2;
  if (item.potShape === 'square') areaM2 = ((item.potW||25)/100) * ((item.potD||25)/100);
  else if (item.potShape === 'truncated') areaM2 = Math.PI * Math.pow(((item.potDiamTop||25)/2)/100, 2);
  else areaM2 = Math.PI * Math.pow(((item.potDiam||25)/2)/100, 2);

  let evapFactor = 1.0;
  if (item.potMat === 'terracotta') evapFactor *= 1.18;
  if (item.hasMulch) evapFactor *= 0.65;
  if (item.hasSaucer) evapFactor *= 0.92;

  // Partenza: 98% FC (target tipico dopo annaffiatura completa)
  let theta_L = 0.98 * thetaFC_L;

  // Stadio dal mese medio del periodo
  const midMonth = new Date(lastWaterInfo.date.getTime() + (daysSince/2) * 86400000).getMonth() + 1;
  const stage = simGetCurrentStage(midMonth);
  const kc = simGetKcForStage(params, stage);

  for (let d = 0; d < daysSince; d++) {
    const m = meteoBack[d] || meteoBack[meteoBack.length - 1];
    const tMean = (m.tmin + m.tmax) / 2;
    const et0Res = calcET0(tMean, m.hum, m.solarW, m.wind);
    const rain_L = m.rain * areaM2;
    const ETc_L = kc * et0Res.et0 * evapFactor * areaM2;
    theta_L += rain_L - ETc_L;
    if (theta_L > thetaFC_L) theta_L = thetaFC_L;
    if (theta_L < 0) theta_L = 0;
  }

  return Math.max(10, Math.min(100, (theta_L / thetaFC_L) * 100));
}

// Costruisce dati meteo retrospettivi: preferisce storico Ecowitt, altrimenti stagionali.
// Per piante indoor usa valori "ambiente interno" stabili (21°C, 55% hum, luce indiretta).
function simBuildHistoricalMeteo(days, isIndoor) {
  const meteo = [];
  if (isIndoor) {
    for (let i = 0; i < days; i++) {
      meteo.push({tmin:19, tmax:23, hum:55, wind:2, solarW:300, rain:0, isIndoor:true});
    }
    return meteo;
  }
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(today.getTime() - (days - i) * 86400000);
    const month = date.getMonth() + 1;
    const seasonal = {
      1:{tmin:3,tmax:10,hum:75,wind:8,solarW:150,rain:2},
      2:{tmin:4,tmax:12,hum:70,wind:8,solarW:200,rain:2},
      3:{tmin:7,tmax:16,hum:65,wind:10,solarW:300,rain:2},
      4:{tmin:10,tmax:20,hum:60,wind:10,solarW:400,rain:2},
      5:{tmin:14,tmax:24,hum:55,wind:8,solarW:500,rain:1},
      6:{tmin:18,tmax:29,hum:50,wind:8,solarW:600,rain:1},
      7:{tmin:21,tmax:32,hum:45,wind:8,solarW:700,rain:0.5},
      8:{tmin:21,tmax:32,hum:50,wind:8,solarW:650,rain:1},
      9:{tmin:17,tmax:27,hum:60,wind:8,solarW:450,rain:2},
      10:{tmin:12,tmax:21,hum:65,wind:10,solarW:300,rain:3},
      11:{tmin:7,tmax:15,hum:75,wind:10,solarW:180,rain:3},
      12:{tmin:4,tmax:11,hum:75,wind:10,solarW:120,rain:3},
    };
    meteo.push({...seasonal[month]});
  }
  return meteo;
}

// Apre il simulatore per un vaso
async function simOpen(potId) {
  const inv = invLoad();
  const item = inv.find(x => x.id === potId);
  if (!item) return;
  _simPotId = potId;

  const p = getPlantById(item.plantTypeIdx);
  // Usa la funzione unificata che fonde saved + default — stessa logica del batch
  const params = simGetParamsForPot(item);
  const vol = invGetVolFromItem(item);

  // Titolo
  document.getElementById('sim-subtitle').textContent =
    `${item.nickname || p.name} · ${invGetDimsLabel(item)} · ${vol.toFixed(1)}L`;

  // Popola campi: ora usa i parametri persistenti del vaso se presenti
  document.getElementById('sim-stage').value = 'mid';
  document.getElementById('sim-kc').value = params.kcMid;
  document.getElementById('sim-root').value = params.rootDepthCm;
  document.getElementById('sim-p').value = params.pCoef;
  document.getElementById('sim-days').value = 7;
  document.getElementById('sim-color').value = 'chiaro';
  // Pacciamatura e sottovaso sono ora attributi del vaso, non scelte di scenario
  document.getElementById('sim-mulch').checked = !!item.hasMulch;
  document.getElementById('sim-saucer').checked = !!item.hasSaucer;
  document.getElementById('sim-auto').checked = true;
  document.getElementById('sim-raw-factor').value = 1.0;
  document.getElementById('sim-target-fill').value = 0.98;
  document.getElementById('sim-meteo-mode').value = 'live';
  simToggleMeteoMode();

  // Info pianta: mostra il profilo Kc completo (personalizzato o default)
  const groupLabels = {succulenta:'Succulenta', orchidea:'Orchidea', tropicale:'Tropicale', agrume:'Agrume', mediterranea:'Mediterranea', bonsai:'Bonsai', arbusto:'Arbusto', albero:'Albero', aromatica:'Aromatica', fiorita:'Da fiore'};
  const kcCustomized = !!(item.simParams && Object.keys(item.simParams).length);
  document.getElementById('sim-plant-info').innerHTML =
    `${p.name} · Gruppo: ${groupLabels[params.group]||params.group} · Kc: iniziale ${params.kcInitial}, sviluppo ${params.kcDev}, piena ${params.kcMid}, tarda ${params.kcLate}, riposo ${params.kcDormant}` +
    (kcCustomized ? ' <span style="color:#2a7abf;font-weight:600">· personalizzato</span>' : '');

  // Info contenitore
  const whcInfo = item.substrate==='custom' && item.customSubstrate
    ? 'personalizzato (WHC calcolato dalla media pesata)'
    : INV_SUB_LABELS[item.substrate]||item.substrate;
  document.getElementById('sim-pot-info').innerHTML =
    `<b>${invGetDimsLabel(item)} · ${vol.toFixed(1)}L</b> · materiale: ${item.potMat} · substrato: ${whcInfo}`;

  // ── Cascata di priorità per l'umidità iniziale ─────────────────────
  // 1° tentativo: sensore live (WH51/WH52)
  // 2° tentativo: stima da ultima annaffiatura nota
  // 3° fallback: 65% generico
  _simLiveMoisture = null;
  _simIndoorLive = null;
  let moistureSource = 'default';
  let moistureNote = '';

  // Singolo fetch Ecowitt che raccoglie tutto: moisture dal WH51/WH52 + dati WN31
  let ewJson = null;
  try {
    const res = await apiFetch('/api/ecowitt/realtime');
    const j = await res.json();
    if (j.configured && j.code === 0) ewJson = j;
  } catch {}

  // Popola dati indoor (WN31 CH1) se la pianta è indoor
  if (ewJson && item.location === 'indoor') {
    _simIndoorLive = meteoGetIndoorData(ewJson, 1);
  }

  // Banner informativo nel modal meteo
  const banner = document.getElementById('sim-meteo-banner');
  if (banner) {
    if (item.location === 'indoor') {
      if (_simIndoorLive && _simIndoorLive.temp !== null) {
        banner.innerHTML = `🏠 <b>Pianta indoor</b> — usa dati WN31 CH1: ${_simIndoorLive.temp.toFixed(1)}°C, umidità ${Math.round(_simIndoorLive.humidity)}%. Meteo esterno ignorato.`;
        banner.style.background = '#e6f1fb';
        banner.style.color = '#2a5a8a';
      } else {
        banner.innerHTML = `🏠 <b>Pianta indoor</b> — sensore WN31 CH1 non disponibile, uso default ambiente (21°C, 55% umidità).`;
        banner.style.background = '#fdf5e0';
        banner.style.color = '#8a6a20';
      }
      banner.style.display = 'block';
    } else {
      banner.innerHTML = `🌤️ <b>Pianta ${item.location === 'balcone' ? 'in balcone' : 'outdoor'}</b> — usa dati meteo esterni (Ecowitt + previsioni Open-Meteo).`;
      banner.style.background = '#edf5ff';
      banner.style.color = '#2a5a8a';
      banner.style.display = 'block';
    }
  }

  // Tenta lettura umidità dal sensore WH51/WH52
  if (item.wh51Ch && ewJson) {
    const d = meteoGetSoilData(ewJson, parseInt(item.wh51Ch));
    if (d.moisture !== null) {
      _simLiveMoisture = d.moisture;
      document.getElementById('sim-initial-moist').value = Math.round(d.moisture);
      moistureSource = 'sensor';
      moistureNote = `📡 Letto in tempo reale dal sensore CH${item.wh51Ch}`;
    }
  }

  // Se il sensore non ha dato risposta, prova con la data ultima annaffiatura
  if (moistureSource === 'default') {
    const lastWater = simFindLastWateringDate(item);
    if (lastWater) {
      const estimated = simEstimateMoistureFromLastWater(item, lastWater);
      if (estimated !== null) {
        document.getElementById('sim-initial-moist').value = Math.round(estimated);
        moistureSource = 'estimated';
        const daysSince = Math.floor((new Date() - lastWater.date) / 86400000);
        const srcLabel = lastWater.source === 'calendar' ? 'dal calendario' : 'dato manuale';
        moistureNote = `💧 Stimato ${daysSince} giorni dopo l'ultima annaffiatura (${srcLabel})`;
      }
    }
  }

  // Se nemmeno questo, usa 65% e avvisa l'utente
  if (moistureSource === 'default') {
    document.getElementById('sim-initial-moist').value = 65;
    moistureNote = '⚠️ Nessun sensore né annaffiatura registrata — stima generica, poco accurata';
  }

  // Mostra la fonte dell'umidità iniziale sotto il campo
  const noteEl = document.getElementById('sim-moist-source');
  if (noteEl) {
    noteEl.textContent = moistureNote;
    noteEl.style.color = moistureSource === 'sensor' ? '#2a6a2a' :
                         moistureSource === 'estimated' ? '#2a7abf' : '#b08030';
  }

  // Prefetch previsioni per lo scenario meteo live
  _simForecast = null;
  try {
    const res = await apiFetch('/api/forecast');
    const data = await res.json();
    if (!data.error && data.daily) _simForecast = data;
  } catch {}

  document.getElementById('sim-results').style.display = 'none';
  document.getElementById('sim-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function simClose() {
  document.getElementById('sim-overlay').classList.remove('open');
  document.body.style.overflow = '';
  _simPotId = null;
}

// Salva i parametri di simulazione del vaso corrente nel database.
// Raccoglie Kc (5 stadi), profondità radicale, coefficiente p dal form,
// più gli attributi fisici pacciamatura/sottovaso, e persiste via API.
async function simSaveParams() {
  if (!_simPotId) return;
  const inv = invLoad();
  const item = inv.find(x => x.id === _simPotId);
  if (!item) return;

  const simP = SIM_PLANT_PARAMS[item.plantTypeIdx] || {group:'arbusto'};
  const kcDefault = SIM_KC_BY_GROUP[simP.group] || SIM_KC_BY_GROUP.arbusto;
  const currentStage = document.getElementById('sim-stage').value;
  const currentKc = +document.getElementById('sim-kc').value;

  // Preserva i Kc degli altri stadi (quelli non modificati nel form)
  // e aggiorna solo lo stadio corrente se diverso dal default
  const saved = item.simParams || {};
  const newSimParams = {
    rootDepthCm: +document.getElementById('sim-root').value,
    pCoef: +document.getElementById('sim-p').value,
    kcInitial: saved.kcInitial != null ? saved.kcInitial : kcDefault.initial,
    kcDev:     saved.kcDev     != null ? saved.kcDev     : kcDefault.dev,
    kcMid:     saved.kcMid     != null ? saved.kcMid     : kcDefault.mid,
    kcLate:    saved.kcLate    != null ? saved.kcLate    : kcDefault.late,
    kcDormant: saved.kcDormant != null ? saved.kcDormant : kcDefault.dormant,
  };
  // Aggiorna solo lo stadio corrente con il valore nel form
  const stageKey = {initial:'kcInitial', dev:'kcDev', mid:'kcMid', late:'kcLate', dormant:'kcDormant'}[currentStage];
  if (stageKey) newSimParams[stageKey] = currentKc;

  // Costruisci oggetto completo per l'update
  const updated = {
    ...item,
    simParams: newSimParams,
    hasMulch: document.getElementById('sim-mulch').checked,
    hasSaucer: document.getElementById('sim-saucer').checked,
  };

  try {
    if (invUseAPI) {
      const res = await fetch(`${INV_API}/${item.id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        invCache = null;
        await invLoadFromAPI();
      }
    } else {
      // Fallback localStorage: aggiorna in place
      const list = invLSLoad();
      const idx = list.findIndex(x => x.id === item.id);
      if (idx >= 0) {
        list[idx] = updated;
        invLSSave(list);
        invCache = null;
      }
    }
    const msg = document.getElementById('sim-save-msg');
    msg.textContent = '✅ Parametri salvati per questo vaso';
    msg.style.display = 'block';
    msg.style.color = '#2a6a2a';
    setTimeout(() => msg.style.display = 'none', 2500);
  } catch (e) {
    const msg = document.getElementById('sim-save-msg');
    msg.textContent = '❌ Errore nel salvataggio';
    msg.style.display = 'block';
    msg.style.color = '#b04040';
    setTimeout(() => msg.style.display = 'none', 3000);
  }
}

// Ripristina i parametri generici dal gruppo pianta, cancellando le personalizzazioni.
async function simResetParams() {
  if (!_simPotId) return;
  if (!confirm('Ripristinare i parametri generici della specie?\nLe personalizzazioni verranno cancellate.')) return;
  const inv = invLoad();
  const item = inv.find(x => x.id === _simPotId);
  if (!item) return;

  const updated = {
    ...item,
    simParams: {},        // Vuoto: il merge tornerà ai default del gruppo
    hasMulch: false,
    hasSaucer: false,
  };

  try {
    if (invUseAPI) {
      const res = await fetch(`${INV_API}/${item.id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        invCache = null;
        await invLoadFromAPI();
      }
    } else {
      const list = invLSLoad();
      const idx = list.findIndex(x => x.id === item.id);
      if (idx >= 0) { list[idx] = updated; invLSSave(list); invCache = null; }
    }
    // Riapri il modal per ricaricare i default
    simOpen(item.id);
  } catch {}
}

function simToggleMeteoMode() {
  const mode = document.getElementById('sim-meteo-mode').value;
  document.getElementById('sim-meteo-manual').style.display = mode === 'manual' ? 'block' : 'none';
}

function simOnStageChange() {
  if (!_simPotId) return;
  const inv = invLoad();
  const item = inv.find(x => x.id === _simPotId);
  if (!item) return;
  const simP = SIM_PLANT_PARAMS[item.plantTypeIdx] || {group:'arbusto'};
  const kc = SIM_KC_BY_GROUP[simP.group] || SIM_KC_BY_GROUP.arbusto;
  const stage = document.getElementById('sim-stage').value;
  document.getElementById('sim-kc').value = kc[stage] || 0.7;
}

// Costruisce array di dati meteo giornalieri per la simulazione
function simBuildMeteoArray(days) {
  const mode = document.getElementById('sim-meteo-mode').value;
  const meteo = [];

  // Se la pianta è indoor, il meteo live diventa "ambiente interno" stabile
  // usando i dati WN31 cached in _simIndoorLive (popolato da simOpen)
  const item = invLoad().find(x => x.id === _simPotId);
  const isIndoor = item && item.location === 'indoor';

  if (mode === 'manual') {
    const tmin = +document.getElementById('sim-tmin').value;
    const tmax = +document.getElementById('sim-tmax').value;
    const hum = +document.getElementById('sim-hum').value;
    const wind = +document.getElementById('sim-wind').value;
    const solarMJ = +document.getElementById('sim-solar').value;
    const rain = +document.getElementById('sim-rain').value;
    // Converti MJ/m²/g → W/m² medio (MJ / 86.4 ks per giorno ≈ W/m² medio diurno)
    const solarW = solarMJ * 1000 / PARAMS.solarConv;
    for (let d = 0; d < days; d++) {
      meteo.push({tmin, tmax, hum, wind, solarW, rain, source:'manual'});
    }
  } else if (isIndoor) {
    // Modalità live per pianta indoor: usa WN31 CH1 (temp+hum) + surrogati FAO
    const live = _simIndoorLive || {temp: 21, humidity: 55};
    const t = live.temp !== null ? live.temp : 21;
    const h = live.humidity !== null ? live.humidity : 55;
    for (let d = 0; d < days; d++) {
      meteo.push({
        tmin: t - 2, tmax: t + 2,
        hum: h,
        wind: 2,
        solarW: 300,
        rain: 0,
        source: 'wn31_indoor',
      });
    }
  } else {
    // Usa previsioni Open-Meteo per piante outdoor/balcone
    const daily = _simForecast && _simForecast.daily;
    for (let d = 0; d < days; d++) {
      if (daily && d < daily.time.length) {
        meteo.push({
          tmin: daily.temperature_2m_min[d],
          tmax: daily.temperature_2m_max[d],
          hum: 60, // Open-Meteo daily non fornisce hum media direttamente
          wind: daily.wind_speed_10m_max ? daily.wind_speed_10m_max[d] * 0.6 : 8,
          solarW: 300, // approx, serve radiazione più precisa ma non fornita in daily
          rain: daily.precipitation_sum[d] || 0,
          source:'forecast',
        });
      } else {
        // Fallback: estende con ultimo giorno disponibile
        const last = meteo[meteo.length-1];
        meteo.push(last ? {...last} : {tmin:15, tmax:25, hum:60, wind:8, solarW:300, rain:0, source:'default'});
      }
    }
  }
  return meteo;
}

// Motore di bilancio idrico FAO-56
function simRun() {
  const inv = invLoad();
  const item = inv.find(x => x.id === _simPotId);
  if (!item) return;

  const p = getPlantById(item.plantTypeIdx);
  const vol = invGetVolFromItem(item);

  // Parametri
  const stage = document.getElementById('sim-stage').value;
  const kc = +document.getElementById('sim-kc').value;
  let rootDepthCm = +document.getElementById('sim-root').value;
  const pCoef = +document.getElementById('sim-p').value;
  const days = Math.max(1, Math.min(30, +document.getElementById('sim-days').value));
  const initialMoistPct = +document.getElementById('sim-initial-moist').value;
  const color = document.getElementById('sim-color').value;
  const hasMulch = document.getElementById('sim-mulch').checked;
  const hasSaucer = document.getElementById('sim-saucer').checked;
  const autoEnabled = document.getElementById('sim-auto').checked;
  const rawFactor = +document.getElementById('sim-raw-factor').value;
  const targetFill = +document.getElementById('sim-target-fill').value;

  // Limita la profondità radicale all'altezza del vaso
  const potHeight = item.potShape === 'square' ? item.potHSq :
                    item.potShape === 'truncated' ? item.potHTrunc : item.potH;
  const maxRoot = (potHeight || 20) - 2; // margine di 2cm dal fondo
  if (rootDepthCm > maxRoot) rootDepthCm = maxRoot;

  // WHC del substrato
  let whc = SUBSTRATE_WHC[item.substrate] || 0.30;
  if (item.substrate === 'custom' && item.customSubstrate) {
    whc = wSubstrates.reduce((s, sub) => {
      const pct = (item.customSubstrate[sub.id] || 0) / 100;
      return s + pct * sub.whc;
    }, 0) || 0.30;
  }

  // Parametri idrologici (volume-based, in litri)
  // Capacità di campo (L) = WHC × volume vaso, ma riferita alla zona radicale
  const rootFraction = Math.min(1, rootDepthCm / (potHeight || 20));
  const rootVolumeL = vol * rootFraction;
  const thetaFC_L = whc * rootVolumeL;  // L al field capacity
  const thetaPWP_L = thetaFC_L * 0.25;   // PWP ≈ 25% di FC (approssimato per substrati organici)
  const TAW_L = thetaFC_L - thetaPWP_L;
  const RAW_L = pCoef * TAW_L;

  // Superficie del vaso (m²) per conversione ET mm → L
  let areaM2;
  if (item.potShape === 'square') {
    areaM2 = ((item.potW||25)/100) * ((item.potD||25)/100);
  } else if (item.potShape === 'truncated') {
    const rTop = ((item.potDiamTop||25)/2)/100;
    areaM2 = Math.PI * rTop * rTop;
  } else {
    const r = ((item.potDiam||25)/2)/100;
    areaM2 = Math.PI * r * r;
  }

  // Fattori di modifica evaporazione
  let evapFactor = 1.0;
  if (item.potMat === 'terracotta') evapFactor *= 1.18;
  if (color === 'scuro') evapFactor *= 1.10;
  if (hasMulch) evapFactor *= 0.65;
  if (hasSaucer) evapFactor *= 0.92;

  // Meteo
  const meteo = simBuildMeteoArray(days);

  // Simulazione
  let theta_L = initialMoistPct / 100 * thetaFC_L;
  const results = [];
  let totalIrrigation_L = 0;
  let totalDrainage_L = 0;
  let stressDays = 0;
  const irrigationEvents = [];

  for (let d = 0; d < days; d++) {
    const m = meteo[d];
    const tMean = (m.tmin + m.tmax) / 2;

    // ET₀ Penman-Monteith (riutilizza la funzione esistente)
    const et0Res = calcET0(tMean, m.hum, m.solarW, m.wind);
    const ET0 = et0Res.et0; // mm/day

    // Stress reduction (Ks)
    const depletion_L = thetaFC_L - theta_L;
    let Ks = 1;
    if (depletion_L > RAW_L) {
      Ks = Math.max(0, (TAW_L - depletion_L) / (TAW_L - RAW_L));
    }

    const ETc_mm = kc * ET0 * evapFactor * Ks;
    const ETc_L = ETc_mm * areaM2;  // mm × m² = L

    // Pioggia effettiva (considera superficie del vaso)
    const rain_L = m.rain * areaM2;

    // Irrigazione automatica
    let irrig_L = 0;
    const rawThreshold_L = rawFactor * RAW_L;
    if (autoEnabled && depletion_L > rawThreshold_L) {
      const target_L = targetFill * thetaFC_L;
      irrig_L = Math.max(0, target_L - theta_L);
      irrigationEvents.push({day: d, liters: irrig_L});
      totalIrrigation_L += irrig_L;
    }

    // Bilancio
    const balance_L = rain_L + irrig_L - ETc_L;
    theta_L += balance_L;

    // Drenaggio (eccesso oltre FC)
    if (theta_L > thetaFC_L) {
      let drain = theta_L - thetaFC_L;
      if (hasSaucer) drain *= 0.7; // sottovaso trattiene parte
      totalDrainage_L += drain;
      theta_L = thetaFC_L;
    }
    if (theta_L < 0) theta_L = 0;

    if (Ks < 1) stressDays++;

    const moisturePct = theta_L / thetaFC_L * 100;
    results.push({
      day: d,
      moisturePct,
      theta_L,
      ET0, ETc_L, ETc_mm,
      Ks,
      rain_L,
      irrig_L,
      source: m.source,
    });
  }

  simRenderResults({
    item, p, vol, thetaFC_L, thetaPWP_L, TAW_L, RAW_L, rootDepthCm, whc, kc,
    results, irrigationEvents, totalIrrigation_L, totalDrainage_L, stressDays, days, areaM2, pCoef,
  });
}

function simRenderResults(r) {
  document.getElementById('sim-results').style.display = 'block';

  // Summary
  const avgMoist = r.results.reduce((s,x)=>s+x.moisturePct,0) / r.results.length;
  const minMoist = Math.min(...r.results.map(x=>x.moisturePct));
  const totalET = r.results.reduce((s,x)=>s+x.ETc_L,0);

  document.getElementById('sim-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;margin-bottom:12px">
      <div class="result-item"><div class="result-item-label">Giorni simulati</div><div class="result-item-val">${r.days}</div></div>
      <div class="result-item"><div class="result-item-label">Umidità media</div><div class="result-item-val">${avgMoist.toFixed(0)}%</div></div>
      <div class="result-item"><div class="result-item-label">Umidità minima</div><div class="result-item-val" style="color:${minMoist < 30 ? '#c04040' : 'inherit'}">${minMoist.toFixed(0)}%</div></div>
      <div class="result-item"><div class="result-item-label">Giorni in stress</div><div class="result-item-val" style="color:${r.stressDays > 0 ? '#c04040' : '#2a6a2a'}">${r.stressDays}</div></div>
      <div class="result-item"><div class="result-item-label">Irrigazioni tot.</div><div class="result-item-val">${r.totalIrrigation_L.toFixed(2)} L</div></div>
      <div class="result-item"><div class="result-item-label">Evapotraspirazione tot.</div><div class="result-item-val">${totalET.toFixed(2)} L</div></div>
      <div class="result-item"><div class="result-item-label">Drenaggio tot.</div><div class="result-item-val">${r.totalDrainage_L.toFixed(2)} L</div></div>
      <div class="result-item"><div class="result-item-label">N. irrigazioni</div><div class="result-item-val">${r.irrigationEvents.length}</div></div>
    </div>
    <div style="font-size:10px;color:var(--muted);padding:6px 8px;background:var(--bg);border-radius:6px;margin-bottom:10px">
      <b>Parametri idrologici del vaso:</b><br>
      FC = ${r.thetaFC_L.toFixed(2)}L · PWP = ${r.thetaPWP_L.toFixed(2)}L · TAW = ${r.TAW_L.toFixed(2)}L · RAW = ${r.RAW_L.toFixed(2)}L (p=${r.pCoef})<br>
      Area superficie: ${(r.areaM2*10000).toFixed(0)} cm² · Profondità radicale: ${r.rootDepthCm} cm · WHC: ${(r.whc*100).toFixed(0)}%
    </div>`;

  // Grafico SVG
  simRenderChart(r);

  // Timeline
  simRenderTimeline(r);
}

function simRenderChart(r) {
  const w = 660, h = 260, padL = 44, padR = 16, padT = 20, padB = 30;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const days = r.results.length;
  const xStep = innerW / Math.max(1, days - 1);

  // Coordinate Y: 0-100%
  const yScale = pct => padT + innerH * (1 - pct/100);

  // Bande colorate: PWP, stress, RAW, ok
  const pwpPct = r.thetaPWP_L / r.thetaFC_L * 100;
  const rawStartPct = (r.thetaFC_L - r.RAW_L) / r.thetaFC_L * 100;

  let bands = `
    <rect x="${padL}" y="${padT}" width="${innerW}" height="${yScale(rawStartPct) - padT}" fill="#d5ecd5" opacity="0.5"/>
    <rect x="${padL}" y="${yScale(rawStartPct)}" width="${innerW}" height="${yScale(pwpPct) - yScale(rawStartPct)}" fill="#fdf0e0" opacity="0.5"/>
    <rect x="${padL}" y="${yScale(pwpPct)}" width="${innerW}" height="${h - padB - yScale(pwpPct)}" fill="#faeaea" opacity="0.5"/>
  `;

  // Linee di riferimento FC, RAW, PWP
  const lines = `
    <line x1="${padL}" y1="${yScale(100)}" x2="${padL+innerW}" y2="${yScale(100)}" stroke="#3a6abf" stroke-dasharray="3,3" stroke-width="1"/>
    <text x="${padL-3}" y="${yScale(100)+3}" font-size="9" fill="#3a6abf" text-anchor="end">FC 100%</text>
    <line x1="${padL}" y1="${yScale(rawStartPct)}" x2="${padL+innerW}" y2="${yScale(rawStartPct)}" stroke="#8a6a20" stroke-dasharray="3,3" stroke-width="1"/>
    <text x="${padL-3}" y="${yScale(rawStartPct)+3}" font-size="9" fill="#8a6a20" text-anchor="end">RAW ${rawStartPct.toFixed(0)}%</text>
    <line x1="${padL}" y1="${yScale(pwpPct)}" x2="${padL+innerW}" y2="${yScale(pwpPct)}" stroke="#c04040" stroke-dasharray="3,3" stroke-width="1"/>
    <text x="${padL-3}" y="${yScale(pwpPct)+3}" font-size="9" fill="#c04040" text-anchor="end">PWP ${pwpPct.toFixed(0)}%</text>
  `;

  // Linea umidità
  let path = '';
  r.results.forEach((x, i) => {
    const xc = padL + i * xStep;
    const yc = yScale(x.moisturePct);
    path += (i === 0 ? 'M' : 'L') + xc + ',' + yc;
  });
  const line = `<path d="${path}" fill="none" stroke="#2a5a8a" stroke-width="2.5"/>`;

  // Punti + irrigazione/pioggia
  let markers = '';
  r.results.forEach((x, i) => {
    const xc = padL + i * xStep;
    const yc = yScale(x.moisturePct);
    markers += `<circle cx="${xc}" cy="${yc}" r="3" fill="#2a5a8a"/>`;
    // Irrigazione (triangolo blu sopra)
    if (x.irrig_L > 0) {
      markers += `<path d="M${xc-4},${padT-4} L${xc+4},${padT-4} L${xc},${padT+2} Z" fill="#3a8abf"/>`;
    }
    // Pioggia (goccia)
    if (x.rain_L > 0) {
      markers += `<circle cx="${xc}" cy="${padT-6}" r="2.5" fill="#4a90d0"/>`;
    }
  });

  // Asse X
  let axisX = '';
  const today = new Date();
  for (let i = 0; i < days; i += Math.max(1, Math.floor(days/10))) {
    const xc = padL + i * xStep;
    const d = new Date(today.getTime() + i * 86400000);
    axisX += `<text x="${xc}" y="${h - 10}" font-size="9" fill="#666" text-anchor="middle">${d.getDate()}/${d.getMonth()+1}</text>`;
    axisX += `<line x1="${xc}" y1="${padT+innerH}" x2="${xc}" y2="${padT+innerH+3}" stroke="#aaa"/>`;
  }

  // Asse Y
  let axisY = '';
  [0, 25, 50, 75, 100].forEach(pct => {
    axisY += `<line x1="${padL-3}" y1="${yScale(pct)}" x2="${padL}" y2="${yScale(pct)}" stroke="#aaa"/>`;
    axisY += `<text x="${padL-5}" y="${yScale(pct)+3}" font-size="9" fill="#666" text-anchor="end">${pct}%</text>`;
  });

  document.getElementById('sim-chart').innerHTML = `
    <div style="font-size:12px;font-weight:500;margin-bottom:4px">📈 Andamento umidità substrato</div>
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;background:#fff;border:1px solid var(--border);border-radius:8px">
      ${bands}${lines}${line}${markers}${axisX}${axisY}
      <rect x="${padL}" y="${padT}" width="${innerW}" height="${innerH}" fill="none" stroke="#ccc"/>
    </svg>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;font-size:10px;color:var(--muted)">
      <span>🟩 Zona ottimale</span>
      <span>🟧 Depletion > RAW (stress imminente)</span>
      <span>🟥 Sotto PWP (danno)</span>
      <span>🔺 Irrigazione</span>
      <span>💧 Pioggia</span>
    </div>`;
}

// ── Simulazione batch per pianificazione calendario ──────────────────
// Esegue la simulazione "headless" senza UI, usando solo dati inventario + parametri di default.
// Ritorna le date e le quantità d'irrigazione previste.
function simQuickRun(item, days, meteoArray, initialMoistPct) {
  // Usa la fonte unica di verità: parametri salvati del vaso + default del gruppo
  const params = simGetParamsForPot(item);

  // Stadio auto dal mese corrente
  const month = new Date().getMonth() + 1;
  let stage = simGetCurrentStage(month);
  // Succulente e orchidee: evitano riposo assoluto (indoor)
  if ((params.group === 'succulenta' || params.group === 'orchidea') && stage === 'dormant') {
    stage = 'initial';
  }

  const kc = simGetKcForStage(params, stage);
  let rootDepthCm = params.rootDepthCm;
  const pCoef = params.pCoef;
  const vol = invGetVolFromItem(item);

  // Limita profondità radicale all'altezza utile del vaso
  const potHeight = item.potShape === 'square' ? item.potHSq :
                    item.potShape === 'truncated' ? item.potHTrunc : item.potH;
  const maxRoot = (potHeight || 20) - 2;
  if (rootDepthCm > maxRoot) rootDepthCm = maxRoot;

  // WHC
  let whc = SUBSTRATE_WHC[item.substrate] || 0.30;
  if (item.substrate === 'custom' && item.customSubstrate) {
    whc = wSubstrates.reduce((s, sub) => {
      const pct = (item.customSubstrate[sub.id] || 0) / 100;
      return s + pct * sub.whc;
    }, 0) || 0.30;
  }

  const rootFraction = Math.min(1, rootDepthCm / (potHeight || 20));
  const rootVolumeL = vol * rootFraction;
  const thetaFC_L = whc * rootVolumeL;
  const thetaPWP_L = thetaFC_L * 0.25;
  const TAW_L = thetaFC_L - thetaPWP_L;
  const RAW_L = pCoef * TAW_L;

  // Superficie
  let areaM2;
  if (item.potShape === 'square') {
    areaM2 = ((item.potW||25)/100) * ((item.potD||25)/100);
  } else if (item.potShape === 'truncated') {
    const rTop = ((item.potDiamTop||25)/2)/100;
    areaM2 = Math.PI * rTop * rTop;
  } else {
    const r = ((item.potDiam||25)/2)/100;
    areaM2 = Math.PI * r * r;
  }

  // Evaporation factor con attributi fisici salvati sul vaso
  let evapFactor = 1.0;
  if (item.potMat === 'terracotta') evapFactor *= 1.18;
  if (item.hasMulch) evapFactor *= 0.65;
  if (item.hasSaucer) evapFactor *= 0.92;

  // Simulazione
  let theta_L = initialMoistPct / 100 * thetaFC_L;
  const irrigations = [];

  for (let d = 0; d < days; d++) {
    const m = meteoArray[d] || meteoArray[meteoArray.length-1];
    const tMean = (m.tmin + m.tmax) / 2;
    const et0Res = calcET0(tMean, m.hum, m.solarW, m.wind);
    const ET0 = et0Res.et0;

    const depletion_L = thetaFC_L - theta_L;
    let Ks = 1;
    if (depletion_L > RAW_L) {
      Ks = Math.max(0, (TAW_L - depletion_L) / (TAW_L - RAW_L));
    }
    const ETc_L = kc * ET0 * evapFactor * Ks * areaM2;
    const rain_L = m.rain * areaM2;

    let irrig_L = 0;
    if (depletion_L > RAW_L) {
      irrig_L = Math.max(0, 0.98 * thetaFC_L - theta_L);
      if (irrig_L > 0) {
        irrigations.push({dayOffset: d, liters: irrig_L, ETc_L, moisturePctBefore: theta_L/thetaFC_L*100});
      }
    }

    theta_L += rain_L + irrig_L - ETc_L;
    if (theta_L > thetaFC_L) theta_L = thetaFC_L;
    if (theta_L < 0) theta_L = 0;
  }

  return {
    irrigations,
    stage, kc,
    thetaFC_L, TAW_L, RAW_L,
  };
}

// Costruisce meteo array per i prossimi N giorni usando Open-Meteo forecast (se disponibile)
// o fallback a valori stagionali ragionevoli.
// Se isIndoor=true, restituisce un meteo "ambiente interno" stabile:
// temperatura dal WN31 live (o valore default), umidità ambiente,
// vento minimo e radiazione surrogata per luce indiretta.
function simBuildMeteoForSchedule(days, isIndoor, indoorLive) {
  const meteo = [];

  if (isIndoor) {
    // Per ambienti interni i valori sono molto più stabili: usiamo quelli live
    // se disponibili, altrimenti defaults ragionevoli per un appartamento.
    const t = (indoorLive && indoorLive.temp !== null) ? indoorLive.temp : 21;
    const h = (indoorLive && indoorLive.humidity !== null) ? indoorLive.humidity : 55;
    // Escursione giornaliera indoor limitata: ±2°C rispetto alla media
    const tmin = t - 2, tmax = t + 2;
    for (let d = 0; d < days; d++) {
      meteo.push({
        tmin, tmax,
        hum: h,
        wind: 2,          // vento bassissimo indoor
        solarW: 300,      // luce indiretta tipica vicino a finestra
        rain: 0,          // mai pioggia indoor
        isIndoor: true,
      });
    }
    return meteo;
  }

  const daily = _simForecast && _simForecast.daily;
  const month = new Date().getMonth() + 1;

  // Valori stagionali di default (Italia centrale)
  const seasonal = {
    1: {tmin:3, tmax:10, hum:75, wind:8, solarW:150, rain:2},
    2: {tmin:4, tmax:12, hum:70, wind:8, solarW:200, rain:2},
    3: {tmin:7, tmax:16, hum:65, wind:10, solarW:300, rain:2},
    4: {tmin:10, tmax:20, hum:60, wind:10, solarW:400, rain:2},
    5: {tmin:14, tmax:24, hum:55, wind:8, solarW:500, rain:1},
    6: {tmin:18, tmax:29, hum:50, wind:8, solarW:600, rain:1},
    7: {tmin:21, tmax:32, hum:45, wind:8, solarW:700, rain:0.5},
    8: {tmin:21, tmax:32, hum:50, wind:8, solarW:650, rain:1},
    9: {tmin:17, tmax:27, hum:60, wind:8, solarW:450, rain:2},
    10: {tmin:12, tmax:21, hum:65, wind:10, solarW:300, rain:3},
    11: {tmin:7, tmax:15, hum:75, wind:10, solarW:180, rain:3},
    12: {tmin:4, tmax:11, hum:75, wind:10, solarW:120, rain:3},
  };
  const defaults = seasonal[month];

  for (let d = 0; d < days; d++) {
    if (daily && d < daily.time.length) {
      meteo.push({
        tmin: daily.temperature_2m_min[d],
        tmax: daily.temperature_2m_max[d],
        hum: defaults.hum,
        wind: daily.wind_speed_10m_max ? daily.wind_speed_10m_max[d] * 0.6 : defaults.wind,
        solarW: defaults.solarW,
        rain: daily.precipitation_sum[d] || 0,
      });
    } else {
      meteo.push({...defaults});
    }
  }
  return meteo;
}

// Genera gli eventi annaffiatura basati sulla simulazione, per tutti i vasi dell'inventario.
// Aggiunge le previsioni al waDateMap esistente.
async function buildSimWateringSchedule() {
  const inv = invLoad();
  if (!inv.length) return;

  // Prefetch previsioni (se non già in cache)
  if (!_simForecast) {
    try {
      const res = await apiFetch('/api/forecast');
      const data = await res.json();
      if (!data.error && data.daily) _simForecast = data;
    } catch {}
  }

  // Prefetch umidità live per vasi con sensore + dati WN31 indoor
  const liveMoisture = {};
  let indoorLive = null;
  try {
    const res = await apiFetch('/api/ecowitt/realtime');
    const json = await res.json();
    if (json.configured && json.code === 0) {
      for (let ch = 1; ch <= 16; ch++) {
        const d = meteoGetSoilData(json, ch);
        if (d.moisture !== null) liveMoisture[ch] = d.moisture;
      }
      // Legge anche temperatura/umidità ambiente interno dal WN31 CH1
      indoorLive = meteoGetIndoorData(json, 1);
    }
  } catch {}

  const horizonDays = 14;  // Pianifica 2 settimane avanti
  // Costruisci due meteo paralleli: uno outdoor (stagionale/forecast) e uno indoor
  // (WN31 live o default). Ogni vaso userà quello appropriato in base alla location.
  const meteoOutdoor = simBuildMeteoForSchedule(horizonDays, false);
  const meteoIndoor = simBuildMeteoForSchedule(horizonDays, true, indoorLive);
  const today = new Date();
  today.setHours(0,0,0,0);

  inv.forEach(item => {
    const p = getPlantById(item.plantTypeIdx);
    if (!p) return;

    // Scegli il meteo in base alla location della pianta
    const meteo = item.location === 'indoor' ? meteoIndoor : meteoOutdoor;

    // Cascata di priorità identica al modal:
    // 1) Sensore live → 2) Stima da ultima annaffiatura → 3) 65% generico
    let initMoist = null;
    if (item.wh51Ch && liveMoisture[parseInt(item.wh51Ch)] !== undefined) {
      initMoist = liveMoisture[parseInt(item.wh51Ch)];
    } else {
      const lastWater = simFindLastWateringDate(item);
      if (lastWater) {
        const estimated = simEstimateMoistureFromLastWater(item, lastWater);
        if (estimated !== null) initMoist = estimated;
      }
    }
    if (initMoist === null) initMoist = 65;

    const sim = simQuickRun(item, horizonDays, meteo, initMoist);

    // Aggiungi ogni irrigazione prevista al calendario
    sim.irrigations.forEach(ev => {
      const date = new Date(today.getTime() + ev.dayOffset * 86400000);
      const key = gDateKey(date);
      if (!waDateMap[key]) waDateMap[key] = [];

      // Crea un evento "sim-based" distinguibile
      const simPlant = {
        id: 1000 + item.id,  // ID virtuale per vasi simulati
        name: item.nickname || p.name,
        icon: p.icon,
        color: '#2a7abf',
        method: `Predittiva (${ev.liters.toFixed(2)}L)`,
        _isSim: true,
        _potRef: item.id,
      };

      // Evita duplicati esatti
      if (!waDateMap[key].some(e => e.plant.id === simPlant.id)) {
        waDateMap[key].push({
          plant: simPlant,
          note: `${ev.liters.toFixed(2)}L · umidità prevista ${ev.moisturePctBefore.toFixed(0)}% · ETc ${ev.ETc_L.toFixed(2)}L/g`,
          _sim: true,
          _liters: ev.liters,
        });
      }
    });

    // Salva anche le date nel plant virtuale per il "prossimo" display
    const virtualId = 1000 + item.id;
    const dates = sim.irrigations.map(ev => new Date(today.getTime() + ev.dayOffset * 86400000));
    // Attach to first event's plant ref
    Object.values(waDateMap).forEach(evs => {
      evs.forEach(e => {
        if (e.plant && e.plant.id === virtualId) {
          e.plant._waDates = dates;
        }
      });
    });
  });
}

function simRenderTimeline(r) {
  const today = new Date();
  const rows = r.results.map((x, i) => {
    const d = new Date(today.getTime() + i * 86400000);
    const date = d.getDate() + '/' + (d.getMonth()+1);
    const dow = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][d.getDay()];
    const stressBadge = x.Ks < 1 ? `<span style="color:#c04040;font-weight:600">stress Ks=${x.Ks.toFixed(2)}</span>` : '';
    const rainBadge = x.rain_L > 0 ? `<span style="color:#3a6abf">💧 ${x.rain_L.toFixed(2)}L</span>` : '';
    const irrigBadge = x.irrig_L > 0 ? `<span style="color:#2a6a2a;font-weight:600">🔻 ${x.irrig_L.toFixed(2)}L</span>` : '';
    return `<tr style="border-top:1px solid var(--border)">
      <td style="padding:4px 6px;font-size:10px">${dow} ${date}</td>
      <td style="padding:4px 6px;font-size:10px;text-align:right">${x.moisturePct.toFixed(0)}%</td>
      <td style="padding:4px 6px;font-size:10px;text-align:right">${x.ETc_L.toFixed(2)}L</td>
      <td style="padding:4px 6px;font-size:10px;text-align:right">${rainBadge}</td>
      <td style="padding:4px 6px;font-size:10px;text-align:right">${irrigBadge}</td>
      <td style="padding:4px 6px;font-size:10px;text-align:right">${stressBadge}</td>
    </tr>`;
  }).join('');

  document.getElementById('sim-timeline').innerHTML = `
    <div style="font-size:12px;font-weight:500;margin:12px 0 4px">📅 Timeline giornaliera</div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:10px;background:#fff;border-radius:8px;border:1px solid var(--border)">
        <thead style="background:var(--bg)"><tr>
          <th style="padding:6px;text-align:left">Giorno</th>
          <th style="padding:6px;text-align:right">Umidità</th>
          <th style="padding:6px;text-align:right">ETc</th>
          <th style="padding:6px;text-align:right">Pioggia</th>
          <th style="padding:6px;text-align:right">Irrigazione</th>
          <th style="padding:6px;text-align:right">Stress</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════
// ⑫ PWA — Service Worker + Offline
// ══════════════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('🌿 SW registrato:', reg.scope);
        // Controlla aggiornamenti ogni 30 minuti
        setInterval(() => reg.update(), 1800000);
      })
      .catch(err => console.log('SW errore:', err));
  });
}

// Indicatore online/offline
function updateOnlineStatus() {
  const bar = document.getElementById('offline-bar');
  if (!bar) return;
  if (navigator.onLine) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Prompt installazione PWA
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'inline-flex';
});

function pwaInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      console.log('🌿 App installata!');
    }
    deferredPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
  });
}

// ══════════════════════════════════════════════════════════════════════
// AVVIO APP
// ══════════════════════════════════════════════════════════════════════
// Mostriamo subito la sezione Schede con le 26 native (UI immediata).
// In parallelo carichiamo le piante custom dal database: quando arrivano,
// vengono fuse nelle strutture e le sezioni vengono invalidate per essere
// re-inizializzate alla prossima visita. Il caricamento iniziale ridisegna
// anche la sezione Schede così l'utente vede subito la sua griglia di piante.
showSection('schede');
loadCustomPlants().then(() => {
  // Re-inizializzo la sezione Schede per mostrare le piante caricate
  if (typeof sInitSchede === 'function') sInitSchede();
});

// Ping al server per determinare se il database SQLite è raggiungibile.
// Questo aggiorna dUseAPI e tutti gli indicatori .d-mode-indicator nelle
// varie sezioni dell'app (la pillola in alto sotto al titolo di ogni tab).
// Lo chiamiamo qui all'avvio invece che dentro dInitDiario perché vogliamo
// che lo stato della connessione sia visibile su qualsiasi tab — anche
// Schede, Mensile, Acqua ecc. — non solo sul Diario. Il ping ha un timeout
// di 1.2 secondi, quindi se il server non risponde l'app non resta
// "appesa" sul messaggio di connessione: dopo poco più di un secondo
// passa in modalità locale. Non incatenamo niente al .then() perché il
// risultato (dUseAPI settato + indicatori aggiornati) è un effetto
// collaterale che a chi chiama qui non serve direttamente.
dPingServer();
