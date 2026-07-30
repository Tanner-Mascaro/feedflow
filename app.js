/* ============================================================
   FeedFlow — demo logic (vanilla JS)
   Data lives in Supabase (Postgres), table `entries`.
   ============================================================ */

const SUPABASE_URL = "https://ymejzjbabevzippdjitd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_goJVuXzFM37hixhgGn-jTQ_KVS2PMbz";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzSWcJKId9_Un67IqbN2xYCWRNT13P9ckv7Nh67CJFMp9z2WxFwWwMEV_Xve5RfriOx/exec";
function pushToSheet(entry){
  fetch(SHEETS_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors", // Apps Script doesn't send CORS headers; opaque response is fine, we don't read it
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(entry),
  }).catch(err => console.error("Sheets push failed", err));
}

// Raw ingredients that get mixed into mink feed. Swap for your dad's real list.
const INGREDIENTS = [
  "Poultry byproduct",
  "Fish meal",
  "Whole egg",
  "Cereal blend",
  "Poultry fat",
  "Beef liver",
  "Blood meal",
  "Vitamin premix",
];

const ROLES = [
  { id:"tech",    ini:"IT", title:"Inventory technician", desc:"Log batches at the mixer",              view:"log"  },
  { id:"manager", ini:"PM", title:"Plant manager (admin)", desc:"Oversee entries, manage users, export", view:"dash" },
  { id:"cfo",     ini:"FB", title:"CFO / leadership",      desc:"Dashboards, reports, cost savings",      view:"dash" },
];

const NAMES = { tech:"Marco (tech)", manager:"Dana (manager)", cfo:"Dale — CFO" };

let state = {
  role: null,
  entries: [],
  plant: "Sandy",
  range: 30,
};
let usageChart = null, dailyChart = null;

/* ---------- storage (Supabase) ---------- */
function rowToEntry(r){
  return {
    id: r.id,
    ts: new Date(r.ts).getTime(),
    plant: r.plant,
    ingredient: r.ingredient,
    qty: Number(r.qty),
    unit: r.unit,
    by: r.logged_by || "",
    notes: r.notes || "",
  };
}
function entryToRow(e){
  return {
    ts: new Date(e.ts).toISOString(),
    plant: e.plant,
    ingredient: e.ingredient,
    qty: e.qty,
    unit: e.unit,
    logged_by: e.by,
    notes: e.notes || null,
  };
}
async function load(){
  const { data, error } = await db.from("entries").select("*").order("ts", { ascending:true });
  if(error){ console.error(error); toast("Couldn't load entries — check connection."); return []; }
  return data.map(rowToEntry);
}
function subscribeRealtime(){
  db.channel("entries-changes")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"entries" }, payload=>{
      const row = payload.new;
      if(state.entries.some(e=>e.id===row.id)) return;
      state.entries.push(rowToEntry(row));
      state.entries.sort((a,b)=>a.ts-b.ts);
      renderTicketNo();
      renderToday();
      renderDashboard();
    })
    .subscribe();
}

/* ---------- helpers ---------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const fmt = n => Number(n).toLocaleString("en-US");
const startOfToday = ()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
function nextTicketNo(){
  const max = state.entries.reduce((m,e)=>Math.max(m, e.id||0), 1041);
  return "FF-" + String(max+1).padStart(5,"0");
}
function timeStr(ts){ return new Date(ts).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}); }
function dateShort(ts){ return new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric"}); }

/* ---------- LOGIN ---------- */
function renderRoles(){
  const grid = $("#roleGrid");
  grid.innerHTML = ROLES.map(r=>`
    <button class="role" data-role="${r.id}">
      <span class="role-ic">${r.ini}</span>
      <span class="role-main">
        <span class="role-tt">${r.title}</span>
        <span class="role-ds">${r.desc}</span>
      </span>
      <span class="role-go">&rsaquo;</span>
    </button>`).join("");
  $$(".role", grid).forEach(b=>b.addEventListener("click",()=>signIn(b.dataset.role)));
}

function signIn(roleId){
  const role = ROLES.find(r=>r.id===roleId);
  state.role = role;
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#whoAmI").textContent = NAMES[roleId];

  // role-based access: tech = log only, cfo = dashboard only, manager = both
  const showLog  = roleId==="tech" || roleId==="manager";
  const showDash = roleId==="manager" || roleId==="cfo";
  $('.tab[data-view="log"]').classList.toggle("hidden", !showLog);
  $('.tab[data-view="dash"]').classList.toggle("hidden", !showDash);

  switchView(role.view);
  renderTicketNo();
  renderToday();
  renderDashboard();
}

function signOut(){
  state.role = null;
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
}

/* ---------- VIEW SWITCH ---------- */
function switchView(v){
  $$(".tab").forEach(t=>t.classList.toggle("is-active", t.dataset.view===v));
  $("#view-log").classList.toggle("hidden", v!=="log");
  $("#view-dash").classList.toggle("hidden", v!=="dash");
  if(v==="dash") renderDashboard();
}

/* ---------- LOG VIEW ---------- */
function renderTicketNo(){ $("#ticketNo").textContent = nextTicketNo(); }

function fillIngredients(){
  const sel = $("#ingredient");
  sel.innerHTML = `<option value="" disabled selected>Select ingredient…</option>` +
    INGREDIENTS.map(i=>`<option>${i}</option>`).join("");
}

function renderToday(){
  const t0 = startOfToday();
  const today = state.entries.filter(e=>e.ts>=t0).sort((a,b)=>b.ts-a.ts);
  const list = $("#todayList"), empty = $("#todayEmpty");
  const totalLb = today.filter(e=>e.unit==="lb").reduce((s,e)=>s+e.qty,0);
  $("#todayTotal").textContent = fmt(totalLb) + " lb";

  if(today.length===0){ list.innerHTML=""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  list.innerHTML = today.map(e=>`
    <li class="entry">
      <span class="entry-dot"></span>
      <span class="entry-main">
        <div class="entry-ing">${e.ingredient}</div>
        <div class="entry-meta">${e.plant} · ${timeStr(e.ts)} · ${e.by}</div>
      </span>
      <span class="entry-amt">${fmt(e.qty)} ${e.unit}</span>
    </li>`).join("");
}

async function submitTicket(ev){
  ev.preventDefault();
  const ing = $("#ingredient").value;
  const qty = parseFloat($("#qty").value);
  if(!ing || !(qty>0)){ toast("Pick an ingredient and an amount."); return; }

  const draft = {
    ts: Date.now(),
    plant: state.plant,
    ingredient: ing,
    qty,
    unit: $("#unit").value,
    by: NAMES[state.role.id] || "Demo user",
    notes: $("#notes").value.trim(),
  };

  const submitBtn = ev.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const { data, error } = await db.from("entries").insert(entryToRow(draft)).select().single();
  submitBtn.disabled = false;

  if(error){ console.error(error); toast("Couldn't save batch — try again."); return; }

  const entry = rowToEntry(data);
  state.entries.push(entry);
  pushToSheet(entry);

  ev.target.reset();
  fillIngredients();
  renderTicketNo();
  renderToday();
  renderDashboard();
  toast(`Logged ${fmt(qty)} ${entry.unit} · ${ing}`);
}

/* ---------- DASHBOARD ---------- */
function inRange(){
  if(state.range>=9999) return state.entries.slice();
  const cutoff = Date.now() - state.range*864e5;
  return state.entries.filter(e=>e.ts>=cutoff);
}

function renderDashboard(){
  const rows = inRange().sort((a,b)=>b.ts-a.ts);
  renderKpis(rows);
  renderCharts(rows);
  renderTable(rows);
  $("#rowCount").textContent = `${rows.length} entries`;
  $("#chartNote").textContent = `lb, ${state.range>=9999?"all time":"last "+state.range+" days"}`;
}

function renderKpis(rows){
  const lb   = rows.filter(e=>e.unit==="lb").reduce((s,e)=>s+e.qty,0);
  const gal  = rows.filter(e=>e.unit==="gal").reduce((s,e)=>s+e.qty,0);
  const days = new Set(rows.map(e=>new Date(e.ts).toDateString())).size || 1;
  const perDay = Math.round(lb/days);
  const sandy = rows.filter(e=>e.plant==="Sandy").length;
  const share = rows.length ? Math.round(sandy/rows.length*100) : 0;

  const kpis = [
    { l:"Dry material logged", v:fmt(lb)+" lb",  s:`across ${rows.length} batches` },
    { l:"Liquid logged",       v:fmt(gal)+" gal", s:"fats & liquids" },
    { l:"Avg per day",         v:fmt(perDay)+" lb", s:`over ${days} active days` },
    { l:"Captured at source",  v:"100%",          s:"vs. end-of-day recall", accent:true },
  ];
  $("#kpis").innerHTML = kpis.map(k=>`
    <div class="kpi ${k.accent?'accent':''}">
      <div class="kpi-label">${k.l}</div>
      <div class="kpi-val">${k.v}</div>
      <div class="kpi-sub">${k.s}</div>
    </div>`).join("");
}

function renderCharts(rows){
  const green="#146B54", greenL="#23947A", amber="#E8A317", ink3="#8A909B", line="#EEF1F4";

  // usage by ingredient (lb)
  const byIng = {};
  rows.filter(e=>e.unit==="lb").forEach(e=>byIng[e.ingredient]=(byIng[e.ingredient]||0)+e.qty);
  const ingPairs = Object.entries(byIng).sort((a,b)=>b[1]-a[1]);

  // daily volume (lb)
  const byDay = {};
  rows.filter(e=>e.unit==="lb").forEach(e=>{
    const k=new Date(e.ts); k.setHours(0,0,0,0);
    byDay[k.getTime()]=(byDay[k.getTime()]||0)+e.qty;
  });
  const dayKeys = Object.keys(byDay).map(Number).sort((a,b)=>a-b);

  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.color = ink3;

  usageChart && usageChart.destroy();
  usageChart = new Chart($("#usageChart"), {
    type:"bar",
    data:{ labels:ingPairs.map(p=>p[0]),
      datasets:[{ data:ingPairs.map(p=>p[1]), backgroundColor:green, borderRadius:6, maxBarThickness:26 }] },
    options:{ indexAxis:"y", responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmt(c.parsed.x)} lb`}}},
      scales:{ x:{grid:{color:line},ticks:{callback:v=>fmt(v)}}, y:{grid:{display:false}} } }
  });

  dailyChart && dailyChart.destroy();
  dailyChart = new Chart($("#dailyChart"), {
    type:"line",
    data:{ labels:dayKeys.map(dateShort),
      datasets:[{ data:dayKeys.map(k=>byDay[k]), borderColor:green, backgroundColor:"rgba(20,107,84,.10)",
        fill:true, tension:.35, pointRadius:2, pointBackgroundColor:green, borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmt(c.parsed.y)} lb`}}},
      scales:{ x:{grid:{display:false}}, y:{grid:{color:line},ticks:{callback:v=>fmt(v)}} } }
  });
}

function renderTable(rows){
  const body = $("#entriesTable tbody");
  body.innerHTML = rows.slice(0,80).map(e=>`
    <tr>
      <td>${dateShort(e.ts)} · ${timeStr(e.ts)}</td>
      <td><span class="pill ${e.plant==='Logan'?'logan':''}">${e.plant}</span></td>
      <td>${e.ingredient}</td>
      <td class="num">${fmt(e.qty)} ${e.unit}</td>
      <td>${e.by}</td>
      <td class="td-notes">${e.notes || "—"}</td>
    </tr>`).join("");
}

/* ---------- EXCEL EXPORT (SheetJS) ---------- */
function exportExcel(){
  const rows = inRange().sort((a,b)=>a.ts-b.ts);
  const data = rows.map(e=>({
    Date: new Date(e.ts).toLocaleDateString("en-US"),
    Time: timeStr(e.ts),
    Plant: e.plant,
    Ingredient: e.ingredient,
    Amount: e.qty,
    Unit: e.unit,
    "Logged by": e.by,
    Notes: e.notes || "",
    "Ticket #": "FF-"+String(e.id).padStart(5,"0"),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{wch:11},{wch:9},{wch:8},{wch:20},{wch:9},{wch:6},{wch:16},{wch:26},{wch:11}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Batch log");
  const stamp = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `FeedFlow_batch_log_${stamp}.xlsx`);
  toast("Excel file exported");
}

/* ---------- toast ---------- */
let toastT;
function toast(msg){
  const el = $("#toast");
  el.innerHTML = `<span class="t-dot"></span>${msg}`;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(()=>el.classList.remove("show"), 2600);
}

/* ---------- wire up ---------- */
async function init(){
  renderRoles();
  fillIngredients();

  $("#logoutBtn").addEventListener("click", signOut);
  $("#tabs").addEventListener("click", e=>{ if(e.target.dataset.view) switchView(e.target.dataset.view); });
  $("#ticketForm").addEventListener("submit", submitTicket);
  $("#exportBtn").addEventListener("click", exportExcel);
  $("#rangeSel").addEventListener("change", e=>{ state.range=+e.target.value; renderDashboard(); });

  $("#plantSeg").addEventListener("click", e=>{
    const b=e.target.closest(".seg-opt"); if(!b) return;
    state.plant=b.dataset.val;
    $$(".seg-opt", $("#plantSeg")).forEach(o=>o.classList.toggle("is-active",o===b));
  });

  state.entries = await load();
  if(state.role){ renderTicketNo(); renderToday(); renderDashboard(); }
  subscribeRealtime();
}
init();

/* ---------- PWA ---------- */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  });
}
