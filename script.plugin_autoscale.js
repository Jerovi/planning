/* Full master script — moved and updated to support separate percent vs whole-number charts */
Chart.register(ChartDataLabels);

/* ---------- Config & State ---------- */
const STORAGE = { ched: 'chedData', research: 'researchData', extension: 'extensionData' };
const DEFAULT_INDICATORS = ["Licensure","Employability","CHED-RDC","Accreditation"];
const DEFAULT_SETTINGS = { tolerance: 0.5, decimals: 1, chartMaxY: 120 };

// research canonical (all three are canonical names)
const RESEARCH_CANON = [
  'Research Utilization',
  'Completed Research',
  'Research Published'
];

// For research, only Research Utilization & Completed Research are NO_DENOM.
// Research Published is allowed to have denom (per your request).
const RESEARCH_NO_DENOM = [
  'Research Utilization',
  'Completed Research'
];

// extension indicators that are whole-number-only
const EXTENSION_NO_DENOM = [
  "Number of active partnerships as a result of extension activities",
  "Number of trainees weighted by the length of experience",
  "Number of extension programs with the SUC's mandated and priority programs"
];

// NO_DENOM combined set (exclude Research Published)
const NO_DENOM = new Set([...RESEARCH_NO_DENOM, ...EXTENSION_NO_DENOM]);

let activeDataset = 'ched';
let entriesMap = { ched: [], research: [], extension: [] };
let matrix = {};
let settings = DEFAULT_SETTINGS;

// two separate Chart.js instances (percent and whole)
let percentChart = null;
let wholeChart = null;

/* ---------- DOM ---------- */
const datasetSelector = document.getElementById('datasetSelector');
const manageDataBtn = document.getElementById('manageDataBtn');
const manageOverlay = document.getElementById('manageOverlay');
const manageDatasetName = document.getElementById('manageDatasetName');
const closeManage = document.getElementById('closeManage');
const seedDataset = document.getElementById('seedDataset');

const reportTable = document.getElementById('reportTable');
const statusEl = document.getElementById('status');
const downloadCurrentPDFBtn = document.getElementById('downloadCurrentPDF');
const downloadAllPDFBtn = document.getElementById('downloadAllPDF');
const clearDataBtn = document.getElementById('clearData');
const chartSelector = document.getElementById('chartSelector');
const backBtn = document.getElementById('backBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const chartWrap = document.getElementById('chartWrap');

const percentCanvas = document.getElementById('percentChart');
const wholeCanvas = document.getElementById('wholeChart');

// Manage form elements
const entryId = document.getElementById('entryId');
const indicatorSelect = document.getElementById('indicatorSelect');
const indicatorOther = document.getElementById('indicatorOther');
const quarterInput = document.getElementById('quarterInput');
const targetInput = document.getElementById('targetInput');
const targetDenomInput = document.getElementById('targetDenomInput');
const accompInput = document.getElementById('accompInput');
const accompDenomInput = document.getElementById('accompDenomInput');
const remarksInput = document.getElementById('remarksInput');
const saveEntryBtn = document.getElementById('saveEntryBtn');
const entriesList = document.getElementById('entriesList');

const targetDenomLabel = document.getElementById('targetDenomLabel');
const accompDenomLabel = document.getElementById('accompDenomLabel');

/* ---------- Helpers ---------- */
/* Utility functions for UID generation, status updates, parsing, and text wrapping. 
   These are kept lightweight and safe for all datasets. */
const uid = ()=> Date.now() + Math.floor(Math.random()*999);
const showStatus = (t)=> { statusEl.innerText = t; };
const safeParse = s=>{ try{ return JSON.parse(s);}catch(e){return null;} };

function wrapLabel(text, maxWordsPerLine = 4) {
  if (!text && text !== 0) return [''];
  const words = String(text).split(/\s+/);
  const lines = [];
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    lines.push(words.slice(i, i + maxWordsPerLine).join(' '));
  }
  return lines;
}

function normalizeResearchIndicator(name){
  if (!name && name !== 0) return name;
  const s = String(name).trim();
  if (!s) return s;
  const low = s.toLowerCase();
  if (low.includes('utiliz') || /^oc1\b/i.test(s) || low.includes('research utilization')) return 'Research Utilization';
  if (low.includes('complete') || /^op1\b/i.test(s) || low.includes('completed research') || low.includes('complete research')) return 'Completed Research';
  if (low.includes('publish') || low.includes('published') || /^op2\b/i.test(s) || low.includes('research publish')) return 'Research Published';
  if (RESEARCH_CANON.includes(s)) return s;
  return s;
}

function datasetKeyToTitle(k) {
  if (k === 'ched') return 'CHED Performance';
  if (k === 'research') return 'Research Program';
  if (k === 'extension') return 'Extension Services';
  return k.toUpperCase();
}

function loadDataset(key) {
  const raw = safeParse(localStorage.getItem(STORAGE[key])) || [];
  entriesMap[key] = raw;
  return entriesMap[key];
}
function saveDataset(key) {
  localStorage.setItem(STORAGE[key], JSON.stringify(entriesMap[key]));
}

function computeTotalDenom(denomsObj, mode='auto') {
  const vals = ['Q1','Q2','Q3','Q4'].map(q=>Number(denomsObj[q]||0)).filter(v=>v>0);
  if (!vals.length) return 0;
  if (mode === 'sum' || (mode==='auto' && !vals.every(v=>v===vals[0]))) return vals.reduce((a,b)=>a+b,0);
  if (mode === 'constant' || (mode==='auto' && vals.every(v=>v===vals[0]))) return vals[0];
  if (mode === 'max') return Math.max(...vals);
  if (mode === 'average') return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  return vals.reduce((a,b)=>a+b,0);
}

/* indicator key normalization helper */
function indicatorKeyForCheck(rawIndicator, dataset) {
  let key = String(rawIndicator || '').trim();
  if (!key) return '';
  dataset = dataset || activeDataset;
  if (dataset === 'research') return normalizeResearchIndicator(key);
  if (dataset === 'extension') return key.replace(/^(?:OC|OP)\d+\s*[-:]?\s*/i, '').trim();
  return key;
}

/* toggle denom fields based on chosen indicator */
function toggleDenomFields(optionalIndicator) {
  const raw = (optionalIndicator !== undefined) ? optionalIndicator : (indicatorSelect.value === 'other' ? indicatorOther.value : indicatorSelect.value);
  const key = indicatorKeyForCheck(raw, activeDataset);
  const shouldHide = !!(key && NO_DENOM.has(key));
  if (shouldHide) {
    if (targetDenomLabel) targetDenomLabel.style.display = 'none';
    if (accompDenomLabel) accompDenomLabel.style.display = 'none';
    if (targetDenomInput) targetDenomInput.value = '';
    if (accompDenomInput) accompDenomInput.value = '';
  } else {
    if (targetDenomLabel) targetDenomLabel.style.display = '';
    if (accompDenomLabel) accompDenomLabel.style.display = '';
  }
}

/* ---------- indicator select population & helper UI behaviors ---------- */
const ALL_INDICATORS = [
  ...DEFAULT_INDICATORS,
  ...RESEARCH_CANON,
  ...EXTENSION_NO_DENOM,
  'Satisfactory Rating'
];

function populateIndicatorSelect() {
  if (!indicatorSelect) return;
  indicatorSelect.innerHTML = '';
  ALL_INDICATORS.forEach(i => {
    const opt = document.createElement('option'); opt.value = i; opt.textContent = i;
    indicatorSelect.appendChild(opt);
  });
  const otherOpt = document.createElement('option'); otherOpt.value = 'other'; otherOpt.textContent = 'Other (type below)';
  indicatorSelect.appendChild(otherOpt);
}
populateIndicatorSelect();

if (indicatorSelect) {
  indicatorSelect.addEventListener('change', ()=>{
    if (indicatorSelect.value === 'other') {
      indicatorOther.style.display = '';
      indicatorOther.focus();
      toggleDenomFields(indicatorOther.value);
    } else {
      indicatorOther.style.display = 'none';
      toggleDenomFields(indicatorSelect.value);
    }
  });
}
if (indicatorOther) indicatorOther.addEventListener('input', ()=> toggleDenomFields(indicatorOther.value));

/* ---------- Build matrix ---------- */
function buildMatrixFromEntries(entries, datasetKey) {
  const m = {};
  if (datasetKey === 'ched') {
    DEFAULT_INDICATORS.forEach(ind => {
      m[ind] = {
        targets: {Q1:0,Q2:0,Q3:0,Q4:0},
        targetDenoms: {Q1:0,Q2:0,Q3:0,Q4:0},
        accomps: {Q1:0,Q2:0,Q3:0,Q4:0},
        accompDenoms: {Q1:0,Q2:0,Q3:0,Q4:0}
      };
    });
  }

  if (datasetKey === 'research') {
    RESEARCH_CANON.forEach(r => {
      m[r] = {
        targets: {Q1:0,Q2:0,Q3:0,Q4:0},
        targetDenoms: {Q1:0,Q2:0,Q3:0,Q4:0},
        accomps: {Q1:0,Q2:0,Q3:0,Q4:0},
        accompDenoms: {Q1:0,Q2:0,Q3:0,Q4:0}
      };
    });
  }

  entries.forEach(e => {
    let indicatorKey = e.indicator;
    if (datasetKey === 'research') {
      indicatorKey = normalizeResearchIndicator(e.indicator);
      if (!RESEARCH_CANON.includes(indicatorKey)) return;
    }
    if (datasetKey === 'extension') {
      indicatorKey = String(indicatorKey).replace(/^(?:OC|OP)\d+\s*[-:]?\s*/i, '').trim();
      if (DEFAULT_INDICATORS.includes(indicatorKey)) return;
    }
    if (!m[indicatorKey]) {
      m[indicatorKey] = {
        targets:{Q1:0,Q2:0,Q3:0,Q4:0},
        targetDenoms:{Q1:0,Q2:0,Q3:0,Q4:0},
        accomps:{Q1:0,Q2:0,Q3:0,Q4:0},
        accompDenoms:{Q1:0,Q2:0,Q3:0,Q4:0}
      };
    }
    m[indicatorKey].targets[e.quarter] = Number(e.target) || 0;
    m[indicatorKey].targetDenoms[e.quarter] = Number(e.targetDenom) || 0;
    m[indicatorKey].accomps[e.quarter] = Number(e.accomp) || 0;
    m[indicatorKey].accompDenoms[e.quarter] = Number(e.accompDenom) || 0;
  });

  return m;
}

/* ---------- Render report & chart arrays ---------- */
function renderReportForDataset(key) {
  const entries = entriesMap[key] || [];
  matrix = buildMatrixFromEntries(entries, key);

  reportTable.innerHTML = '';
  const labelKeys = [];
  const chartLabels = [];
  const overallTargets = [], overallAccomps = [];
  const quarterlyTargets = {Q1:[],Q2:[],Q3:[],Q4:[]}, quarterlyAccomps = {Q1:[],Q2:[],Q3:[],Q4:[]};

  let inds;
  if (key === 'research') inds = RESEARCH_CANON;
  else if (key === 'ched') inds = DEFAULT_INDICATORS;
  else if (key === 'extension') inds = Object.keys(matrix);
  else inds = Object.keys(matrix);

  inds.forEach(ind => {
    if (key === 'extension' && DEFAULT_INDICATORS.includes(ind)) return;

    const t = matrix[ind] || {
      targets:{Q1:0,Q2:0,Q3:0,Q4:0},
      targetDenoms:{Q1:0,Q2:0,Q3:0,Q4:0},
      accomps:{Q1:0,Q2:0,Q3:0,Q4:0},
      accompDenoms:{Q1:0,Q2:0,Q3:0,Q4:0}
    };

    const totalTarget = t.targets.Q1 + t.targets.Q2 + t.targets.Q3 + t.targets.Q4;
    const totalAccomp = t.accomps.Q1 + t.accomps.Q2 + t.accomps.Q3 + t.accomps.Q4;
    let totalTargetDenom = computeTotalDenom(t.targetDenoms);
    let totalAccompDenom = computeTotalDenom(t.accompDenoms);

    if (totalTargetDenom === 0 && NO_DENOM.has(ind) && totalTarget > 0) totalTargetDenom = totalTarget;
    if (totalAccompDenom === 0 && NO_DENOM.has(ind) && totalAccomp > 0) totalAccompDenom = totalAccomp;

    const overallTargetPct = totalTargetDenom ? (totalTarget / totalTargetDenom * 100) : null;
    const overallAccompPct = totalAccompDenom ? (totalAccomp / totalAccompDenom * 100) : null;

    const dispTargetPct = overallTargetPct == null ? '-' : overallTargetPct.toFixed(settings.decimals) + '%';
    const dispAccompPct = overallAccompPct == null ? '-' : overallAccompPct.toFixed(settings.decimals) + '%';

    const qCellsTarget = {};
    const qCellsAccomp = {};
    ['Q1','Q2','Q3','Q4'].forEach(q => {
      const numT = t.targets[q] || 0;
      const denT = Number(t.targetDenoms[q] || 0);
      let effectiveDenT = denT;
      if (effectiveDenT === 0 && NO_DENOM.has(ind) && numT > 0) effectiveDenT = numT;
      const pctT = effectiveDenT ? (numT / effectiveDenT * 100).toFixed(settings.decimals) + '%' : '-';
      qCellsTarget[q] = (NO_DENOM.has(ind) ? (numT === 0 ? '-' : String(numT)) : ((denT === 0 && numT === 0) ? '-' : `${numT}/${denT || '-'} (${pctT})`));

      const numA = t.accomps[q] || 0;
      const denA = Number(t.accompDenoms[q] || 0);
      let effectiveDenA = denA;
      if (effectiveDenA === 0 && NO_DENOM.has(ind) && numA > 0) effectiveDenA = numA;
      const pctA = effectiveDenA ? (numA / effectiveDenA * 100).toFixed(settings.decimals) + '%' : '-';
      qCellsAccomp[q] = (NO_DENOM.has(ind) ? (numA === 0 ? '-' : String(numA)) : ((denA === 0 && numA === 0) ? '-' : `${numA}/${denA || '-'} (${pctA})`));
    });

    // gather remarks for this indicator from entries
    const allEntries = (entriesMap[key] || []).filter(e => {
      let eKey = e.indicator;
      if (key === 'research') eKey = normalizeResearchIndicator(e.indicator);
      if (key === 'extension') eKey = String(eKey).replace(/^(?:OC|OP)\d+\s*[-:]?\s*/i, '').trim();
      return eKey === ind;
    });
    const uniqueRemarks = Array.from(new Set(allEntries.map(x=>String(x.remarks||'').trim()).filter(Boolean)));
    const remarksText = uniqueRemarks.join('; ') || '-';

    // header row (indicator)
    const header = document.createElement('tr');
    header.className = 'bg-slate-100 font-semibold';
    header.innerHTML = `<td class="p-2" colspan="7">${ind}</td><td class="p-2 bg-slate-100 font-semibold">Remarks</td>`;
    reportTable.appendChild(header);

    // Target row + remarks (rowspan=2)
    const totalTargetDisplay = (totalTargetDenom === 0 && totalTarget === 0) ? '-' : `${totalTarget}/${totalTargetDenom || '-'}`;
    const trT = document.createElement('tr'); trT.className='bg-white';
    trT.innerHTML = `
      <td class="border p-2">Target</td>
      <td class="border p-2">${qCellsTarget.Q1}</td>
      <td class="border p-2">${qCellsTarget.Q2}</td>
      <td class="border p-2">${qCellsTarget.Q3}</td>
      <td class="border p-2">${qCellsTarget.Q4}</td>
      <td class="border p-2">${totalTargetDisplay}</td>
      <td class="border p-2 font-semibold">${dispTargetPct}</td>
      <td class="border p-2 remarks" rowspan="2">${remarksText}</td>
    `;
    reportTable.appendChild(trT);

    // Accomplishment row
    const totalAccompDisplay = (totalAccompDenom === 0 && totalAccomp === 0) ? '-' : `${totalAccomp}/${totalAccompDenom || '-'}`;
    const trA = document.createElement('tr');
    const totalAccompClass = (totalAccompDenom === 0 && totalAccomp === 0) ? '' : ( (totalAccomp < totalTarget) ? 'text-red-600' : 'text-green-600' );
    const overallClass = (overallAccompPct != null && overallTargetPct != null && (overallAccompPct + settings.tolerance >= overallTargetPct)) ? 'text-green-600' : 'text-red-600';
    trA.innerHTML = `
      <td class="border p-2">Accomplishment</td>
      <td class="border p-2 ${t.accomps.Q1 < t.targets.Q1 ? 'text-red-600 font-bold':'text-green-600 font-bold'}">${qCellsAccomp.Q1}</td>
      <td class="border p-2 ${t.accomps.Q2 < t.targets.Q2 ? 'text-red-600 font-bold':'text-green-600 font-bold'}">${qCellsAccomp.Q2}</td>
      <td class="border p-2 ${t.accomps.Q3 < t.targets.Q3 ? 'text-red-600 font-bold':'text-green-600 font-bold'}">${qCellsAccomp.Q3}</td>
      <td class="border p-2 ${t.accomps.Q4 < t.targets.Q4 ? 'text-red-600 font-bold':'text-green-600 font-bold'}">${qCellsAccomp.Q4}</td>
      <td class="border p-2 font-bold ${totalAccompClass}">${totalAccompDisplay}</td>
      <td class="border p-2 font-bold ${overallClass}">${dispAccompPct}</td>
    `;
    reportTable.appendChild(trA);

    // Chart arrays
    labelKeys.push(ind);
    chartLabels.push(wrapLabel(ind));
    overallTargets.push(overallTargetPct == null ? 0 : Number(overallTargetPct.toFixed(settings.decimals+1)));
    overallAccomps.push(overallAccompPct == null ? 0 : Number(overallAccompPct.toFixed(settings.decimals+1)));

    ['Q1','Q2','Q3','Q4'].forEach(q => {
      const tqDen = Number(t.targetDenoms[q] || 0) || (NO_DENOM.has(ind) ? t.targets[q] : 0);
      const aqDen = Number(t.accompDenoms[q] || 0) || (NO_DENOM.has(ind) ? t.accomps[q] : 0);
      const tq = tqDen ? (t.targets[q]/tqDen*100) : 0;
      const aq = aqDen ? (t.accomps[q]/aqDen*100) : 0;
      quarterlyTargets[q].push(Number(tq.toFixed(settings.decimals+1)));
      quarterlyAccomps[q].push(Number(aq.toFixed(settings.decimals+1)));
    });
  });

  matrix._chartData = { labels: labelKeys, chartLabels, overallTargets, overallAccomps, quarterlyTargets, quarterlyAccomps };

  showStatus(entries.length ? `${entries.length} row(s) — dataset: ${key.toUpperCase()}` : `No data — dataset: ${key.toUpperCase()}`);
}

/* ---------- Chart rendering helpers ---------- */
function baseChartOptions(isPercent = true, maxY = null) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position:'top' },
      tooltip: { enabled: true },
      datalabels: { display: false }
    },
    scales: {
      x: { ticks: { maxRotation:0, minRotation:0, autoSkip:false } },
      y: {
        beginAtZero:true,
        max: maxY || (isPercent ? settings.chartMaxY : undefined),
        ticks: {
          callback: v => isPercent ? (v + '%') : v
        }
      }
    },
    interaction: { mode: 'index', intersect: false }
  };
}

/* plugin to draw extra labels (works for percent and whole number charts) */

// dualLabelsPlugin - corrected: raw numbers inside bars, percentages above bars (no extra *100)
const dualLabelsPlugin = {
  id: 'dualLabelsPlugin',
  afterDatasetsDraw: function(chart) {
    const ctx = chart.ctx;
    ctx.save();
    try {
      const datasets = chart.data.datasets || [];
      const metas = datasets.map((_, i) => chart.getDatasetMeta(i));
      const labelsCount = chart.data.labels ? chart.data.labels.length : 0;
      const THRESH = (window.settings && window.settings.insideLabelThresholdPx) ? window.settings.insideLabelThresholdPx : 16;
      for (let i = 0; i < labelsCount; i++) {
        for (let dsIndex = 0; dsIndex < metas.length; dsIndex++) {
          const meta = metas[dsIndex];
          if (!meta || !meta.data || !meta.data[i]) continue;
          const el = meta.data[i];
          const ds = datasets[dsIndex];
          const x = (el.x !== undefined) ? el.x : (el.getCenterPoint ? el.getCenterPoint().x : 0);
          const y = (el.y !== undefined) ? el.y : (el.getCenterPoint ? el.getCenterPoint().y : 0);
          const base = (el.base !== undefined) ? el.base : null;

          // DRAW RAW DATA INSIDE the bar (for both percent and count datasets if rawData present)
          if (ds.rawData && ds.rawData[i] != null && base != null && String(ds.rawData[i]) !== '-') {
            const rawText = String(ds.rawData[i]);
            const centerY = (y + base) / 2;
            // determine contrast color based on dataset background
            let textColor = '#fff';
            try {
              const bg = ds.backgroundColor;
              let fill = '#000';
              if (Array.isArray(bg)) fill = bg[i] || bg[0] || '#000';
              else if (typeof bg === 'string') fill = bg;
              const m = String(fill).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
              if (m) {
                const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
                const lum = (0.2126*r + 0.7152*g + 0.0722*b);
                textColor = lum > 160 ? '#000' : '#fff';
              } else {
                const hex = String(fill).replace('#','');
                if (hex.length === 6) {
                  const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
                  const lum = (0.2126*r + 0.7152*g + 0.0722*b);
                  textColor = lum > 160 ? '#000' : '#fff';
                }
              }
            } catch(e){ textColor = '#fff'; }

            ctx.textAlign = 'center';
            ctx.font = 'bold 11px sans-serif';
            if (Math.abs(base - y) > THRESH) {
              ctx.textBaseline = 'middle';
              ctx.fillStyle = textColor;
              ctx.fillText(rawText, x, centerY);
            } else {
              ctx.textBaseline = 'bottom';
              ctx.fillStyle = '#222';
              ctx.fillText(rawText, x, y - 4);
            }
          }

          // DRAW PERCENTAGE above bar using right-axis (y1) scale; ds.data is expected to be 0..100
          if (ds.isPercent && ds.data && ds.data[i] != null) {
            const val = Number(ds.data[i]);
            if (!isNaN(val)) {
              const pctText = Number(val).toFixed((window.settings && window.settings.decimals) ? window.settings.decimals : 1) + '%';
              const yScale = chart.scales && chart.scales['y1'] ? chart.scales['y1'] : null;
              const yPct = yScale && typeof yScale.getPixelForValue === 'function' ? yScale.getPixelForValue(val) : y;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              ctx.font = 'bold 11px sans-serif';
              ctx.fillStyle = '#222';
              ctx.fillText(pctText, x, yPct - 4);
            }
          }
        }
      }
    } catch (err) {
      console.warn('dualLabelsPlugin error', err);
    } finally {
      ctx.restore();
    }
  }
};


function renderDynamicChart(view) {
  if (!matrix._chartData) return;
  const labelKeys = matrix._chartData.labels;
  const labelsWrapped = labelKeys.map(ind => wrapLabel(ind));

  // destroy existing charts
  try { if (percentChart) { percentChart.destroy(); percentChart = null; } } catch(e){}
  try { if (wholeChart) { wholeChart.destroy(); wholeChart = null; } } catch(e){}

  // prepare arrays
  const n = labelKeys.length;
  const pTarget = Array(n).fill(null), pAccomp = Array(n).fill(null);
  const rawPT = Array(n).fill('-'), rawPA = Array(n).fill('-');
  const colorsPA = Array(n).fill('rgba(34,197,94,0.85)');

  labelKeys.forEach((ind, i) => {
    const m = matrix[ind];
    if (!m) return;

    if (view === 'overall') {
      const numT = m.targets.Q1 + m.targets.Q2 + m.targets.Q3 + m.targets.Q4;
      const numA = m.accomps.Q1 + m.accomps.Q2 + m.accomps.Q3 + m.accomps.Q4;
      let denT = computeTotalDenom(m.targetDenoms);
      let denA = computeTotalDenom(m.accompDenoms);

      if (denT === 0 && NO_DENOM.has(ind) && numT > 0) denT = numT;
      if (denA === 0 && NO_DENOM.has(ind) && numA > 0) denA = numA;

      const pctT = denT ? (numT/denT*100) : 0;
      const pctA = denA ? (numA/denA*100) : 0;
      pTarget[i] = Number(pctT.toFixed(settings.decimals+1));
      pAccomp[i] = Number(pctA.toFixed(settings.decimals+1));
      rawPT[i] = (denT===0 && numT===0) ? '-' : `${numT}/${denT||'-'}`;
      rawPA[i] = (denA===0 && numA===0) ? '-' : `${numA}/${denA||'-'}`;
      colorsPA[i] = (pAccomp[i] + settings.tolerance >= (pTarget[i]||0)) ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)';
    } else {
      const numT = m.targets[view] || 0;
      const numA = m.accomps[view] || 0;
      const denT = m.targetDenoms[view] || 0;
      const denA = m.accompDenoms[view] || 0;

      let pctT = 0, pctA = 0;
      if (denT > 0) pctT = (numT/denT*100);
      else if (NO_DENOM.has(ind) && numT>0) pctT = 100;
      if (denA > 0) pctA = (numA/denA*100);
      else if (NO_DENOM.has(ind) && numA>0) pctA = 100;

      pTarget[i] = Number(pctT.toFixed(settings.decimals+1));
      pAccomp[i] = Number(pctA.toFixed(settings.decimals+1));
      rawPT[i] = (denT===0 && numT===0) ? '-' : `${numT}/${denT||'-'}`;
      rawPA[i] = (denA===0 && numA===0) ? '-' : `${numA}/${denA||'-'}`;
      colorsPA[i] = (pAccomp[i] + settings.tolerance >= (pTarget[i]||0)) ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)';
    }
  });

  const datasets = [
    { label: 'Target', data: pTarget, backgroundColor: 'rgba(30,64,175,0.9)', borderColor: 'rgba(30,64,175,1)', borderWidth: 1, yAxisID: 'yPercent', rawData: rawPT, isPercent: true },
    { label: 'Accomplishment', data: pAccomp, backgroundColor: colorsPA, borderColor: colorsPA, borderWidth: 1, yAxisID: 'yPercent', rawData: rawPA, isPercent: true }
  ];

  const ctx = percentCanvas.getContext('2d');
  percentChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: labelsWrapped, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position:'top' },
        tooltip: { enabled: true },
        datalabels: { display: false }
      },
      scales: {
        x: { ticks: { maxRotation:0, minRotation:0, autoSkip:false } },
        yPercent: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { callback: v => v + '%' },
          afterDataLimits: (scale) => {
            let maxPercent = 0;
            scale.chart.data.datasets.forEach(ds => {
              if (ds.isPercent && Array.isArray(ds.data)) {
                ds.data.forEach(v => {
                  const num = Number(v);
                  if (!isNaN(num)) maxPercent = Math.max(maxPercent, num);
                });
              }
            });
            scale.max = maxPercent > 0 ? Math.ceil((maxPercent * 1.2) / 10) * 10 : 100;
          },
          title: { display: true, text: 'Percentage' }
        },
        yCount: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          ticks: { callback: v => String(v) },
          grid: { drawOnChartArea: false },
          afterDataLimits: (scale) => {
            let maxCount = 0;
            scale.chart.data.datasets.forEach(ds => {
              if (!ds.isPercent && Array.isArray(ds.data)) {
                ds.data.forEach(v => {
                  const num = Number(v);
                  if (!isNaN(num)) maxCount = Math.max(maxCount, num);
                });
              }
            });
            scale.max = maxCount > 0 ? Math.ceil(maxCount * 1.2) : 10;
          },
          title: { display: true, text: 'Raw Values' }
        }
      },
      interaction: { mode: 'index', intersect: false }
    },
    plugins: [dualLabelsPlugin]
  });
}

/* ---------- Manage overlay logic ---------- */
function openManageOverlay() {
  manageDatasetName.innerText = activeDataset === 'ched' ? 'CHED Performance' : (activeDataset === 'research' ? 'Research Program' : 'Extension Services');
  populateEntriesList();
  clearForm();
  toggleDenomFields('');
  manageOverlay.style.display = 'flex';
}
function closeManageOverlay() { manageOverlay.style.display = 'none'; }
function clearForm() {
  if (!entryId) return;
  entryId.value = '';
  indicatorSelect.value = ALL_INDICATORS[0] || '';
  indicatorOther.value = '';
  indicatorOther.style.display = 'none';
  quarterInput.value = 'Q1';
  targetInput.value = '';
  targetDenomInput.value = '';
  accompInput.value = '';
  accompDenomInput.value = '';
  remarksInput.value = '';
  toggleDenomFields('');
}

function populateEntriesList() {
  const list = entriesMap[activeDataset] || [];
  entriesList.innerHTML = '';
  list.slice().reverse().forEach(e => {
    let dispIndicator = e.indicator;
    if (activeDataset === 'research') {
      dispIndicator = normalizeResearchIndicator(e.indicator);
      if (!RESEARCH_CANON.includes(dispIndicator)) return;
    }
    if (activeDataset === 'extension') {
      dispIndicator = String(dispIndicator).replace(/^(?:OC|OP)\d+\s*[-:]?\s*/i, '').trim();
      if (DEFAULT_INDICATORS.includes(dispIndicator)) return;
    }

    const isNoDenom = NO_DENOM.has(indicatorKeyForCheck(e.indicator, activeDataset));
    const targetDisplay = (isNoDenom ? (Number(e.target) || '-') : `${e.target}/${e.targetDenom || '-'}`);
    const accompDisplay = (isNoDenom ? (Number(e.accomp) || '-') : `${e.accomp}/${e.accompDenom || '-'}`);
    const remarkDisplay = String(e.remarks||'').trim() || '-';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-1 text-xs">${e.id}</td>
      <td class="p-1">${dispIndicator}</td>
      <td class="p-1">${e.quarter}</td>
      <td class="p-1">${targetDisplay}</td>
      <td class="p-1">${accompDisplay}</td>
      <td class="p-1">${remarkDisplay}</td>
      <td class="p-1">
        <button data-id="${e.id}" class="editBtn text-xs px-2 py-1 bg-slate-100 rounded mr-1">Edit</button>
        <button data-id="${e.id}" class="delBtn text-xs px-2 py-1 bg-red-50 rounded text-red-600">Delete</button>
      </td>
    `;
    entriesList.appendChild(tr);
  });

  // wire edit/delete
  entriesList.querySelectorAll('.editBtn').forEach(btn=>{
    btn.addEventListener('click',(ev)=>{
      const id = ev.currentTarget.dataset.id;
      const item = entriesMap[activeDataset].find(x=>String(x.id)===String(id));
      if(!item) return;
      entryId.value = item.id;
      // prefer to select exact option if exists
      const displayed = (activeDataset === 'research') ? normalizeResearchIndicator(item.indicator) : (activeDataset === 'extension' ? String(item.indicator).replace(/^(?:OC|OP)\d+\s*[-:]?\s*/i, '').trim() : item.indicator);
      if (ALL_INDICATORS.includes(displayed)) {
        indicatorSelect.value = displayed;
        indicatorOther.style.display = 'none';
      } else {
        indicatorSelect.value = 'other';
        indicatorOther.style.display = '';
        indicatorOther.value = item.indicator;
      }
      quarterInput.value = item.quarter;
      targetInput.value = item.target;
      targetDenomInput.value = item.targetDenom;
      accompInput.value = item.accomp;
      accompDenomInput.value = item.accompDenom;
      remarksInput.value = item.remarks || '';
      toggleDenomFields(indicatorSelect.value === 'other' ? indicatorOther.value : indicatorSelect.value);
    });
  });
  entriesList.querySelectorAll('.delBtn').forEach(btn=>{
    btn.addEventListener('click',(ev)=>{
      const id = ev.currentTarget.dataset.id;
      if(!confirm('Delete entry?')) return;
      entriesMap[activeDataset] = entriesMap[activeDataset].filter(x=>String(x.id)!==String(id));
      saveDataset(activeDataset);
      populateEntriesList();
      refreshAll();
    });
  });
}

/* ---------- Save entry ---------- */
if (indicatorOther) indicatorOther.addEventListener('input', ()=> toggleDenomFields(indicatorOther.value));

if (saveEntryBtn) saveEntryBtn.addEventListener('click', ()=>{
  const id = entryId.value || uid();
  const selected = indicatorSelect.value;
  let indicator = selected === 'other' ? (indicatorOther.value.trim() || '') : selected;
  const quarter = quarterInput.value;
  let target = Number(targetInput.value) || 0;
  let targetDen = Number(targetDenomInput.value) || 0;
  let accomp = Number(accompInput.value) || 0;
  let accompDen = Number(accompDenomInput.value) || 0;
  const remarks = String(remarksInput.value || '').trim();

  if (!indicator) { alert('Indicator required'); return; }
  if (!['Q1','Q2','Q3','Q4'].includes(quarter)) { alert('Quarter required'); return; }

  if (activeDataset === 'research') {
    indicator = normalizeResearchIndicator(indicator);
    if (!RESEARCH_CANON.includes(indicator)) {
      alert('For Research Program please use one of: ' + RESEARCH_CANON.join(', '));
      return;
    }
  }

  if (activeDataset === 'extension') {
    indicator = String(indicator).replace(/^(?:OC|OP)\d+\s*[-:]?\s*/i,'').trim();
    if (DEFAULT_INDICATORS.includes(indicator)) {
      alert('Extension Services should not use CHED performance indicators (e.g., Licensure). Choose a different indicator.');
      return;
    }
  }

  const checkKey = indicatorKeyForCheck(indicator, activeDataset);
  if (NO_DENOM.has(checkKey)) {
    target = Math.round(target);
    accomp = Math.round(accomp);
    targetDen = 0;
    accompDen = 0;
  } else {
    targetDen = Math.round(targetDen);
    accompDen = Math.round(accompDen);
  }

  const idx = entriesMap[activeDataset].findIndex(x=>String(x.id)===String(id));
  const payload = { id, indicator, quarter, target, targetDenom: targetDen, accomp, accompDenom: accompDen, remarks };
  if (idx >= 0) entriesMap[activeDataset][idx] = payload;
  else entriesMap[activeDataset].push(payload);

  saveDataset(activeDataset);
  populateEntriesList();
  clearForm();
  refreshAll();
});

/* ---------- Seed / overlay controls ---------- */
if (manageDataBtn) manageDataBtn.addEventListener('click', ()=> openManageOverlay());
if (closeManage) closeManage.addEventListener('click', ()=> closeManageOverlay());
manageOverlay.addEventListener('click',(ev)=> { if (ev.target === manageOverlay) closeManageOverlay(); });

if (seedDataset) seedDataset.addEventListener('click', ()=>{
  if (!confirm('Merge sample data into this dataset?')) return;
  const sample = (activeDataset === 'ched') ? [
    {id:uid(),indicator:"Licensure",quarter:"Q1",target:40,targetDenom:50,accomp:35,accompDenom:50,remarks:'Licensure Q1'},
    {id:uid(),indicator:"Licensure",quarter:"Q2",target:45,targetDenom:50,accomp:46,accompDenom:50,remarks:''},
    {id:uid(),indicator:"Employability",quarter:"Q1",target:80,targetDenom:100,accomp:76,accompDenom:100,remarks:''},
    {id:uid(),indicator:"CHED-RDC",quarter:"Q1",target:3,targetDenom:5,accomp:2,accompDenom:5,remarks:''},
    {id:uid(),indicator:"Accreditation",quarter:"Q1",target:1,targetDenom:2,accomp:1,accompDenom:2,remarks:''},
  ] : (activeDataset === 'research') ? [
    // Research: Research Published allows denom here
    {id:uid(),indicator:"Research Utilization",quarter:"Q1",target:12,targetDenom:0,accomp:10,accompDenom:0,remarks:'Utilization sample'},
    {id:uid(),indicator:"Completed Research",quarter:"Q1",target:8,targetDenom:0,accomp:7,accompDenom:0,remarks:''},
    {id:uid(),indicator:"Research Published",quarter:"Q1",target:5,targetDenom:7,accomp:3,accompDenom:7,remarks:'Published (has denom)'},
  ] : [
    {id:uid(),indicator:"Number of active partnerships as a result of extension activities",quarter:"Q1",target:10,targetDenom:0,accomp:8,accompDenom:0,remarks:'Partnerships stable'},
    {id:uid(),indicator:"Number of trainees weighted by the length of experience",quarter:"Q2",target:50,targetDenom:0,accomp:45,accompDenom:0,remarks:''},
    {id:uid(),indicator:"Satisfactory Rating",quarter:"Q1",target:80,targetDenom:100,accomp:78,accompDenom:100,remarks:''},
  ];
  entriesMap[activeDataset] = entriesMap[activeDataset].concat(sample);
  saveDataset(activeDataset);
  populateEntriesList();
  refreshAll();
});

/* ---------- PDF Export helpers ---------- */
const sleep = ms => new Promise(r=>setTimeout(r,ms));

/*
  Capture function: renders the report for the given dataset, captures table and charts.
  Returns: { tableImg, overallImg, quarterImgs: [{view:'Q1', img}, ...] }
*/
async function captureReportAndChartsForDataset(datasetKey) {
  const prevActive = activeDataset;
  activeDataset = datasetKey;
  renderReportForDataset(datasetKey);
  // render overall charts first
  renderDynamicChart('overall');
  await sleep(300);

  // capture table (reportContent)
  const tableEl = document.getElementById('reportContent');
  const tableCanvas = await html2canvas(tableEl, { scale: 2, useCORS: true });
  const tableImg = tableCanvas.toDataURL('image/png');

  // capture overall chartWrap (this will capture both percentChart and wholeChart stacked)
  const chartEl = chartWrap;
  const overallCanvas = await html2canvas(chartEl, { scale: 2, useCORS: true });
  const overallImg = overallCanvas.toDataURL('image/png');

  // capture quarter charts (we'll render each, capture chartWrap)
  const quarterImgs = [];
  const views = ['Q1','Q2','Q3','Q4'];
  for (let v of views) {
    renderDynamicChart(v);
    await sleep(250);
    const qCanvas = await html2canvas(chartEl, { scale: 2, useCORS: true });
    quarterImgs.push({ view: v, img: qCanvas.toDataURL('image/png') });
  }

  // restore previous view
  activeDataset = prevActive;
  renderReportForDataset(activeDataset);
  renderDynamicChart(chartSelector.value || 'overall');

  return { tableImg, overallImg, quarterImgs };
}

/* utility to compute scaled image height for PDF page */
function computeScaledHeight(imgWidth, imgHeight, pdfWidth) {
  return (imgHeight * pdfWidth) / imgWidth;
}

/* Download current dataset: Page1 table+overall, Page2 quarters in 2x2 grid */
async function downloadCurrentPDF() {
  const curEntries = entriesMap[activeDataset] || [];
  if (!curEntries.length) { alert('No data to export'); return; }
  loadingOverlay.style.display = 'flex';
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p','mm','a4');
    const pdfWidth = doc.internal.pageSize.getWidth();
    const pdfHeight = doc.internal.pageSize.getHeight();
    const margin = 8;

    const imgs = await captureReportAndChartsForDataset(activeDataset);

    // Add table image to first page, at top left. Then place overall chart below scaled to fit remainder of page.
    const tableLoad = await new Promise(resolve => {
      const img = new Image();
      img.onload = ()=> resolve({ w: img.width, h: img.height });
      img.src = imgs.tableImg;
    });
    const tableH = computeScaledHeight(tableLoad.w, tableLoad.h, pdfWidth - margin*2);
    doc.addImage(imgs.tableImg, 'PNG', margin, 8, pdfWidth - margin*2, tableH);

    // overall chart: try to put below table; if not enough space, scale it to fit remaining; otherwise new page
    const ovLoad = await new Promise(resolve => {
      const img = new Image();
      img.onload = ()=> resolve({ w: img.width, h: img.height });
      img.src = imgs.overallImg;
    });
    let ovH = computeScaledHeight(ovLoad.w, ovLoad.h, pdfWidth - margin*2);
    const spaceLeft = pdfHeight - (tableH + 16) - 16; // bottom margin allowance
    if (spaceLeft > 40) {
      if (ovH > spaceLeft) ovH = spaceLeft;
      doc.addImage(imgs.overallImg, 'PNG', margin, tableH + 12, pdfWidth - margin*2, ovH);
    } else {
      doc.addPage();
      doc.addImage(imgs.overallImg, 'PNG', margin, 12, pdfWidth - margin*2, ovH);
    }

    // Page 2: quarters in 2x2 grid
    doc.addPage();
    doc.setFontSize(11);
    doc.text(`${datasetKeyToTitle(activeDataset)} — Quarterly (Q1–Q4)`, margin, 12);

    // grid placement
    const startY = 18;
    const gap = 6;
    const colWidth = (pdfWidth - margin*2 - gap) / 2;
    const rowHeight = (pdfHeight - startY - margin - gap) / 2;

    for (let i = 0; i < imgs.quarterImgs.length; i++) {
      const qi = imgs.quarterImgs[i];
      const imgLoad = await new Promise(resolve => {
        const img = new Image();
        img.onload = ()=> resolve({ w: img.width, h: img.height });
        img.src = qi.img;
      });
      // scale to fit within colWidth x rowHeight while preserving aspect ratio
      const scale = Math.min(colWidth / imgLoad.w, rowHeight / imgLoad.h);
      const drawW = imgLoad.w * scale;
      const drawH = imgLoad.h * scale;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = margin + col * (colWidth + gap) + (colWidth - drawW)/2;
      const y = startY + row * (rowHeight + gap) + (rowHeight - drawH)/2;
      doc.addImage(qi.img, 'PNG', x, y, drawW, drawH);
      doc.setFontSize(10);
      doc.text(`${qi.view}`, x + 4, y + 8);
    }

    doc.setFontSize(9);
    doc.text(`Dataset: ${datasetKeyToTitle(activeDataset)} — Generated: ${new Date().toLocaleString()}`, margin, pdfHeight - 8);
    doc.save(`CHED_Report_${activeDataset}_${new Date().toISOString().slice(0,10)}.pdf`);
  } catch (err) {
    console.error(err);
    alert('PDF export failed');
  } finally {
    loadingOverlay.style.display = 'none';
  }
}

/* Download all datasets: for each dataset that has data produce the same 2-page layout */
async function downloadAllPDF() {
  const datasets = ['ched','research','extension'];
  const hasAny = datasets.some(d => (entriesMap[d]||[]).length > 0);
  if (!hasAny) { alert('No data to export in any dataset'); return; }
  loadingOverlay.style.display = 'flex';
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p','mm','a4');
    const pdfWidth = doc.internal.pageSize.getWidth();
    const pdfHeight = doc.internal.pageSize.getHeight();
    const margin = 8;

    let firstPage = true;
    for (let ds of datasets) {
      if (!entriesMap[ds] || entriesMap[ds].length === 0) continue;
      const imgs = await captureReportAndChartsForDataset(ds);

      if (!firstPage) doc.addPage();
      firstPage = false;

      // Table (page)
      const tableLoad = await new Promise(resolve => {
        const img = new Image();
        img.onload = ()=> resolve({ w: img.width, h: img.height });
        img.src = imgs.tableImg;
      });
      const tableH = computeScaledHeight(tableLoad.w, tableLoad.h, pdfWidth - margin*2);
      doc.addImage(imgs.tableImg, 'PNG', margin, 8, pdfWidth - margin*2, tableH);
      doc.setFontSize(10);
      doc.text(`${datasetKeyToTitle(ds)}`, margin, Math.min(tableH + 12, pdfHeight - 20));

      // overall chart (try place below table; otherwise new page)
      const ovLoad = await new Promise(resolve => {
        const img = new Image();
        img.onload = ()=> resolve({ w: img.width, h: img.height });
        img.src = imgs.overallImg;
      });
      let ovH = computeScaledHeight(ovLoad.w, ovLoad.h, pdfWidth - margin*2);
      const spaceLeft = pdfHeight - (tableH + 16) - 16;
      if (spaceLeft > 40) {
        if (ovH > spaceLeft) ovH = spaceLeft;
        doc.addImage(imgs.overallImg, 'PNG', margin, tableH + 12, pdfWidth - margin*2, ovH);
      } else {
        doc.addPage();
        doc.addImage(imgs.overallImg, 'PNG', margin, 12, pdfWidth - margin*2, ovH);
      }

      // Second page: quarters grid
      doc.addPage();
      doc.setFontSize(11);
      doc.text(`${datasetKeyToTitle(ds)} — Quarterly (Q1–Q4)`, margin, 12);
      const startY = 18;
      const gap = 6;
      const colWidth = (pdfWidth - margin*2 - gap) / 2;
      const rowHeight = (pdfHeight - startY - margin - gap) / 2;

      for (let i = 0; i < imgs.quarterImgs.length; i++) {
        const qi = imgs.quarterImgs[i];
        const imgLoad = await new Promise(resolve => {
          const img = new Image();
          img.onload = ()=> resolve({ w: img.width, h: img.height });
          img.src = qi.img;
        });
        const scale = Math.min(colWidth / imgLoad.w, rowHeight / imgLoad.h);
        const drawW = imgLoad.w * scale;
        const drawH = imgLoad.h * scale;
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = margin + col * (colWidth + gap) + (colWidth - drawW)/2;
        const y = startY + row * (rowHeight + gap) + (rowHeight - drawH)/2;
        doc.addImage(qi.img, 'PNG', x, y, drawW, drawH);
        doc.setFontSize(10);
        doc.text(`${qi.view}`, x + 4, y + 8);
      }
    }

    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 8, 287);
    doc.save(`CHED_Report_ALL_${new Date().toISOString().slice(0,10)}.pdf`);
  } catch (err) {
    console.error(err);
    alert('PDF export failed');
  } finally {
    loadingOverlay.style.display = 'none';
  }
}

/* ---------- Clear dataset / Refresh ---------- */
function clearCurrentDataset() {
  if (!confirm(`Remove all data from "${activeDataset.toUpperCase()}"?`)) return;
  entriesMap[activeDataset] = [];
  saveDataset(activeDataset);
  refreshAll();
}

function refreshAll() {
  loadDataset('ched'); loadDataset('research'); loadDataset('extension');
  if (!entriesMap[activeDataset]) activeDataset = 'ched';
  renderReportForDataset(activeDataset);
  renderDynamicChart(chartSelector.value || 'overall');
}

/* ---------- Dropdown UI ---------- */
const dropdownBtn = document.getElementById('dropdownBtn');
const dropdownMenu = document.getElementById('dropdownMenu');

function toggleDropdown() {
  const isVisible = dropdownMenu.style.display === 'block';
  dropdownMenu.style.display = isVisible ? 'none' : 'block';
  dropdownBtn.setAttribute('aria-expanded', (!isVisible).toString());
}
if (dropdownBtn) dropdownBtn.addEventListener('click', (e)=> { e.preventDefault(); toggleDropdown(); });
document.addEventListener('click', (e)=> {
  if (!dropdownBtn.contains(e.target) && !dropdownMenu.contains(e.target)) dropdownMenu.style.display = 'none';
});

/* ---------- Wiring ---------- */
if (datasetSelector) datasetSelector.addEventListener('change', (e)=>{
  activeDataset = e.target.value;
  if (manageOverlay.style.display === 'flex') manageDatasetName.innerText = activeDataset === 'ched' ? 'CHED Performance' : (activeDataset === 'research' ? 'Research Program' : 'Extension Services');
  toggleDenomFields('');
  renderReportForDataset(activeDataset);
  renderDynamicChart(chartSelector.value || 'overall');
});

if (chartSelector) chartSelector.addEventListener('change', e => renderDynamicChart(e.target.value));
if (downloadCurrentPDFBtn) document.getElementById('downloadCurrentPDF').addEventListener('click', e=>{ e.preventDefault(); toggleDropdown(); downloadCurrentPDF(); });
if (downloadAllPDFBtn) document.getElementById('downloadAllPDF').addEventListener('click', e=>{ e.preventDefault(); toggleDropdown(); downloadAllPDF(); });
if (clearDataBtn) clearDataBtn.addEventListener('click', clearCurrentDataset);
if (backBtn) backBtn.addEventListener('click', ()=> { window.location.href = 'pdo.html'; });

/* ---------- Init ---------- */
refreshAll();
