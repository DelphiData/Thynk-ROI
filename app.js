/* Thynk-ROI — front-end modeler
 * Source baseline: ThynkHealth Internal Validation Trial — “ROI tool for Joey.xlsx”
 * This JS mirrors workbook logic at a high level, with explicit assumptions noted.
 */

// ---------- Utilities ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmtInt = (n) => isNaN(n) ? "0" : n.toLocaleString();
const fmtMoney = (n) => (isNaN(n) ? 0 : n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- Inputs (DOM) ----------
const inputs = {
  annualCt: $('#annualCt'),
  blueRate: $('#blueRate'),
  overhead: $('#overhead'),
  tBlue: $('#tBlue'),
  tGreen: $('#tGreen'),
  tAmber: $('#tAmber'),
  tRed: $('#tRed'),
  wage: $('#wage'),
  thynkFee: $('#thynkFee'),
  diyAmort: $('#diyAmort'),
  diyBuild: $('#diyBuild'),
  diyMaint: $('#diyMaint'),
  diyFteInput: $('#diyFteInput'),
};

const kpis = {
  hospCost: $('#hospitalCost'),
  hospFte: $('#hospitalFte'),
  thynkCost: $('#thynkCost'),
  thynkFte: $('#thynkFte'),
  diyCost: $('#diyCost'),
  diyFte: $('#diyFte'),
  savings: $('#savings'),
  target: $('#savingsTarget'),
  sumRed: $('#sumRed'),
  sumAmber: $('#sumAmber'),
  sumGreen: $('#sumGreen'),
  sumBlue: $('#sumBlue'),
  sumTotal: $('#sumTotal'),
  sumHosp: $('#sumHosp'),
  sumThynk: $('#sumThynk'),
};

// Model selector pills
const modelPicker = $('#modelPicker');
let savingsVs = 'hospital'; // default compare-to
modelPicker.addEventListener('click', (e) => {
  if (!(e.target instanceof HTMLButtonElement)) return;
  $$('#modelPicker .pill').forEach(b => {
    b.classList.toggle('selected', b === e.target);
    b.setAttribute('aria-pressed', b === e.target ? 'true' : 'false');
  });
  savingsVs = e.target.dataset.model;
  recalc();
});

// ---------- Core Assumptions ----------
// Minutes per severity (editable via UI). Default per screenshot & workbook feel.
function getMinutes(){
  return {
    blue: +inputs.tBlue.value || 0,
    green: +inputs.tGreen.value || 0,
    amber: +inputs.tAmber.value || 0,
    red: +inputs.tRed.value || 0,
  };
}

// Wage and overhead
function getLabor(){
  const wageHr = +inputs.wage.value || 0;      // $/hr
  const perMin = wageHr / 60;
  const overhead = (+inputs.overhead.value || 0) / 100; // %
  const loadedPerMin = perMin * (1 + overhead);
  return { perMin, loadedPerMin, overhead, wageHr };
}

// DIY team fully-loaded cost per FTE (assumption aligned with workbook patterns)
const DIY_FTE_FULLY_LOADED = 160000; // $/yr — can be adjusted here.

// Efficiency multipliers (lower = faster)
const EFFICIENCY = {
  hospital: 1.00, // baseline
  thynk:    0.65, // automation & process gains
  diy:      0.85, // typical in-house tool without full automation layer
};

// ---------- Module Catalog ----------
// Each module defines: name, shareOfCT (portion of annual CT that becomes this module's pool),
// severityMix (for actionable R/A/G; Blue is added using Blue%), and enabled flag.
// The two seeded modules reflect the screenshot rows.
let MODULES = [
  {
    key: 'ipn',
    name: 'Incidental Pulmonary Nodule (Fleischner)',
    shareOfCT: 0.135, // tuned so that with 400k CT & 12% Blue you match ~54k total in screenshot
    severityMix: { red: 0.0326, amber: 0.1303, green: 0.7160 }, // yields roughly 1,760 / 7,040 / 38,720 actionable given totals
    enabled: true
  },
  {
    key: 'lcs',
    name: 'Lung Cancer Screening (Lung-RADS)',
    shareOfCT: 0.105, // tuned to ~42k total at 400k CT
    severityMix: { red: 0.0335, amber: 0.1257, green: 0.7208 },
    enabled: true
  },
  // Add more modules here as needed; the UI and math will adapt automatically.
];

// ---------- Table Rendering ----------
const tbody = $('#moduleBody');
function renderTable(){
  tbody.innerHTML = '';
  const bluePct = clamp(+inputs.blueRate.value || 0, 0, 100) / 100;
  const annualCT = +inputs.annualCt.value || 0;

  let sum = { red:0, amber:0, green:0, blue:0, total:0, hosp:0, thynk:0 };

  MODULES.forEach((m, i) => {
    const total = Math.round(annualCT * m.shareOfCT);
    const actionable = Math.round(total * (1 - bluePct));
    const red = Math.round(actionable * m.severityMix.red);
    const amber = Math.round(actionable * m.severityMix.amber);
    const green = Math.round(actionable * m.severityMix.green);
    const used = red + amber + green;
    const blue = Math.max(0, total - used); // remaining volume marked Blue (already managed)

    const costs = perModuleCosts({ red, amber, green, blue, total });
    sum.red += red; sum.amber += amber; sum.green += green; sum.blue += blue; sum.total += total;
    sum.hosp += costs.hospital; sum.thynk += costs.thynk;

    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = m.name;
    tr.appendChild(nameTd);

    const addCell = (v) => {
      const td = document.createElement('td');
      td.className = 'num';
      td.textContent = fmtInt(v);
      tr.appendChild(td);
    };
    addCell(red); addCell(amber); addCell(green); addCell(blue); addCell(total);

    const hospTd = document.createElement('td');
    hospTd.className = 'num';
    hospTd.textContent = fmtMoney(costs.hospital);
    tr.appendChild(hospTd);

    const thynkTd = document.createElement('td');
    thynkTd.className = 'num';
    thynkTd.textContent = fmtMoney(costs.thynk);
    tr.appendChild(thynkTd);

    const useTd = document.createElement('td');
    useTd.className = 'num';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = m.enabled;
    cb.addEventListener('change', () => { m.enabled = cb.checked; recalc(); });
    useTd.appendChild(cb);
    tr.appendChild(useTd);

    tbody.appendChild(tr);
  });

  // Footer totals
  kpis.sumRed.textContent = fmtInt(sum.red);
  kpis.sumAmber.textContent = fmtInt(sum.amber);
  kpis.sumGreen.textContent = fmtInt(sum.green);
  kpis.sumBlue.textContent = fmtInt(sum.blue);
  kpis.sumTotal.textContent = fmtInt(sum.total);
  kpis.sumHosp.textContent = fmtMoney(sum.hosp);
  kpis.sumThynk.textContent = fmtMoney(sum.thynk);
}

// ---------- Cost Math ----------
function perModuleCosts(vol){
  // vol = { red, amber, green, blue, total }
  const mins = getMinutes();
  const labor = getLabor();
  const actionable = vol.red + vol.amber + vol.green;

  // Minutes by model
  const hospMin = (vol.red*mins.red + vol.amber*mins.amber + vol.green*mins.green + vol.blue*mins.blue) * EFFICIENCY.hospital;
  const thynkMin = (vol.red*mins.red + vol.amber*mins.amber + vol.green*mins.green + vol.blue*mins.blue) * EFFICIENCY.thynk;
  const diyMin = (vol.red*mins.red + vol.amber*mins.amber + vol.green*mins.green + vol.blue*mins.blue) * EFFICIENCY.diy;

  const hospitalCost = hospMin * labor.loadedPerMin;
  const thynkCost = thynkMin * labor.loadedPerMin + actionable * (+inputs.thynkFee.value || 0);

  // DIY: residual minutes + platform/team will be added at portfolio level (amortized)
  const diyLaborCost = diyMin * labor.loadedPerMin;

  return {
    hospital: hospitalCost,
    thynk: thynkCost,
    diyLabor: diyLaborCost,
    actionable
  };
}

function portfolioTotals(){
  const labor = getLabor();
  let totals = {
    hospital: 0, thynk: 0, diy: 0,
    hospMin:0, thynkMin:0, diyMin:0,
    actionable:0, total:0
  };

  MODULES.forEach(m => {
    if(!m.enabled) return;
    const bluePct = clamp(+inputs.blueRate.value || 0, 0, 100) / 100;
    const annualCT = +inputs.annualCt.value || 0;
    const total = Math.round(annualCT * m.shareOfCT);
    const actionable = Math.round(total * (1 - bluePct));
    const red = Math.round(actionable * m.severityMix.red);
    const amber = Math.round(actionable * m.severityMix.amber);
    const green = Math.round(actionable * m.severityMix.green);
    const used = red + amber + green;
    const blue = Math.max(0, total - used);

    const mins = getMinutes();
    const hospMin = (red*mins.red + amber*mins.amber + green*mins.green + blue*mins.blue) * EFFICIENCY.hospital;
    const thynkMin = (red*mins.red + amber*mins.amber + green*mins.green + blue*mins.blue) * EFFICIENCY.thynk;
    const diyMin = (red*mins.red + amber*mins.amber + green*mins.green + blue*mins.blue) * EFFICIENCY.diy;

    totals.hospital += hospMin * labor.loadedPerMin;
    totals.thynk += thynkMin * labor.loadedPerMin + actionable * (+inputs.thynkFee.value || 0);
    totals.diy += diyMin * labor.loadedPerMin; // platform/team added after loop

    totals.hospMin += hospMin;
    totals.thynkMin += thynkMin;
    totals.diyMin += diyMin;

    totals.actionable += actionable;
    totals.total += total;
  });

  // Add DIY platform & team
  const diyAmort = +inputs.diyAmort.value || 0;
  const diyBuild = +inputs.diyBuild.value || 0;
  const diyMaint = +inputs.diyMaint.value || 0;
  const diyFte = +inputs.diyFteInput.value || 0;

  // Amortize build over 5 years by default (explicit assumption)
  const buildAmort = diyBuild / 5;
  totals.diy += diyAmort + buildAmort + diyMaint + diyFte * DIY_FTE_FULLY_LOADED;

  return totals;
}

function fteFromMinutes(mins){
  // 1 FTE = 2080 hours/year
  const hours = mins / 60;
  return hours / 2080;
}

// ---------- CI (Monte Carlo) ----------
function randomNormal(mu, sigma){
  // Box–Muller
  let u1 = Math.random(); let u2 = Math.random();
  let z0 = Math.sqrt(-2*Math.log(u1)) * Math.cos(2*Math.PI*u2);
  return mu + z0 * sigma;
}
function sampleCI(n=500){
  const baseInputs = {
    t: getMinutes(),
    wage: +inputs.wage.value || 0,
    blue: +inputs.blueRate.value || 0,
  };
  const results = [];
  for(let i=0;i<n;i++){
    // perturb
    const tBlue = Math.max(0.1, randomNormal(baseInputs.t.blue, baseInputs.t.blue*0.15 || 0.15));
    const tGreen = Math.max(0.2, randomNormal(baseInputs.t.green, baseInputs.t.green*0.15 || 0.3));
    const tAmber = Math.max(0.5, randomNormal(baseInputs.t.amber, baseInputs.t.amber*0.15 || 0.75));
    const tRed = Math.max(1, randomNormal(baseInputs.t.red, baseInputs.t.red*0.15 || 1.5));
    const wage = Math.max(5, randomNormal(baseInputs.wage, baseInputs.wage*0.10 || 4));
    const blue = clamp(randomNormal(baseInputs.blue, 5), 0, 100);

    // temporarily set inputs
    const stash = {
      t: getMinutes(), wage: +inputs.wage.value, blue: +inputs.blueRate.value
    };
    inputs.tBlue.value = tBlue.toFixed(2);
    inputs.tGreen.value = tGreen.toFixed(2);
    inputs.tAmber.value = tAmber.toFixed(2);
    inputs.tRed.value = tRed.toFixed(2);
    inputs.wage.value = wage.toFixed(2);
    inputs.blueRate.value = blue.toFixed(2);

    const totals = portfolioTotals();
    const savings = modelSavings(totals);

    results.push(savings);

    // restore
    inputs.tBlue.value = stash.t.blue;
    inputs.tGreen.value = stash.t.green;
    inputs.tAmber.value = stash.t.amber;
    inputs.tRed.value = stash.t.red;
    inputs.wage.value = stash.wage;
    inputs.blueRate.value = stash.blue;
  }
  results.sort((a,b)=>a-b);
  const lo = results[Math.floor(0.025 * results.length)];
  const hi = results[Math.floor(0.975 * results.length)];
  return { lo, hi, n };
}

// ---------- Savings vs selected ----------
function modelSavings(totals){
  // totals = { hospital, thynk, diy }
  let baseline;
  if (savingsVs === 'hospital') baseline = totals.hospital;
  else if (savingsVs === 'thynk') baseline = totals.thynk;
  else baseline = totals.diy;

  // Savings = baseline - min(other two)
  let others = [];
  if (savingsVs !== 'hospital') others.push(totals.hospital);
  if (savingsVs !== 'thynk') others.push(totals.thynk);
  if (savingsVs !== 'diy') others.push(totals.diy);

  const bestOther = Math.min(...others);
  return baseline - bestOther;
}

// ---------- Recalc + UI wiring ----------
function recalc(){
  renderTable();
  const totals = portfolioTotals();

  // KPIs
  const labor = getLabor();
  kpis.hospCost.textContent = fmtMoney(totals.hospital);
  kpis.thynkCost.textContent = fmtMoney(totals.thynk);
  kpis.diyCost.textContent = fmtMoney(totals.diy);

  kpis.hospFte.textContent = fteFromMinutes(totals.hospMin).toFixed(1);
  kpis.thynkFte.textContent = fteFromMinutes(totals.thynkMin).toFixed(1);
  kpis.diyFte.textContent = fteFromMinutes(totals.diyMin).toFixed(1);

  // Savings card
  const s = modelSavings(totals);
  kpis.savings.textContent = fmtMoney(s);
  kpis.target.textContent = `vs ${savingsVs[0].toUpperCase() + savingsVs.slice(1)}`;

  // CI preview string for tooltip/modal content
  const ci = sampleCI(300); // quicker on every recalc; modal runs 500
  $('#ciChip').title = `95% CI: ${fmtMoney(ci.lo)} to ${fmtMoney(ci.hi)}`;
  $('#ciSummary').textContent = `For the current inputs, the estimated savings 95% confidence interval is ${fmtMoney(ci.lo)} to ${fmtMoney(ci.hi)} (n=${ci.n} draws).`;
}

// Buttons
$('#recalc').addEventListener('click', recalc);
$('#selectAll').addEventListener('click', () => { MODULES.forEach(m => m.enabled = true); recalc(); syncChecks(true); });
$('#clearAll').addEventListener('click', () => { MODULES.forEach(m => m.enabled = false); recalc(); syncChecks(false); });

function syncChecks(val){
  $$('#moduleBody input[type="checkbox"]').forEach(cb => cb.checked = val);
}

// CI Modal
const ciModal = $('#ciModal');
$('#ciChip').addEventListener('click', () => {
  // recompute with n=500 for modal
  const ci = sampleCI(500);
  $('#ciSummary').textContent = `For the selected baseline (vs ${savingsVs}), the estimated savings 95% confidence interval is ${fmtMoney(ci.lo)} to ${fmtMoney(ci.hi)} (n=${ci.n} draws).`;
  ciModal.showModal();
});

// Recalc whenever a primary input changes
Object.values(inputs).forEach(inp => {
  inp.addEventListener('input', () => {
    // Light debounce
    clearTimeout(inp._t);
    inp._t = setTimeout(recalc, 120);
  });
});

// First render
renderTable();
recalc();
