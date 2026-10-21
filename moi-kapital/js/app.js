// Screens, routing and user actions. Shared data and helpers live in core.js;
// passive income, calendar, screener and review live in invest.js.
import { $, esc, nf0, nf2, rub, pct, sgn, today, ym, MONTHS, MONTHS_FULL, ymLabel, dLabel, addMonths, COLORS, donut, bars, area, short } from './util.js';
import { CALCS, GROUPS } from './calcs.js';
import { ctx, sb, DEMO, NDFL, CLS, ACC_TYPES, ACC_GROUPS, CURRENCIES, fx, money, curSym, accountBalance, brokerCashMap, quoteOf, q, loadAll, loadMarket, saveSettings, saveCache, loadCache, dropCache, syncBondSchedules,
  accBalances, brokerCash, positions, netWorthNow, monthStats, portfolioXirr, moneyEvents, shiftDay, pad, num, monthsBetween, daysBetween,
  toast, openModal, closeModal, inp, sel, guard, logo, catLogo, smoothPath } from './core.js';
import { parseQuick } from './quick.js';
import { term, showTerm } from './glossary.js';
import { PLAN_ACTIONS, planInput, viewFire } from './plan.js';
import { WATCH_ACTIONS, ladderPanel } from './watch.js';
import { ichart } from './chart.js';
import { IP_ACTIONS, ipInput } from './incomeplan.js';
import { CONNECT_ACTIONS, viewConnections, connectChange, autoSync } from './connect.js';
import { viewIncome, viewCalendar, viewScreener, viewAnalysis, INVEST_ACTIONS, investInput, incomeForecast, ana } from './invest.js';

// ---------- view state ----------
let tab = 'overview';
const pf = {pid: null, tab: 'comp', opsFilter: 'all', showSold: false};
const bud = {tab: 'accounts', month: ym(today()), filter: 'all'};
const gl = {tab: 'goal'};
const ov = {period: '1y'};
const PERIODS = [['1m', '1М', 31], ['6m', '6М', 183], ['1y', '1Г', 366], ['all', 'Всё', 1e5]];
let calcId = 'compound';
const calcVals = {};
try { tab = localStorage.getItem('kapital-tab') || 'overview'; } catch {}
if (location.hash.length > 1 && !location.hash.includes('=')) tab = location.hash.slice(1);

const S = () => ctx.S;
const accName = id => S().accounts.find(a => a.id === id)?.name || '—';
const pName = id => !id ? 'Основной' : S().portfolios.find(p => p.id === id)?.name || 'Портфель';
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };

// ---------- automatic jobs ----------
async function runRecurring(){
  const cur = ym(today()), d = +today().slice(8);
  for (const r of S().recurring.filter(r => r.active)) {
    let m = r.last_month ? addMonths(r.last_month, 1) : r.start_month, last = r.last_month;
    const rows = [];
    while ((m < cur || (m === cur && r.day <= d)) && rows.length < 36) {
      rows.push({date: m + '-' + pad(r.day), type: r.type, amount: r.amount, account_id: r.account_id, to_account_id: r.to_account_id, category: r.category, note: r.note, recurring_id: r.id});
      last = m; m = addMonths(m, 1);
    }
    if (!rows.length) continue;
    S().tx.push(...await q(sb.from('transactions').insert(rows).select()));
    await q(sb.from('recurring').update({last_month: last}).eq('id', r.id));
    r.last_month = last;
    toast(`Добавлены регулярные операции: ${rows.length}`);
  }
}
async function snapshotDaily(){
  if (!S().accounts.length) return;
  const n = netWorthNow(), d = today(), daily = S().daily ||= [], prev = daily.find(x => x.date === d);
  if (prev && Math.abs(prev.total - n.total) < 1) return;
  const row = {date: d, total: Math.round(n.total), invested: Math.round(n.invested), cash: Math.round(n.cash)};
  await q(sb.from('capital_daily').upsert(row), true);
  if (prev) Object.assign(prev, row); else daily.push(row);
}
// capital history for a period: daily snapshots when there are enough, otherwise monthly ones; always ends today
function capitalSeries(days, now){
  const from = shiftDay(today(), -days), d = (S().daily || []).filter(x => x.date >= from && x.date < today());
  let pts = d.map(x => ({d: x.date, total: +x.total, invested: +x.invested}));
  if (pts.length < 3) pts = S().netWorth.filter(h => h.month + '-28' >= from && h.month < ym(today())).map(h => ({d: h.month + '-28', total: +h.total, invested: +h.invested}));
  pts.push({d: today(), total: now.total, invested: now.invested});
  return pts;
}
async function snapshotNetWorth(){
  if (!S().accounts.length) return;
  const n = netWorthNow(), m = ym(today()), prev = S().netWorth.find(x => x.month === m);
  if (prev && Math.abs(prev.total - n.total) < 1) return;
  const row = {month: m, total: Math.round(n.total), invested: Math.round(n.invested), cash: Math.round(n.cash)};
  await q(sb.from('net_worth').upsert(row), true);
  if (prev) Object.assign(prev, row); else S().netWorth.push(row);
}

// ---------- shared bits ----------
function spark(values){
  if (values.length < 2) return '';
  const W = 800, H = 130, min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1;
  const pts = values.map((v, i) => [i / (values.length - 1) * W, H - 14 - (v - min) / span * (H - 34)]);
  const line = smoothPath(pts), last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:130px;display:block" role="img" aria-label="Динамика капитала">
    <defs><linearGradient id="spg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D8BE8C" stop-opacity=".35"/><stop offset="1" stop-color="#D8BE8C" stop-opacity="0"/></linearGradient></defs>
    <path d="${line}L${W},${H}L0,${H}Z" fill="url(#spg)"/><path d="${line}" fill="none" stroke="#E7CF9C" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0] - 5}" cy="${last[1]}" r="5" fill="#FFF6E5"/></svg>`;
}
const tabs = (items, cur, act) => `<div class="tabs" role="tablist">${items.map(([k, l, c]) => `<button role="tab" data-act="${act}" data-k="${k}" aria-selected="${cur === k}">${l}${c != null ? `<span class="count">${c}</span>` : ''}</button>`).join('')}</div>`;
function goalPlan(g){
  const months = Math.max(1, monthsBetween(today(), g.deadline)), r = (+g.ret || 0) / 100 / 12;
  const need = Math.max(0, g.target - g.saved * Math.pow(1 + r, months));
  return {months, pmt: r ? need * r / (Math.pow(1 + r, months) - 1) : need / months};
}
function goalCard(g){
  const p = Math.min(100, g.saved / g.target * 100), plan = goalPlan(g);
  return `<div class="panel" style="gap:10px">
    <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><div><b>${esc(g.name)}</b><div class="sub2 muted">${g.achieved ? 'достигнута' : `до ${dLabel(g.deadline)} ${g.deadline.slice(0, 4)}`}</div></div>
      <span class="row" style="gap:0;flex-wrap:nowrap">${!g.achieved ? `<button class="icon-btn" data-act="goal-done" data-id="${g.id}" title="Отметить достигнутой" aria-label="Отметить достигнутой">✓</button>` : ''}<button class="icon-btn" data-act="edit-goal" data-id="${g.id}" aria-label="Изменить">✎</button><button class="icon-btn" data-act="del-goal" data-id="${g.id}" aria-label="Удалить">✕</button></span></div>
    <div class="row" style="justify-content:space-between"><span class="num" style="font-weight:650;font-size:17px">${rub(g.saved)}</span><span class="num muted">из ${rub(g.target)}</span></div>
    <div class="bar gold"><i style="width:${p}%"></i></div>
    ${g.achieved ? '' : `<div class="row" style="justify-content:space-between;font-size:13px"><span class="muted">${nf0.format(p)}% · ${plan.months} мес</span><span>откладывать <b class="num">${rub(plan.pmt)}</b> в месяц</span></div>`}
  </div>`;
}

// ---------- overview ----------
function viewOnboarding(){
  return `<div class="head"><div><h1>Добро пожаловать</h1><p class="sub">Начните со счетов — где лежат ваши деньги. Затем добавьте операции и бумаги.</p></div></div>
  <div class="grid">
    <section class="panel"><h2>Быстрый старт</h2><p class="note">Создам четыре счёта с нулевым балансом: карта, наличные, накопительный и брокерский. Названия и балансы поменяете потом.</p><div><button class="btn" data-act="create-defaults">Создать счета</button></div></section>
    <section class="panel"><h2>Перенести данные</h2><p class="note">Если вы вели учёт в первой версии на claude.ai, сохраните там копию в разделе «Данные» и загрузите файл сюда.</p><div><label class="btn ghost" for="import-file" style="cursor:pointer">Загрузить файл</label><input type="file" id="import-file" accept=".json,application/json" hidden></div></section>
  </div>`;
}
function viewOverview(){
  if (!S().accounts.length) return viewOnboarding();
  const nw = netWorthNow(), pos = positions(), open = pos.filter(p => p.open);
  const m = monthStats(ym(today()));
  const hist = S().netWorth.filter(h => h.month < ym(today())).slice(-11), prev = hist[hist.length - 1], delta = prev ? nw.total - prev.total : null;
  const pTotal = pos.reduce((s, p) => s + p.total, 0), pInv = pos.reduce((s, p) => s + p.invested, 0), day = open.reduce((s, p) => s + p.dayAbs, 0);
  const inc = incomeForecast(), up = moneyEvents(today(), shiftDay(today(), 30)).filter(e => e.kind !== 'goal').slice(0, 6);
  const cats = Object.entries(m.byCat).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const goals = S().goals.filter(g => !g.achieved && g.kind !== 'wish').slice(0, 2);
  const mini = (l, v, cls = '') => `<div><div class="muted" style="font-size:12.5px">${l}</div><div class="num ${cls}" style="font-weight:650;font-size:17px">${v}</div></div>`;
  return `<div class="head"><div><h1>${greeting()}</h1><p class="sub">${new Intl.DateTimeFormat('ru-RU', {weekday: 'long', day: 'numeric', month: 'long'}).format(new Date())}</p></div></div>
  <section class="statement">
    <div style="display:flex;flex-direction:column;gap:10px"><span class="label">${term('networth', 'Чистый капитал')}</span><span class="big"><span id="nw-big">${nf0.format(nw.total)}</span><small>₽</small></span>
      <div class="chips">${delta != null ? `<span id="nw-sub" class="chip ${sgn(delta)}">${delta >= 0 ? '+' : '−'}${rub(Math.abs(delta))} за месяц</span>` : '<span id="nw-sub" class="chip" hidden></span>'}${open.length ? `<span class="chip ${sgn(day)}">${day >= 0 ? '+' : '−'}${rub(Math.abs(day))} за день</span>` : ''}</div></div>
    <div class="figs">
      <div class="fig"><div class="l">Инвестиции</div><div class="v">${rub(nw.invested)}</div></div>
      <div class="fig"><div class="l">Деньги на счетах</div><div class="v">${rub(nw.cash)}</div></div>
      <div class="fig"><div class="l">${term('result', 'Результат инвестиций')}</div><div class="v">${pInv ? pct(pTotal / pInv * 100) : '—'}</div></div>
      <div class="fig"><div class="l">${term('passive')}</div><div class="v">${rub(inc.avg)}/мес</div></div>
    </div>
    ${(() => { const days = PERIODS.find(p => p[0] === ov.period)[2], pts = capitalSeries(days, nw);
      const sub = delta != null ? `${delta >= 0 ? '+' : '−'}${rub(Math.abs(delta))} за месяц` : '';
      return `<div style="grid-column:1/-1;display:flex;justify-content:flex-end;margin-bottom:-6px"><div class="periods" role="group" aria-label="Период">${PERIODS.map(([k, l]) => `<button data-act="ov-period" data-k="${k}" aria-pressed="${ov.period === k}">${l}</button>`).join('')}</div></div>
      <div class="spark">${pts.length >= 2 ? ichart({id: 'cap', dates: pts.map(p => p.d), series: [{name: 'Капитал', values: pts.map(p => p.total), color: '#E7CF9C', fill: true, width: 2.5}], height: 170, axis: false,
        bind: {value: 'nw-big', sub: 'nw-sub', restore: nf0.format(nw.total), restoreSub: sub, restoreSubClass: 'chip ' + (delta != null ? sgn(delta) : '')}}) : '<p class="note" style="padding:0 26px 20px">График появится, когда накопится история капитала.</p>'}</div>`; })()}
  </section>
  <div class="grid2">
    <section class="panel"><div class="panel-head"><h2>Портфель</h2><button class="btn ghost sm" data-go="portfolio">Открыть</button></div>
      ${open.length ? `<div class="tbl-wrap"><table><tbody>${[...open].sort((a, b) => b.value - a.value).slice(0, 5).map(p => `<tr class="click" data-act="instrument" data-t="${esc(p.ticker)}"><td><div class="sec">${logo(p.ticker, p.name)}<div><b>${esc(p.name || p.ticker)}</b><div class="sub2">${CLS[p.cls]}</div></div></div></td><td class="r num">${rub(p.value)}<div class="sub2 ${p.dayPct == null ? '' : sgn(p.dayPct)}">${p.dayPct == null ? '' : pct(p.dayPct)}</div></td><td class="r num ${sgn(p.total)}">${pct(p.totalPct)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">Портфель пуст.<button class="btn sm" data-go="screener">Найти бумаги</button></div>`}
    </section>
    <section class="panel"><div class="panel-head"><h2>Ближайшие 30 дней</h2><button class="btn ghost sm" data-go="calendar">Календарь</button></div>
      ${up.length ? up.map(u => `<div class="list-row"><span><span class="num muted">${dLabel(u.date)}</span>&nbsp; ${esc(u.label)}</span><span class="num ${u.sign > 0 ? 'pos' : ''}">${u.amount ? (u.sign > 0 ? '+' : '−') + rub(u.amount) : `<span class="chip warn">${u.kind === 'tax' ? 'налоги' : 'оферта'}</span>`}</span></div>`).join('') : '<p class="note">Купоны, дивиденды, оферты и регулярные платежи появятся здесь.</p>'}
    </section>
  </div>
  <div class="grid2">
    <section class="panel"><div class="panel-head"><h2>${MONTHS_FULL[new Date().getMonth()]}</h2><button class="btn ghost sm" data-go="budget">Бюджет</button></div>
      <div class="grid3 keep">${mini('Доходы', rub(m.income))}${mini('Расходы', rub(m.expense))}${mini('Остаток', rub(m.income - m.expense), sgn(m.income - m.expense))}</div>
      ${cats.map(([c, v]) => { const l = S().settings.limits[c]; return `<div style="display:flex;flex-direction:column;gap:5px"><div class="row" style="justify-content:space-between;font-size:13.5px"><span>${esc(c)}</span><span class="num ${l && v > l ? 'neg' : 'muted'}">${rub(v)}${l ? ` из ${rub(l)}` : ''}</span></div><div class="bar ${l && v > l ? 'over' : ''}"><i style="width:${Math.min(100, l ? v / l * 100 : v / (m.expense || 1) * 100)}%"></i></div></div>`; }).join('')}
    </section>
    <section class="panel"><div class="panel-head"><h2>Цели</h2><button class="btn ghost sm" data-go="goals">Все цели</button></div>
      ${goals.length ? goals.map(g => `<div style="display:flex;flex-direction:column;gap:6px"><div class="row" style="justify-content:space-between"><b>${esc(g.name)}</b><span class="num muted">${nf0.format(g.saved / g.target * 100)}%</span></div><div class="bar gold"><i style="width:${Math.min(100, g.saved / g.target * 100)}%"></i></div><span class="note">${rub(g.saved)} из ${rub(g.target)} · откладывать ${rub(goalPlan(g).pmt)} в месяц</span></div>`).join('') : '<div class="empty">Целей пока нет.<button class="btn sm" data-act="add-goal">Добавить цель</button></div>'}
    </section>
  </div>`;
}

// ---------- portfolio ----------
const pfOf = pid => pid && pid !== 'main' ? S().portfolios.find(p => p.id === pid) : null;
function portfolioTotals(pid){
  const pos = positions(pid), open = pos.filter(p => p.open), cur = pfOf(pid)?.currency || 'RUB';
  const acc = pfOf(pid)?.account_id ? S().accounts.find(a => a.id === pfOf(pid).account_id) : null;
  return {pos, open, cur, valueCur: open.reduce((s, p) => s + p.value / fx(cur), 0), cash: acc ? accountBalance(acc, undefined, brokerCashMap()) : null, cashCur: acc?.currency || 'RUB', value: open.reduce((s, p) => s + p.value, 0), invested: open.reduce((s, p) => s + p.cost, 0), total: pos.reduce((s, p) => s + p.total, 0),
    inv: pos.reduce((s, p) => s + p.invested, 0), day: open.reduce((s, p) => s + p.dayAbs, 0), realizedYear: pos.realizedYear};
}
function viewPortfolio(){
  const ps = S().portfolios, hasMain = S().trades.some(t => !t.portfolio_id);
  const cards = [[null, 'Все портфели'], ...(ps.length && hasMain ? [['main', 'Основной']] : []), ...ps.map(p => [p.id, p.name])];
  if (pf.pid && !cards.some(c => c[0] === pf.pid)) pf.pid = null;
  const t = portfolioTotals(pf.pid), bc = brokerCash();
  const irr = S().trades[0] && monthsBetween(S().trades[0].date, today()) >= 3 ? portfolioXirr(pf.pid) : NaN;
  const lastSync = S().sync?.last_run ? new Date(S().sync.last_run) : null;
  const inc = incomeForecast();
  return `<div class="head"><div><h1>Портфель</h1><p class="sub">Котировки Мосбиржи обновляются каждые 30 минут в торговые часы${lastSync ? ` · последнее обновление ${pad(lastSync.getHours())}:${pad(lastSync.getMinutes())}${lastSync.toDateString() === new Date().toDateString() ? '' : ' ' + dLabel(lastSync.toISOString().slice(0, 10))}` : ''}.</p></div>
    <div class="row"><button class="btn ghost" data-act="refresh-prices">Обновить котировки</button><button class="btn" data-act="add-trade">Добавить сделку</button></div></div>
  <div class="pcards">${cards.map(([id, name]) => { const tt = portfolioTotals(id); return `<button class="pcard" data-act="pf-pick" data-k="${id ?? ''}" aria-pressed="${pf.pid === id}"><span class="n">${esc(name)}${tt.cur !== 'RUB' ? ` <span class="muted" style="font-weight:500">· ${tt.cur}</span>` : ''}</span><span class="v num">${tt.cur !== 'RUB' ? money(tt.valueCur, tt.cur) : rub(tt.value)}</span><span class="num ${pf.pid === id ? '' : sgn(tt.total)}" style="font-size:12.5px">${tt.inv ? pct(tt.total / tt.inv * 100) : '—'}</span></button>`; }).join('')}
    <button class="pcard add" data-act="add-portfolio">+ Портфель</button></div>
  <section class="statement">
    <div style="display:flex;flex-direction:column;gap:10px"><span class="label">Стоимость ${pf.pid ? '· ' + esc(pName(pf.pid === 'main' ? null : pf.pid)) : 'всех портфелей'}</span><span class="big">${t.cur !== 'RUB' ? `${nf0.format(t.valueCur)}<small>${curSym(t.cur)}</small>` : `${nf0.format(t.value)}<small>₽</small>`}</span>
      <div class="chips">${t.cur !== 'RUB' ? `<span class="chip">≈ ${rub(t.value)} по курсу ЦБ ${nf2.format(fx(t.cur))}</span>` : ''}<span class="chip ${sgn(t.total)}">${t.total >= 0 ? '+' : '−'}${rub(Math.abs(t.total))} · ${t.inv ? pct(t.total / t.inv * 100) : '0%'}</span><span class="chip ${sgn(t.day)}">${t.day >= 0 ? '+' : '−'}${rub(Math.abs(t.day))} за день</span></div></div>
    <div class="figs">
      <div class="fig"><div class="l">${term('invested', 'Вложено в активы')}</div><div class="v">${rub(t.invested)}</div></div>
      <div class="fig"><div class="l">${term('xirr')}</div><div class="v">${isFinite(irr) ? pct(irr * 100) : '—'}</div></div>
      <div class="fig"><div class="l">${pf.pid ? 'Дивиденды и купоны получено' : 'Пассивный доход за 12 мес'}</div><div class="v">${pf.pid ? rub(t.pos.reduce((s, p) => s + p.income, 0)) : rub(inc.total)}</div></div>
      <div class="fig"><div class="l">${pf.pid && t.cash == null ? term('tax', 'Налог с продаж в году') : term('cash')}</div><div class="v">${pf.pid && t.cash == null ? rub(Math.max(0, t.realizedYear) * NDFL) : t.cash != null ? money(t.cash, t.cashCur) : rub(bc)}</div></div>
    </div>
  </section>
  ${pf.pid && pf.pid !== 'main' ? `<div class="row"><button class="btn ghost sm" data-act="edit-portfolio" data-id="${pf.pid}">Настройки портфеля</button></div>` : ''}
  ${tabs([['comp', 'Состав', t.open.length], ['ops', 'Операции'], ['review', 'Обзор']], pf.tab, 'pf-tab')}
  ${pf.tab === 'comp' ? portfolioComp(t) : pf.tab === 'ops' ? portfolioOps() : portfolioReview(t)}`;
}
function portfolioComp(t){
  if (!t.open.length) return `<div class="empty">Добавьте первую сделку — позиция появится здесь, а цена подтянется с Мосбиржи.<div class="row"><button class="btn sm" data-act="add-trade">Добавить сделку</button><button class="btn ghost sm" data-go="screener">Найти бумаги</button></div></div>`;
  const manual = t.open.filter(p => !p.auto);
  const native = p => p.cur !== 'RUB' ? `<div class="sub2">${money(p.valueCur, p.cur)}</div>` : '';
  const order = ['stock', 'bond', 'fund', 'metal', 'crypto', 'other', 'cash'];
  const blocks = order.filter(c => t.open.some(p => p.cls === c)).map(c => {
    const list = t.open.filter(p => p.cls === c).sort((a, b) => b.value - a.value), v = list.reduce((s, p) => s + p.value, 0);
    const bond = c === 'bond';
    const head = bond ? `<th>Облигация</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">${term('ytm', 'Доходность')}</th><th class="r">${term('coupon', 'Ближ. купон')}</th><th class="r">${term('maturity', 'Погашение')}</th><th class="r">Стоимость</th><th class="r">${term('share', 'Доля')}</th><th class="r">${term('result', 'Результат')}</th>`
      : `<th>Бумага</th><th class="r">Кол-во</th><th class="r">${term('avg', 'Средняя')}</th><th class="r">Текущая</th><th class="r">${term('day', 'За день')}</th><th class="r">Стоимость</th><th class="r">${term('share', 'Доля')}</th><th class="r">${term('divs', 'Дивиденды')}</th><th class="r">${term('result', 'Результат')}</th>`;
    const rows = list.map(p => {
      const s = p.sec || {}, share = p.value / (t.value || 1) * 100;
      const secCell = `<td><div class="sec">${logo(p.ticker, p.name)}<div><b>${esc(p.name || p.ticker)}</b><div class="sub2">${esc(p.ticker)}${p.foreign ? ` · ${esc(S().fq[p.ticker]?.exchange || 'зарубежная')}` : ''}${p.firstBuy && daysBetween(p.firstBuy, today()) >= 365 * 3 ? ' · ' + term('ldv', 'ЛДВ') : ''}</div></div></div></td>`;
      const res = `<td class="r num ${sgn(p.total)}">${rub(p.total)}<div class="sub2">${pct(p.totalPct)}</div></td>`;
      if (bond) return `<tr class="click" data-act="instrument" data-t="${esc(p.ticker)}">${secCell}<td class="r num">${nf0.format(p.qty)}</td><td class="r num">${p.price != null && s.face_value ? nf2.format(p.price / s.face_value * 100) + '%' : p.price != null ? nf2.format(p.price) : '—'}<div class="sub2">ср. ${nf2.format(p.avg)}</div></td>
        <td class="r num">${s.ytm != null ? nf2.format(s.ytm) + '%' : '—'}</td><td class="r num">${s.next_coupon ? dLabel(s.next_coupon) : '—'}<div class="sub2">${s.coupon_value ? rub(s.coupon_value * p.qty * (1 - NDFL)) : ''}</div></td>
        <td class="r num">${s.mat_date ? s.mat_date.split('-').reverse().join('.') : '—'}${s.offer_date ? `<div class="sub2 warn">оферта ${s.offer_date.split('-').reverse().join('.')}</div>` : ''}</td><td class="r num">${rub(p.value)}</td><td class="r num muted">${nf2.format(share)}%</td>${res}</tr>`;
      return `<tr class="click" data-act="instrument" data-t="${esc(p.ticker)}">${secCell}<td class="r num">${nf2.format(p.qty).replace(/,00$/, '')}</td><td class="r num">${money(p.avg, p.cur, 1)}</td><td class="r num ${p.noPrice ? 'warn' : ''}">${p.noPrice ? 'нет цены' : money(p.price, p.cur, 1)}${p.auto ? '' : '<div class="sub2">вручную</div>'}</td>
        <td class="r num ${p.dayPct == null ? 'faint' : sgn(p.dayPct)}">${p.dayPct == null ? '—' : pct(p.dayPct)}</td><td class="r num">${rub(p.value)}${native(p)}</td><td class="r num muted">${nf2.format(share)}%</td><td class="r num">${p.income ? rub(p.income) : '—'}</td>${res}</tr>`;
    }).join('');
    return `<section class="panel"><div class="class-head"><h2>${CLS[c]}</h2><div class="share"><span class="num">${rub(v)}</span><span class="chip">${nf2.format(v / (t.value || 1) * 100)}%</span></div></div><div class="tbl-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join('');
  const sold = t.pos.filter(p => !p.open);
  const alloc = {}; t.open.forEach(p => alloc[p.cls] = (alloc[p.cls] || 0) + p.value); if (!pf.pid) alloc.cash = (alloc.cash || 0) + Math.max(0, brokerCash());
  const sum = Object.values(alloc).reduce((s, v) => s + v, 0) || 1;
  const keys = [...new Set([...Object.keys(S().settings.targets), ...Object.keys(alloc)])];
  return `${manual.length ? `<div class="banner"><span>Для ${manual.map(p => esc(p.ticker)).join(', ')} не нашлось котировки на Мосбирже и зарубежных биржах — укажите цену вручную.</span><button class="btn ghost sm" data-act="prices">Указать цены</button></div>` : ''}
  ${blocks}
  ${sold.length ? `<section class="panel"><div class="panel-head"><h2>Проданные</h2><button class="btn ghost sm" data-act="pf-sold">${pf.showSold ? 'Скрыть' : `Показать (${sold.length})`}</button></div>
    ${pf.showSold ? `<div class="tbl-wrap"><table><tbody>${sold.map(p => `<tr class="click" data-act="instrument" data-t="${esc(p.ticker)}"><td><div class="sec">${logo(p.ticker, p.name)}<div><b>${esc(p.name || p.ticker)}</b><div class="sub2">${CLS[p.cls]}</div></div></div></td><td class="r num">продано на ${rub(p.sells)}</td><td class="r num ${sgn(p.total)}">${rub(p.total)}<div class="sub2">${pct(p.totalPct)}</div></td></tr>`).join('')}</tbody></table></div>` : ''}</section>` : ''}
  <section class="panel"><div class="panel-head"><h2>Структура и ${term('rebalance', 'ребалансировка')}</h2><button class="btn ghost sm" data-act="targets">Целевые доли</button></div>
    <div class="grid2" style="align-items:center"><div class="row" style="gap:24px;align-items:center">${donut(keys.filter(k => alloc[k] > 0).map((k, i) => ({v: alloc[k], color: COLORS[i % 6]})), 150)}
      <div class="legend" style="flex:1;min-width:180px">${keys.filter(k => alloc[k] > 0).map((k, i) => `<div><i class="sw" style="background:${COLORS[i % 6]}"></i><span>${CLS[k]}</span><span class="num muted">${nf0.format(alloc[k] / sum * 100)}%</span><span></span></div>`).join('')}</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Класс</th><th class="r">Сейчас</th><th class="r">${term('targets', 'Цель')}</th><th class="r">Действие</th></tr></thead><tbody>
    ${keys.map(k => { const cur = (alloc[k] || 0) / sum * 100, tg = +S().settings.targets[k] || 0, diff = tg / 100 * sum - (alloc[k] || 0), ok = Math.abs(diff) < sum * 0.02;
      return `<tr><td>${CLS[k] || k}</td><td class="r num">${nf0.format(cur)}%</td><td class="r num muted">${tg}%</td><td class="r num ${ok ? 'muted' : diff > 0 ? 'pos' : 'neg'}">${ok ? 'в норме' : (diff > 0 ? 'докупить ' : 'сократить ') + rub(Math.abs(diff))}</td></tr>`; }).join('')}
    </tbody></table></div></div>
  </section>`;
}
function portfolioOps(){
  const T = {buy: 'Покупка', sell: 'Продажа', income: 'Доход'};
  const list = S().trades.filter(t => !pf.pid || (pf.pid === 'main' ? !t.portfolio_id : t.portfolio_id === pf.pid)).filter(t => pf.opsFilter === 'all' || t.type === pf.opsFilter).sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="filters">${[['all', 'Все'], ['buy', 'Покупки'], ['sell', 'Продажи'], ['income', 'Дивиденды и купоны']].map(([k, l]) => `<button data-act="pf-ops" data-k="${k}" aria-pressed="${pf.opsFilter === k}">${l}</button>`).join('')}</div>
  <section class="panel">${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Дата</th><th>Бумага</th><th>Операция</th>${S().portfolios.length ? '<th>Портфель</th>' : ''}<th class="r">Кол-во × цена</th><th class="r">Сумма</th><th></th></tr></thead><tbody>
  ${list.map(t => { const amt = t.type === 'income' ? +t.amount : t.qty * t.price; return `<tr><td class="num">${t.date.split('-').reverse().join('.')}</td><td><div class="sec">${logo(t.ticker, t.name, 26)}<span>${esc(t.name || t.ticker)}</span></div></td><td><span class="chip ${t.type === 'income' ? 'pos' : t.type === 'sell' ? 'acc' : ''}">${t.type === 'income' ? esc(t.kind || 'Доход') : T[t.type]}</span></td>${S().portfolios.length ? `<td class="muted">${esc(pName(t.portfolio_id))}</td>` : ''}<td class="r num muted">${t.type === 'income' ? '' : nf2.format(t.qty).replace(/,00$/, '') + ' × ' + money(t.price, t.currency || 'RUB', 1)}</td><td class="r num ${t.type === 'buy' ? '' : 'pos'}">${t.type === 'buy' ? '−' : '+'}${money(amt, t.currency || 'RUB', 1)}</td><td class="r" style="white-space:nowrap"><button class="icon-btn" data-act="edit-trade" data-id="${t.id}" aria-label="Изменить">✎</button><button class="icon-btn" data-act="del-trade" data-id="${t.id}" aria-label="Удалить">✕</button></td></tr>`; }).join('')}
  </tbody></table></div>` : '<div class="empty">Операций нет.</div>'}</section>`;
}
function portfolioReview(t){
  const trades = S().trades.filter(x => !pf.pid || (pf.pid === 'main' ? !x.portfolio_id : x.portfolio_id === pf.pid));
  const broker = S().accounts.find(a => a.type === 'broker');
  const inflow = broker ? S().tx.filter(x => x.type === 'transfer' && x.to_account_id === broker.id).reduce((s, x) => s + +x.amount, 0) : 0;
  const outflow = broker ? S().tx.filter(x => x.type === 'transfer' && x.account_id === broker.id).reduce((s, x) => s + +x.amount, 0) : 0;
  const buys = trades.filter(x => x.type === 'buy'), sells = trades.filter(x => x.type === 'sell');
  const months = []; if (trades[0]) for (let m = trades[0].date.slice(0, 7); m <= ym(today()); m = addMonths(m, 1)) months.push(m);
  const invested = months.map(m => { let c = 0; const pos = {}; trades.filter(x => x.date.slice(0, 7) <= m).forEach(x => { const p = pos[x.ticker] ||= {q: 0, c: 0}; if (x.type === 'buy') { p.q += +x.qty; p.c += x.qty * x.price; } if (x.type === 'sell' && p.q) { const avg = p.c / p.q, qn = Math.min(+x.qty, p.q); p.c -= qn * avg; p.q -= qn; } }); Object.values(pos).forEach(p => c += p.c); return c; });
  const valByMonth = Object.fromEntries(S().netWorth.map(h => [h.month, +h.invested]));
  const value = months.map((m, i) => m === ym(today()) ? t.value : pf.pid ? invested[i] : valByMonth[m] ?? invested[i]);
  const irr = trades[0] && monthsBetween(trades[0].date, today()) >= 3 ? portfolioXirr(pf.pid) : NaN;
  if (ana.imoex == null && trades[0]) ACTIONS['load-imoex'](trades[0].date);
  const im = ana.imoex, idxY = im?.change != null ? (Math.pow(1 + im.change / 100, 1 / Math.max(im.years, 0.25)) - 1) * 100 : null;
  const bondsV = t.open.filter(p => p.cls === 'bond'), ofz = bondsV.filter(p => p.sec?.board === 'TQOB').reduce((s, p) => s + p.value, 0), corp = bondsV.reduce((s, p) => s + p.value, 0) - ofz;
  const top = [...t.open].sort((a, b) => b.value - a.value).slice(0, 8);
  return `<div class="kpis">
    <div class="kpi"><span class="l">Внесено на брокерский</span><span class="v">${rub(inflow)}</span><span class="s">выведено ${rub(outflow)}</span></div>
    <div class="kpi"><span class="l">Дивиденды и купоны</span><span class="v pos">${rub(trades.filter(x => x.type === 'income').reduce((s, x) => s + +x.amount, 0))}</span></div>
    <div class="kpi"><span class="l">Сделок</span><span class="v">${buys.length + sells.length}</span><span class="s">покупок ${rub(buys.reduce((s, x) => s + x.qty * x.price, 0))}, продаж ${rub(sells.reduce((s, x) => s + x.qty * x.price, 0))}</span></div>
    <div class="kpi"><span class="l">Комиссии</span><span class="v">${rub(trades.reduce((s, x) => s + (+x.fee || 0), 0))}</span><span class="s">налог с продаж в году ≈ ${rub(Math.max(0, t.realizedYear) * NDFL)}</span></div>
  </div>
  <div class="grid2">
    <section class="panel"><h2>Вложено и стоимость</h2>
      ${months.length > 1 ? ichart({id: 'pf-review', dates: months.map(m => m === ym(today()) ? today() : m + '-28'), series: [{name: 'Стоимость', values: value, color: '#E7CF9C', fill: true}, {name: 'Вложено', values: invested, color: '#6B7FA3', dash: true, width: 1.6}], height: 230}) + '<div class="row" style="gap:16px;font-size:12.5px;color:var(--muted)"><span class="row" style="gap:6px"><i class="sw" style="background:#E7CF9C"></i>Стоимость</span><span class="row" style="gap:6px"><i class="sw" style="background:#6B7FA3"></i>Вложено</span></div>' : '<p class="note">График появится через месяц после первой сделки.</p>'}
    </section>
    <section class="panel"><h2>${term('xirr', 'Доходность')}</h2>
      <div class="result"><div class="strong"><span class="l">Портфель, годовых</span><span class="v num">${isFinite(irr) ? pct(irr * 100) : '—'}</span></div><div><span class="l">Индекс Мосбиржи, годовых</span><span class="v num">${idxY != null ? pct(idxY) : im === false ? 'нет данных' : '…'}</span></div></div>
      <p class="note">Доходность портфеля учитывает даты покупок и продаж (как XIRR). Индекс — за тот же период, без дивидендов.${isFinite(irr) ? '' : ' Цифра появится через 3 месяца после первой сделки.'}</p>
      ${bondsV.length ? `<h3>Облигации</h3><div class="legend"><div><i class="sw" style="background:var(--c3)"></i><span>ОФЗ</span><span class="num muted">${nf0.format(ofz / ((ofz + corp) || 1) * 100)}%</span><span class="num">${rub(ofz)}</span></div><div><i class="sw" style="background:var(--c2)"></i><span>Корпоративные</span><span class="num muted">${nf0.format(corp / ((ofz + corp) || 1) * 100)}%</span><span class="num">${rub(corp)}</span></div></div>` : ''}
    </section>
  </div>
  ${ladderPanel(t.open)}
  <section class="panel"><h2>Крупнейшие позиции</h2>
    ${top.map(p => `<div style="display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr) auto;gap:12px;align-items:center"><div class="sec" style="min-width:0">${logo(p.ticker, p.name, 26)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name || p.ticker)}</span></div><div class="bar gold"><i style="width:${p.value / (top[0]?.value || 1) * 100}%"></i></div><span class="num muted">${nf2.format(p.value / (t.value || 1) * 100)}%</span></div>`).join('') || '<p class="note">Пусто</p>'}
  </section>`;
}

// ---------- budget ----------
function viewBudget(){
  if (!S().accounts.length) return viewOnboarding();
  return `<div class="head"><div><h1>Бюджет</h1><p class="sub">${term('transfer', 'Переводы')} между своими счетами не считаются ни доходом, ни расходом.</p></div>
    <div class="row"><button class="btn ghost" data-act="add-account">Новый счёт</button><button class="btn" data-act="add-tx">Добавить операцию</button></div></div>
  ${tabs([['accounts', 'Счета'], ['history', 'История'], ['analytics', 'Аналитика']], bud.tab, 'bud-tab')}
  ${bud.tab === 'accounts' ? budgetAccounts() : bud.tab === 'history' ? budgetHistory() : budgetAnalytics()}`;
}
function budgetAccounts(){
  const bal = accBalances(), cashMap = brokerCashMap(), balOf = a => accountBalance(a, bal, cashMap), rubOf = a => balOf(a) * fx(a.currency);
  const total = S().accounts.filter(a => !a.archived).reduce((s, a) => s + rubOf(a), 0), m = monthStats(ym(today()));
  return `<section class="statement"><div style="display:flex;flex-direction:column;gap:10px"><span class="label">Всего денег</span><span class="big">${nf0.format(total)}<small>₽</small></span></div>
    <div class="figs"><div class="fig"><div class="l">Доходы за месяц</div><div class="v">${rub(m.income)}</div></div><div class="fig"><div class="l">Расходы за месяц</div><div class="v">${rub(m.expense)}</div></div><div class="fig"><div class="l">${term('interest', 'Проценты по накопительным')}</div><div class="v">${rub(m.interest)}</div></div><div class="fig"><div class="l">${term('savingsRate', 'Отложено')}</div><div class="v">${m.income ? nf0.format(Math.max(0, (m.income - m.expense) / m.income * 100)) + '%' : '—'}</div></div></div></section>
  <div class="grid">${ACC_GROUPS.map(([g, types]) => { const list = S().accounts.filter(a => !a.archived && types.includes(a.type)); if (!list.length) return '';
    return `<section class="panel"><div class="panel-head"><h2>${g}</h2><span class="num muted">${rub(list.reduce((s, a) => s + rubOf(a), 0))}</span></div>
      ${list.map(a => `<div class="list-row"><span class="row" style="gap:10px;flex-wrap:nowrap">${logo(a.name, a.name, 30)}<span><b>${esc(a.name)}</b>${S().settings.defaultAccount === a.id ? ' <span class="chip acc">основной</span>' : ''}<div class="sub2 muted">${ACC_TYPES[a.type]}${a.rate ? ` · ${nf2.format(a.rate).replace(/,00$/, '')}% годовых` : ''}${a.type === 'broker' ? ' · свободные деньги' : ''}</div></span></span><span class="row" style="gap:4px;flex-wrap:nowrap"><span class="num ${balOf(a) < 0 ? 'neg' : ''}" style="font-weight:600;text-align:right">${money(balOf(a), a.currency, 1)}${a.currency && a.currency !== 'RUB' ? `<div class="sub2 muted" style="font-weight:400">≈ ${rub(rubOf(a))}</div>` : ''}</span><button class="icon-btn" data-act="edit-account" data-id="${a.id}" aria-label="Изменить">✎</button></span></div>`).join('')}</section>`; }).join('')}</div>
  <section class="panel"><div class="panel-head"><h2>Регулярные операции</h2><button class="btn ghost sm" data-act="add-rec">Добавить</button></div>
    ${S().recurring.length ? S().recurring.map(r => `<div class="list-row"><span><b>${esc(r.note || r.category || 'Перевод')}</b> <span class="muted">· ${r.day} числа · ${r.type === 'transfer' ? esc(accName(r.account_id)) + ' → ' + esc(accName(r.to_account_id)) : esc(r.category)}</span>${r.active ? '' : ' <span class="chip">на паузе</span>'}</span><span class="row" style="gap:4px;flex-wrap:nowrap"><span class="num ${r.type === 'income' ? 'pos' : ''}">${r.type === 'income' ? '+' : r.type === 'expense' ? '−' : ''}${rub(r.amount)}</span><button class="icon-btn" data-act="edit-rec" data-id="${r.id}" aria-label="Изменить">✎</button><button class="icon-btn" data-act="del-rec" data-id="${r.id}" aria-label="Удалить">✕</button></span></div>`).join('')
      : '<p class="note">Аренда, подписки, зарплата, автопополнение накопительного. Приложение само добавит их в нужный день.</p>'}
  </section>`;
}
const monthNav = (m, act) => `<div class="row"><button class="btn ghost sm" data-act="${act}" data-d="-1" aria-label="Предыдущий месяц">←</button><b style="min-width:140px;text-align:center">${ymLabel(m)}</b><button class="btn ghost sm" data-act="${act}" data-d="1" aria-label="Следующий месяц">→</button></div>`;
function budgetHistory(){
  const list = S().tx.filter(t => t.date.slice(0, 7) === bud.month && (bud.filter === 'all' || t.type === bud.filter)).sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
  const days = [...new Set(list.map(t => t.date))];
  const fmtDay = d => new Intl.DateTimeFormat('ru-RU', {weekday: 'long', day: 'numeric', month: 'long'}).format(new Date(d + 'T12:00:00'));
  return `<div class="row" style="justify-content:space-between">${monthNav(bud.month, 'bud-month')}<div class="filters">${[['all', 'Все'], ['expense', 'Расходы'], ['income', 'Доходы'], ['transfer', 'Переводы']].map(([k, l]) => `<button data-act="bud-filter" data-k="${k}" aria-pressed="${bud.filter === k}">${l}</button>`).join('')}</div></div>
  <section class="panel" style="gap:0">${days.length ? days.map(d => { const items = list.filter(t => t.date === d), out = items.filter(t => t.type === 'expense').reduce((s, t) => s + +t.amount, 0);
    return `<div class="day-head row" style="justify-content:space-between"><span style="text-transform:capitalize">${fmtDay(d)}</span>${out ? `<span class="num">−${rub(out)}</span>` : ''}</div>${items.map(t => `<div class="tx-row">${t.type === 'transfer' ? logo('ПЕ', 'Перевод', 34) : catLogo(t.category)}<div style="min-width:0"><div class="t">${t.type === 'transfer' ? 'Перевод' : esc(t.category)}${t.recurring_id ? ' <span class="chip">регулярная</span>' : ''}</div><div class="d">${esc(accName(t.account_id))}${t.type === 'transfer' ? ' → ' + esc(accName(t.to_account_id)) : ''}${t.note ? ' · ' + esc(t.note) : ''}</div></div><span class="num ${t.type === 'income' ? 'pos' : t.type === 'transfer' ? 'muted' : ''}" style="font-weight:600">${t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}${rub(t.amount, 1)}</span><span style="white-space:nowrap"><button class="icon-btn" data-act="edit-tx" data-id="${t.id}" aria-label="Изменить">✎</button><button class="icon-btn" data-act="del-tx" data-id="${t.id}" aria-label="Удалить">✕</button></span></div>`).join('')}`; }).join('')
    : '<div class="empty">Операций за этот месяц нет.</div>'}</section>`;
}
function budgetAnalytics(){
  const m = monthStats(bud.month), p = monthStats(addMonths(bud.month, -1));
  const months = Array.from({length: 6}, (_, i) => addMonths(bud.month, i - 5));
  const cats = Object.entries(m.byCat).sort((a, b) => b[1] - a[1]);
  const first = bud.month + '-01', dim = new Date(+bud.month.slice(0, 4), +bud.month.slice(5), 0).getDate(), offset = (new Date(first + 'T12:00:00').getDay() + 6) % 7;
  const daily = Array.from({length: dim}, (_, i) => S().tx.filter(t => t.type === 'expense' && t.date === `${bud.month}-${pad(i + 1)}`).reduce((s, t) => s + +t.amount, 0));
  const maxD = Math.max(1, ...daily);
  return `<div class="row" style="justify-content:space-between">${monthNav(bud.month, 'bud-month')}<button class="btn ghost sm" data-act="limits">Лимиты</button></div>
  <div class="kpis">
    <div class="kpi"><span class="l">Доходы</span><span class="v">${rub(m.income)}</span><span class="s ${sgn(m.income - p.income)}">${p.income ? pct((m.income / p.income - 1) * 100) + ' к прошлому' : ''}</span></div>
    <div class="kpi"><span class="l">Расходы</span><span class="v">${rub(m.expense)}</span><span class="s ${sgn(p.expense - m.expense)}">${p.expense ? pct((m.expense / p.expense - 1) * 100) + ' к прошлому' : ''}</span></div>
    <div class="kpi"><span class="l">Остаток</span><span class="v ${sgn(m.income - m.expense)}">${rub(m.income - m.expense)}</span></div>
    <div class="kpi"><span class="l">${term('interest', 'Проценты по накопительным')}</span><span class="v pos">${rub(m.interest)}</span><span class="s">отдельно от пополнений</span></div>
  </div>
  <div class="grid2">
    <section class="panel"><h2>Расходы по категориям</h2>
      ${cats.length ? `<div class="tbl-wrap"><table><thead><tr><th>Категория</th><th class="r">Сумма</th><th class="r">Доля</th><th class="r">К прошлому месяцу</th><th class="r">${term('limit', 'Лимит')}</th></tr></thead><tbody>${cats.map(([c, v]) => { const pv = p.byCat[c] || 0, l = S().settings.limits[c];
        return `<tr><td><div class="sec">${catLogo(c)}<span>${esc(c)}</span></div></td><td class="r num"><b>${rub(v)}</b></td><td class="r num muted">${nf0.format(v / m.expense * 100)}%</td><td class="r num ${pv ? sgn(pv - v) : 'faint'}">${pv ? (v >= pv ? '+' : '−') + rub(Math.abs(v - pv)) : 'новая'}</td><td class="r num ${l && v > l ? 'neg' : 'muted'}">${l ? (v > l ? 'превышен' : nf0.format(v / l * 100) + '%') : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">В этом месяце расходов нет.</div>'}
    </section>
    <section class="panel"><h2>Календарь трат</h2>
      <div class="heat">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div style="aspect-ratio:auto;color:var(--muted);font-weight:600">${d}</div>`).join('')}${Array.from({length: offset}, () => '<div></div>').join('')}
      ${daily.map((v, i) => `<div title="${i + 1} ${MONTHS[+bud.month.slice(5) - 1]}: ${rub(v)}" style="background:${v ? `rgba(216,190,140,${(0.1 + v / maxD * 0.7).toFixed(2)})` : 'var(--sunk)'};color:${v / maxD > .55 ? '#17140F' : 'var(--fg-2)'}">${i + 1}</div>`).join('')}</div>
      <p class="note">Чем темнее день, тем больше потрачено. Самый дорогой день: ${daily.some(Boolean) ? `${daily.indexOf(maxD) + 1} ${MONTHS[+bud.month.slice(5) - 1]}, ${rub(maxD)}` : '—'}.</p>
    </section>
  </div>
  <section class="panel"><h2>Доходы и расходы за полгода</h2>${bars(months.map(mm => { const s = monthStats(mm); return {label: MONTHS[+mm.slice(5) - 1], a: s.income, b: s.expense}; }), {label: 'Доходы и расходы'})}
    <div class="row" style="gap:16px;font-size:12.5px;color:var(--muted)"><span class="row" style="gap:6px"><i class="sw" style="background:var(--accent)"></i>Доходы</span><span class="row" style="gap:6px"><i class="sw" style="background:var(--neg)"></i>Расходы</span></div></section>`;
}

// ---------- goals ----------
function viewGoals(){
  if (gl.tab === 'fire') return `<div class="head"><div><h1>Цели</h1><p class="sub">Когда капитал сможет заменить зарплату — по вашим реальным расходам, накоплениям и портфелю.</p></div></div>
  ${tabs([['goal', 'Цели'], ['wish', 'Желания'], ['done', 'Достигнутые'], ['fire', 'Независимость']], gl.tab, 'gl-tab')}${viewFire()}`;
  const list = S().goals.filter(g => gl.tab === 'done' ? g.achieved : !g.achieved && (g.kind || 'goal') === gl.tab);
  const active = S().goals.filter(g => !g.achieved && g.kind !== 'wish');
  return `<div class="head"><div><h1>Цели</h1><p class="sub">Сколько откладывать в месяц — с учётом доходности, под которую вы вкладываете накопления.</p></div><button class="btn" data-act="add-goal">${gl.tab === 'wish' ? 'Новое желание' : 'Новая цель'}</button></div>
  ${tabs([['goal', 'Цели', active.length], ['wish', 'Желания', S().goals.filter(g => g.kind === 'wish' && !g.achieved).length], ['done', 'Достигнутые', S().goals.filter(g => g.achieved).length], ['fire', 'Независимость']], gl.tab, 'gl-tab')}
  ${gl.tab === 'goal' && active.length ? `<div class="kpis"><div class="kpi"><span class="l">Накоплено</span><span class="v">${rub(active.reduce((s, g) => s + +g.saved, 0))}</span></div><div class="kpi"><span class="l">Нужно всего</span><span class="v">${rub(active.reduce((s, g) => s + +g.target, 0))}</span></div><div class="kpi"><span class="l">Откладывать в месяц</span><span class="v">${rub(active.reduce((s, g) => s + goalPlan(g).pmt, 0))}</span></div></div>` : ''}
  ${gl.tab === 'wish' ? '<p class="note">Желания — то, что хочется, но без жёсткого срока. Когда решите копить, поменяйте тип на «Цель».</p>' : ''}
  ${list.length ? `<div class="grid">${list.map(goalCard).join('')}</div>` : `<div class="empty">${gl.tab === 'done' ? 'Здесь появятся достигнутые цели.' : gl.tab === 'wish' ? 'Желаний пока нет.' : 'Целей пока нет.'}</div>`}`;
}

// ---------- calculators ----------
const sliderRange = (f, def) => {
  const label = f[1];
  if (/%/.test(label)) return [0, Math.max(50, def * 2), 0.1];
  if (/лет/.test(label)) return [1, Math.max(40, def * 2), 1];
  if (/мес/i.test(label) && !/₽/.test(label)) return [1, Math.max(360, def * 2), 1];
  if (/дней|Дней|Выплат/.test(label)) return [0, Math.max(30, def * 2), 1];
  return [0, Math.max(100, def * 4), def >= 100000 ? 10000 : def >= 1000 ? 1000 : def >= 100 ? 10 : 1];
};
const CALC_TERMS = {compound: ['compound', 'inflation', 'realReturn'], savings: ['compound', 'inflation'], deposit: ['compound', 'interest'], inflation: ['inflation'], goal: ['compound', 'inflation'],
  mortgage: ['annuity', 'diff'], credit: ['annuity', 'diff'], early: ['annuity'], refi: ['annuity'], bond: ['ytm', 'coupon', 'face', 'nkd'], iis: ['iis'], pds: ['compound'], fire: ['fire', 'swr', 'realReturn'], fx: ['fx'], vacation: []};
function viewCalc(){
  const c = CALCS.find(x => x.id === calcId) || CALCS[0];
  const vals = calcVals[c.id] ||= Object.fromEntries(c.f.map(f => [f[0], f[2]]));
  return `<div class="head"><div><h1>Калькуляторы</h1><p class="sub">${CALCS.length} калькуляторов. Результат пересчитывается сразу.</p></div></div>
  <div class="calc-layout">
    <nav class="calc-nav" aria-label="Калькуляторы">${GROUPS.map(([g, l]) => `<h3>${l}</h3>${CALCS.filter(x => x.g === g).map(x => `<button data-act="calc" data-id="${x.id}" aria-current="${x.id === c.id}">${x.t}</button>`).join('')}`).join('')}</nav>
    <div style="display:flex;flex-direction:column;gap:16px;min-width:0"><div><h2 style="font-size:19px">${c.t}</h2><p class="sub">${c.d}</p>${CALC_TERMS[c.id] ? `<div class="row" style="gap:12px;margin-top:8px;font-size:13px;color:var(--muted)">${CALC_TERMS[c.id].map(k => term(k)).join('')}</div>` : ''}</div><div id="calc-out">${calcOut(c, vals)}</div></div>
    <form class="panel calc-form" id="calc-form" autocomplete="off">${c.f.map(f => f[3]
      ? `<label class="f">${f[1]}<select id="c-${c.id}-${f[0]}" name="${f[0]}">${f[3].map(([k, l]) => `<option value="${k}" ${vals[f[0]] === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
      : (() => { const [mn, mx, st] = sliderRange(f, +f[2]); return `<div class="field-slider"><label class="f">${f[1]}<input id="c-${c.id}-${f[0]}" name="${f[0]}" type="number" step="any" inputmode="decimal" value="${vals[f[0]]}"></label><input type="range" data-for="${f[0]}" min="${mn}" max="${mx}" step="${st}" value="${vals[f[0]]}" aria-label="${esc(f[1])}"></div>`; })()).join('')}</form>
  </div>`;
}
function calcOut(c, vals){
  let r; try { r = c.run(vals); } catch { return '<div class="empty">Проверьте введённые значения.</div>'; }
  const fmt = ([l, v, strong, unit]) => { const s = !isFinite(v) ? 'не достигается' : unit === '%' ? nf2.format(v) + '%' : unit === 'мес' ? nf0.format(v) + ' мес' : unit === 'лет' ? nf2.format(v).replace(/,00$/, '') + ' лет' : unit === '₽' ? nf2.format(v) + ' ₽' : unit === '₽/мес' ? rub(v) + '/мес' : rub(v); return `<div class="${strong ? 'strong' : ''}"><span class="l">${l}</span><span class="v num">${s}</span></div>`; };
  const table = r.table ? `<section class="panel"><h2>Расчёт по годам</h2><div class="tbl-wrap"><table><thead><tr>${r.table.head.map((h, i) => `<th class="${i ? 'r' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${r.table.rows.map(row => `<tr>${row.map((v, i) => `<td class="${i ? 'r num' : 'num'}">${i ? rub(v) : v}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>` : '';
  return `<div style="display:flex;flex-direction:column;gap:16px"><div class="result">${r.res.map(fmt).join('')}</div>${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}${r.chart ? `<section class="panel">${r.chart}</section>` : ''}${table}</div>`;
}

// ---------- data & more ----------
function viewData(){
  return `<div class="head"><div><h1>Подключения и данные</h1><p class="sub">${DEMO ? 'Демо-режим: данные живут до перезагрузки страницы.' : `Вы вошли как ${esc(ctx.user.email)}. Данные хранятся в вашей базе и видны только вам.`}</p></div>${DEMO ? '<a class="btn" href="./">Войти</a>' : '<button class="btn ghost" data-act="logout">Выйти</button>'}</div>
  ${viewConnections()}
  <h2 style="margin-top:8px">Данные</h2>
  <div class="grid">
    <section class="panel"><h2>Резервная копия</h2><p class="note">Файл со всеми счетами, операциями, сделками, портфелями и целями. Подходит и для переноса из первой версии на claude.ai.</p><div class="row"><button class="btn" data-act="export">Скачать копию</button><label class="btn ghost" for="import-file" style="cursor:pointer">Загрузить из файла</label><input type="file" id="import-file" accept=".json,application/json" hidden></div></section>
    <section class="panel"><h2>Импорт из банка</h2><p class="note">Вставьте строки выписки: <span class="num">дата;сумма;категория;комментарий</span>. Дата ДД.ММ.ГГГГ, расходы со знаком минус.</p>
      <textarea id="csv-in" rows="4" placeholder="05.10.2026;-1250,50;Продукты;Пятёрочка"></textarea>
      <div class="row"><label class="f" style="flex:1">Счёт<select id="csv-acc">${S().accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label><button class="btn" data-act="csv">Импортировать</button></div></section>
    <section class="panel"><h2>Категории</h2><p class="note">По одной на строку. Удалённые категории останутся в старых операциях.</p>
      <div class="form"><label class="f">Расходы<textarea id="cat-exp" rows="8">${esc(S().settings.categories.expense.join('\n'))}</textarea></label><label class="f">Доходы<textarea id="cat-inc" rows="8">${esc(S().settings.categories.income.join('\n'))}</textarea></label></div>
      <div><button class="btn" data-act="save-cats">Сохранить категории</button></div></section>
    <section class="panel"><h2>Удалить всё</h2><p class="note">Удаляет все ваши данные без возможности восстановления. Сначала скачайте копию.</p><div><button class="btn danger" data-act="reset">Удалить все данные</button></div></section>
  </div>`;
}
function viewMore(){
  const items = [['income', 'Пассивный доход', 'Прогноз купонов и дивидендов на год'], ['calendar', 'Календарь выплат', 'Купоны, оферты, погашения, дивиденды'], ['screener', 'Поиск бумаг', 'Облигации, акции и фонды Мосбиржи'], ['analysis', 'Анализ портфеля', 'Проверки и разбор от ИИ'], ['calc', 'Калькуляторы', '15 финансовых расчётов'], ['data', 'Подключения и данные', 'Т-Инвестиции, Telegram, импорт, копия']];
  return `<div class="head"><h1>Ещё</h1></div><section class="panel" style="gap:0;padding-block:6px">${items.map(([k, t, d]) => `<button data-go="${k}" style="all:unset;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)"><span><b>${t}</b><div class="sub2 muted">${d}</div></span><span class="muted">›</span></button>`).join('')}</section>`;
}

// ---------- modals ----------
const accOpts = () => S().accounts.filter(a => !a.archived).map(a => [a.id, a.name]);
function txModal(t, recurring){
  const isNew = !t?.id;
  t = {date: bud.month === ym(today()) ? today() : bud.month + '-01', type: 'expense', amount: '', account_id: S().settings.defaultAccount || S().accounts[0]?.id, category: '', note: '', day: Math.min(28, +today().slice(8)), active: true, ...t};
  const body = () => `<div class="seg" role="group" aria-label="Тип">${[['expense', 'Расход'], ['income', 'Доход'], ['transfer', 'Перевод']].map(([k, l]) => `<button type="button" data-act="txtype" data-k="${k}" aria-pressed="${t.type === k}">${l}</button>`).join('')}</div>
    <div class="form">${inp('amount', 'Сумма (в валюте счёта)', t.amount, 'number', 'required min="0.01"')}
    ${recurring ? inp('day', 'Какого числа', t.day, 'number', 'required min="1" max="28"') : inp('date', 'Дата', t.date, 'date', 'required')}
    ${sel('account_id', t.type === 'transfer' ? 'Откуда' : 'Счёт', accOpts(), t.account_id)}
    ${t.type === 'transfer' ? sel('to_account_id', 'Куда', accOpts(), t.to_account_id || S().accounts.find(a => a.id !== t.account_id)?.id) : sel('category', 'Категория', S().settings.categories[t.type].map(c => [c, c]), t.category)}
    ${inp('note', recurring ? 'Название' : 'Комментарий', t.note)}
    ${recurring && !isNew ? sel('active', 'Состояние', [['true', 'действует'], ['false', 'на паузе']], String(t.active)) : ''}</div>
    ${t.type === 'transfer' ? '<p class="note">Перевод между своими счетами не влияет на доходы и расходы. Пополнение брокерского счёта записывайте переводом.</p>' : ''}${t.type === 'income' && !recurring ? '<p class="note">Проценты по накопительному счёту — в категорию «Проценты»: они попадут в аналитику отдельно от пополнений.</p>' : ''}${recurring ? '<p class="note">Операция будет добавляться автоматически каждый месяц, начиная с текущего.</p>' : ''}`;
  openModal(recurring ? (isNew ? 'Регулярная операция' : 'Изменить регулярную') : (isNew ? 'Новая операция' : 'Изменить операцию'), `<div id="txbody" style="display:flex;flex-direction:column;gap:12px">${body()}</div>`, async fd => {
    const rec = {type: t.type, amount: num(fd.amount), account_id: fd.account_id, to_account_id: t.type === 'transfer' ? fd.to_account_id : null, category: t.type === 'transfer' ? '' : fd.category, note: fd.note || ''};
    if (!(rec.amount > 0)) { toast('Укажите сумму больше нуля'); return false; }
    if (rec.type === 'transfer' && rec.to_account_id === rec.account_id) { toast('Выберите разные счета для перевода'); return false; }
    if (recurring) {
      Object.assign(rec, {day: Math.min(28, Math.max(1, +fd.day || 1)), active: fd.active ? fd.active === 'true' : true});
      if (isNew) { rec.start_month = ym(today()); S().recurring.push(await q(sb.from('recurring').insert(rec).select().single())); await runRecurring(); }
      else Object.assign(S().recurring.find(x => x.id === t.id), await q(sb.from('recurring').update(rec).eq('id', t.id).select().single()));
      toast('Регулярная операция сохранена'); return;
    }
    rec.date = fd.date;
    if (isNew) S().tx.push(await q(sb.from('transactions').insert(rec).select().single()));
    else Object.assign(S().tx.find(x => x.id === t.id), await q(sb.from('transactions').update(rec).eq('id', t.id).select().single()));
    bud.month = rec.date.slice(0, 7); toast(isNew ? 'Операция добавлена' : 'Операция сохранена');
  }, {after: afterChange});
  txModal.cur = t; txModal.body = body;
}
function tradeModal(t){
  const isNew = !t?.id;
  t = {date: today(), type: 'buy', ticker: '', name: '', cls: 'stock', qty: '', price: '', fee: '', amount: '', kind: 'Дивиденды', portfolio_id: pf.pid && pf.pid !== 'main' ? pf.pid : '', ...t};
  t.currency ||= pfOf(t.portfolio_id)?.currency || 'RUB';
  const body = () => `<div class="seg" role="group" aria-label="Тип">${[['buy', 'Покупка'], ['sell', 'Продажа'], ['income', 'Дивиденд или купон']].map(([k, l]) => `<button type="button" data-act="trtype" data-k="${k}" aria-pressed="${t.type === k}">${l}</button>`).join('')}</div>
    <label class="f">Бумага: тикер или название<input id="m-search" type="text" value="${esc(t.ticker ? t.ticker + (t.name ? ' · ' + t.name : '') : '')}" placeholder="SBER, ОФЗ 26238, Apple, VOO, Tencent…" autocomplete="off"></label>
    <div class="sugg" id="sugg" hidden></div>
    <div class="form">${inp('ticker', 'Тикер', t.ticker, 'text', 'required style="text-transform:uppercase"')}${inp('name', 'Название', t.name)}${sel('cls', 'Класс актива', Object.entries(CLS), t.cls)}${inp('date', 'Дата', t.date, 'date', 'required')}
    ${S().portfolios.length ? sel('portfolio_id', 'Портфель', [['', 'Основной'], ...S().portfolios.map(p => [p.id, p.name])], t.portfolio_id || '') : ''}
    ${sel('currency', 'Валюта сделки', CURRENCIES, t.currency)}
    ${(pfOf(t.portfolio_id)?.region || 'ru') === 'ru' ? '<p class="note" style="grid-column:1/-1;margin:0">Российский счёт: поиск только по бумагам Мосбиржи.</p>' : '<p class="note" style="grid-column:1/-1;margin:0">Зарубежный счёт: поиск по биржам США, Европы и Азии.</p>'}
    ${t.type === 'income' ? inp('amount', 'Сумма после налога', t.amount, 'number', 'required') + sel('kind', 'Вид', [['Дивиденды', 'Дивиденды'], ['Купон', 'Купон'], ['Амортизация', 'Амортизация'], ['Прочее', 'Прочее']], t.kind)
      : inp('qty', 'Количество, шт', t.qty, 'number', 'required') + inp('price', 'Цена за 1 шт', t.price, 'number', 'required') + inp('fee', 'Комиссия', t.fee, 'number')}</div>
    <p class="note">Суммы — в валюте сделки. Облигации: цена в рублях за штуку, например 965 при 96,5% от номинала 1000. Зарубежные акции и фонды находятся поиском, их цены подтягиваются с бирж США, Европы и Азии.</p>`;
  openModal(isNew ? 'Сделка' : 'Изменить сделку', `<div id="trbody" style="display:flex;flex-direction:column;gap:12px">${body()}</div>`, async fd => {
    const rec = {date: fd.date, type: t.type, ticker: fd.ticker.trim().toUpperCase(), name: fd.name || '', cls: fd.cls, portfolio_id: fd.portfolio_id || null, currency: fd.currency || 'RUB'};
    if (!rec.ticker) { toast('Укажите тикер'); return false; }
    const region = pfOf(rec.portfolio_id)?.region || 'ru';
    if (region === 'ru' && (rec.currency !== 'RUB' || (!S().sec[rec.ticker] && S().fq?.[rec.ticker]))) { toast('На российском счёте только бумаги Мосбиржи. Зарубежные активы записывайте в портфель Freedom Finance'); return false; }
    if (t.type === 'income') Object.assign(rec, {amount: num(fd.amount), kind: fd.kind, qty: null, price: null, fee: 0});
    else Object.assign(rec, {qty: num(fd.qty), price: num(fd.price), fee: num(fd.fee), amount: null, kind: null});
    const known = positions().find(p => p.ticker === rec.ticker);
    if (t.type === 'sell' && (!known || known.qty + (isNew ? 0 : +t.qty) < rec.qty - 1e-9)) { toast('Нельзя продать больше, чем есть в портфеле'); return false; }
    if (!rec.name && known) rec.name = known.name;
    if (isNew) S().trades.push(await q(sb.from('trades').insert(rec).select().single()));
    else Object.assign(S().trades.find(x => x.id === t.id), await q(sb.from('trades').update(rec).eq('id', t.id).select().single()));
    S().trades.sort((a, b) => a.date.localeCompare(b.date));
    if (rec.cls === 'bond' && !S().events.some(e => e.ticker === rec.ticker)) await syncBondSchedules([rec.ticker]);
    if (rec.currency !== 'RUB' && !S().sec[rec.ticker] && !DEMO) await sb.functions.invoke('foreign', {body: {action: 'quote', symbols: [rec.ticker]}}).catch(() => null);
    await loadMarket();
    toast('Сделка сохранена');
  }, {after: afterChange});
  tradeModal.cur = t; tradeModal.body = body;
}
let searchTimer;
async function searchSecurities(text){
  const s = text.replace(/[^\p{L}\p{N} .-]/gu, '').trim(), box = $('#sugg');
  if (!box) return;
  if (s.length < 2) { box.hidden = true; return; }
  const pfSel = $('#mform')?.elements.portfolio_id?.value, region = pfOf(pfSel || null)?.region || 'ru';
  const [rows, foreign] = await Promise.all([
    region === 'ru' ? q(sb.from('securities').select('ticker,name,cls,price,board,logo').or(`ticker.ilike.${s}%,name.ilike.%${s}%`).order('value_today', {ascending: false, nullsFirst: false}).limit(8), true).catch(() => []) : Promise.resolve([]),
    region === 'foreign' && /[a-z0-9]/i.test(s) ? sb.functions.invoke('foreign', {body: {action: 'search', q: s}}).then(r => r.data?.results || []).catch(() => []) : Promise.resolve([]),
  ]);
  if (!$('#sugg')) return;
  rows.forEach(r => { if (r.logo) ctx.logos[r.ticker] = r.logo; });
  const moex = rows.map(r => `<button type="button" data-act="pick-sec" data-t="${esc(r.ticker)}" data-n="${esc(r.name)}" data-c="${r.cls}" data-p="${r.price ?? ''}" data-cur="RUB"><span class="sec" style="min-width:0">${logo(r.ticker, r.name, 26)}<span><b>${esc(r.name)}</b> <span class="muted">${esc(r.ticker)} · Мосбиржа</span></span></span><span class="num muted">${r.price != null ? nf2.format(r.price) + ' ₽' : ''}</span></button>`);
  const intl = foreign.filter(f => !rows.some(r => r.ticker === f.symbol)).map(f => `<button type="button" data-act="pick-sec" data-t="${esc(f.symbol)}" data-n="${esc(f.name)}" data-c="${f.type}" data-foreign="1"><span class="sec" style="min-width:0">${logo(f.symbol, f.name, 26)}<span><b>${esc(f.name)}</b> <span class="muted">${esc(f.symbol)} · ${esc(f.exchange || '')}</span></span></span><span class="chip">зарубежная</span></button>`);
  const list = region === 'ru' ? moex : intl;
  box.innerHTML = list.join('') || `<p class="note" style="padding:9px 12px">${region === 'ru' ? 'На Мосбирже не нашлось. Зарубежные бумаги добавляйте в портфель Freedom Finance.' : 'На зарубежных биржах не нашлось. Попробуйте тикер, например AAPL или VOO.'}</p>`;
  box.hidden = false;
}
function accountModal(id){
  const acc = S().accounts.find(x => x.id === id) || {name: '', type: 'card', start_balance: 0, rate: '', archived: false};
  openModal(id ? 'Изменить счёт' : 'Новый счёт', `<div class="form">${inp('name', 'Название', acc.name, 'text', 'required')}${sel('type', 'Тип', Object.entries(ACC_TYPES), acc.type)}${sel('currency', 'Валюта', CURRENCIES, acc.currency || 'RUB')}${inp('start_balance', 'Баланс на старте учёта', acc.start_balance, 'number')}${inp('rate', 'Ставка, % (для накопительных)', acc.rate ?? '', 'number')}${sel('main', 'Для быстрого ввода', [['no', 'обычный счёт'], ['yes', 'основной счёт']], S().settings.defaultAccount === id ? 'yes' : 'no')}${id ? sel('archived', 'Показывать', [['false', 'да'], ['true', 'в архиве']], String(!!acc.archived)) : ''}</div>
    <p class="note">Баланс на старте — сколько было на счёте в день, с которого вы начали учёт, в валюте счёта. Дальше он считается по операциям. Для зарубежного брокера создайте брокерский счёт в долларах или евро.</p>${id ? `<div><button type="button" class="btn danger sm" data-act="del-account" data-id="${id}">Удалить счёт</button></div>` : ''}`, async fd => {
    const rec = {name: fd.name, type: fd.type, currency: fd.currency || 'RUB', start_balance: num(fd.start_balance), rate: num(fd.rate) || null, archived: fd.archived === 'true'};
    let row;
    if (id) { row = await q(sb.from('accounts').update(rec).eq('id', id).select().single()); Object.assign(S().accounts.find(x => x.id === id), row); }
    else { row = await q(sb.from('accounts').insert(rec).select().single()); S().accounts.push(row); }
    const wantMain = fd.main === 'yes';
    if (wantMain !== (S().settings.defaultAccount === row.id)) { S().settings.defaultAccount = wantMain ? row.id : null; await saveSettings(); }
    toast('Счёт сохранён');
  }, {after: afterChange});
}
function goalModal(id){
  const g = S().goals.find(x => x.id === id) || {name: '', target: '', saved: 0, deadline: addMonths(ym(today()), 12) + '-01', ret: 10, kind: gl.tab === 'wish' ? 'wish' : 'goal'};
  openModal(id ? 'Изменить' : g.kind === 'wish' ? 'Новое желание' : 'Новая цель', `<div class="form">${inp('name', 'Название', g.name, 'text', 'required')}${sel('kind', 'Тип', [['goal', 'Цель'], ['wish', 'Желание']], g.kind || 'goal')}${inp('target', 'Сколько нужно, ₽', g.target, 'number', 'required')}${inp('saved', 'Уже накоплено, ₽', g.saved, 'number')}${inp('deadline', 'К какой дате', g.deadline, 'date', 'required')}${inp('ret', 'Доходность накоплений, % годовых', g.ret, 'number')}</div>`, async fd => {
    const rec = {name: fd.name, kind: fd.kind, target: num(fd.target), saved: num(fd.saved), deadline: fd.deadline, ret: num(fd.ret)};
    if (!(rec.target > 0)) { toast('Укажите сумму'); return false; }
    if (id) Object.assign(S().goals.find(x => x.id === id), await q(sb.from('goals').update(rec).eq('id', id).select().single()));
    else S().goals.push(await q(sb.from('goals').insert(rec).select().single()));
    toast('Сохранено');
  }, {after: afterChange});
}
function quickModal(){
  if (!S().accounts.length) return toast('Сначала создайте счета на главном экране');
  const freq = {};
  S().tx.filter(t => t.type === 'expense').slice(-200).forEach(t => freq[t.category] = (freq[t.category] || 0) + 1);
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([c]) => c).concat(S().settings.categories.expense).filter((c, i, a) => a.indexOf(c) === i).slice(0, 6);
  openModal('Записать операцию', `<div class="quick"><input id="quick-in" placeholder="450 кофе" aria-label="Сумма и описание"><button type="button" class="btn" data-act="quick-save">Добавить</button></div>
    <div class="quick-hint" id="quick-hint">${quickHint(null)}</div>
    <div class="chips">${top.map(c => `<button type="button" data-act="qchip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="row" style="justify-content:space-between"><span class="note">«+120 000 зарплата», «1200 такси вчера», «2к кино»</span><span class="row"><button type="button" class="btn ghost sm" data-act="add-tx">Подробная форма</button><button type="button" class="btn ghost sm" data-act="add-trade">Сделка с бумагой</button></span></div>`, null);
  $('#quick-in').focus();
}
function quickHint(p){
  if (!p) return 'Сумма и пара слов — категорию и дату приложение поймёт само.';
  const acc = S().accounts.find(a => a.id === p.account_id);
  return `${p.type === 'income' ? 'Доход' : 'Расход'} <b>${rub(p.amount, 1)}</b> · <b>${esc(p.category)}</b> · ${p.date === today() ? 'сегодня' : dLabel(p.date)} · ${esc(acc?.name || '')}${p.note ? ' · ' + esc(p.note) : ''}`;
}
async function saveQuick(){
  const input = $('#quick-in'), p = parseQuick(input.value);
  if (!p) return toast('Не понял сумму. Пример: 450 кофе');
  await guard(async () => { S().tx.push(await q(sb.from('transactions').insert(p).select().single())); closeModal(); afterChange(); toast(`Добавлено: ${p.category}, ${rub(p.amount, 1)}`); })();
}

// ---------- import / export ----------
async function importData(raw){
  const v1 = !raw.version, idMap = {}, pMap = {};
  for (const a of raw.accounts || []) {
    const row = await q(sb.from('accounts').insert({name: a.name, type: ACC_TYPES[a.type] ? a.type : 'other', start_balance: +(v1 ? a.start : a.start_balance) || 0, rate: +a.rate || null}).select().single());
    idMap[a.id] = row.id; S().accounts.push(row);
  }
  for (const p of raw.portfolios || []) { const row = await q(sb.from('portfolios').insert({name: p.name, kind: p.kind || 'broker', sort: p.sort || 0}).select().single()); pMap[p.id] = row.id; S().portfolios.push(row); }
  const txs = (v1 ? raw.tx : raw.transactions || []).map(t => ({date: t.date, type: t.type, amount: +t.amount, account_id: idMap[v1 ? t.account : t.account_id], to_account_id: t.type === 'transfer' ? idMap[v1 ? t.to : t.to_account_id] : null, category: t.category || '', note: t.note || ''}))
    .filter(t => t.account_id && t.amount > 0 && (t.type !== 'transfer' || t.to_account_id));
  for (let i = 0; i < txs.length; i += 500) S().tx.push(...await q(sb.from('transactions').insert(txs.slice(i, i + 500)).select()));
  const trades = (raw.trades || []).map(t => ({date: t.date, type: t.type, ticker: t.ticker, name: t.name || '', cls: CLS[t.cls] ? t.cls : 'other', qty: t.type === 'income' ? null : +t.qty, price: t.type === 'income' ? null : +t.price, fee: +t.fee || 0, amount: t.type === 'income' ? +t.amount : null, kind: t.kind || null, portfolio_id: t.portfolio_id ? pMap[t.portfolio_id] || null : null}));
  if (trades.length) S().trades.push(...await q(sb.from('trades').insert(trades).select()));
  const goals = (raw.goals || []).map(g => ({name: g.name, target: +g.target, saved: +g.saved || 0, deadline: g.deadline, ret: +g.ret || 0, kind: g.kind || 'goal', achieved: !!g.achieved}));
  if (goals.length) S().goals.push(...await q(sb.from('goals').insert(goals).select()));
  const divs = (raw.expected_dividends || []).map(d => ({ticker: d.ticker, record_date: d.record_date, per_share: +d.per_share, note: d.note || ''}));
  if (divs.length) S().divs.push(...await q(sb.from('expected_dividends').insert(divs).select()));
  if (raw.recurring?.length) {
    const rec = raw.recurring.map(r => ({type: r.type, amount: +r.amount, account_id: idMap[r.account_id], to_account_id: r.to_account_id ? idMap[r.to_account_id] : null, category: r.category || '', note: r.note || '', day: r.day, start_month: r.start_month, last_month: r.last_month, active: r.active})).filter(r => r.account_id);
    if (rec.length) S().recurring.push(...await q(sb.from('recurring').insert(rec).select()));
  }
  const settings = raw.settings || {categories: raw.categories, limits: raw.limits, targets: raw.targets};
  S().settings = {...S().settings, ...Object.fromEntries(Object.entries(settings).filter(([, v]) => v))};
  if (settings.defaultAccount) S().settings.defaultAccount = idMap[settings.defaultAccount] || null;
  await saveSettings();
  const bonds = [...new Set(trades.filter(t => t.cls === 'bond').map(t => t.ticker))];
  if (bonds.length) await syncBondSchedules(bonds.slice(0, 30));
  await loadMarket();
  const prices = raw.prices || raw.manual_prices || {};
  const manual = Object.entries(prices).filter(([t]) => S().sec[t]?.price == null).map(([ticker, price]) => ({ticker, price: +price}));
  if (manual.length) { await q(sb.from('manual_prices').upsert(manual)); manual.forEach(m => S().manual[m.ticker] = m.price); }
  return {accounts: (raw.accounts || []).length, tx: txs.length, trades: trades.length, goals: goals.length};
}
function exportData(){
  const strip = ({user_id, ...r}) => r;
  return {version: 3, exported: new Date().toISOString(), accounts: S().accounts.map(strip), portfolios: S().portfolios.map(strip), transactions: S().tx.map(strip), recurring: S().recurring.map(strip),
    trades: S().trades.map(strip), goals: S().goals.map(strip), expected_dividends: S().divs.map(strip), manual_prices: S().manual, settings: S().settings};
}

// ---------- actions ----------
let pendingConfirm = null;
function confirmIn(btn, key, msg, fn){
  if (pendingConfirm === key) { pendingConfirm = null; fn(); return; }
  pendingConfirm = key; btn.textContent = msg; btn.classList.add('danger');
  setTimeout(() => { if (pendingConfirm === key) { pendingConfirm = null; render(); } }, 3500);
}
function afterChange(){ saveCache(); render(); snapshotNetWorth().catch(() => {}); snapshotDaily().catch(() => {}); }
const del = (table, list, label) => (b, id) => confirmIn(b, table + id, 'Точно?', guard(async () => { await q(sb.from(table).delete().eq('id', id)); S()[list] = S()[list].filter(x => x.id !== id); afterChange(); toast(label); }));
const ACTIONS = {
  ...INVEST_ACTIONS,
  ...WATCH_ACTIONS,
  ...CONNECT_ACTIONS,
  ...PLAN_ACTIONS,
  ...IP_ACTIONS,
  term: b => showTerm(b),
  'load-imoex': async from => {
    ana.imoex = 'loading';
    try {
      const url = (f, t) => `https://iss.moex.com/iss/history/engines/stock/markets/index/securities/IMOEX.json?iss.meta=off&from=${f}${t ? '&till=' + t : ''}&history.columns=TRADEDATE,CLOSE`;
      const [a, b] = await Promise.all([fetch(url(from, shiftDay(from, 10))).then(r => r.json()), fetch(url(shiftDay(today(), -10))).then(r => r.json())]);
      const s = a.history.data[0], e = b.history.data[b.history.data.length - 1];
      ana.imoex = s && e ? {change: (e[1] / s[1] - 1) * 100, years: daysBetween(s[0], e[0]) / 365} : false;
    } catch { ana.imoex = false; }
    render();
  },
  close: () => closeModal(),
  quick: () => quickModal(),
  'quick-save': () => saveQuick(),
  qchip: b => { const i = $('#quick-in'), words = i.value.replace(/[^\d\s+.,к]+$/i, '').trim(); i.value = (words ? words + ' ' : '') + b.dataset.c.toLowerCase(); i.dispatchEvent(new Event('input', {bubbles: true})); i.focus(); },
  'create-defaults': guard(async () => {
    const rows = await q(sb.from('accounts').insert([{name: 'Карта', type: 'card'}, {name: 'Наличные', type: 'cash'}, {name: 'Накопительный счёт', type: 'savings'}, {name: 'Брокерский счёт', type: 'broker'}]).select());
    S().accounts.push(...rows); S().settings.defaultAccount = rows[0].id; await saveSettings(); afterChange(); toast('Счета созданы. Поправьте балансы в разделе «Бюджет»');
  }),
  'add-tx': () => { closeModal(); txModal(); },
  'edit-tx': (b, id) => txModal({...S().tx.find(t => t.id === id)}),
  'del-tx': del('transactions', 'tx', 'Операция удалена'),
  'add-rec': () => txModal(null, true),
  'edit-rec': (b, id) => txModal({...S().recurring.find(t => t.id === id)}, true),
  'del-rec': del('recurring', 'recurring', 'Регулярная операция удалена, прошлые остались'),
  txtype: b => { const cur = txModal.cur; Object.assign(cur, Object.fromEntries(new FormData($('#mform')))); cur.type = b.dataset.k; cur.category = ''; $('#txbody').innerHTML = txModal.body(); },
  trtype: b => { const cur = tradeModal.cur; Object.assign(cur, Object.fromEntries(new FormData($('#mform')))); cur.type = b.dataset.k; $('#trbody').innerHTML = tradeModal.body(); },
  'add-trade': () => { closeModal(); tradeModal(); },
  'edit-trade': (b, id) => tradeModal({...S().trades.find(t => t.id === id)}),
  'del-trade': del('trades', 'trades', 'Сделка удалена'),
  'pick-sec': async b => {
    const f = $('#mform'); f.elements.ticker.value = b.dataset.t; f.elements.name.value = b.dataset.n; f.elements.cls.value = b.dataset.c;
    if (b.dataset.cur && f.elements.currency) f.elements.currency.value = b.dataset.cur;
    if (f.elements.price && !f.elements.price.value && b.dataset.p) f.elements.price.value = b.dataset.p;
    $('#m-search').value = b.dataset.t + ' · ' + b.dataset.n; $('#sugg').hidden = true; (f.elements.qty || f.elements.amount)?.focus();
    if (b.dataset.foreign && !DEMO) {
      const { data } = await sb.functions.invoke('foreign', {body: {action: 'quote', symbols: [b.dataset.t]}}).catch(() => ({}));
      const qt = data?.quotes?.[0];
      if (qt && $('#mform')) { if (f.elements.currency && CURRENCIES.some(([c]) => c === qt.currency)) f.elements.currency.value = qt.currency; if (f.elements.price && !f.elements.price.value) f.elements.price.value = qt.price; S().fq[qt.symbol] = qt; }
    }
  },
  'ov-period': b => { ov.period = b.dataset.k; render(); },
  'pf-pick': b => { pf.pid = b.dataset.k || null; render(); },
  'pf-tab': b => { pf.tab = b.dataset.k; render(); },
  'pf-ops': b => { pf.opsFilter = b.dataset.k; render(); },
  'pf-sold': () => { pf.showSold = !pf.showSold; render(); },
  'pf-preset': b => { const f = $('#mform'), k = b.dataset.k; if (!f) return;
    Object.entries(k === 'freedom' ? {name: 'Freedom Finance', region: 'foreign', kind: 'foreign', currency: 'USD'} : {name: 'Т-Инвестиции', region: 'ru', kind: 'broker', currency: 'RUB'}).forEach(([n, v]) => { if (f.elements[n]) f.elements[n].value = v; });
    const acc = S().accounts.find(a => a.type === 'broker' && (a.currency || 'RUB') === (k === 'freedom' ? 'USD' : 'RUB')); if (acc && f.elements.account_id) f.elements.account_id.value = acc.id; },
  'add-portfolio': () => { const p = {name: '', region: 'ru', kind: 'broker', currency: 'RUB', account_id: ''};
    openModal('Новый портфель', `<div class="chips"><button type="button" data-act="pf-preset" data-k="tinv">Т-Инвестиции · Россия · ₽</button><button type="button" data-act="pf-preset" data-k="freedom">Freedom Finance · зарубежный · $</button></div>` + `<div class="form">${inp('name', 'Название', p.name, 'text', 'required placeholder="например, ИИС, Т-Инвестиции или Interactive Brokers"')}${sel('region', 'Брокер', [['ru', 'Российский'], ['foreign', 'Зарубежный']], p.region || 'ru')}${sel('kind', 'Тип счёта', [['broker', 'Брокерский счёт'], ['iis', 'ИИС'], ['foreign', 'Счёт у зарубежного брокера'], ['other', 'Другое']], p.kind)}${sel('currency', 'Основная валюта', CURRENCIES, p.currency || 'RUB')}${sel('account_id', 'Деньги на счёте брокера', [['', 'не привязан'], ...S().accounts.filter(a => a.type === 'broker').map(a => [a.id, `${a.name} · ${a.currency || 'RUB'}`])], p.account_id || '')}</div>
    <p class="note">Основная валюта — в чём показывать стоимость портфеля. Привязанный счёт нужен, чтобы видеть свободные деньги у этого брокера; создайте его в «Бюджете» с типом «Брокерский» и нужной валютой.</p>`, async fd => {
      if (fd.region === 'foreign' && fd.currency === 'RUB') fd.currency = 'USD';
      const row = await q(sb.from('portfolios').insert({name: fd.name, kind: fd.kind, region: fd.region, currency: fd.currency, account_id: fd.account_id || null, sort: S().portfolios.length}).select().single()); S().portfolios.push(row); pf.pid = row.id; toast('Портфель создан');
    }, {after: afterChange}); },
  'edit-portfolio': (b, id) => { const p = S().portfolios.find(x => x.id === id);
    openModal('Настройки портфеля', `<div class="form">${inp('name', 'Название', p.name, 'text', 'required placeholder="например, ИИС, Т-Инвестиции или Interactive Brokers"')}${sel('region', 'Брокер', [['ru', 'Российский'], ['foreign', 'Зарубежный']], p.region || 'ru')}${sel('kind', 'Тип счёта', [['broker', 'Брокерский счёт'], ['iis', 'ИИС'], ['foreign', 'Счёт у зарубежного брокера'], ['other', 'Другое']], p.kind)}${sel('currency', 'Основная валюта', CURRENCIES, p.currency || 'RUB')}${sel('account_id', 'Деньги на счёте брокера', [['', 'не привязан'], ...S().accounts.filter(a => a.type === 'broker').map(a => [a.id, `${a.name} · ${a.currency || 'RUB'}`])], p.account_id || '')}</div>
    <p class="note">Основная валюта — в чём показывать стоимость портфеля. Привязанный счёт нужен, чтобы видеть свободные деньги у этого брокера; создайте его в «Бюджете» с типом «Брокерский» и нужной валютой.</p><p class="note">При удалении портфеля его сделки перейдут в «Основной».</p><div><button type="button" class="btn danger sm" data-act="del-portfolio" data-id="${id}">Удалить портфель</button></div>`, async fd => {
      Object.assign(p, await q(sb.from('portfolios').update({name: fd.name, kind: fd.kind, region: fd.region, currency: fd.currency, account_id: fd.account_id || null}).eq('id', id).select().single())); toast('Сохранено'); }, {after: afterChange}); },
  'del-portfolio': (b, id) => confirmIn(b, 'pf' + id, 'Нажмите ещё раз', guard(async () => { await q(sb.from('portfolios').delete().eq('id', id)); S().portfolios = S().portfolios.filter(x => x.id !== id); S().trades.forEach(t => { if (t.portfolio_id === id) t.portfolio_id = null; }); pf.pid = null; closeModal(); afterChange(); })),
  'refresh-prices': guard(async b => { b.textContent = 'Обновляю…'; await Promise.all([sb.functions.invoke('moex-sync', {body: {}}).catch(() => null), sb.functions.invoke('foreign', {body: {action: 'refresh'}}).catch(() => null)]); await loadMarket(); afterChange(); toast('Котировки обновлены'); }),
  prices: () => {
    const open = positions().filter(p => p.open && !p.auto);
    if (!open.length) return toast('Все ваши бумаги получают цены с Мосбиржи автоматически');
    openModal('Цены вручную', `<p class="note">Для бумаг, которых нет на Мосбирже. Цена за 1 штуку в рублях.</p><div class="form">${open.map(p => inp('p_' + p.ticker, `${esc(p.ticker)} · ${esc(p.name)}`, S().manual[p.ticker] ?? '', 'number')).join('')}</div>`, async fd => {
      const rows = Object.entries(fd).filter(([, v]) => v !== '').map(([k, v]) => ({ticker: k.slice(2), price: num(v), updated_at: new Date().toISOString()}));
      if (rows.length) await q(sb.from('manual_prices').upsert(rows));
      rows.forEach(r => S().manual[r.ticker] = r.price); toast('Цены сохранены');
    }, {after: afterChange});
  },
  targets: () => openModal('Целевая структура', `<p class="note">Сумма долей должна быть 100%.</p><div class="form">${Object.entries(CLS).map(([k, l]) => inp('t_' + k, l + ', %', S().settings.targets[k] ?? 0, 'number')).join('')}</div>`, async fd => {
    const t = {}; let s = 0; Object.entries(fd).forEach(([k, v]) => { const n = num(v); if (n) t[k.slice(2)] = n; s += n; });
    if (Math.abs(s - 100) > 0.01) { toast(`Сейчас сумма ${nf2.format(s)}%, нужно 100%`); return false; }
    S().settings.targets = t; await saveSettings(); toast('Целевая структура сохранена');
  }, {after: afterChange}),
  limits: () => openModal('Лимиты расходов в месяц', `<div class="form">${S().settings.categories.expense.map(c => inp('l_' + c, esc(c) + ', ₽', S().settings.limits[c] ?? '', 'number', 'placeholder="без лимита"')).join('')}</div>`, async fd => {
    const l = {}; Object.entries(fd).forEach(([k, v]) => { if (num(v) > 0) l[k.slice(2)] = num(v); }); S().settings.limits = l; await saveSettings(); toast('Лимиты сохранены');
  }, {after: afterChange}),
  'add-account': () => accountModal(), 'edit-account': (b, id) => accountModal(id),
  'del-account': (b, id) => {
    if (S().tx.some(t => t.account_id === id || t.to_account_id === id)) return toast('На счёте есть операции. Его можно скрыть: выберите «в архиве»');
    confirmIn(b, 'acc' + id, 'Нажмите ещё раз', guard(async () => { await q(sb.from('accounts').delete().eq('id', id)); S().accounts = S().accounts.filter(x => x.id !== id); closeModal(); afterChange(); }));
  },
  'bud-tab': b => { bud.tab = b.dataset.k; render(); },
  'bud-month': b => { bud.month = addMonths(bud.month, +b.dataset.d); render(); },
  'bud-filter': b => { bud.filter = b.dataset.k; render(); },
  'gl-tab': b => { gl.tab = b.dataset.k; render(); },
  'add-goal': () => goalModal(), 'edit-goal': (b, id) => goalModal(id),
  'del-goal': del('goals', 'goals', 'Удалено'),
  'goal-done': guard(async (b, id) => { const g = S().goals.find(x => x.id === id); Object.assign(g, await q(sb.from('goals').update({achieved: true, saved: Math.max(+g.saved, +g.target)}).eq('id', id).select().single())); afterChange(); toast('Поздравляем! Цель достигнута'); }),
  calc: (b, id) => { calcId = id; render(); },
  export: () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 1)], {type: 'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'moi-kapital-' + today() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  csv: guard(async () => {
    const txt = $('#csv-in').value.trim(), acc = $('#csv-acc').value; if (!txt) return toast('Вставьте строки выписки');
    let bad = 0, catsChanged = false; const rows = [], cats = S().settings.categories;
    txt.split(/\r?\n/).forEach(line => {
      const p = line.split(/[;\t]/), m = (p[0] || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/), amt = num(p[1]);
      if (!m || !amt) { bad++; return; }
      const type = amt < 0 ? 'expense' : 'income', cat = (p[2] || '').trim() || 'Прочее';
      if (!cats[type].includes(cat)) { cats[type].push(cat); catsChanged = true; }
      rows.push({date: `${m[3]}-${m[2]}-${m[1]}`, type, amount: Math.abs(amt), account_id: acc, category: cat, note: (p[3] || '').trim()});
    });
    for (let i = 0; i < rows.length; i += 500) S().tx.push(...await q(sb.from('transactions').insert(rows.slice(i, i + 500)).select()));
    if (catsChanged) await saveSettings();
    afterChange(); toast(`Добавлено операций: ${rows.length}${bad ? `, пропущено строк: ${bad}` : ''}`);
  }),
  'save-cats': guard(async () => {
    const parse = id => [...new Set($(id).value.split('\n').map(s => s.trim()).filter(Boolean))];
    const exp = parse('#cat-exp'), inc = parse('#cat-inc');
    if (!exp.length || !inc.length) return toast('Оставьте хотя бы одну категорию в каждом списке');
    S().settings.categories = {expense: exp, income: inc}; await saveSettings(); toast('Категории сохранены');
  }),
  reset: b => confirmIn(b, 'reset', 'Нажмите ещё раз — всё удалится', guard(async () => {
    for (const t of ['transactions', 'recurring', 'trades', 'goals', 'manual_prices', 'net_worth', 'expected_dividends', 'portfolios', 'accounts']) await q(sb.from(t).delete().eq('user_id', ctx.user.id));
    await loadAll(); afterChange(); toast('Все данные удалены');
  })),
  logout: async () => { await sb.auth.signOut(); dropCache(); location.reload(); },
};

function go(t){ tab = t; try { localStorage.setItem('kapital-tab', tab); } catch {} history.replaceState(null, '', location.search + '#' + tab); render(); window.scrollTo(0, 0); }
document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-tab],[data-go]');
  if (nav) { closeModal(); go(nav.dataset.tab || nav.dataset.go); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = ACTIONS[b.dataset.act];
  if (act) { if (b.type !== 'checkbox') e.preventDefault(); else e.stopPropagation(); await act(b, b.dataset.id, e); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'quick-in') { $('#quick-hint').innerHTML = quickHint(parseQuick(e.target.value)); return; }
  if (e.target.id === 'm-search') { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchSecurities(e.target.value), 250); return; }
  if (investInput(e) || planInput(e) || ipInput(e)) return;
  const f = e.target.closest('#calc-form'); if (!f) return;
  if (e.target.type === 'range') f.elements[e.target.dataset.for].value = e.target.value;
  else if (e.target.name) { const r = f.querySelector(`input[type=range][data-for="${e.target.name}"]`); if (r) r.value = e.target.value; }
  const c = CALCS.find(x => x.id === calcId), v = calcVals[c.id];
  c.f.forEach(fl => { const el = f.elements[fl[0]]; v[fl[0]] = fl[3] ? el.value : num(el.value); });
  $('#calc-out').innerHTML = calcOut(c, v);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.id === 'quick-in') { e.preventDefault(); saveQuick(); }
});
document.addEventListener('change', async e => {
  if (await connectChange(e)) return;
  if (e.target.id === 'import-file') {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = guard(async () => {
      let raw; try { raw = JSON.parse(rd.result); if (!raw.accounts) throw 0; } catch { return toast('Нужен файл резервной копии этого приложения (.json)'); }
      toast('Переношу данные…');
      const r = await importData(raw);
      afterChange(); toast(`Перенесено: счетов ${r.accounts}, операций ${r.tx}, сделок ${r.trades}, целей ${r.goals}`);
    });
    rd.readAsText(file);
  }
  if ((e.target.closest('#calc-form') || e.target.closest('#scr-form') || e.target.closest('#ip-form')) && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox')) e.target.dispatchEvent(new Event('input', {bubbles: true}));
});
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (ctx.S && t && t !== tab && !t.includes('=')) { tab = t; render(); } });
window.addEventListener('online', () => { ctx.online = true; setSync(); render(); });
window.addEventListener('offline', () => { ctx.online = false; setSync(); render(); });

// ---------- render & boot ----------
function setSync(){ $('#sync').innerHTML = DEMO ? '<span class="dot local"></span>Демо-режим' : ctx.online ? '<span class="dot ok"></span>Сохраняется в облаке' : '<span class="dot local"></span>Нет интернета'; }
const VIEWS = {overview: viewOverview, portfolio: viewPortfolio, income: viewIncome, calendar: viewCalendar, screener: viewScreener, analysis: viewAnalysis, budget: viewBudget, goals: viewGoals, calc: viewCalc, data: viewData, more: viewMore};
const NAV_PARENT = {income: 'more', calendar: 'more', screener: 'more', analysis: 'more', calc: 'more', data: 'more'};
function render(){
  if (!ctx.S) return;
  if (!VIEWS[tab]) tab = 'overview';
  const narrow = matchMedia('(max-width:900px)').matches;
  document.querySelectorAll('.nav').forEach(n => n.setAttribute('aria-current', n.dataset.tab === tab || (narrow && n.dataset.tab === NAV_PARENT[tab])));
  $('#main').innerHTML = (DEMO ? '<div class="banner info"><span>Демо-режим с примерными данными: изменения живут до перезагрузки страницы.</span><a class="btn sm" href="./">Войти и вести свой учёт</a></div>' : '')
    + (ctx.online ? '' : '<div class="banner"><span>Нет интернета. Показаны данные с последнего подключения, изменения пока недоступны.</span></div>') + VIEWS[tab]();
}
Object.assign(ctx, {render, go, afterChange, saveSettings, openTrade: t => tradeModal(t)});

function showAuth(){
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const email = $('#auth-email').value.trim(), btn = $('#auth-btn');
    btn.disabled = true; btn.textContent = 'Отправляю…';
    const { error } = await sb.auth.signInWithOtp({email, options: {emailRedirectTo: location.origin + location.pathname}});
    btn.disabled = false; btn.textContent = 'Получить ссылку для входа';
    $('#auth-msg').textContent = error ? (error.status === 429 ? 'Слишком много писем подряд. Подождите минуту.' : 'Не получилось отправить письмо: ' + error.message) : `Письмо отправлено на ${email}. Откройте ссылку на этом устройстве.`;
  };
}
async function start(session){
  ctx.user = session.user;
  $('#auth').hidden = true; $('#app').hidden = false; setSync();
  const cached = loadCache();
  if (cached?.portfolios) { ctx.S = cached; render(); }
  try {
    await loadAll(); render(); saveCache();
    await runRecurring(); await snapshotNetWorth(); await snapshotDaily().catch(() => {}); render(); saveCache();
    autoSync().catch(() => {});
  } catch (e) {
    console.error(e);
    if (!ctx.S) $('#main').innerHTML = '<div class="empty">Не удалось загрузить данные. Проверьте интернет и обновите страницу.</div>';
    else toast('Нет связи с сервером, показаны сохранённые данные');
  }
}
let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (session && !started) { started = true; if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname); start(session); }
  if (event === 'SIGNED_OUT') { started = false; showAuth(); }
});
const { data: { session } } = await sb.auth.getSession();
if (!session && !started) showAuth();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
