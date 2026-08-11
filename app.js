/* AI use: Claude Sonnet 5 (Claude Code) — Sprint 3 RBAC (auth/profile wiring),
   structured logging, and the lib.js extraction. See README "AI use". */
/* ============================================================
   FeedFlow — inventory logic (vanilla JS)
   Data lives in Supabase (Postgres):
     movements(id, ts, location, ingredient, type, qty, unit,
               truck_no, notes, logged_by, created_at)
     opening_balances(location, ingredient, qty)
   type: to_mix | received | sold_raw | transferred | adjusted
   End Balance = Beg + Received - ToMix - SoldRaw + Transferred + Adjusted
   ============================================================ */

const SUPABASE_URL = "https://ymejzjbabevzippdjitd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_goJVuXzFM37hixhgGn-jTQ_KVS2PMbz";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- structured logging ----------
   JSON lines to the console: {ts, level, event, ...context}. Grep-able and
   ready to pipe into a log drain (Vercel/Logflare/etc.) without changing
   call sites. */
function log(level, event, context={}){
  const line = { ts:new Date().toISOString(), level, event, ...context };
  const method = level==="error" ? "error" : level==="warn" ? "warn" : "log";
  console[method](JSON.stringify(line));
}

const SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwcRZSibHEtyQtib7kOOS_h2f3SrB5LdKiu7HFaI0Jbcb0JOZlqvPJmk-HHsFdoVPnB/exec";
function pushToSheet(movement){
  fetch(SHEETS_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors", // Apps Script doesn't send CORS headers; opaque response is fine, we don't read it
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(movement),
  }).catch(err => log("warn", "sheets_push_failed", { message: String(err) }));
}

const INGREDIENTS = [
  "Trout", "Spent Hen", "Turkey", "Liver", "Lungs", "Spleen", "Trimmings", "Beef",
  "Beef Salivary", "Cheese", "Egg", "Phos Acid", "Molasses", "Wheat Germ",
  "Choline Chloride", "Chicken Skins", "Liquid Fat", "Pet Protein", "Cereal",
  "Poultry Meal", "Beet Pulp", "Fish Meal", "Rovamix", "Salt", "Dog Fines",
  "Minerals", "Fly Control", "Neomed", "Amoxi", "Neo/Terra", "SMZ", "Baytril",
  "Soy", "Probiotics", "TM", "Auromix", "Tylan", "Cephalexin", "Water",
];

const MOVEMENT_TYPE_LABEL = {
  to_mix: "To Mix",
  received: "Received",
  sold_raw: "Sold (Raw)",
  transferred: "Transferred",
  adjusted: "Adjusted",
};

const ROLES = [
  { id:"tech",    view:"log"  },
  { id:"manager", view:"dash" },
  { id:"cfo",     view:"dash" },
];

let state = {
  role: null,
  userName: "",
  movements: [],
  openingBalances: [],
  location: "Midvale",
  txnLocation: "Midvale",
  range: 30,
};
let usageChart = null, dailyChart = null;

/* ---------- storage (Supabase) ---------- */
function rowToMovement(r){
  return {
    id: r.id,
    ts: new Date(r.ts).getTime(),
    location: r.location,
    ingredient: r.ingredient,
    type: r.type,
    qty: Number(r.qty),
    unit: r.unit,
    truckNo: r.truck_no || "",
    notes: r.notes || "",
    by: r.logged_by || "",
  };
}
function movementToRow(m){
  return {
    ts: new Date(m.ts).toISOString(),
    location: m.location,
    ingredient: m.ingredient,
    type: m.type,
    qty: m.qty,
    unit: m.unit,
    truck_no: m.truckNo || null,
    notes: m.notes || null,
    logged_by: m.by,
  };
}
async function load(){
  const [{ data: mv, error: e1 }, { data: ob, error: e2 }] = await Promise.all([
    db.from("movements").select("*").order("ts", { ascending:true }),
    db.from("opening_balances").select("*"),
  ]);
  if(e1 || e2){ log("error", "load_failed", { message: (e1||e2).message }); toast("Couldn't load data — check connection."); return; }
  state.movements = mv.map(rowToMovement);
  state.openingBalances = ob;
}
let realtimeChannel = null;
function subscribeRealtime(){
  realtimeChannel = db.channel("movements-changes")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"movements" }, payload=>{
      const row = payload.new;
      if(state.movements.some(m=>m.id===row.id)) return;
      state.movements.push(rowToMovement(row));
      state.movements.sort((a,b)=>a.ts-b.ts);
      renderTicketNo();
      renderToday();
      renderTxnToday();
      renderDashboard();
    })
    .subscribe();
}
function unsubscribeRealtime(){
  if(realtimeChannel){ db.removeChannel(realtimeChannel); realtimeChannel = null; }
}

/* ---------- helpers ---------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const fmt = n => Number(n).toLocaleString("en-US");
const startOfToday = ()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
function timeStr(ts){ return new Date(ts).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}); }
function dateShort(ts){ return new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
function fillIngredientSelect(sel){
  sel.innerHTML = `<option value="" disabled selected>Select ingredient…</option>` +
    INGREDIENTS.map(i=>`<option>${i}</option>`).join("");
}

/* ---------- AUTH / LOGIN ----------
   Real Supabase Auth (email/password) + a `profiles` row (role, name) per
   account. RLS on `movements`/`opening_balances` enforces the same role
   boundaries server-side — see supabase_rbac.sql. */
async function fetchProfile(userId){
  const { data, error } = await db.from("profiles").select("role,name").eq("id", userId).single();
  if(error){ log("error", "profile_fetch_failed", { userId, message: error.message }); return null; }
  return data;
}

function loginError(msg){
  const el = $("#loginError");
  if(!msg){ el.classList.add("hidden"); el.textContent=""; return; }
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function handleLogin(ev){
  ev.preventDefault();
  loginError(null);
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  const btn = $("#loginSubmit");
  btn.disabled = true;

  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if(error){
    btn.disabled = false;
    log("warn", "sign_in_failed", { email, message: error.message });
    loginError("Wrong email or password.");
    return;
  }
  const profile = await fetchProfile(data.user.id);
  btn.disabled = false;
  if(!profile){
    loginError("No FeedFlow role is set up for this account yet.");
    await db.auth.signOut();
    return;
  }
  log("info", "sign_in", { email, role: profile.role });
  await enterApp(profile);
}

async function enterApp(profile){
  const role = ROLES.find(r=>r.id===profile.role);
  state.role = role;
  state.userName = profile.name;
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");

  // role-based access: tech = log only, cfo = dashboard only, manager = log + txn + dashboard
  // (defense in depth — RLS on movements/opening_balances enforces the same boundaries server-side)
  const showLog  = role.id==="tech" || role.id==="manager";
  const showTxn  = role.id==="manager";
  const showDash = role.id==="manager" || role.id==="cfo";
  $$('.tab[data-view="log"]').forEach(t=>t.classList.toggle("hidden", !showLog));
  $$('.tab[data-view="txn"]').forEach(t=>t.classList.toggle("hidden", !showTxn));
  $$('.tab[data-view="dash"]').forEach(t=>t.classList.toggle("hidden", !showDash));

  await load();
  renderTicketNo();
  renderToday();
  renderTxnToday();
  switchView(role.view); // renders the dashboard itself when the role lands on it
  subscribeRealtime();
}

async function signOut(){
  log("info", "sign_out", { role: state.role && state.role.id });
  unsubscribeRealtime();
  await db.auth.signOut();
  state.role = null;
  state.userName = "";
  state.movements = [];
  state.openingBalances = [];
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
  $("#loginForm").reset();
}

/* ---------- VIEW SWITCH ---------- */
function switchView(v){
  $$(".tab").forEach(t=>t.classList.toggle("is-active", t.dataset.view===v));
  $("#view-log").classList.toggle("hidden", v!=="log");
  $("#view-txn").classList.toggle("hidden", v!=="txn");
  $("#view-dash").classList.toggle("hidden", v!=="dash");
  if(v==="dash") renderDashboard();
}

/* ---------- LOG BATCH (To Mix) VIEW ---------- */
function renderTicketNo(){ $("#ticketNo").textContent = nextTicketNo(state.movements); }

function renderToday(){
  const t0 = startOfToday();
  const today = state.movements.filter(m=>m.type==="to_mix" && m.ts>=t0).sort((a,b)=>b.ts-a.ts);
  const list = $("#todayList"), empty = $("#todayEmpty");
  const totalLb = today.filter(m=>m.unit==="lb").reduce((s,m)=>s+m.qty,0);
  $("#todayTotal").textContent = fmt(totalLb) + " lb";

  if(today.length===0){ list.innerHTML=""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  list.innerHTML = today.map(m=>`
    <li class="entry">
      <span class="entry-dot"></span>
      <span class="entry-main">
        <div class="entry-ing">${m.ingredient}</div>
        <div class="entry-meta">${m.location} · ${timeStr(m.ts)} · ${m.by}</div>
      </span>
      <span class="entry-amt">${fmt(m.qty)} ${m.unit}</span>
    </li>`).join("");
}

async function submitTicket(ev){
  ev.preventDefault();
  const ing = $("#ingredient").value;
  const qty = parseFloat($("#qty").value);
  const err = validateMovementInput(ing, qty);
  if(err){ toast(err); return; }

  const draft = {
    ts: Date.now(),
    location: state.location,
    ingredient: ing,
    type: "to_mix",
    qty,
    unit: $("#unit").value,
    by: state.userName,
    notes: $("#notes").value.trim(),
  };

  const submitBtn = ev.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const { data, error } = await db.from("movements").insert(movementToRow(draft)).select().single();
  submitBtn.disabled = false;

  if(error){ log("error", "batch_save_failed", { message: error.message }); toast("Couldn't save batch — try again."); return; }

  const m = rowToMovement(data);
  state.movements.push(m);
  pushToSheet(m);

  ev.target.reset();
  fillIngredientSelect($("#ingredient"));
  renderTicketNo();
  renderToday();
  renderDashboard();
  toast(`Logged ${fmt(qty)} ${m.unit} · ${ing}`);
}

/* ---------- TRANSACTIONS VIEW ---------- */
function updateTxnFieldsVisibility(){
  const type = $("#txnType").value;
  const signed = type==="transferred" || type==="adjusted";
  $("#txnSignField").classList.toggle("hidden", !signed);
}

function renderTxnToday(){
  const t0 = startOfToday();
  const today = state.movements.filter(m=>m.type!=="to_mix" && m.ts>=t0).sort((a,b)=>b.ts-a.ts);
  const list = $("#txnTodayList"), empty = $("#txnTodayEmpty");
  if(today.length===0){ list.innerHTML=""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  list.innerHTML = today.map(m=>`
    <li class="entry">
      <span class="entry-dot"></span>
      <span class="entry-main">
        <div class="entry-ing">${MOVEMENT_TYPE_LABEL[m.type]} · ${m.ingredient}</div>
        <div class="entry-meta">${m.location} · ${timeStr(m.ts)} · ${m.by}${m.truckNo?" · Truck "+m.truckNo:""}</div>
      </span>
      <span class="entry-amt">${fmt(m.qty)} ${m.unit}</span>
    </li>`).join("");
}

async function submitTxn(ev){
  ev.preventDefault();
  const type = $("#txnType").value;
  const ing = $("#txnIngredient").value;
  let qty = parseFloat($("#txnQty").value);
  const err = validateMovementInput(ing, qty);
  if(err){ toast(err); return; }
  const isOutbound = $(".seg-opt.is-active", $("#txnSignSeg"))?.dataset.val === "out";
  if((type==="transferred" || type==="adjusted") && isOutbound) qty = -qty;

  const draft = {
    ts: Date.now(),
    location: state.txnLocation,
    ingredient: ing,
    type,
    qty,
    unit: $("#txnUnit").value,
    truckNo: $("#txnTruck").value.trim(),
    notes: $("#txnNotes").value.trim(),
    by: state.userName,
  };

  const submitBtn = ev.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const { data, error } = await db.from("movements").insert(movementToRow(draft)).select().single();
  submitBtn.disabled = false;

  if(error){ log("error", "transaction_save_failed", { message: error.message }); toast("Couldn't save transaction — try again."); return; }

  const m = rowToMovement(data);
  state.movements.push(m);
  pushToSheet(m);

  ev.target.reset();
  fillIngredientSelect($("#txnIngredient"));
  updateTxnFieldsVisibility();
  renderTxnToday();
  renderDashboard();
  toast(`Logged ${MOVEMENT_TYPE_LABEL[type]} · ${fmt(Math.abs(qty))} ${m.unit} · ${ing}`);
}

/* ---------- DASHBOARD ---------- */
function inRange(){
  if(state.range>=9999) return state.movements.slice();
  const cutoff = Date.now() - state.range*864e5;
  return state.movements.filter(m=>m.ts>=cutoff);
}

function renderDashboard(){
  const rows = inRange();
  renderKpis(rows);
  renderCharts(rows);
  renderMovementsTable(rows);
  $("#rowCount").textContent = `${rows.length} movements`;
  $("#chartNote").textContent = `lb, ${state.range>=9999?"all time":"last "+state.range+" days"}`;

  const midBal = computeBalances(INGREDIENTS, state.movements, state.openingBalances, "Midvale");
  const loganBal = computeBalances(INGREDIENTS, state.movements, state.openingBalances, "Logan");
  renderBalanceTable("midvaleBalTable", midBal);
  renderBalanceTable("loganBalTable", loganBal);
  renderBalanceTable("combinedBalTable", combineBalances(midBal, loganBal));
}

function renderKpis(rows){
  const mix = rows.filter(m=>m.type==="to_mix");
  const lb   = mix.filter(m=>m.unit==="lb").reduce((s,m)=>s+m.qty,0);
  const gal  = mix.filter(m=>m.unit==="gal").reduce((s,m)=>s+m.qty,0);
  const days = new Set(mix.map(m=>new Date(m.ts).toDateString())).size || 1;
  const perDay = Math.round(lb/days);

  const kpis = [
    { l:"To Mix logged",      v:fmt(lb)+" lb",  s:`across ${mix.length} batches`, ic:"▤", tone:"blue" },
    { l:"Liquid to mix",      v:fmt(gal)+" gal", s:"fats & liquids", ic:"◈", tone:"teal" },
    { l:"Avg per day",        v:fmt(perDay)+" lb", s:`over ${days} active days`, ic:"◔", tone:"purple" },
    { l:"Captured at source", v:"100%",          s:"vs. end-of-day recall", ic:"✓", tone:"gold", accent:true },
  ];
  $("#kpis").innerHTML = kpis.map(k=>`
    <div class="kpi ${k.accent?'accent':''}">
      <div class="kpi-top">
        <span class="kpi-ic kpi-ic-${k.tone}">${k.ic}</span>
        <div class="kpi-label">${k.l}</div>
      </div>
      <div class="kpi-val">${k.v}</div>
      <div class="kpi-sub">${k.s}</div>
    </div>`).join("");
}

function renderCharts(rows){
  const ink3="#8A96B4", line="rgba(255,255,255,.08)";
  const mix = rows.filter(m=>m.type==="to_mix");

  // usage by ingredient (lb, to-mix only)
  const byIng = {};
  mix.filter(m=>m.unit==="lb").forEach(m=>byIng[m.ingredient]=(byIng[m.ingredient]||0)+m.qty);
  const ingPairs = Object.entries(byIng).sort((a,b)=>b[1]-a[1]);

  // daily volume (lb, to-mix only)
  const byDay = {};
  mix.filter(m=>m.unit==="lb").forEach(m=>{
    const k=new Date(m.ts); k.setHours(0,0,0,0);
    byDay[k.getTime()]=(byDay[k.getTime()]||0)+m.qty;
  });
  const dayKeys = Object.keys(byDay).map(Number).sort((a,b)=>a-b);

  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.color = ink3;

  const barCtx = $("#usageChart").getContext("2d");
  const barGrad = barCtx.createLinearGradient(0, 0, barCtx.canvas.width || 400, 0);
  barGrad.addColorStop(0, "#2F65AA");
  barGrad.addColorStop(1, "#7FB4F0");

  usageChart && usageChart.destroy();
  usageChart = new Chart($("#usageChart"), {
    type:"bar",
    data:{ labels:ingPairs.map(p=>p[0]),
      datasets:[{ data:ingPairs.map(p=>p[1]), backgroundColor:barGrad, borderRadius:6, maxBarThickness:26 }] },
    options:{ indexAxis:"y", responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmt(c.parsed.x)} lb`}}},
      scales:{ x:{grid:{color:line},ticks:{callback:v=>fmt(v)}}, y:{grid:{display:false}} } }
  });

  const lineCtx = $("#dailyChart").getContext("2d");
  const lineGrad = lineCtx.createLinearGradient(0, 0, 0, lineCtx.canvas.height || 260);
  lineGrad.addColorStop(0, "rgba(216,179,74,.38)");
  lineGrad.addColorStop(1, "rgba(216,179,74,0)");

  dailyChart && dailyChart.destroy();
  dailyChart = new Chart($("#dailyChart"), {
    type:"line",
    data:{ labels:dayKeys.map(dateShort),
      datasets:[{ data:dayKeys.map(k=>byDay[k]), borderColor:"#D8B34A", backgroundColor:lineGrad,
        fill:true, tension:.35, pointRadius:2, pointBackgroundColor:"#D8B34A", borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmt(c.parsed.y)} lb`}}},
      scales:{ x:{grid:{display:false}}, y:{grid:{color:line},ticks:{callback:v=>fmt(v)}} } }
  });
}

function renderMovementsTable(rows){
  const body = $("#entriesTable tbody");
  const sorted = rows.slice().sort((a,b)=>b.ts-a.ts);
  body.innerHTML = sorted.slice(0,80).map(m=>`
    <tr>
      <td>${dateShort(m.ts)} · ${timeStr(m.ts)}</td>
      <td><span class="pill ${m.location==='Logan'?'logan':''}">${m.location}</span></td>
      <td>${m.ingredient}</td>
      <td>${MOVEMENT_TYPE_LABEL[m.type] || m.type}</td>
      <td class="num">${fmt(m.qty)} ${m.unit}</td>
      <td>${m.by}</td>
      <td class="td-notes">${m.notes || "—"}</td>
    </tr>`).join("");
}

function renderBalanceTable(tbodyId, rows){
  const body = document.getElementById(tbodyId);
  body.innerHTML = rows.map(r=>`
    <tr>
      <td>${r.ingredient}</td>
      <td class="num">${fmt(round2(r.beg))}</td>
      <td class="num">${fmt(round2(r.received))}</td>
      <td class="num">${fmt(round2(r.toMix))}</td>
      <td class="num">${fmt(round2(r.soldRaw))}</td>
      <td class="num">${fmt(round2(r.transferred))}</td>
      <td class="num">${fmt(round2(r.adjusted))}</td>
      <td class="num" style="font-weight:700">${fmt(round2(r.end))}</td>
    </tr>`).join("");
}

/* ---------- EXCEL EXPORT (SheetJS) ---------- */
function exportExcel(){
  const rows = inRange().sort((a,b)=>a.ts-b.ts);
  const data = rows.map(m=>({
    Date: new Date(m.ts).toLocaleDateString("en-US"),
    Time: timeStr(m.ts),
    Location: m.location,
    Type: MOVEMENT_TYPE_LABEL[m.type] || m.type,
    Ingredient: m.ingredient,
    Amount: m.qty,
    Unit: m.unit,
    "Truck #": m.truckNo || "",
    "Logged by": m.by,
    Notes: m.notes || "",
    "Ticket #": "FF-"+String(m.id).padStart(5,"0"),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{wch:11},{wch:9},{wch:8},{wch:11},{wch:20},{wch:9},{wch:6},{wch:10},{wch:16},{wch:26},{wch:11}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movements");
  const stamp = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `FeedFlow_movements_${stamp}.xlsx`);
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
  $("#loginForm").addEventListener("submit", handleLogin);
  fillIngredientSelect($("#ingredient"));
  fillIngredientSelect($("#txnIngredient"));

  $$(".js-logout").forEach(b=>b.addEventListener("click", signOut));
  document.addEventListener("click", e=>{
    const t = e.target.closest(".tab");
    if(t && t.dataset.view) switchView(t.dataset.view);
  });
  $("#ticketForm").addEventListener("submit", submitTicket);
  $("#txnForm").addEventListener("submit", submitTxn);
  $("#txnType").addEventListener("change", updateTxnFieldsVisibility);
  $("#exportBtn").addEventListener("click", exportExcel);
  $("#rangeSel").addEventListener("change", e=>{ state.range=+e.target.value; renderDashboard(); });

  $("#plantSeg").addEventListener("click", e=>{
    const b=e.target.closest(".seg-opt"); if(!b) return;
    state.location=b.dataset.val;
    $$(".seg-opt", $("#plantSeg")).forEach(o=>o.classList.toggle("is-active",o===b));
  });
  $("#txnLocationSeg").addEventListener("click", e=>{
    const b=e.target.closest(".seg-opt"); if(!b) return;
    state.txnLocation=b.dataset.val;
    $$(".seg-opt", $("#txnLocationSeg")).forEach(o=>o.classList.toggle("is-active",o===b));
  });
  $("#txnSignSeg").addEventListener("click", e=>{
    const b=e.target.closest(".seg-opt"); if(!b) return;
    $$(".seg-opt", $("#txnSignSeg")).forEach(o=>o.classList.toggle("is-active",o===b));
  });

  updateTxnFieldsVisibility();

  const { data:{ session } } = await db.auth.getSession();
  if(session){
    const profile = await fetchProfile(session.user.id);
    if(profile) await enterApp(profile);
    else await db.auth.signOut();
  }
}
init();

/* ---------- PWA ---------- */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  });
}
