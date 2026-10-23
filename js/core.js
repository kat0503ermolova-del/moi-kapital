// Shared state, data access, derived numbers and UI helpers used by every screen.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { $, esc, rub, today, ym, addMonths } from './util.js';

export const DEMO = new URLSearchParams(location.search).has('demo');
export const sb = DEMO ? (await import('./mock.js')).createDemoClient() : createClient(SUPABASE_URL, SUPABASE_KEY);
export const NDFL = 0.13;
export const ISS = 'https://iss.moex.com/iss';
export const CURRENCIES = [['RUB', '₽ рубль'], ['USD', '$ доллар'], ['EUR', '€ евро'], ['CNY', '¥ юань'], ['HKD', 'HK$ гонконгский доллар'], ['GBP', '£ фунт'], ['CHF', '₣ франк'], ['AED', 'дирхам ОАЭ'], ['KZT', '₸ тенге']];
const SYM = {RUB: '₽', USD: '$', EUR: '€', CNY: '¥', HKD: 'HK$', GBP: '£', CHF: '₣', AED: 'AED', KZT: '₸'};
export const curSym = c => SYM[c] || c;
// roubles per 1 unit at the Bank of Russia rate; unknown currencies count as 1 so nothing silently disappears
export const fx = c => !c || c === 'RUB' ? 1 : ctx.S?.fx?.[c] || 1;
export const money = (n, cur = 'RUB', d) => {
  if (!cur || cur === 'RUB') return rub(n, d);
  const v = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: d ? 2 : 0, maximumFractionDigits: d ? 2 : 0}).format(Math.round((+n || 0) * 100) / 100);
  return ['USD', 'GBP', 'HKD'].includes(cur) ? `${curSym(cur)}${v}` : `${v} ${curSym(cur)}`;
};

export const CLS = {stock: 'Акции', bond: 'Облигации', fund: 'Фонды', cash: 'Деньги и вклады', metal: 'Золото и металлы', crypto: 'Криптовалюта', other: 'Другое'};
export const ACC_TYPES = {card: 'Карта', cash: 'Наличные', savings: 'Накопительный', deposit: 'Вклад', broker: 'Брокерский', other: 'Другое'};
export const ACC_GROUPS = [['Повседневные', ['card', 'cash', 'other']], ['Накопления', ['savings', 'deposit']], ['Инвестиции', ['broker']]];
export const DEFAULT_SETTINGS = {
  categories: {
    income: ['Зарплата', 'Подработка', 'Проценты', 'Дивиденды и купоны', 'Подарки', 'Прочее'],
    expense: ['Продукты', 'Кафе', 'Жильё и ЖКХ', 'Транспорт', 'Здоровье', 'Одежда', 'Развлечения', 'Подписки', 'Подарки', 'Прочее'],
  },
  limits: {}, targets: {stock: 40, bond: 40, fund: 10, cash: 10}, defaultAccount: null, passiveGoal: 0,
};

// the one mutable store; screens read ctx.S and write through the helpers below
export const ctx = {S: null, user: null, online: navigator.onLine, logos: {}};

export const pad = n => String(n).padStart(2, '0');
export const shiftDay = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
export const num = v => +String(v ?? '').replace(/\s/g, '').replace(',', '.') || 0;
export const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// ---------- data access ----------
export async function q(promise, quiet){
  const { data, error } = await promise;
  if (error) { if (!quiet) toast('Не удалось сохранить: ' + (error.message || 'ошибка сети')); throw error; }
  return data;
}
export async function selectAll(table, order, build){
  const out = [];
  for (let from = 0; ; from += 1000) {
    let query = sb.from(table).select('*').range(from, from + 999);
    if (build) query = build(query);
    if (order) query = query.order(order.col, {ascending: order.asc});
    const rows = await q(query, true);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const cacheKey = () => 'kapital-cache-' + (ctx.user?.id || 'anon');
export function saveCache(){ if (DEMO) return; try { localStorage.setItem(cacheKey(), JSON.stringify(ctx.S)); } catch {} }
export function loadCache(){ if (DEMO) return null; try { return JSON.parse(localStorage.getItem(cacheKey())); } catch { return null; } }
export function dropCache(){ try { localStorage.removeItem(cacheKey()); } catch {} }

export async function loadAll(){
  const [accounts, tx, recurring, trades, manual, goals, netWorth, portfolios, divs, profile, sync, watch, broker, tg, cfg, fxRows, daily] = await Promise.all([
    selectAll('accounts', {col: 'created_at', asc: true}), selectAll('transactions', {col: 'date', asc: false}), selectAll('recurring'),
    selectAll('trades', {col: 'date', asc: true}), selectAll('manual_prices'), selectAll('goals', {col: 'deadline', asc: true}),
    selectAll('net_worth', {col: 'month', asc: true}), selectAll('portfolios', {col: 'sort', asc: true}), selectAll('expected_dividends', {col: 'record_date', asc: true}),
    q(sb.from('profiles').select('*').maybeSingle(), true), q(sb.from('market_sync').select('*').maybeSingle(), true),
    selectAll('watchlist', {col: 'created_at', asc: true}),
    q(sb.from('broker_connections').select('*').eq('broker', 'tinvest').maybeSingle(), true).catch(() => null),
    q(sb.from('tg_links').select('*').maybeSingle(), true).catch(() => null),
    q(sb.from('app_config').select('*').maybeSingle(), true).catch(() => null),
    selectAll('fx_rates').catch(() => []),
    selectAll('capital_daily', {col: 'date', asc: true}).catch(() => []),
  ]);
  let settings = profile?.settings;
  if (!profile) { await q(sb.from('profiles').insert({settings: DEFAULT_SETTINGS})); settings = DEFAULT_SETTINGS; }
  ctx.S = {accounts, tx, recurring, trades, goals, netWorth, portfolios, divs, sync, watch, broker, tg, cfg, daily,
    fx: Object.fromEntries([['RUB', 1], ...fxRows.map(r => [r.code, +r.rate])]), fxDate: fxRows.find(r => r.code === 'USD')?.date || null, fq: {},
    manual: Object.fromEntries(manual.map(m => [m.ticker, +m.price])),
    settings: {...DEFAULT_SETTINGS, ...settings, categories: {...DEFAULT_SETTINGS.categories, ...(settings?.categories || {})}},
    sec: {}, events: []};
  await loadMarket();
}
export async function loadMarket(){
  const S = ctx.S;
  const tickers = [...new Set([...S.trades.map(t => t.ticker), ...(S.watch || []).map(w => w.ticker)])];
  if (!tickers.length) { S.sec = {}; S.events = []; S.fq = {}; return; }
  const [rows, events, sync, fq] = await Promise.all([
    q(sb.from('securities').select('*').in('ticker', tickers), true),
    q(sb.from('bond_events').select('*').in('ticker', tickers).gte('date', shiftDay(today(), -40)).lte('date', shiftDay(today(), 400)).order('date'), true).catch(() => []),
    q(sb.from('market_sync').select('*').maybeSingle(), true),
    q(sb.from('foreign_quotes').select('*').in('symbol', tickers), true).catch(() => []),
  ]);
  S.sec = Object.fromEntries(rows.map(s => [s.ticker, s]));
  S.fq = Object.fromEntries(fq.map(f => [f.symbol, f]));
  S.events = events; S.sync = sync;
}
export async function saveSettings(){ await q(sb.from('profiles').update({settings: ctx.S.settings, updated_at: new Date().toISOString()}).eq('user_id', ctx.user.id)); }
export async function syncBondSchedules(tickers){
  if (!tickers.length) return;
  await sb.functions.invoke('moex-sync', {body: {tickers}}).catch(() => null);
}

// ---------- derived numbers ----------
export function accBalances(){
  const S = ctx.S, b = {};
  S.accounts.forEach(a => b[a.id] = +a.start_balance || 0);
  S.tx.forEach(t => {
    if (t.type === 'income') b[t.account_id] = (b[t.account_id] || 0) + +t.amount;
    else if (t.type === 'expense') b[t.account_id] = (b[t.account_id] || 0) - +t.amount;
    else { b[t.account_id] = (b[t.account_id] || 0) - +t.amount; b[t.to_account_id] = (b[t.to_account_id] || 0) + +t.amount; }
  });
  return b;
}
// which money account pays for a trade: the portfolio's linked account, else the first broker account in that currency, else the first broker account
export function tradeAccount(t){
  const S = ctx.S, p = t.portfolio_id ? S.portfolios.find(x => x.id === t.portfolio_id) : null, brokers = S.accounts.filter(a => a.type === 'broker');
  return (p?.account_id && S.accounts.find(a => a.id === p.account_id)) || brokers.find(a => (a.currency || 'RUB') === (t.currency || 'RUB')) || brokers[0] || null;
}
// free cash on each broker account, in that account's currency
export function brokerCashMap(){
  const S = ctx.S, bal = accBalances(), out = {};
  S.accounts.filter(a => a.type === 'broker').forEach(a => out[a.id] = bal[a.id] || 0);
  S.trades.forEach(t => {
    const a = tradeAccount(t); if (!a) return;
    const k = fx(t.currency) / fx(a.currency);
    const v = t.type === 'buy' ? -(t.qty * t.price + (+t.fee || 0)) : t.type === 'sell' ? t.qty * t.price - (+t.fee || 0) : +t.amount;
    out[a.id] += v * k;
  });
  return out;
}
// total free broker cash in roubles
export function brokerCash(){
  const m = brokerCashMap();
  return ctx.S.accounts.filter(a => a.type === 'broker').reduce((s, a) => s + (m[a.id] || 0) * fx(a.currency), 0);
}
// balance of any account in its own currency (broker accounts show free cash)
export function accountBalance(a, bal = accBalances(), cash = null){
  return a.type === 'broker' ? (cash || brokerCashMap())[a.id] || 0 : bal[a.id] || 0;
}
export const quoteOf = t => ctx.S.sec[t] || (ctx.S.fq?.[t]?.price != null ? ctx.S.fq[t] : null);
export const priceOf = t => quoteOf(t)?.price != null ? +quoteOf(t).price : ctx.S.manual[t] ?? null;
// trades of one portfolio ('main' = without a portfolio); with no pid — everything except archived portfolios
export function inPortfolio(pid){
  if (pid) return t => pid === 'main' ? !t.portfolio_id : t.portfolio_id === pid;
  const arch = new Set(ctx.S.portfolios.filter(p => p.archived).map(p => p.id));
  return t => !arch.has(t.portfolio_id);
}
export function positions(pid){
  const map = {}, year = today().slice(0, 4);
  let realizedYear = 0;
  // a security can change its trading currency (T-Bank funds were redenominated from dollars to roubles in 2023):
  // the position is kept in the currency of its latest trade and older trades are converted at today's rate
  const curOf = {};
  ctx.S.trades.forEach(t => { if (!curOf[t.ticker] || t.date >= curOf[t.ticker].d) curOf[t.ticker] = {d: t.date, c: t.currency || 'RUB'}; });
  ctx.S.trades.filter(inPortfolio(pid)).forEach(tr => {
    const p = map[tr.ticker] ||= {ticker: tr.ticker, name: tr.name, cls: tr.cls, cur: curOf[tr.ticker].c, qty: 0, cost: 0, realized: 0, income: 0, fees: 0, invested: 0, firstBuy: null, buys: 0, sells: 0};
    if (tr.name) p.name = tr.name;
    const k = fx(tr.currency || 'RUB') / fx(p.cur), price = tr.price * k, fee = (+tr.fee || 0) * k;
    if (tr.type === 'buy') {
      if (p.qty <= 1e-9) p.firstBuy = tr.date;
      p.qty += +tr.qty; p.cost += tr.qty * price; p.fees += fee; p.invested += tr.qty * price; p.buys += tr.qty * price;
    } else if (tr.type === 'sell') {
      const avg = p.qty ? p.cost / p.qty : 0, qn = Math.min(+tr.qty, p.qty);
      p.realized += qn * (price - avg); p.cost -= qn * avg; p.qty -= qn; p.fees += fee; p.sells += tr.qty * price;
      if (tr.date.startsWith(year)) realizedYear += (qn * (price - avg) - fee) * fx(p.cur);
    } else p.income += +tr.amount * k;
  });
  const list = Object.values(map).map(p => {
    const price = priceOf(p.ticker), s = quoteOf(p.ticker), k = fx(p.cur);
    const valueCur = price != null ? p.qty * price : p.cost;
    const totalCur = valueCur - p.cost + p.realized + p.income - p.fees;
    // native-currency figures keep a "Cur" suffix; everything else is in roubles at today's rate
    return {...p, avg: p.qty ? p.cost / p.qty : 0, price, valueCur, totalCur, costCur: p.cost,
      value: valueCur * k, cost: p.cost * k, unreal: (valueCur - p.cost) * k, realized: p.realized * k, income: p.income * k, fees: p.fees * k,
      invested: p.invested * k, buys: p.buys * k, sells: p.sells * k, total: totalCur * k, totalPct: p.invested ? totalCur / p.invested * 100 : 0,
      noPrice: price == null, auto: s?.price != null, foreign: !ctx.S.sec[p.ticker] && !!ctx.S.fq?.[p.ticker], dayPct: s?.change_pct != null ? +s.change_pct : null,
      dayAbs: s?.price != null && s?.prev_price != null ? p.qty * (s.price - s.prev_price) * k : 0, sec: ctx.S.sec[p.ticker] || null, open: p.qty > 1e-9};
  });
  list.realizedYear = realizedYear;
  return list;
}
export function netWorthNow(){
  const S = ctx.S, bal = accBalances(), pos = positions();
  const invested = pos.reduce((s, p) => s + p.value, 0);
  const cashMap = brokerCashMap();
  const cash = S.accounts.reduce((s, a) => s + accountBalance(a, bal, cashMap) * fx(a.currency), 0);
  return {invested, cash, total: invested + cash};
}
export function monthStats(m){
  const r = {income: 0, expense: 0, interest: 0, byCat: {}, byInc: {}};
  const curOf = Object.fromEntries(ctx.S.accounts.map(a => [a.id, a.currency || 'RUB']));
  ctx.S.tx.forEach(t0 => {
    if (t0.date.slice(0, 7) !== m) return;
    const t = curOf[t0.account_id] && curOf[t0.account_id] !== 'RUB' ? {...t0, amount: t0.amount * fx(curOf[t0.account_id])} : t0;
    if (t.type === 'income') { r.income += +t.amount; r.byInc[t.category] = (r.byInc[t.category] || 0) + +t.amount; if (t.category === 'Проценты') r.interest += +t.amount; }
    if (t.type === 'expense') { r.expense += +t.amount; r.byCat[t.category] = (r.byCat[t.category] || 0) + +t.amount; }
  });
  return r;
}
export function xirr(flows){
  if (flows.length < 2) return NaN;
  flows.sort((a, b) => a.d.localeCompare(b.d));
  const t0 = Date.parse(flows[0].d);
  const f = r => flows.reduce((s, x) => s + x.v / Math.pow(1 + r, (Date.parse(x.d) - t0) / 864e5 / 365), 0);
  let lo = -0.99, hi = 10, flo = f(lo);
  if (flo * f(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2, fm = f(mid); if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; } }
  return (lo + hi) / 2;
}
export function portfolioXirr(pid){
  const trades = ctx.S.trades.filter(inPortfolio(pid));
  const flows = trades.map(t => ({d: t.date, v: (t.type === 'buy' ? -(t.qty * t.price + (+t.fee || 0)) : t.type === 'sell' ? t.qty * t.price - (+t.fee || 0) : +t.amount) * fx(t.currency)}));
  const value = positions(pid).reduce((s, p) => s + p.value, 0);
  if (value > 0) flows.push({d: today(), v: value});
  return xirr(flows);
}
export function qtyOn(ticker, date){
  // shares held at the end of `date` (used to size coupons and dividends)
  let qn = 0;
  ctx.S.trades.forEach(t => { if (t.ticker === ticker && t.date <= date) { if (t.type === 'buy') qn += +t.qty; if (t.type === 'sell') qn -= +t.qty; } });
  return Math.max(0, qn);
}

// every dated money event in a window: bond payments, offers, expected dividends, recurring payments, goal deadlines
export function moneyEvents(from, to){
  const S = ctx.S, out = [], held = Object.fromEntries(positions().map(p => [p.ticker, p]));
  for (const e of S.events) {
    if (e.date < from || e.date > to) continue;
    const p = held[e.ticker]; if (!p) continue;
    const qty = e.date >= today() ? p.qty : qtyOn(e.ticker, shiftDay(e.date, -1));
    if (!qty) continue;
    const name = p.name || e.ticker;
    if (e.kind === 'coupon') out.push({date: e.date, kind: 'coupon', ticker: e.ticker, label: `Купон · ${name}`, amount: (+e.value_rub || 0) * qty * (1 - NDFL), sign: 1});
    if (e.kind === 'amort') out.push({date: e.date, kind: 'amort', ticker: e.ticker, label: `Амортизация · ${name}`, amount: (+e.value_rub || 0) * qty, sign: 1});
    if (e.kind === 'maturity') out.push({date: e.date, kind: 'maturity', ticker: e.ticker, label: `Погашение · ${name}`, amount: (+e.value_rub || 0) * qty, sign: 1});
    if (e.kind === 'offer') out.push({date: e.date, kind: 'offer', ticker: e.ticker, label: `Оферта · ${name}`, amount: 0, sign: 0});
  }
  for (const d of S.divs) {
    if (d.record_date < from || d.record_date > to) continue;
    const p = held[d.ticker], qty = d.record_date >= today() ? p?.qty || 0 : qtyOn(d.ticker, d.record_date);
    out.push({date: d.record_date, kind: 'dividend', ticker: d.ticker, id: d.id, label: `Дивиденды · ${p?.name || d.ticker}`, amount: d.per_share * qty * (1 - NDFL) * fx(p?.cur), sign: 1, note: d.note});
  }
  for (const r of S.recurring.filter(r => r.active && r.type !== 'transfer')) {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) {
      const date = m + '-' + pad(r.day);
      if (date < from || date > to || m < r.start_month) continue;
      out.push({date, kind: 'recurring', label: r.note || r.category, amount: +r.amount, sign: r.type === 'income' ? 1 : -1});
    }
  }
  if (S.portfolios.some(p => p.region === 'foreign')) {
    // a foreign broker account means filing yourself: 3-NDFL, cash-flow report (ОДДС) and paying the tax
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      [[`${y}-04-30`, 'Подать 3-НДФЛ за доходы у зарубежного брокера'], [`${y}-06-01`, 'Отчёт о движении средств (ОДДС) по зарубежному счёту'], [`${y}-07-15`, 'Заплатить НДФЛ по декларации']]
        .forEach(([date, label]) => { if (date >= from && date <= to) out.push({date, kind: 'tax', label, amount: 0, sign: 0}); });
    }
  }
  for (const g of S.goals.filter(g => !g.achieved && g.kind !== 'wish')) {
    if (g.deadline >= from && g.deadline <= to) out.push({date: g.deadline, kind: 'goal', label: `Срок цели · ${g.name}`, amount: +g.target, sign: 0});
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- UI helpers ----------
let toastTimer;
export function toast(msg){
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3200);
}
export function openModal(title, body, onSubmit, opts = {}){
  $('#modal-root').innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><form class="sheet ${opts.wide ? 'wide' : ''}" id="mform" autocomplete="off">
    <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Закрыть">✕</button></div>
    <div class="sheet-body">${body}</div>
    ${onSubmit ? `<div class="sheet-foot"><button type="button" class="btn ghost" data-act="close">Отмена</button><button class="btn" type="submit" id="msubmit">${opts.submit || 'Сохранить'}</button></div>` : ''}</form></div>`;
  const f = $('#mform');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = $('#msubmit'); btn.disabled = true;
    try { if (await onSubmit(Object.fromEntries(new FormData(f))) !== false) { closeModal(); opts.after?.(); } }
    catch {} finally { if (btn.isConnected) btn.disabled = false; }
  });
  f.querySelector('input:not([type=hidden]):not([type=range]),select')?.focus();
}
export const closeModal = () => { $('#modal-root').innerHTML = ''; };
export const inp = (name, label, val = '', type = 'text', extra = '') => `<label class="f">${label}<input id="m-${name}" name="${name}" type="${type}" value="${esc(val)}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${extra}></label>`;
export const sel = (name, label, opts, val) => `<label class="f">${label}<select id="m-${name}" name="${name}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
export const guard = fn => async (...a) => { if (!ctx.online) return toast('Нет интернета: изменения сейчас не сохранятся'); try { await fn(...a); } catch (e) { console.error(e); } };

// monogram "logo": two letters on a colour picked from the ticker, like broker apps without image logos
const HUES = [340, 20, 45, 160, 200, 230, 265, 300];
// brand colours for well-known tickers, so placeholders look like the real marks until logos load
const BRAND = {SBER: '#21A038', SBERP: '#21A038', LKOH: '#D52B1E', GAZP: '#0079C2', ROSN: '#E8A100', YDEX: '#FC3F1D', TATN: '#00843D', MGNT: '#E5262C', MOEX: '#C8102E',
  PLZL: '#B8925A', GMKN: '#0067A5', NVTK: '#00A0DC', VTBR: '#0A2896', T: '#C9A100', TCSG: '#C9A100', OZON: '#005BFF', MTSS: '#E30611', AFLT: '#1B3E8C', CHMF: '#0072BC', SNGS: '#2A5CAA',
  AAPL: '#1D1D1F', MSFT: '#00A4EF', GOOGL: '#4285F4', AMZN: '#FF9900', NVDA: '#76B900', TSLA: '#CC0000', META: '#0866FF', VOO: '#96151D', SPY: '#1F2A44', QQQ: '#2F6FB5', TMOS: '#C9A100', LQDT: '#2E5BBA'};
export function logo(ticker, name, size = 32, url){
  const t = String(ticker || '?'), h = HUES[[...t].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length];
  const letters = (/^(SU|RU)\d/.test(t) ? (name || t).replace(/[^А-ЯA-Zа-яa-z]/g, '') : t).slice(0, 2).toUpperCase();
  const src = url || ctx.S?.sec?.[t]?.logo || ctx.logos[t];
  const bc = BRAND[t] ? `--lc:${BRAND[t]};` : '';
  return `<span class="logo" style="${bc}--h:${h};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px" aria-hidden="true">${esc(letters)}${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}
// Catmull-Rom → cubic Bézier, so lines read as curves rather than polylines
export function smoothPath(pts){
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  return pts.map((p, i) => {
    if (!i) return `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || p;
    return `C${(p1[0] + (p[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p[1] - p0[1]) / 6).toFixed(1)} ${(p[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  }).join('');
}
export const catLogo = c => logo(c, c, 34);
export { rub, esc };
