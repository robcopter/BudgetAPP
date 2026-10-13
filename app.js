'use strict';
/* Budget – en personlig budgetapp. All data sparas lokalt i telefonen (localStorage). */
(() => {
  // ================================================================
  // Hjälpfunktioner
  // ================================================================
  const KEY = 'budget-v1';
  const APP_VERSION = '1.1.0';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const nf0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const clean = (s) => s.replace(/[  ]/g, ' ').replace('-', '−');
  const fmt = (n) => clean(nf0.format(Math.round(n) || 0));
  const kr = (n) => fmt(n) + ' kr';
  const fmtTx = (n) => (n > 0 ? '+' : '') + clean(Number.isInteger(Math.round(n * 100) / 100) ? nf0.format(n) : nf2.format(n));

  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const DAYS = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayIso = () => iso(new Date());
  const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 86400000);
  const shortDate = (s) => { const d = fromIso(s); return d.getDate() + ' ' + SHORT[d.getMonth()]; };
  const ordinal = (n) => n + ((n % 10 === 1 || n % 10 === 2) && n % 100 !== 11 && n % 100 !== 12 ? ':a' : ':e');

  // ================================================================
  // Data
  // ================================================================
  const DEFAULT_CATS = [
    ['Mat & dryck', 4500], ['Boende', 8000], ['Nöje', 1200], ['Transport', 900],
    ['Hälsa & träning', 600], ['Kläder', 800], ['Övrigt', 500]
  ];
  const INCOME_CATS = ['Lön', 'Swish', 'Återbetalning', 'Övrig inkomst'];

  function defaults() {
    return {
      v: 1,
      settings: { theme: 'auto', monthStart: 1, mainGoalId: null, rules: {} },
      categories: [
        ...DEFAULT_CATS.map(([name, budget]) => ({ id: uid(), name, budget, kind: 'expense' })),
        ...INCOME_CATS.map((name) => ({ id: uid(), name, budget: 0, kind: 'income' }))
      ],
      transactions: [],
      goals: []
    };
  }

  let db;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : defaults();
    } catch (e) { db = defaults(); }
    const d = defaults();
    db.settings = Object.assign(d.settings, db.settings || {});
    db.categories = Array.isArray(db.categories) ? db.categories : d.categories;
    db.transactions = Array.isArray(db.transactions) ? db.transactions : [];
    db.goals = Array.isArray(db.goals) ? db.goals : [];
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('Kunde inte spara – lagringen är full eller blockerad'); }
  }

  const cat = (id) => db.categories.find((c) => c.id === id);
  const expenseCats = () => db.categories.filter((c) => c.kind === 'expense');
  const incomeCats = () => db.categories.filter((c) => c.kind === 'income');
  const shortName = (name) => name.replace(/[^A-Za-zÅÄÖåäöÉé]/g, '').slice(0, 2).toUpperCase() || '•';
  const txHash = (t) => t.date + '|' + String(t.text).trim().toLowerCase() + '|' + Number(t.amount).toFixed(2);

  // ================================================================
  // Perioder och beräkningar
  // ================================================================
  // En period börjar på inställd dag (1 = kalendermånad, 25 = lönedag osv.)
  function period(offset = 0, ref = todayIso()) {
    const start = db.settings.monthStart || 1;
    const r = fromIso(ref);
    let y = r.getFullYear(), m = r.getMonth();
    if (r.getDate() < start) m -= 1;
    m += offset;
    const s = new Date(y, m, Math.min(start, new Date(y, m + 1, 0).getDate()));
    const nx = new Date(y, m + 1, Math.min(start, new Date(y, m + 2, 0).getDate()));
    const e = new Date(nx); e.setDate(e.getDate() - 1);
    const sIso = iso(s), eIso = iso(e);
    let label, monthName;
    if (start === 1) { label = cap(MONTHS[s.getMonth()]) + ' ' + s.getFullYear(); monthName = MONTHS[s.getMonth()]; }
    else { label = s.getDate() + ' ' + SHORT[s.getMonth()] + ' – ' + e.getDate() + ' ' + SHORT[e.getMonth()]; monthName = 'perioden'; }
    return { start: sIso, end: eIso, label, monthName, days: daysBetween(sIso, eIso) + 1 };
  }
  const inPeriod = (d, p) => d >= p.start && d <= p.end;

  function stats(p) {
    const tx = db.transactions.filter((t) => inPeriod(t.date, p));
    const spentBy = {};
    let spent = 0, uncategorized = 0;
    for (const t of tx) {
      if (t.amount >= 0) continue;
      const c = cat(t.catId);
      if (c && c.kind === 'income') continue;
      spent += -t.amount;
      if (c) spentBy[c.id] = (spentBy[c.id] || 0) - t.amount;
      else uncategorized += -t.amount;
    }
    const budget = expenseCats().reduce((s, c) => s + (Number(c.budget) || 0), 0);
    return { tx, spentBy, spent, uncategorized, budget };
  }

  function daily() {
    const p = period(0);
    const today = todayIso();
    const st = stats(p);
    let before = 0, todaySpent = 0;
    for (const t of st.tx) {
      if (t.amount >= 0) continue;
      const c = cat(t.catId);
      if (c && c.kind === 'income') continue;
      if (t.date < today) before += -t.amount; else if (t.date === today) todaySpent += -t.amount;
    }
    const daysLeft = daysBetween(today, p.end) + 1;
    const allowance = Math.max(0, (st.budget - before) / daysLeft);
    return { p, st, daysLeft, allowance, todaySpent, left: allowance - todaySpent };
  }

  const goalSaved = (g) => g.deposits.reduce((s, d) => s + d.amount, 0);
  const goalDone = (g) => g.target > 0 && goalSaved(g) >= g.target;
  function mainGoal() {
    if (!db.goals.length) return null;
    return db.goals.find((g) => g.id === db.settings.mainGoalId) || db.goals.find((g) => !goalDone(g)) || db.goals[0];
  }
  function goalNeed(g) {
    if (!g.deadline) return null;
    const remaining = g.target - goalSaved(g);
    if (remaining <= 0) return null;
    const end = g.deadline.length === 7 ? iso(new Date(+g.deadline.slice(0, 4), +g.deadline.slice(5, 7), 0)) : g.deadline;
    const days = Math.max(1, daysBetween(todayIso(), end));
    return { perMonth: remaining / Math.max(1, days / 30.44), perDay: remaining / days, late: end < todayIso() };
  }
  function deadlineLabel(g) {
    if (!g.deadline) return '';
    const [y, m] = g.deadline.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + y;
  }

  // ================================================================
  // Automatisk kategorisering
  // ================================================================
  const KEYWORDS = {
    'Mat & dryck': ['ica', 'coop', 'willys', 'hemköp', 'hemkop', 'lidl', 'city gross', 'mathem', 'foodora', 'wolt', 'mcdonald', 'max burgers', 'burger king', 'pressbyrån', '7-eleven', 'espresso house', 'systembolaget', 'bageri', 'restaurang', 'pizzeria', 'sushi', 'cafe', 'café'],
    'Transport': ['sl ', 'västtrafik', 'vasttrafik', 'skånetrafiken', 'skanetrafiken', 'sj ', ' sj', 'uber', 'bolt', 'circle k', 'preem', 'okq8', 'st1', 'ingo', 'parkering', 'easypark', 'voi', 'tier', 'lime'],
    'Nöje': ['spotify', 'netflix', 'hbo', 'viaplay', 'disney', 'filmstaden', 'steam', 'playstation', 'xbox', 'nintendo', 'youtube', 'ticketmaster', 'tickster', 'bio '],
    'Hälsa & träning': ['apotek', 'apoteket', 'kronans', 'sats', 'friskis', 'nordic wellness', 'actic', 'gym', 'vårdcentral'],
    'Kläder': ['h&m', 'hm ', 'zara', 'zalando', 'lindex', 'kappahl', 'stadium', 'intersport', 'boozt', 'åhléns', 'ahlens', 'uniqlo'],
    'Boende': ['hyra', 'vattenfall', 'ellevio', 'tibber', 'eon', 'e.on', 'telia', 'tele2', 'comviq', 'telenor', 'tre ', 'bredband', 'bahnhof', 'försäkring', 'folksam', 'länsförsäkringar', 'trygg-hansa', 'ikea', 'bauhaus', 'clas ohlson']
  };
  const normText = (s) => String(s).toLowerCase().replace(/[0-9*#/\\\-.,:;_]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  function suggestCat(text, amount) {
    const rule = db.settings.rules[normText(text)];
    if (rule && cat(rule)) {
      const c = cat(rule);
      if ((amount < 0) === (c.kind === 'expense')) return c.id;
    }
    const t = ' ' + String(text).toLowerCase() + ' ';
    const byName = (n) => (db.categories.find((c) => c.name === n) || {}).id || null;
    if (amount > 0) {
      if (/\blön\b|\blon\b|salary/.test(t)) return byName('Lön');
      if (/swish/.test(t)) return byName('Swish');
      return null;
    }
    for (const [name, words] of Object.entries(KEYWORDS)) {
      if (words.some((w) => t.includes(w))) return byName(name);
    }
    return null;
  }
  function learn(text, catId) { if (catId) db.settings.rules[normText(text)] = catId; }

  // ================================================================
  // CSV
  // ================================================================
  function decodeFile(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
    let delim = ';', best = -1;
    for (const d of [';', ',', '\t']) {
      const counts = sample.map((l) => l.split(d).length - 1).sort((a, b) => a - b);
      const med = counts[Math.floor(counts.length / 2)] || 0;
      if (med > best) { best = med; delim = d; }
    }
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim()); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows.filter((r) => r.some((c) => c !== ''));
  }
  function parseDate(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return null;
  }
  function parseAmount(s) {
    s = String(s || '').replace(/[\s  ]|kr|sek/gi, '').replace(/[−–]/g, '-');
    if (!s || !/\d/.test(s) || /[^0-9.,+-]/.test(s)) return null;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc > -1) s = /,\d{3}$/.test(s) && (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const H_DATE = /^(transaktionsdag|transaktionsdatum|datum|bokföringsdag|bokforingsdag|bokföringsdatum|bokf|reskontradatum|valutadag|date)/i;
  const H_TEXT_PRIORITY = [/^rubrik/i, /beskrivning/i, /text/i, /specifikation/i, /meddelande/i, /description/i, /^transaktion$/i, /referens/i, /namn/i, /mottagare/i];
  const H_AMOUNT = /^(belopp|amount|summa|transaktionsbelopp)/i;
  function detectColumns(rows) {
    let header = -1;
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const r = rows[i];
      if (r.some((c) => H_DATE.test(c)) && r.some((c) => H_AMOUNT.test(c))) { header = i; break; }
    }
    const data = rows.slice(header + 1);
    const width = Math.max(...rows.map((r) => r.length));
    const names = Array.from({ length: width }, (_, i) => (header >= 0 && rows[header][i]) || 'Kolumn ' + String.fromCharCode(65 + i));
    const find = (re) => names.findIndex((n) => re.test(n));
    let dc = header >= 0 ? find(H_DATE) : -1;
    let ac = header >= 0 ? find(H_AMOUNT) : -1;
    let tc = -1;
    if (header >= 0) {
      for (const re of H_TEXT_PRIORITY) { tc = find(re); if (tc >= 0) break; }
    }
    const score = (fn, i) => data.slice(0, 50).filter((r) => fn(r[i])).length;
    const cols = [...Array(width).keys()];
    if (dc < 0) dc = cols.sort((a, b) => score(parseDate, b) - score(parseDate, a))[0];
    if (ac < 0) {
      const num = cols.filter((i) => i !== dc).map((i) => ({ i, s: score((v) => parseAmount(v) !== null, i), neg: score((v) => (parseAmount(v) || 0) < 0, i) }));
      num.sort((a, b) => (b.s + b.neg) - (a.s + a.neg));
      ac = num.length ? num[0].i : -1;
    }
    if (tc < 0) {
      const txt = cols.filter((i) => i !== dc && i !== ac).map((i) => ({ i, s: data.slice(0, 50).reduce((sum, r) => sum + (parseAmount(r[i]) === null && !parseDate(r[i]) ? String(r[i] || '').length : 0), 0) }));
      txt.sort((a, b) => b.s - a.s);
      tc = txt.length ? txt[0].i : -1;
    }
    return { header, names, map: { date: dc, text: tc, amount: ac } };
  }
  function buildImport(rows, header, map) {
    const existing = {};
    for (const t of db.transactions) { const h = t.hash || txHash(t); existing[h] = (existing[h] || 0) + 1; }
    const items = [];
    for (const r of rows.slice(header + 1)) {
      const date = parseDate(r[map.date]);
      const amount = parseAmount(r[map.amount]);
      const text = String(r[map.text] ?? '').trim() || 'Okänd';
      if (!date || amount === null || amount === 0) continue;
      const item = { date, text, amount, catId: suggestCat(text, amount) };
      item.hash = txHash(item);
      if (existing[item.hash]) { item.dup = true; existing[item.hash]--; }
      items.push(item);
    }
    items.sort((a, b) => (a.date < b.date ? 1 : -1));
    return items;
  }

  // ================================================================
  // Ikoner
  // ================================================================
  const svg = (inner, size = 24, sw = 1.8) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const I = {
    overview: svg('<path d="M6.3 18.9 A9 9 0 1 1 17.7 18.9"/><line x1="12" y1="12" x2="15.5" y2="8.5"/>'),
    budget: svg('<path d="M11.5 4.5 A8 8 0 1 0 19.5 12.5 H11.5 Z"/><path d="M14 3 A7.5 7.5 0 0 1 21 10 H14 Z"/>'),
    goals: svg('<path d="M5 11.66 A7.28 6.16 0 0 1 19.56 9.98 H21.24 V13.9 H19.22 A7.28 6.16 0 0 1 16.76 16.59 V19.5 H13.96 V17.71 H10.6 V19.5 H7.8 V16.36 A6.16 6.16 0 0 1 5 11.66 Z"/><line x1="10.6" y1="7.85" x2="13.96" y2="7.85"/><circle cx="16.42" cy="10.54" r="0.8" fill="currentColor" stroke="none"/><path d="M5.11 10.88 C3.43 10.88 3.07 9.42 3.97 8.64"/>'),
    import: svg('<path d="M12 4 V15"/><path d="M7.5 10.5 L12 15 L16.5 10.5"/><path d="M5 19 H19"/>'),
    gear: svg('<circle cx="12" cy="12" r="3.2"/><line x1="12" y1="2.5" x2="12" y2="5.5"/><line x1="12" y1="18.5" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5.5" y2="12"/><line x1="18.5" y1="12" x2="21.5" y2="12"/><line x1="5.3" y1="5.3" x2="7.4" y2="7.4"/><line x1="16.6" y1="16.6" x2="18.7" y2="18.7"/><line x1="5.3" y1="18.7" x2="7.4" y2="16.6"/><line x1="16.6" y1="7.4" x2="18.7" y2="5.3"/>', 20),
    plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 20, 2),
    left: svg('<path d="M15 5 L8 12 L15 19"/>', 18, 2),
    right: svg('<path d="M9 5 L16 12 L9 19"/>', 18, 2),
    chev: svg('<path d="M9 5 L16 12 L9 19"/>', 16, 2),
    file: svg('<path d="M14 3 H7 a2 2 0 0 0 -2 2 V19 a2 2 0 0 0 2 2 H17 a2 2 0 0 0 2 -2 V8 Z"/><path d="M14 3 V8 H19"/>', 20),
    check: svg('<path d="M5 12.5 L10 17.5 L19 7"/>', 12, 3)
  };

  // ================================================================
  // UI-tillstånd
  // ================================================================
  const ui = {
    budgetOffset: 0,
    importMode: 'csv',
    csv: null, // { fileName, rows, header, names, map, items }
    manual: null,
    cal: null
  };
  function resetManual() {
    ui.manual = { type: 'expense', amount: '', desc: '', catId: null, date: todayIso() };
  }
  resetManual();

  const ROUTES = ['oversikt', 'budget', 'sparmal', 'import', 'installningar'];
  const route = () => { const r = location.hash.replace(/^#\/?/, ''); return ROUTES.includes(r) ? r : 'oversikt'; };

  // ================================================================
  // Skärmar
  // ================================================================
  function bar(pct, cls = '', thin = false) {
    return `<div class="bar${thin ? ' thin' : ''}"><i class="${cls}" style="width:${clamp(pct, 0, 100).toFixed(1)}%"></i></div>`;
  }

  function txRow(t) {
    const c = cat(t.catId);
    return `<button class="row" data-act="editTx" data-id="${t.id}">
      <div class="grow">
        <div class="line1"><span class="title">${esc(t.text)}</span><span class="amt">${fmtTx(t.amount)}</span></div>
        <div class="meta"><span>${shortDate(t.date)}</span>${c ? `<span class="tag">${esc(c.name)}</span>` : '<span class="tag warn">Välj kategori</span>'}</div>
      </div></button>`;
  }

  function screenOverview() {
    const d = daily();
    const now = new Date();
    const hasBudget = d.st.budget > 0;
    const pct = d.allowance > 0 ? clamp(d.left / d.allowance, 0, 1) : 0;
    const arc = (pct * Math.PI * 100).toFixed(1);
    const leftMonth = d.st.budget - d.st.spent;
    const savedNow = db.goals.reduce((s, g) => s + g.deposits.filter((x) => !x.initial && inPeriod(x.date, d.p)).reduce((a, x) => a + x.amount, 0), 0);
    const cats = expenseCats()
      .map((c) => ({ c, used: d.st.spentBy[c.id] || 0 }))
      .sort((a, b) => (b.used - a.used) || (b.c.budget - a.c.budget))
      .slice(0, 4);
    const recent = [...db.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 5);
    return `<div class="screen">
      <div class="head">
        <div class="titles">
          <span class="overline">${DAYS[now.getDay()]} ${now.getDate()} ${SHORT[now.getMonth()]}</span>
          <h1>${esc(db.settings.monthStart === 1 ? cap(d.p.monthName) : 'Denna period')}</h1>
        </div>
        <div class="actions">
          <a class="icon-btn" href="#/installningar" aria-label="Inställningar">${I.gear}</a>
          <button class="icon-btn primary" data-act="quickAdd" aria-label="Lägg till utgift">${I.plus}</button>
        </div>
      </div>

      <section class="hero" aria-label="Daglig balans" style="align-items:center;gap:4px">
        <span class="overline" style="align-self:flex-start">Kvar att spendera idag</span>
        <div class="gauge">
          <svg role="img" aria-label="${Math.round(pct * 100)} procent av dagsbudgeten kvar" width="240" height="132" viewBox="0 0 240 132" fill="none">
            <path d="M20 120 A100 100 0 0 1 220 120" stroke="var(--hero-track)" stroke-width="16" stroke-linecap="round"/>
            <path d="M20 120 A100 100 0 0 1 220 120" stroke="var(--accent)" stroke-width="16" stroke-linecap="round" stroke-dasharray="${arc} 400" ${pct <= 0 ? 'opacity="0"' : ''}/>
          </svg>
          <div class="gauge-text">
            <span class="big${d.left < 0 ? ' neg' : ''}">${kr(d.left)}</span>
            <span class="sub">${hasBudget ? 'av ' + kr(d.allowance) : 'Ingen budget satt'}</span>
          </div>
        </div>
        <div class="hero-foot" style="align-self:stretch;margin-top:14px">
          <span>Dagsbudget ${kr(d.allowance)}</span>
          <span>${d.daysLeft} ${d.daysLeft === 1 ? 'dag' : 'dagar'} kvar</span>
        </div>
      </section>

      <div class="grid2">
        <div class="card"><span class="label">Kvar ${db.settings.monthStart === 1 ? 'i månaden' : 'i perioden'}</span><span class="value" style="${leftMonth < 0 ? 'color:var(--over)' : ''}">${kr(leftMonth)}</span></div>
        <div class="card"><span class="label">Sparat i ${esc(d.p.monthName)}</span><span class="value">${kr(savedNow)}</span></div>
      </div>

      <section aria-label="Kategorier" style="display:flex;flex-direction:column;gap:14px">
        <div class="section-head"><h2>Kategorier</h2><a class="link" href="#/budget">Visa alla</a></div>
        ${cats.map(({ c, used }) => {
          const over = c.budget > 0 && used > c.budget;
          return `<button class="cat-mini" data-act="openCat" data-id="${c.id}">
            <div class="top"><span class="name">${esc(c.name)}</span><span class="amt ${over ? 'over' : 'muted'}">${fmt(used)} / ${fmt(c.budget)} kr</span></div>
            ${bar(c.budget > 0 ? used / c.budget * 100 : 0, over ? 'over' : '')}
          </button>`;
        }).join('')}
      </section>

      <section aria-label="Senaste transaktioner" style="display:flex;flex-direction:column;gap:10px">
        <h2>Senaste</h2>
        ${recent.length ? `<div class="list">${recent.map(txRow).join('')}</div>`
          : `<div class="list"><p class="empty">Inga transaktioner än. Importera från banken eller lägg till manuellt.</p></div>`}
      </section>
    </div>`;
  }

  function screenBudget() {
    const p = period(ui.budgetOffset);
    const st = stats(p);
    const today = todayIso();
    const elapsed = today > p.end ? 100 : today < p.start ? 0 : (daysBetween(p.start, today) + 1) / p.days * 100;
    const pct = st.budget > 0 ? st.spent / st.budget * 100 : 0;
    const rows = expenseCats().map((c) => {
      const used = st.spentBy[c.id] || 0;
      const diff = c.budget - used;
      const over = diff < 0;
      return `<button class="row" data-act="openCat" data-id="${c.id}">
        <span class="badge">${esc(shortName(c.name))}</span>
        <div class="grow">
          <div class="line1"><span class="title">${esc(c.name)}</span><span class="amt ${over ? 'over' : ''}">${over ? '−' + fmt(-diff) + ' kr' : fmt(diff) + ' kr kvar'}</span></div>
          ${bar(c.budget > 0 ? used / c.budget * 100 : (used > 0 ? 100 : 0), over ? 'over' : '', true)}
        </div></button>`;
    });
    if (st.uncategorized > 0) {
      rows.push(`<button class="row" data-act="openCat" data-id="">
        <span class="badge">?</span>
        <div class="grow"><div class="line1"><span class="title">Okategoriserat</span><span class="amt">${kr(st.uncategorized)}</span></div>
        <span class="meta">Tryck för att välja kategori</span></div></button>`);
    }
    return `<div class="screen">
      <div class="head">
        <button class="icon-btn" data-act="budgetPrev" aria-label="Föregående månad">${I.left}</button>
        <div class="head-center"><span class="overline">Månadsbudget</span><h1 class="small">${esc(p.label)}</h1></div>
        <button class="icon-btn" data-act="budgetNext" aria-label="Nästa månad" ${ui.budgetOffset >= 1 ? 'disabled' : ''}>${I.right}</button>
      </div>
      <section class="hero" aria-label="Summering">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px">
          <div style="display:flex;flex-direction:column;gap:4px">
            <span style="font-size:13px;color:var(--hero-muted)">Använt</span>
            <span style="font-size:32px;font-weight:600;letter-spacing:-.03em;line-height:1;${st.spent > st.budget && st.budget > 0 ? 'color:#FF7A5C' : ''}">${kr(st.spent)}</span>
          </div>
          <span style="font-size:13px;color:var(--hero-soft)">av ${kr(st.budget)}</span>
        </div>
        ${bar(pct)}
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--hero-soft)">
          <span>${Math.round(pct)} % av budget</span><span>${Math.round(elapsed)} % av ${db.settings.monthStart === 1 ? 'månaden' : 'perioden'}</span>
        </div>
      </section>
      <section class="list" aria-label="Kategorier">${rows.join('') || '<p class="empty">Inga kategorier.</p>'}</section>
      <button class="btn push-bottom" data-act="newCat">+ Ny kategori</button>
    </div>`;
  }

  function screenGoals() {
    const total = db.goals.reduce((s, g) => s + goalSaved(g), 0);
    const main = mainGoal();
    const others = db.goals.filter((g) => g !== main);
    let hero = '';
    if (main) {
      const saved = goalSaved(main);
      const done = goalDone(main);
      const pct = main.target > 0 ? clamp(saved / main.target, 0, 1) : 0;
      const circ = 2 * Math.PI * 38;
      const today = todayIso();
      const series = [];
      for (let i = 29; i >= 0; i--) {
        const day = addDays(today, -i);
        series.push(main.deposits.filter((x) => x.initial || x.date <= day).reduce((s, x) => s + x.amount, 0));
      }
      const min = Math.min(...series), max = Math.max(...series);
      const before = main.deposits.filter((x) => x.initial || x.date <= addDays(today, -30)).reduce((s, x) => s + x.amount, 0);
      const delta = series[29] - before;
      const bars = series.map((v) => `<i style="height:${max > min ? Math.round(10 + (v - min) / (max - min) * 50) : (v > 0 ? 40 : 6)}px"></i>`).join('');
      const need = goalNeed(main);
      hero = `<section class="hero" aria-label="Huvudmål">
        <div class="goal-top">
          <div class="t">
            <span class="overline">${esc(main.name)}</span>
            <span class="goal-amount${done ? ' done' : ''}">${kr(saved)}</span>
            <span style="font-size:13px;color:var(--hero-soft)">av ${kr(main.target)}${main.deadline ? ' · mål ' + deadlineLabel(main) : ''}</span>
          </div>
          <div class="ring">
            <svg role="img" aria-label="${Math.round(pct * 100)} procent av målet" width="92" height="92" viewBox="0 0 92 92" fill="none">
              <circle cx="46" cy="46" r="38" stroke="var(--hero-track)" stroke-width="10"/>
              <circle cx="46" cy="46" r="38" stroke="${done ? 'var(--good-on-hero)' : 'var(--accent)'}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(pct * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 46 46)" ${pct <= 0 ? 'opacity="0"' : ''}/>
            </svg>
            <span>${Math.round(pct * 100)} %</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--hero-muted)"><span>Utveckling, 30 dagar</span><span style="color:var(--on-hero)">${delta >= 0 ? '+' : ''}${kr(delta)}</span></div>
          <div class="spark" role="img" aria-label="Sparat belopp de senaste 30 dagarna">${bars}</div>
        </div>
        <div class="hero-foot">
          ${done ? '<span style="color:var(--good-on-hero)">Målet är nått!</span><span></span>'
            : need ? `<span>${need.late ? 'Datumet har passerat' : 'Behöver ' + kr(need.perMonth) + '/mån'}</span><span>${need.late ? kr(main.target - saved) + ' kvar' : '≈ ' + kr(need.perDay) + '/dag'}</span>`
            : `<span>${kr(Math.max(0, main.target - saved))} kvar</span><span></span>`}
        </div>
        <div class="pills" style="display:flex;gap:8px">
          <button class="pill" data-act="deposit" data-id="${main.id}" style="flex:1;height:44px">Sätt in</button>
          <button class="pill" data-act="openGoal" data-id="${main.id}" style="flex:1;height:44px">Hantera</button>
        </div>
      </section>`;
    }
    const cards = others.map((g) => {
      const saved = goalSaved(g), done = goalDone(g);
      return `<button class="goal-card" data-act="openGoal" data-id="${g.id}">
        <div class="top">
          <span class="name">${esc(g.name)}${done ? `<span class="tag good">${I.check}Uppnått</span>` : ''}</span>
          <span class="amt ${done ? 'good' : 'muted'}">${fmt(saved)} / ${fmt(g.target)} kr</span>
        </div>
        ${bar(g.target > 0 ? saved / g.target * 100 : 0, done ? 'good' : '')}
      </button>`;
    }).join('');
    return `<div class="screen">
      <div class="titles"><span class="overline">Totalt sparat ${kr(total)}</span><h1>Sparmål</h1></div>
      ${hero || `<div class="list"><p class="empty">Inga sparmål än. Skapa ditt första – till exempel en buffert eller en resa.</p></div>`}
      ${others.length ? `<section style="display:flex;flex-direction:column;gap:10px" aria-label="Fler mål"><h2>Fler mål</h2>${cards}</section>` : ''}
      <button class="btn push-bottom" data-act="newGoal">+ Nytt sparmål</button>
    </div>`;
  }

  function screenImport() {
    const seg = `<div class="seg" role="group" aria-label="Källa">
      <button aria-pressed="${ui.importMode === 'csv'}" data-act="mode" data-mode="csv">CSV från banken</button>
      <button aria-pressed="${ui.importMode === 'manual'}" data-act="mode" data-mode="manual">Manuellt</button>
    </div>`;
    const head = `<div class="titles"><span class="overline">Lägg till transaktioner</span><h1>Importera</h1></div>`;
    return `<div class="screen">${head}${seg}${ui.importMode === 'csv' ? csvView() : manualView()}</div>`;
  }

  function csvView() {
    const fileInput = `<input id="csv-file" class="sr-only" type="file" accept=".csv,.txt,text/csv,text/plain" data-change="csvFile">`;
    if (!ui.csv) {
      return `${fileInput}
        <label class="drop" for="csv-file">
          ${svg('<path d="M14 3 H7 a2 2 0 0 0 -2 2 V19 a2 2 0 0 0 2 2 H17 a2 2 0 0 0 2 -2 V8 Z"/><path d="M14 3 V8 H19"/><path d="M12 11 V17"/><path d="M9.5 14.5 L12 17 L14.5 14.5"/>', 28)}
          <b>Välj CSV-fil</b>
          <span>Exportera kontohändelser från internetbanken, spara filen i Filer och välj den här.</span>
        </label>
        <div class="card" style="gap:8px">
          <span class="label">Så funkar det</span>
          <span style="font-size:14px">Appen hittar datum, text och belopp själv och föreslår kategorier. Rader som redan finns hoppas över, så du kan importera samma fil flera gånger.</span>
        </div>`;
    }
    const c = ui.csv;
    const items = c.items;
    const fresh = items.filter((i) => !i.dup);
    const missing = fresh.filter((i) => !i.catId).length;
    const dates = items.map((i) => i.date).sort();
    const opt = (sel) => c.names.map((n, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const catOpts = (it) => {
      const list = it.amount < 0 ? expenseCats() : incomeCats();
      return `<option value="">Välj kategori</option>` + list.map((x) => `<option value="${x.id}" ${x.id === it.catId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    };
    const shown = items.slice(0, 150);
    return `${fileInput}
      <div class="file-card">
        <div class="ic">${I.file}</div>
        <div class="t"><b>${esc(c.fileName)}</b><span>${items.length} rader${dates.length ? ' · ' + shortDate(dates[0]) + '–' + shortDate(dates[dates.length - 1]) : ''}</span></div>
        <label class="btn-ghost" for="csv-file" style="display:flex;align-items:center">Byt fil</label>
      </div>
      <div class="card" style="gap:10px">
        <span class="label">Kolumner</span>
        <div class="map-grid">
          <label>Datum<select data-change="map" data-key="date">${opt(c.map.date)}</select></label>
          <label>Text<select data-change="map" data-key="text">${opt(c.map.text)}</select></label>
          <label>Belopp<select data-change="map" data-key="amount">${opt(c.map.amount)}</select></label>
        </div>
      </div>
      <section style="display:flex;flex-direction:column;gap:10px" aria-label="Förhandsvisning">
        <div class="section-head"><h2>Förhandsvisning</h2><span class="muted" style="font-size:13px">${missing ? missing + ' behöver kategori' : 'Allt kategoriserat'}</span></div>
        ${items.length ? `<div class="list">${shown.map((it, idx) => `
          <div class="row${it.dup ? ' dup' : ''}">
            <div class="grow">
              <div class="line1"><span class="title">${esc(it.text)}</span><span class="amt">${fmtTx(it.amount)}</span></div>
              <div class="meta"><span>${shortDate(it.date)}</span>
                ${it.dup ? '<span class="tag">Finns redan</span>' : `<select class="cat-select${it.catId ? '' : ' warn'}" data-change="itemCat" data-idx="${idx}" aria-label="Kategori för ${esc(it.text)}">${catOpts(it)}</select>`}
              </div>
            </div>
          </div>`).join('')}
          ${items.length > shown.length ? `<p class="empty">+ ${items.length - shown.length} rader till</p>` : ''}</div>`
          : '<div class="list"><p class="empty">Hittade inga transaktioner. Prova att byta kolumner ovan.</p></div>'}
      </section>
      <div style="display:flex;flex-direction:column;gap:10px" class="push-bottom">
        <button class="btn" data-act="doImport" ${fresh.length ? '' : 'disabled'}>${fresh.length ? 'Importera ' + fresh.length + ' transaktioner' : 'Inget nytt att importera'}</button>
        <button class="btn secondary" data-act="cancelCsv">Avbryt</button>
      </div>`;
  }

  function manualView() {
    const m = ui.manual;
    const isInc = m.type === 'income';
    const list = isInc ? incomeCats() : expenseCats();
    if (!m.catId || !list.some((c) => c.id === m.catId)) m.catId = null;
    const today = todayIso(), yest = addDays(today, -1);
    const custom = m.date !== today && m.date !== yest;
    return `
      <section class="hero" aria-label="Belopp" style="padding:16px 20px 22px">
        <div class="pills" role="group" aria-label="Typ">
          <button class="pill" aria-pressed="${!isInc}" data-act="mType" data-type="expense">Utgift</button>
          <button class="pill" aria-pressed="${isInc}" data-act="mType" data-type="income">Inkomst</button>
        </div>
        <label for="m-amount" class="overline">Belopp</label>
        <div class="amount-row">
          <span class="sign${isInc ? ' plus' : ''}" aria-hidden="true">${isInc ? '+' : '−'}</span>
          <input id="m-amount" class="amount-input" inputmode="decimal" placeholder="0" autocomplete="off" value="${esc(m.amount)}" data-input="mAmount">
          <span class="kr">kr</span>
        </div>
      </section>
      <div class="field">
        <label for="m-desc">Beskrivning</label>
        <input id="m-desc" class="input" placeholder="T.ex. ICA, bio, gymkort" autocomplete="off" value="${esc(m.desc)}" data-input="mDesc">
      </div>
      <div class="field" role="group" aria-labelledby="m-cat-l">
        <span class="label" id="m-cat-l">Kategori</span>
        <div class="chips scroll">${list.map((c) => `<button class="chip" aria-pressed="${m.catId === c.id}" data-act="mCat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      </div>
      <div class="field" role="group" aria-labelledby="m-date-l">
        <span class="label" id="m-date-l">Datum</span>
        <div class="chips three">
          <button class="chip" aria-pressed="${m.date === today}" data-act="mDate" data-d="${today}">Idag</button>
          <button class="chip" aria-pressed="${m.date === yest}" data-act="mDate" data-d="${yest}">Igår</button>
          <button class="chip" aria-pressed="${custom}" data-act="openCal">${custom ? shortDate(m.date) : 'Välj datum'}</button>
        </div>
      </div>
      <button class="btn push-bottom" data-act="mSave">${isInc ? 'Lägg till inkomst' : 'Lägg till utgift'}</button>`;
  }

  function screenSettings() {
    const t = db.settings.theme;
    const effDark = document.documentElement.dataset.theme === 'dark';
    const startOpts = Array.from({ length: 28 }, (_, i) => i + 1)
      .map((n) => `<option value="${n}" ${n === db.settings.monthStart ? 'selected' : ''}>${n === 1 ? '1:a (kalendermånad)' : ordinal(n)}</option>`).join('');
    return `<div class="screen">
      <div style="display:flex;flex-direction:column;gap:10px">
        <a href="#/oversikt" class="link" style="display:flex;align-items:center;gap:4px;height:44px;margin-left:-6px;align-self:flex-start">${svg('<path d="M15 5 L8 12 L15 19"/>', 20, 2)}Översikt</a>
        <h1>Inställningar</h1>
      </div>
      <div class="group-title">Utseende</div>
      <div class="list">
        <div class="setting"><div class="txt"><b id="s-dark">Nattläge</b><span>Gäller hela appen</span></div>
          <button class="switch" role="switch" aria-checked="${effDark}" aria-labelledby="s-dark" data-act="toggleDark"></button></div>
        <div class="setting"><div class="txt"><b id="s-auto">Följ iPhones utseende</b><span>Byter automatiskt med telefonen</span></div>
          <button class="switch" role="switch" aria-checked="${t === 'auto'}" aria-labelledby="s-auto" data-act="toggleAuto"></button></div>
      </div>
      <div class="group-title">Budget</div>
      <div class="list">
        <label class="setting"><div class="txt"><b>Månaden börjar</b><span>Välj din lönedag om du budgeterar lön till lön</span></div>
          <select data-change="monthStart" aria-label="Månaden börjar">${startOpts}</select></label>
        <button class="setting" data-act="reminder"><div class="txt"><b>Månatlig påminnelse</b><span>Lägg in en återkommande händelse i kalendern</span></div><span class="chev">${I.chev}</span></button>
      </div>
      <div class="group-title">Data</div>
      <div class="list">
        <a class="setting" href="#/import" style="text-decoration:none"><div class="txt"><b>Importera från banken</b></div><span class="chev">${I.chev}</span></a>
        <button class="setting" data-act="exportCsv"><div class="txt"><b>Exportera som CSV</b><span>Alla transaktioner</span></div><span class="chev">${I.chev}</span></button>
        <button class="setting" data-act="backup"><div class="txt"><b>Säkerhetskopiera</b><span>Sparar allt i en fil du kan lägga i iCloud Drive</span></div><span class="chev">${I.chev}</span></button>
        <label class="setting" for="restore-file" style="cursor:pointer"><div class="txt"><b>Återställ säkerhetskopia</b></div><span class="chev">${I.chev}</span></label>
        <button class="setting" data-act="wipe"><div class="txt"><b style="color:var(--over)">Radera all data</b></div></button>
      </div>
      <input id="restore-file" class="sr-only" type="file" accept=".json,application/json" data-change="restore">
      <p class="muted" style="font-size:12px;text-align:center;margin:8px 0 0">Budget ${APP_VERSION} · Datan sparas bara på den här enheten.</p>
    </div>`;
  }

  // ================================================================
  // Rendering
  // ================================================================
  let lastRoute = null;
  function render() {
    const r = route();
    const screens = { oversikt: screenOverview, budget: screenBudget, sparmal: screenGoals, import: screenImport, installningar: screenSettings };
    $('#app').innerHTML = screens[r]();
    const active = r === 'installningar' ? 'oversikt' : r;
    const tabs = [['oversikt', 'Översikt', I.overview], ['budget', 'Budget', I.budget], ['sparmal', 'Sparmål', I.goals], ['import', 'Import', I.import]];
    $('#tabbar').innerHTML = tabs.map(([id, label, icon]) =>
      `<a class="tab" href="#/${id}" ${id === active ? 'aria-current="page"' : ''}>${icon}${label}</a>`).join('');
    if (r !== lastRoute) { window.scrollTo(0, 0); lastRoute = r; }
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ---------- Bottenark ----------
  function openSheet(html, label) {
    const open = $('#sheet-root .sheet');
    if (open) { // Byt innehåll utan att animera om arket
      open.setAttribute('aria-label', label || '');
      open.innerHTML = '<div class="grabber" aria-hidden="true"></div>' + html;
      return;
    }
    $('#sheet-root').innerHTML = `<div class="sheet-wrap">
      <button class="sheet-backdrop" data-act="closeSheet" aria-label="Stäng"></button>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label || '')}"><div class="grabber" aria-hidden="true"></div>${html}</section>
    </div>`;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('#sheet-root').innerHTML = '';
    document.body.style.overflow = '';
    ui.cal = null; ui.confirmFn = null;
  }
  const field = (id, label, input) => `<div class="field"><label for="${id}">${label}</label>${input}</div>`;
  const val = (id) => ($('#' + id) || {}).value || '';

  function catOptions(kind, selected) {
    const list = kind === 'income' ? incomeCats() : expenseCats();
    return `<option value="">Ingen kategori</option>` + list.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  function txSheet(id) {
    const t = db.transactions.find((x) => x.id === id);
    if (!t) return;
    openSheet(`<h2>Transaktion</h2>
      ${field('t-text', 'Beskrivning', `<input id="t-text" class="input" value="${esc(t.text)}">`)}
      <div class="grid2">
        ${field('t-amount', 'Belopp (minus = utgift)', `<input id="t-amount" class="input" inputmode="decimal" value="${esc(String(t.amount).replace('.', ','))}">`)}
        ${field('t-date', 'Datum', `<input id="t-date" class="input" type="date" value="${t.date}">`)}
      </div>
      ${field('t-cat', 'Kategori', `<select id="t-cat" class="input">${catOptions(t.amount < 0 ? 'expense' : 'income', t.catId)}</select>`)}
      <div class="btn-row"><button class="btn danger" data-act="deleteTx" data-id="${t.id}">Ta bort</button><button class="btn" data-act="saveTx" data-id="${t.id}">Spara</button></div>`, 'Transaktion');
  }

  function catSheet(id) {
    const p = period(route() === 'budget' ? ui.budgetOffset : 0);
    const c = id ? cat(id) : null;
    const tx = db.transactions
      .filter((t) => inPeriod(t.date, p) && (c ? t.catId === c.id : (!cat(t.catId) && t.amount < 0)))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const list = tx.length ? `<div class="list" style="background:var(--bg)">${tx.map(txRow).join('')}</div>` : '<p class="empty">Inga transaktioner i ' + esc(p.label.toLowerCase()) + '.</p>';
    if (!c) {
      openSheet(`<h2>Okategoriserat</h2><p class="muted" style="margin:0;font-size:14px">Tryck på en rad för att välja kategori.</p>${list}
        <button class="btn secondary" data-act="closeSheet">Stäng</button>`, 'Okategoriserat');
      return;
    }
    openSheet(`<h2>${esc(c.name)}</h2>
      <div class="grid2">
        ${field('c-name', 'Namn', `<input id="c-name" class="input" value="${esc(c.name)}">`)}
        ${field('c-budget', 'Budget per månad (kr)', `<input id="c-budget" class="input" inputmode="numeric" value="${esc(c.budget)}">`)}
      </div>
      <div class="section-head"><h2 style="font-size:15px">${esc(p.label)}</h2><span class="amt muted">${kr(tx.reduce((s, t) => s - t.amount, 0))}</span></div>
      ${list}
      <div class="btn-row"><button class="btn danger" data-act="deleteCat" data-id="${c.id}">Ta bort</button><button class="btn" data-act="saveCat" data-id="${c.id}">Spara</button></div>`, c.name);
  }

  function newCatSheet() {
    openSheet(`<h2>Ny kategori</h2>
      ${field('c-name', 'Namn', '<input id="c-name" class="input" placeholder="T.ex. Resor">')}
      ${field('c-budget', 'Budget per månad (kr)', '<input id="c-budget" class="input" inputmode="numeric" placeholder="0">')}
      <div class="btn-row"><button class="btn secondary" data-act="closeSheet">Avbryt</button><button class="btn" data-act="saveCat">Skapa</button></div>`, 'Ny kategori');
  }

  function goalForm(g) {
    return `${field('g-name', 'Namn', `<input id="g-name" class="input" value="${esc(g ? g.name : '')}" placeholder="T.ex. Resa till Japan">`)}
      <div class="grid2">
        ${field('g-target', 'Mål (kr)', `<input id="g-target" class="input" inputmode="numeric" value="${g ? esc(g.target) : ''}" placeholder="0">`)}
        ${field('g-deadline', 'Klart senast (valfritt)', `<input id="g-deadline" class="input" type="month" value="${g && g.deadline ? esc(g.deadline.slice(0, 7)) : ''}">`)}
      </div>`;
  }
  function newGoalSheet() {
    openSheet(`<h2>Nytt sparmål</h2>${goalForm(null)}
      ${field('g-start', 'Redan sparat (valfritt)', '<input id="g-start" class="input" inputmode="numeric" placeholder="0">')}
      <div class="btn-row"><button class="btn secondary" data-act="closeSheet">Avbryt</button><button class="btn" data-act="createGoal">Skapa</button></div>`, 'Nytt sparmål');
  }
  function goalSheet(id) {
    const g = db.goals.find((x) => x.id === id);
    if (!g) return;
    const isMain = mainGoal() === g;
    const history = [...g.deposits].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
    openSheet(`<h2>${esc(g.name)}</h2>
      <p class="muted" style="margin:0;font-size:14px">${kr(goalSaved(g))} av ${kr(g.target)} sparat</p>
      <button class="btn" data-act="deposit" data-id="${g.id}">Sätt in eller ta ut</button>
      ${goalForm(g)}
      ${isMain ? '' : `<button class="btn secondary" data-act="makeMain" data-id="${g.id}">Visa som huvudmål</button>`}
      ${history.length ? `<div class="section-head"><h2 style="font-size:15px">Senaste insättningar</h2></div>
        <div class="list" style="background:var(--bg)">${history.map((x) => `<div class="row"><div class="grow"><div class="line1"><span class="title">${shortDate(x.date)}</span><span class="amt">${fmtTx(x.amount)}</span></div></div><button class="link" data-act="delDeposit" data-id="${g.id}" data-dep="${x.id}" aria-label="Ta bort insättning ${shortDate(x.date)}" style="padding:12px 0 12px 8px">Ta bort</button></div>`).join('')}</div>` : ''}
      <div class="btn-row"><button class="btn danger" data-act="deleteGoal" data-id="${g.id}">Ta bort mål</button><button class="btn" data-act="saveGoal" data-id="${g.id}">Spara</button></div>`, g.name);
  }
  function depositSheet(id) {
    const g = db.goals.find((x) => x.id === id);
    if (!g) return;
    openSheet(`<h2>${esc(g.name)}</h2>
      ${field('d-amount', 'Belopp (kr)', '<input id="d-amount" class="input" inputmode="decimal" placeholder="0">')}
      ${field('d-date', 'Datum', `<input id="d-date" class="input" type="date" value="${todayIso()}" max="${todayIso()}">`)}
      <div class="btn-row"><button class="btn secondary" data-act="doDeposit" data-id="${g.id}" data-sign="-1">Ta ut</button><button class="btn" data-act="doDeposit" data-id="${g.id}" data-sign="1">Sätt in</button></div>`, 'Sätt in');
  }
  function confirmSheet(title, text, okLabel, onOk) {
    ui.confirmFn = onOk;
    openSheet(`<h2>${esc(title)}</h2><p class="muted" style="margin:0;font-size:14px">${esc(text)}</p>
      <div class="btn-row"><button class="btn secondary" data-act="closeSheet">Avbryt</button><button class="btn" style="background:var(--over);color:#fff" data-act="confirmOk">${esc(okLabel)}</button></div>`, title);
  }

  // ---------- Kalender ----------
  function calSheet() {
    const c = ui.cal;
    const today = todayIso();
    const { y, m } = c.view;
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const dim = new Date(y, m + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<span aria-hidden="true"></span>';
    for (let d = 1; d <= dim; d++) {
      const ds = y + '-' + pad(m + 1) + '-' + pad(d);
      const future = ds > today;
      cells += `<button class="${ds === today ? 'today' : ''}" aria-pressed="${ds === c.pend}" aria-label="${d} ${MONTHS[m]}${ds === today ? ', idag' : ''}" data-act="calDay" data-d="${ds}" ${future ? 'disabled' : ''}>${d}</button>`;
    }
    const atCurrent = y === new Date().getFullYear() && m === new Date().getMonth();
    const pendLabel = c.pend === today ? 'idag' : shortDate(c.pend);
    openSheet(`<div class="cal-head">
        <button class="icon-btn" data-act="calMove" data-dir="-1" aria-label="Föregående månad">${I.left}</button>
        <h3>${cap(MONTHS[m])} ${y}</h3>
        <button class="icon-btn" data-act="calMove" data-dir="1" aria-label="Nästa månad" ${atCurrent ? 'disabled' : ''}>${I.right}</button>
      </div>
      <div class="cal-week" aria-hidden="true"><span>M</span><span>T</span><span>O</span><span>T</span><span>F</span><span>L</span><span>S</span></div>
      <div class="cal-grid">${cells}</div>
      <div class="btn-row"><button class="btn secondary" data-act="closeSheet">Avbryt</button><button class="btn" data-act="calOk">Välj ${pendLabel}</button></div>`, 'Välj datum');
  }

  // ================================================================
  // Händelser
  // ================================================================
  const actions = {
    closeSheet,
    quickAdd() { ui.importMode = 'manual'; location.hash = '#/import'; render(); },
    editTx(el) { txSheet(el.dataset.id); },
    saveTx(el) {
      const t = db.transactions.find((x) => x.id === el.dataset.id);
      const amount = parseAmount(val('t-amount'));
      if (amount === null || amount === 0) return toast('Ange ett belopp');
      t.text = val('t-text').trim() || t.text;
      t.amount = amount;
      t.date = val('t-date') || t.date;
      const c = cat(val('t-cat'));
      t.catId = c && ((amount < 0) === (c.kind === 'expense')) ? c.id : null;
      t.hash = txHash(t);
      learn(t.text, t.catId);
      save(); closeSheet(); render(); toast('Sparat');
    },
    deleteTx(el) {
      db.transactions = db.transactions.filter((x) => x.id !== el.dataset.id);
      save(); closeSheet(); render(); toast('Transaktionen togs bort');
    },
    budgetPrev() { ui.budgetOffset--; render(); },
    budgetNext() { if (ui.budgetOffset < 1) { ui.budgetOffset++; render(); } },
    openCat(el) { catSheet(el.dataset.id); },
    newCat() { newCatSheet(); },
    saveCat(el) {
      const name = val('c-name').trim();
      const budget = Math.abs(parseAmount(val('c-budget')) || 0);
      if (!name) return toast('Ge kategorin ett namn');
      if (el.dataset.id) Object.assign(cat(el.dataset.id), { name, budget });
      else db.categories.splice(expenseCats().length, 0, { id: uid(), name, budget, kind: 'expense' });
      save(); closeSheet(); render(); toast('Sparat');
    },
    deleteCat(el) {
      const c = cat(el.dataset.id);
      confirmSheet('Ta bort ' + c.name + '?', 'Transaktionerna i kategorin finns kvar men blir okategoriserade.', 'Ta bort', () => {
        db.categories = db.categories.filter((x) => x.id !== c.id);
        db.transactions.forEach((t) => { if (t.catId === c.id) t.catId = null; });
        save(); render(); toast('Kategorin togs bort');
      });
    },
    newGoal() { newGoalSheet(); },
    createGoal() {
      const name = val('g-name').trim();
      const target = Math.abs(parseAmount(val('g-target')) || 0);
      const start = Math.abs(parseAmount(val('g-start')) || 0);
      if (!name || !target) return toast('Fyll i namn och mål');
      const g = { id: uid(), name, target, deadline: val('g-deadline') || null, deposits: [], created: todayIso() };
      if (start) g.deposits.push({ id: uid(), date: todayIso(), amount: start, initial: true });
      db.goals.push(g);
      if (!db.settings.mainGoalId) db.settings.mainGoalId = g.id;
      save(); closeSheet(); render(); toast('Sparmålet skapades');
    },
    openGoal(el) { goalSheet(el.dataset.id); },
    saveGoal(el) {
      const g = db.goals.find((x) => x.id === el.dataset.id);
      const name = val('g-name').trim();
      const target = Math.abs(parseAmount(val('g-target')) || 0);
      if (!name || !target) return toast('Fyll i namn och mål');
      Object.assign(g, { name, target, deadline: val('g-deadline') || null });
      save(); closeSheet(); render(); toast('Sparat');
    },
    makeMain(el) { db.settings.mainGoalId = el.dataset.id; save(); closeSheet(); render(); },
    deleteGoal(el) {
      const g = db.goals.find((x) => x.id === el.dataset.id);
      confirmSheet('Ta bort ' + g.name + '?', 'Målet och dess insättningar raderas.', 'Ta bort', () => {
        db.goals = db.goals.filter((x) => x.id !== g.id);
        if (db.settings.mainGoalId === g.id) db.settings.mainGoalId = null;
        save(); render(); toast('Sparmålet togs bort');
      });
    },
    deposit(el) { depositSheet(el.dataset.id); },
    doDeposit(el) {
      const g = db.goals.find((x) => x.id === el.dataset.id);
      const amount = Math.abs(parseAmount(val('d-amount')) || 0);
      if (!amount) return toast('Ange ett belopp');
      g.deposits.push({ id: uid(), date: val('d-date') || todayIso(), amount: amount * Number(el.dataset.sign) });
      const done = goalDone(g);
      save(); closeSheet(); render();
      toast(done ? 'Målet är nått!' : (el.dataset.sign === '1' ? 'Insatt ' : 'Uttaget ') + kr(amount));
    },
    delDeposit(el) {
      const g = db.goals.find((x) => x.id === el.dataset.id);
      g.deposits = g.deposits.filter((x) => x.id !== el.dataset.dep);
      save(); render(); goalSheet(g.id);
    },
    confirmOk() { const fn = ui.confirmFn; closeSheet(); if (fn) fn(); },

    // Import
    mode(el) { ui.importMode = el.dataset.mode; render(); },
    cancelCsv() { ui.csv = null; render(); },
    doImport() {
      const fresh = ui.csv.items.filter((i) => !i.dup);
      for (const it of fresh) {
        db.transactions.push({ id: uid(), date: it.date, text: it.text, amount: it.amount, catId: it.catId || null, source: 'csv', hash: it.hash });
        learn(it.text, it.catId);
      }
      save(); ui.csv = null;
      toast(fresh.length + ' transaktioner importerade');
      location.hash = '#/oversikt'; render();
    },
    mType(el) { ui.manual.type = el.dataset.type; ui.manual.catId = null; render(); },
    mCat(el) { ui.manual.catId = el.dataset.id; render(); },
    mDate(el) { ui.manual.date = el.dataset.d; render(); },
    mSave() {
      const m = ui.manual;
      const amount = Math.abs(parseAmount(m.amount) || 0);
      if (!amount) return toast('Fyll i ett belopp');
      const text = m.desc.trim() || (cat(m.catId) || {}).name || (m.type === 'income' ? 'Inkomst' : 'Utgift');
      const t = { id: uid(), date: m.date, text, amount: m.type === 'income' ? amount : -amount, catId: m.catId, source: 'manual' };
      t.hash = txHash(t);
      db.transactions.push(t);
      learn(text, m.catId);
      save();
      const type = m.type;
      resetManual(); ui.manual.type = type;
      render();
      toast(type === 'income' ? 'Inkomst tillagd' : 'Utgift tillagd');
    },
    openCal() {
      const p = ui.manual.date;
      const d = fromIso(p);
      ui.cal = { pend: p, view: { y: d.getFullYear(), m: d.getMonth() } };
      calSheet();
    },
    calMove(el) {
      const v = ui.cal.view;
      const d = new Date(v.y, v.m + Number(el.dataset.dir), 1);
      const now = new Date();
      if (d > new Date(now.getFullYear(), now.getMonth(), 1)) return;
      ui.cal.view = { y: d.getFullYear(), m: d.getMonth() };
      calSheet();
    },
    calDay(el) { ui.cal.pend = el.dataset.d; calSheet(); },
    calOk() { ui.manual.date = ui.cal.pend; closeSheet(); render(); },

    // Inställningar
    toggleDark() {
      const dark = document.documentElement.dataset.theme === 'dark';
      db.settings.theme = dark ? 'light' : 'dark';
      save(); applyTheme(); render();
    },
    toggleAuto() {
      db.settings.theme = db.settings.theme === 'auto' ? document.documentElement.dataset.theme : 'auto';
      save(); applyTheme(); render();
    },
    exportCsv() {
      const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
      const lines = ['Datum;Text;Belopp;Kategori'];
      [...db.transactions].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((t) =>
        lines.push([t.date, q(t.text), String(t.amount).replace('.', ','), q((cat(t.catId) || {}).name || '')].join(';')));
      shareFile('budget-transaktioner-' + todayIso() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
    },
    backup() {
      shareFile('budget-backup-' + todayIso() + '.json', JSON.stringify(db, null, 1), 'application/json');
    },
    reminder() {
      // Föreslå dagen före lönedagen (eller sista dagen i månaden om månaden börjar den 1:a)
      const start = db.settings.monthStart || 1;
      const def = start === 1 ? 'sista' : pad(start - 1);
      const opts = [...Array.from({ length: 28 }, (_, i) => pad(i + 1)), 'sista']
        .map((k) => `<option value="${k}" ${k === def ? 'selected' : ''}>${k === 'sista' ? 'Sista dagen i månaden' : 'Den ' + ordinal(Number(k))}</option>`).join('');
      openSheet(`<h2>Månatlig påminnelse</h2>
        <p class="muted" style="margin:0;font-size:14px">Lägger in "Planera månadens budget" i iPhones kalender, kl. 18.00 varje månad. Du får en notis från Kalender när det är dags.</p>
        ${field('r-day', 'Vilken dag?', `<select id="r-day" class="input" data-change="reminderDay">${opts}</select>`)}
        <a id="r-link" class="btn" href="paminnelse-${def}.ics" target="_blank" rel="noopener">Lägg till i kalendern</a>
        <p class="muted" style="margin:0;font-size:13px">Välj <b>Lägg till alla</b> i rutan som öppnas. Vill du ändra eller ta bort påminnelsen gör du det i Kalender-appen.</p>
        <button class="btn secondary" data-act="closeSheet">Stäng</button>`, 'Månatlig påminnelse');
    },
    wipe() {
      confirmSheet('Radera all data?', 'Alla transaktioner, kategorier och sparmål tas bort från den här enheten. Det går inte att ångra.', 'Radera', () => {
        db = defaults(); save(); applyTheme(); location.hash = '#/oversikt'; render(); toast('All data raderad');
      });
    }
  };

  const changes = {
    async csvFile(el) {
      const f = el.files && el.files[0];
      if (!f) return;
      try {
        const text = decodeFile(await f.arrayBuffer());
        const rows = parseCSV(text);
        if (rows.length < 1) return toast('Filen verkar vara tom');
        const det = detectColumns(rows);
        ui.csv = { fileName: f.name, rows, header: det.header, names: det.names, map: det.map, items: [] };
        ui.csv.items = buildImport(rows, det.header, det.map);
        render();
        if (!ui.csv.items.length) toast('Hittade inga rader – kontrollera kolumnerna');
      } catch (e) { toast('Kunde inte läsa filen'); }
      el.value = '';
    },
    map(el) {
      const c = ui.csv;
      c.map[el.dataset.key] = Number(el.value);
      c.items = buildImport(c.rows, c.header, c.map);
      render();
    },
    itemCat(el) {
      const it = ui.csv.items[Number(el.dataset.idx)];
      it.catId = el.value || null;
      // Samma text längre ner får samma kategori
      const key = normText(it.text);
      ui.csv.items.forEach((x) => { if (!x.catId && !x.dup && normText(x.text) === key && (x.amount < 0) === (it.amount < 0)) x.catId = it.catId; });
      render();
    },
    reminderDay(el) { $('#r-link').setAttribute('href', 'paminnelse-' + el.value + '.ics'); },
    monthStart(el) { db.settings.monthStart = Number(el.value) || 1; ui.budgetOffset = 0; save(); render(); toast('Sparat'); },
    async restore(el) {
      const f = el.files && el.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('fel format');
        confirmSheet('Återställa säkerhetskopian?', 'Det som finns i appen nu ersätts med innehållet i filen.', 'Återställ', () => {
          localStorage.setItem(KEY, JSON.stringify(data)); load(); applyTheme(); render(); toast('Säkerhetskopian är återställd');
        });
      } catch (e) { toast('Filen är ingen giltig säkerhetskopia'); }
      el.value = '';
    }
  };
  const inputs = {
    mAmount(el) { ui.manual.amount = el.value; },
    mDesc(el) { ui.manual.desc = el.value; }
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('change', (e) => { const fn = changes[e.target.dataset.change]; if (fn) fn(e.target); });
  document.addEventListener('input', (e) => { const fn = inputs[e.target.dataset.input]; if (fn) fn(e.target); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet(); });
  window.addEventListener('hashchange', () => { closeSheet(); render(); });

  async function shareFile(name, text, mime) {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ================================================================
  // Tema
  // ================================================================
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const t = db.settings.theme;
    const dark = t === 'dark' || (t === 'auto' && mq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.removeAttribute('media'); m.setAttribute('content', dark ? '#0E0E0D' : '#ECEAE5'); });
  }
  mq.addEventListener('change', () => { if (db.settings.theme === 'auto') { applyTheme(); render(); } });

  // ================================================================
  // Start
  // ================================================================
  load();
  applyTheme();
  render();
  // Ny dag? Rita om när appen öppnas igen
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#sheet-root').innerHTML) render(); });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__budget = { db: () => db, parseCSV, detectColumns, parseAmount, parseDate };
})();
