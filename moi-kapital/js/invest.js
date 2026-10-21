// Investment tools that profinansy keeps behind PREMIUM: passive income, payment calendar,
// bond/stock screener, portfolio review (rule-based + optional Claude), and the instrument card.
import { $, esc, nf0, nf2, rub, pct, sgn, today, ym, addMonths, MONTHS, MONTHS_FULL, ymLabel, dLabel, short, niceMax } from './util.js';
import { viewWatch, cmp, cmpBar, isWatched } from './watch.js';
import { term, tip } from './glossary.js';
import { stressPanel } from './plan.js';
import { ichart } from './chart.js';
import { viewPlan } from './incomeplan.js';
export const incTab = {k: 'forecast'};
import { money, fx, quoteOf } from './core.js';
import { ctx, sb, q, NDFL, ISS, CLS, DEMO, positions, brokerCash, accBalances, monthStats, moneyEvents, portfolioXirr, netWorthNow,
  shiftDay, pad, num, daysBetween, monthsBetween, toast, openModal, closeModal, inp, sel, guard, logo, syncBondSchedules, smoothPath } from './core.js';

const KIND = {tax: 'Налоги', coupon: 'Купон', dividend: 'Дивиденды', amort: 'Амортизация', maturity: 'Погашение', offer: 'Оферта', recurring: 'Платёж', goal: 'Цель'};

// ---------- small charts ----------
export function stackBars(groups, series, opts = {}){
  const W = 720, H = opts.h || 220, P = {l: 56, r: 8, t: 12, b: 26};
  const tops = groups.map(g => series.reduce((s, se) => s + (g[se.key] || 0), 0));
  const nice = niceMax(Math.max(1, ...tops)), iw = W - P.l - P.r, ih = H - P.t - P.b, gw = iw / groups.length, bw = Math.min(30, gw * 0.56);
  const y = v => P.t + ih - v / nice * ih;
  let s = '';
  for (let i = 0; i <= 4; i++) { const v = nice * i / 4; s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`; }
  groups.forEach((g, i) => {
    const x = P.l + gw * i + gw / 2 - bw / 2; let acc = 0;
    series.forEach((se, k) => {
      const v = g[se.key] || 0; if (v <= 0) return;
      const top = acc + v, last = series.slice(k + 1).every(n => !(g[n.key] > 0));
      s += `<rect x="${x}" y="${y(top)}" width="${bw}" height="${Math.max(1, y(acc) - y(top))}" rx="${last ? 4 : 0}" fill="${se.color}"><title>${esc(g.label)} · ${esc(se.label)}: ${rub(v)}</title></rect>`;
      acc = top;
    });
    s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(g.label)}</text>`;
  });
  const leg = series.map(se => `<span class="row" style="gap:6px"><i class="sw" style="background:${se.color}"></i>${esc(se.label)}</span>`).join('');
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:460px;height:auto" role="img" aria-label="${esc(opts.label || 'График')}">${s}</svg></div><div class="row" style="gap:16px;font-size:12.5px;color:var(--muted)">${leg}</div>`;
}
function lineChart(points, marks = [], opts = {}){
  // points: [{d, v}]; marks: [{d, kind: 'buy'|'sell'}]
  if (points.length < 2) return '<p class="note">Нет данных для графика.</p>';
  const W = 720, H = opts.h || 240, P = {l: 56, r: 10, t: 12, b: 24};
  const vs = points.map(p => p.v), min = Math.min(...vs), max = Math.max(...vs), span = (max - min) || 1;
  const x = i => P.l + i / (points.length - 1) * (W - P.l - P.r), y = v => P.t + (1 - (v - min) / span) * (H - P.t - P.b);
  const line = smoothPath(points.map((p, i) => [x(i), y(p.v)]));
  let s = '';
  for (let i = 0; i <= 3; i++) { const v = min + span * i / 3; s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${nf2.format(v).replace(/,00$/, '')}</text>`; }
  const up = vs[vs.length - 1] >= vs[0];
  s += `<path d="${line}L${x(points.length - 1)},${H - P.b}L${P.l},${H - P.b}Z" fill="${up ? 'var(--pos)' : 'var(--neg)'}" opacity=".07"/><path d="${line}" fill="none" stroke="${up ? 'var(--pos)' : 'var(--neg)'}" stroke-width="1.8"/>`;
  const idx = d => { let best = 0; points.forEach((p, i) => { if (p.d <= d) best = i; }); return best; };
  marks.forEach(m => { const i = idx(m.d); s += `<circle cx="${x(i)}" cy="${y(points[i].v)}" r="5" fill="${m.kind === 'sell' ? 'var(--neg)' : 'var(--accent)'}" stroke="#fff" stroke-width="2"><title>${m.kind === 'sell' ? 'Продажа' : 'Покупка'} ${m.d}</title></circle>`; });
  const step = Math.ceil(points.length / 6);
  points.forEach((p, i) => { if (i % step === 0) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${dLabel(p.d)}</text>`; });
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:420px;height:auto" role="img" aria-label="${esc(opts.label || 'Цена')}">${s}</svg></div>`;
}

function priceChart(ticker, points, marks, fmt){
  const up = points[points.length - 1].v >= points[0].v;
  return ichart({id: 'px-' + ticker, dates: points.map(p => p.d), series: [{name: 'Цена', values: points.map(p => p.v), color: up ? '#86DDAE' : '#F08A7E', fill: true}], height: 240, fmt, marks});
}

// ---------- passive income ----------
function savingsInterestMonthly(){
  const bal = accBalances();
  return ctx.S.accounts.filter(a => (a.type === 'savings' || a.type === 'deposit') && a.rate).reduce((s, a) => s + Math.max(0, bal[a.id] || 0) * a.rate / 100 / 12, 0);
}
export function incomeForecast(){
  const start = ym(today()), from = today(), to = shiftDay(addMonths(start, 12) + '-01', -1);
  const ev = moneyEvents(from, to), interest = savingsInterestMonthly();
  const months = Array.from({length: 12}, (_, i) => {
    const m = addMonths(start, i), list = ev.filter(e => e.date.startsWith(m));
    const sum = k => list.filter(e => e.kind === k).reduce((s, e) => s + e.amount, 0);
    return {m, label: MONTHS[+m.slice(5) - 1], coupon: sum('coupon'), dividend: sum('dividend'), interest, principal: sum('amort') + sum('maturity'), list};
  });
  const total = months.reduce((s, m) => s + m.coupon + m.dividend + m.interest, 0), invTotal = months.reduce((s, m) => s + m.coupon + m.dividend, 0);
  return {months, total, invTotal, avg: total / 12, ev};
}
export function viewIncome(){
  const S = ctx.S, f = incomeForecast(), pos = positions().filter(p => p.open);
  const pv = pos.reduce((s, p) => s + p.value, 0);
  const expAvg = [1, 2, 3].map(k => monthStats(addMonths(ym(today()), -k)).expense).reduce((a, b) => a + b, 0) / 3;
  const past = Array.from({length: 12}, (_, i) => { const m = addMonths(ym(today()), i - 11);
    return {label: MONTHS[+m.slice(5) - 1], inv: S.trades.filter(t => t.type === 'income' && t.date.startsWith(m)).reduce((s, t) => s + +t.amount, 0),
      int: S.tx.filter(t => t.type === 'income' && t.category === 'Проценты' && t.date.startsWith(m)).reduce((s, t) => s + +t.amount, 0)}; });
  const received = past.reduce((s, m) => s + m.inv + m.int, 0);
  const goal = +S.settings.passiveGoal || 0;
  const bySec = pos.map(p => {
    const list = f.ev.filter(e => e.ticker === p.ticker && (e.kind === 'coupon' || e.kind === 'dividend'));
    const sum = list.reduce((s, e) => s + e.amount, 0), next = list[0];
    return {p, sum, next, n: list.length, yoc: p.cost ? sum / p.cost * 100 : 0};
  }).filter(r => r.sum > 0 || r.p.cls === 'bond' || r.p.cls === 'stock').sort((a, b) => b.sum - a.sum);
  const principal = f.ev.filter(e => e.kind === 'amort' || e.kind === 'maturity');
  const tabsHtml = `<div class="tabs" role="tablist">${[['forecast', 'Прогноз'], ['plan', 'Подбор под цель']].map(([k, l]) => `<button role="tab" data-act="inc-tab" data-k="${k}" aria-selected="${incTab.k === k}">${l}</button>`).join('')}</div>`;
  if (incTab.k === 'plan') return `<div class="head"><div><h1>Пассивный доход</h1><p class="sub">Скажите, сколько и когда хотите получать, — приложение подберёт облигации с уже объявленными купонами и покажет, что и до какого числа купить.</p></div></div>${tabsHtml}${viewPlan()}`;
  return `<div class="head"><div><h1>Пассивный доход</h1><p class="sub">Прогноз выплат на 12 месяцев: купоны по графику Мосбиржи, ожидаемые дивиденды и проценты по накопительным счетам. Суммы после налога 13%.</p></div>
    <div class="row"><button class="btn ghost" data-act="passive-goal">${goal ? 'Изменить цель' : 'Поставить цель'}</button><button class="btn" data-act="add-div">Ожидаемый дивиденд</button></div></div>
  ${tabsHtml}
  <section class="statement">
    <div style="display:flex;flex-direction:column;gap:10px"><span class="label">${term('passive', 'В среднем в месяц')}</span><span class="big">${rub(f.avg)}</span>
      <div class="chips"><span class="chip">${rub(f.total)} за 12 месяцев</span>${pv && f.invTotal ? `<span class="chip">купоны и дивиденды: ${nf2.format(f.invTotal / pv * 100)}% к портфелю</span>` : ''}</div></div>
    <div class="figs">
      <div class="fig"><div class="l">Покрывает расходов</div><div class="v">${expAvg ? nf0.format(f.avg / expAvg * 100) + '%' : '—'}</div></div>
      <div class="fig"><div class="l">Получено за 12 мес</div><div class="v">${rub(received)}</div></div>
      <div class="fig"><div class="l">Цель</div><div class="v">${goal ? rub(goal) + '/мес' : 'не задана'}</div></div>
      <div class="fig"><div class="l">До цели</div><div class="v">${goal ? (f.avg >= goal ? 'достигнута' : rub(goal - f.avg)) : '—'}</div></div>
    </div>
    ${goal ? `<div style="grid-column:1/-1"><div class="bar gold"><i style="width:${Math.min(100, f.avg / goal * 100)}%"></i></div></div>` : ''}
  </section>
  <section class="panel"><div class="panel-head"><h2>Прогноз по месяцам</h2><span class="note">Нажмите на столбец, чтобы увидеть выплаты</span></div>
    ${stackBars(f.months, [{key: 'coupon', label: 'Купоны', color: 'var(--c2)'}, {key: 'dividend', label: 'Дивиденды', color: 'var(--c4)'}, {key: 'interest', label: 'Проценты по вкладам', color: 'var(--c3)'}], {label: 'Пассивный доход по месяцам'})}
    <div class="tbl-wrap"><table><thead><tr><th>Месяц</th><th class="r">Купоны</th><th class="r">Дивиденды</th><th class="r">Проценты</th><th class="r">Итого</th><th class="r">Возврат номинала</th></tr></thead><tbody>
    ${f.months.map(m => `<tr class="click" data-act="goto-cal" data-m="${m.m}"><td>${ymLabel(m.m)}</td><td class="r num">${m.coupon ? rub(m.coupon) : '—'}</td><td class="r num">${m.dividend ? rub(m.dividend) : '—'}</td><td class="r num">${m.interest ? rub(m.interest) : '—'}</td><td class="r num"><b>${rub(m.coupon + m.dividend + m.interest)}</b></td><td class="r num muted">${m.principal ? rub(m.principal) : ''}</td></tr>`).join('')}
    </tbody></table></div>
  </section>
  <div class="grid2">
    <section class="panel"><h2>По бумагам</h2>
      ${bySec.length ? `<div class="tbl-wrap"><table><thead><tr><th>Бумага</th><th class="r">Выплат</th><th class="r">Ближайшая</th><th class="r">За 12 мес</th><th class="r">К вложенному</th></tr></thead><tbody>
      ${bySec.map(r => `<tr class="click" data-act="instrument" data-t="${esc(r.p.ticker)}"><td><div class="sec">${logo(r.p.ticker, r.p.name)}<div><b>${esc(r.p.name || r.p.ticker)}</b><div class="sub2">${CLS[r.p.cls]}</div></div></div></td><td class="r num">${r.n || '—'}</td><td class="r num">${r.next ? dLabel(r.next.date) : r.p.cls === 'stock' ? '<span class="faint">укажите</span>' : '—'}</td><td class="r num">${r.sum ? rub(r.sum) : '—'}</td><td class="r num">${r.sum ? nf2.format(r.yoc) + '%' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Добавьте облигации или акции в портфель — здесь появится доход по каждой бумаге.</div>'}
    </section>
    <section class="panel"><h2>Получено за год</h2>
      ${stackBars(past.map(p => ({...p})), [{key: 'inv', label: 'Купоны и дивиденды', color: 'var(--c2)'}, {key: 'int', label: 'Проценты', color: 'var(--c3)'}], {h: 180, label: 'Полученный доход'})}
      ${principal.length ? `<h3>Вернётся номинал</h3>${principal.slice(0, 5).map(e => `<div class="list-row"><span><span class="num muted">${dLabel(e.date)} ${e.date.slice(0, 4)}</span>&nbsp; ${esc(e.label)}</span><span class="num">${rub(e.amount)}</span></div>`).join('')}` : ''}
    </section>
  </div>
  <div class="grid2">
    <section class="panel"><div class="panel-head"><h2>Ожидаемые дивиденды</h2><button class="btn ghost sm" data-act="add-div">Добавить</button></div>
      <p class="note">Мосбиржа не публикует дивиденды бесплатно. Внесите прогноз из новостей компании: дату закрытия реестра и сумму на акцию.</p>
      ${S.divs.length ? S.divs.map(d => `<div class="list-row"><span class="row" style="gap:10px">${logo(d.ticker, d.ticker, 28)}<span><b>${esc(d.ticker)}</b> · ${nf2.format(d.per_share)} ₽ на акцию<div class="sub2 muted">реестр ${dLabel(d.record_date)} ${d.record_date.slice(0, 4)}${d.note ? ' · ' + esc(d.note) : ''}</div></span></span><button class="icon-btn" data-act="del-div" data-id="${d.id}" aria-label="Удалить">✕</button></div>`).join('') : ''}
    </section>
    <section class="panel"><h2>Сколько нужно вложить</h2>
      <div class="form"><label class="f">Хочу получать в месяц, ₽<input id="pl-want" type="number" inputmode="decimal" value="${goal || 50000}"></label><label class="f">Доходность, % годовых<input id="pl-yield" type="number" inputmode="decimal" value="14"></label></div>
      <div id="pl-out">${plannerOut(goal || 50000, 14)}</div>
    </section>
  </div>`;
}
function plannerOut(want, y){
  const cap = y > 0 ? want * 12 / (y / 100 * (1 - NDFL)) : 0, have = netWorthNow().invested;
  return `<div class="result"><div class="strong"><span class="l">Нужный капитал</span><span class="v num">${rub(cap)}</span></div><div><span class="l">Уже в инвестициях</span><span class="v num">${rub(have)}</span></div><div><span class="l">Осталось собрать</span><span class="v num">${rub(Math.max(0, cap - have))}</span></div></div><p class="note">С учётом налога 13% на купоны и дивиденды, без реинвестирования.</p>`;
}

// ---------- calendar ----------
export const calState = {month: ym(today()), day: null, filter: 'all'};
const CAL_FILTERS = [['all', 'Все'], ['coupon', 'Купоны'], ['dividend', 'Дивиденды'], ['risk', 'Оферты и погашения'], ['recurring', 'Платежи'], ['goal', 'Цели'], ['tax', 'Налоги']];
const passFilter = e => calState.filter === 'all' || e.kind === calState.filter || (calState.filter === 'risk' && ['offer', 'maturity', 'amort'].includes(e.kind)) || (calState.filter === 'coupon' && e.kind === 'coupon');
export function viewCalendar(){
  const m = calState.month, first = m + '-01', last = shiftDay(addMonths(m, 1) + '-01', -1);
  const ev = moneyEvents(first, last).filter(passFilter);
  const dowFirst = (new Date(first + 'T12:00:00').getDay() + 6) % 7, start = shiftDay(first, -dowFirst);
  const cells = Array.from({length: Math.ceil((dowFirst + +last.slice(8)) / 7) * 7}, (_, i) => shiftDay(start, i));
  const inSum = ev.filter(e => e.sign > 0 && e.kind !== 'recurring').reduce((s, e) => s + e.amount, 0);
  const outSum = ev.filter(e => e.kind === 'recurring' && e.sign < 0).reduce((s, e) => s + e.amount, 0);
  const risk = ev.filter(e => e.kind === 'offer' || e.kind === 'maturity');
  const dayList = calState.day ? ev.filter(e => e.date === calState.day) : ev;
  return `<div class="head"><div><h1>Календарь выплат</h1><p class="sub">Купоны, амортизации, оферты и погашения ваших облигаций по данным Мосбиржи, ожидаемые дивиденды, регулярные платежи и сроки целей.</p></div>
    <div class="row"><button class="btn ghost sm" data-act="cal-month" data-d="-1" aria-label="Предыдущий месяц">←</button><b style="min-width:140px;text-align:center">${ymLabel(m)}</b><button class="btn ghost sm" data-act="cal-month" data-d="1" aria-label="Следующий месяц">→</button>${m !== ym(today()) ? '<button class="btn ghost sm" data-act="cal-today">Сегодня</button>' : ''}</div></div>
  <div class="filters" role="group" aria-label="Тип событий">${CAL_FILTERS.map(([k, l]) => `<button data-act="cal-filter" data-k="${k}" aria-pressed="${calState.filter === k}">${l}</button>`).join('')}</div>
  <div class="kpis">
    <div class="kpi"><span class="l">Поступит за месяц</span><span class="v pos">${rub(inSum)}</span><span class="s">купоны, дивиденды, номинал</span></div>
    <div class="kpi"><span class="l">Регулярные платежи</span><span class="v">${rub(outSum)}</span></div>
    <div class="kpi"><span class="l">Оферты и погашения</span><span class="v ${risk.length ? 'warn' : ''}">${risk.length}</span><span class="s">${risk.length ? 'решите, что делать с деньгами' : 'в этом месяце нет'}</span></div>
  </div>
  <div class="grid2">
    <section class="panel">
      <div class="cal" role="grid">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div class="dow">${d}</div>`).join('')}
      ${cells.map(d => { const list = ev.filter(e => e.date === d);
        return `<div class="d ${d.slice(0, 7) !== m ? 'out' : ''} ${d === today() ? 'today' : ''}" role="gridcell" data-act="cal-day" data-d="${d}" aria-selected="${calState.day === d}"><span class="n">${+d.slice(8)}</span>${list.slice(0, 3).map(e => `<span class="ev ${e.kind}" title="${esc(e.label)}">${esc(e.kind === 'recurring' ? e.label : (e.ticker || e.label))}</span>`).join('')}${list.length > 3 ? `<span class="faint">+${list.length - 3}</span>` : ''}</div>`; }).join('')}
      </div>
    </section>
    <section class="panel"><div class="panel-head"><h2>${calState.day ? `${dLabel(calState.day)}` : 'Все события месяца'}</h2>${calState.day ? '<button class="btn ghost sm" data-act="cal-day" data-d="">Весь месяц</button>' : ''}</div>
      ${dayList.length ? dayList.map(e => `<div class="list-row"><span><span class="chip ${e.kind === 'offer' || e.kind === 'tax' ? 'warn' : e.kind === 'dividend' ? 'pos' : e.kind === 'goal' ? 'acc' : e.kind === 'recurring' ? '' : 'gold'}">${KIND[e.kind]}</span> <span class="num muted">${dLabel(e.date)}</span><div style="margin-top:3px">${esc(e.label.replace(/^[^·]+· /, ''))}</div></span><span class="num ${e.sign > 0 ? 'pos' : ''}">${e.amount ? (e.sign > 0 ? '+' : e.sign < 0 ? '−' : '') + rub(e.amount) : e.kind === 'offer' ? '<span class="warn">решение</span>' : ''}</span></div>`).join('')
        : '<p class="note">Событий нет. Купоны и оферты появятся, когда в портфеле будут облигации.</p>'}
    </section>
  </div>`;
}

// ---------- screener ----------
export const scr = {cls: 'bond', rows: null, loading: false, sort: {col: 'ytm', asc: false},
  f: {type: 'all', ytmMin: 12, ytmMax: 35, yMin: 0, yMax: 5, level: 3, cpnMin: 0, noOffer: false, liq: 1, capMin: 0}};
const BOND_PRESETS = [
  ['ofz', 'Надёжные ОФЗ', {type: 'ofz', ytmMin: 0, ytmMax: 40, yMin: 0, yMax: 15, level: 3, cpnMin: 0, noOffer: false, liq: 1}],
  ['short', 'Короткие до 3 лет', {type: 'all', ytmMin: 10, ytmMax: 30, yMin: 0.5, yMax: 3, level: 2, cpnMin: 0, noOffer: true, liq: 1}],
  ['first', 'Корпоративные 1 уровня', {type: 'corp', ytmMin: 12, ytmMax: 30, yMin: 0, yMax: 5, level: 1, cpnMin: 0, noOffer: false, liq: 1}],
  ['high', 'Высокий купон', {type: 'corp', ytmMin: 18, ytmMax: 40, yMin: 0.5, yMax: 4, level: 3, cpnMin: 18, noOffer: false, liq: 1}],
];
const STOCK_PRESETS = [['big', 'Крупнейшие компании', {capMin: 500, liq: 10}, {col: 'capitalization', asc: false}], ['liquid', 'Самые торгуемые', {capMin: 0, liq: 50}, {col: 'value_today', asc: false}], ['up', 'Растут сегодня', {capMin: 0, liq: 5}, {col: 'change_pct', asc: false}], ['down', 'Падают сегодня', {capMin: 0, liq: 5}, {col: 'change_pct', asc: true}]];
export async function loadScreener(){
  const f = scr.f; scr.loading = true;
  let qy;
  if (scr.cls === 'bond') {
    qy = sb.from('securities').select('ticker,name,logo,board,price,change_pct,ytm,coupon_pct,coupon_value,coupon_period,mat_date,offer_date,duration_days,list_level,value_today,face_value,next_coupon').eq('cls', 'bond').not('ytm', 'is', null).not('price', 'is', null)
      .gte('ytm', +f.ytmMin || 0).lte('ytm', +f.ytmMax || 100).gte('mat_date', shiftDay(today(), Math.round((+f.yMin || 0) * 365))).lte('mat_date', shiftDay(today(), Math.round((+f.yMax || 50) * 365)))
      .lte('list_level', +f.level || 3).gte('value_today', (+f.liq || 0) * 1e6);
    if (f.type === 'ofz') qy = qy.eq('board', 'TQOB'); if (f.type === 'corp') qy = qy.eq('board', 'TQCB');
    if (+f.cpnMin) qy = qy.gte('coupon_pct', +f.cpnMin);
    if (f.noOffer) qy = qy.is('offer_date', null);
  } else {
    qy = sb.from('securities').select('ticker,name,logo,board,price,change_pct,capitalization,value_today,list_level,lot').eq('cls', scr.cls).not('price', 'is', null).gte('value_today', (+f.liq || 0) * 1e6);
    if (scr.cls === 'stock' && +f.capMin) qy = qy.gte('capitalization', +f.capMin * 1e9);
  }
  qy = qy.order(scr.sort.col, {ascending: scr.sort.asc, nullsFirst: false}).limit(150);
  try { scr.rows = await q(qy, true); scr.rows.forEach(r => { if (r.logo) ctx.logos[r.ticker] = r.logo; }); } catch { scr.rows = []; toast('Не удалось загрузить бумаги'); }
  scr.loading = false; ctx.render();
}
const yrs = d => d ? nf2.format(Math.max(0, daysBetween(today(), d) / 365)).replace(/,00$/, '') : '—';
export function viewScreener(){
  const tabsHtml = `<div class="tabs" role="tablist">${[['bond', 'Облигации'], ['stock', 'Акции'], ['fund', 'Фонды'], ['watch', `Избранное${ctx.S.watch?.length ? ` (${ctx.S.watch.length})` : ''}`]].map(([k, l]) => `<button role="tab" data-act="scr-cls" data-k="${k}" aria-selected="${scr.cls === k}">${l}</button>`).join('')}</div>`;
  if (scr.cls === 'watch') return `<div class="head"><div><h1>Поиск бумаг</h1><p class="sub">Избранные бумаги с ценовыми сигналами. Отметьте 2–4 бумаги, чтобы сравнить их.</p></div></div>${tabsHtml}<section class="panel">${viewWatch()}</section><div id="cmp-slot">${cmpBar()}</div>`;
  if (!scr.rows && !scr.loading) loadScreener();
  const f = scr.f, th = (col, label, r = true) => `<th class="sort ${r ? 'r' : ''} ${scr.sort.col === col ? 'sorted' : ''}" data-act="scr-sort" data-col="${col}">${label}${scr.sort.col === col ? (scr.sort.asc ? ' ↑' : ' ↓') : ''}</th>`;
  const held = new Set(positions().filter(p => p.open).map(p => p.ticker));
  const rows = scr.rows || [];
  const filters = scr.cls === 'bond' ? `
    <div class="filters">${BOND_PRESETS.map(([k, l]) => `<button data-act="scr-preset" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="form" id="scr-form">
      ${sel('type', 'Тип', [['all', 'Все'], ['ofz', 'ОФЗ'], ['corp', 'Корпоративные']], f.type)}
      <label class="f">Доходность от, %<input name="ytmMin" type="number" inputmode="decimal" value="${f.ytmMin}"></label>
      <label class="f">Доходность до, %<input name="ytmMax" type="number" inputmode="decimal" value="${f.ytmMax}"></label>
      <label class="f">Погашение от, лет<input name="yMin" type="number" inputmode="decimal" value="${f.yMin}"></label>
      <label class="f">Погашение до, лет<input name="yMax" type="number" inputmode="decimal" value="${f.yMax}"></label>
      ${sel('level', 'Уровень листинга', [['1', 'только 1'], ['2', '1–2'], ['3', 'любой']], f.level)}
      <label class="f">Купон от, %<input name="cpnMin" type="number" inputmode="decimal" value="${f.cpnMin}"></label>
      <label class="f">Оборот за день от, млн ₽<input name="liq" type="number" inputmode="decimal" value="${f.liq}"></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px;padding-top:22px"><input name="noOffer" type="checkbox" ${f.noOffer ? 'checked' : ''}> Без оферты</label>
    </div>` : `
    <div class="filters">${scr.cls === 'stock' ? STOCK_PRESETS.map(([k, l]) => `<button data-act="scr-preset" data-k="${k}">${l}</button>`).join('') : ''}</div>
    <div class="form" id="scr-form">${scr.cls === 'stock' ? `<label class="f">Капитализация от, млрд ₽<input name="capMin" type="number" inputmode="decimal" value="${f.capMin}"></label>` : ''}<label class="f">Оборот за день от, млн ₽<input name="liq" type="number" inputmode="decimal" value="${f.liq}"></label></div>`;
  const cb = r => `<td><input class="cmp" type="checkbox" data-act="cmp-toggle" data-t="${esc(r.ticker)}" ${cmp.has(r.ticker) ? 'checked' : ''} aria-label="Сравнить"></td>`;
  const table = scr.cls === 'bond' ? `<table><thead><tr><th title="Сравнить"></th><th>Облигация</th>${th('ytm', 'Доходность' + tip('ytm'))}${th('coupon_pct', 'Купон' + tip('coupon'))}${th('price', 'Цена' + tip('face'))}${th('mat_date', 'Погашение' + tip('maturity'))}${th('duration_days', 'Дюрация' + tip('duration'))}${th('list_level', 'Ур.' + tip('listing'))}${th('value_today', 'Оборот' + tip('turnover'))}<th></th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-act="instrument" data-t="${esc(r.ticker)}">${cb(r)}<td><div class="sec">${logo(r.ticker, r.name)}<div><b>${esc(r.name)}</b>${held.has(r.ticker) ? ' <span class="chip gold">в портфеле</span>' : ''}<div class="sub2">${r.board === 'TQOB' ? term('ofz', 'ОФЗ') : term('corp', 'Корпоративная')}${r.offer_date ? ` · <span class="warn">${term('offer', 'оферта')} ${dLabel(r.offer_date)} ${r.offer_date.slice(0, 4)}</span>` : ''}</div></div></div></td>
      <td class="r num"><b>${nf2.format(r.ytm)}%</b></td><td class="r num">${r.coupon_pct != null ? nf2.format(r.coupon_pct) + '%' : '—'}<div class="sub2">${r.coupon_period ? Math.round(365 / r.coupon_period) + ' раз в год' : ''}</div></td>
      <td class="r num">${nf2.format(r.price / (r.face_value || 1000) * 100)}%<div class="sub2">${rub(r.price, 1)}</div></td><td class="r num">${r.mat_date ? `${yrs(r.mat_date)} г.<div class="sub2">${r.mat_date.split('-').reverse().join('.')}</div>` : '—'}</td>
      <td class="r num">${r.duration_days ? nf2.format(r.duration_days / 365).replace(/,00$/, '') + ' г.' : '—'}</td><td class="r num">${r.list_level ?? '—'}</td><td class="r num muted">${short(r.value_today || 0)}</td>
      <td class="r"><button class="btn ghost sm" data-act="scr-buy" data-t="${esc(r.ticker)}">Купить</button></td></tr>`).join('')}</tbody></table>`
    : `<table><thead><tr><th title="Сравнить"></th><th>Бумага</th>${th('price', 'Цена')}${th('change_pct', 'За день')}${scr.cls === 'stock' ? th('capitalization', 'Капитализация' + tip('cap')) : ''}${th('value_today', 'Оборот' + tip('turnover'))}<th></th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-act="instrument" data-t="${esc(r.ticker)}">${cb(r)}<td><div class="sec">${logo(r.ticker, r.name)}<div><b>${esc(r.name)}</b>${held.has(r.ticker) ? ' <span class="chip gold">в портфеле</span>' : ''}<div class="sub2">${esc(r.ticker)}${r.lot > 1 ? ` · лот ${r.lot}` : ''}</div></div></div></td>
      <td class="r num">${nf2.format(r.price)} ₽</td><td class="r num ${sgn(r.change_pct || 0)}">${r.change_pct != null ? pct(r.change_pct) : '—'}</td>${scr.cls === 'stock' ? `<td class="r num">${r.capitalization ? short(r.capitalization) : '—'}</td>` : ''}<td class="r num muted">${short(r.value_today || 0)}</td>
      <td class="r"><button class="btn ghost sm" data-act="scr-buy" data-t="${esc(r.ticker)}">Купить</button></td></tr>`).join('')}</tbody></table>`;
  return `<div class="head"><div><h1>Поиск бумаг</h1><p class="sub">${scr.cls === 'bond' ? 'Рублёвые облигации Мосбиржи с доходностью, купоном, сроком, дюрацией и офертами.' : scr.cls === 'stock' ? 'Акции Мосбиржи с капитализацией и оборотом торгов.' : 'Биржевые фонды Мосбиржи.'} Данные обновляются каждые полчаса.</p></div></div>
  ${tabsHtml}
  <section class="panel">${filters}</section>
  <section class="panel"><div class="panel-head"><h2>${scr.loading ? 'Ищу…' : `Найдено: ${rows.length}${rows.length >= 150 ? '+' : ''}`}</h2><span class="note">Нажмите на строку, чтобы открыть карточку бумаги</span></div>
    ${rows.length ? `<div class="tbl-wrap">${table}</div>` : scr.loading ? '' : '<div class="empty">Под фильтры ничего не подошло. Ослабьте условия.</div>'}
  </section><div id="cmp-slot">${cmpBar()}</div>`;
}

// ---------- portfolio review ----------
export const ana = {ai: null, aiLoading: false, imoex: null};
async function loadImoex(from){
  ana.imoex = 'loading';
  try {
    const [a, b] = await Promise.all([
      fetch(`${ISS}/history/engines/stock/markets/index/securities/IMOEX.json?iss.meta=off&from=${from}&till=${shiftDay(from, 10)}&history.columns=TRADEDATE,CLOSE`).then(r => r.json()),
      fetch(`${ISS}/history/engines/stock/markets/index/securities/IMOEX.json?iss.meta=off&from=${shiftDay(today(), -10)}&history.columns=TRADEDATE,CLOSE`).then(r => r.json()),
    ]);
    const s = a.history.data[0], e = b.history.data[b.history.data.length - 1];
    ana.imoex = s && e ? {from: s[0], to: e[0], change: (e[1] / s[1] - 1) * 100, years: daysBetween(s[0], e[0]) / 365} : false;
  } catch { ana.imoex = false; }
  ctx.render();
}
export function reviewChecks(){
  const S = ctx.S, pos = positions().filter(p => p.open), pv = pos.reduce((s, p) => s + p.value, 0), out = [];
  const add = (level, title, text) => out.push({level, title, text});
  if (!pos.length) { add('info', 'Портфель пуст', 'Добавьте сделки — разбор появится автоматически.'); return {checks: out, score: null}; }
  const sorted = [...pos].sort((a, b) => b.value - a.value), top = sorted[0], topShare = top.value / pv * 100;
  add(topShare > 25 ? 'bad' : topShare > 15 ? 'warn' : 'ok', 'Концентрация', `${pos.length} бумаг. Самая крупная — ${top.name || top.ticker}: ${nf0.format(topShare)}% портфеля.${topShare > 15 ? ' Если с ней что-то случится, пострадает заметная часть капитала.' : ''}`);
  const alloc = {}; pos.forEach(p => alloc[p.cls] = (alloc[p.cls] || 0) + p.value); const bc = Math.max(0, brokerCash()); alloc.cash = (alloc.cash || 0) + bc;
  const sum = Object.values(alloc).reduce((a, b) => a + b, 0) || 1, tg = S.settings.targets;
  const dev = Object.keys({...tg, ...alloc}).map(k => ({k, d: (alloc[k] || 0) / sum * 100 - (+tg[k] || 0)})).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  add(Math.abs(dev.d) > 10 ? 'bad' : Math.abs(dev.d) > 5 ? 'warn' : 'ok', 'Структура против цели', Math.abs(dev.d) <= 5 ? 'Доли классов близки к целевым.' : `${CLS[dev.k]} отклоняются от цели на ${nf0.format(Math.abs(dev.d))} п.п. (${dev.d > 0 ? 'больше' : 'меньше'} плана). Подробности — во вкладке «Состав».`);
  const ruForeign = S.trades.filter(t => (S.portfolios.find(p => p.id === t.portfolio_id)?.region || 'ru') === 'ru' && (t.currency !== 'RUB' || (!S.sec[t.ticker] && S.fq?.[t.ticker])));
  if (ruForeign.length) add('bad', 'Зарубежные бумаги на российском счёте', `${[...new Set(ruForeign.map(t => t.ticker))].join(', ')} учтены в российском портфеле. Такие бумаги рискуют блокировкой — по вашему правилу их место в портфеле Freedom Finance. Перенесите сделки: Операции → ✎ → Портфель.`);
  const byCur = {}; pos.forEach(p => byCur[p.cur] = (byCur[p.cur] || 0) + p.value);
  const nonRub = Object.entries(byCur).filter(([c]) => c !== 'RUB').reduce((s, [, v]) => s + v, 0);
  if (nonRub) add('info', 'Валюты и страны', `${nf0.format(nonRub / pv * 100)}% портфеля в иностранной валюте: ${Object.entries(byCur).filter(([c]) => c !== 'RUB').map(([c, v]) => `${c} ${nf0.format(v / pv * 100)}%`).join(', ')}. Это защищает от ослабления рубля. Отчётность по зарубежному счёту ведёте сами: 3-НДФЛ до 30 апреля, отчёт о движении средств до 1 июня, налог до 15 июля — напоминания есть в календаре. Доход в валюте пересчитывается в рубли по курсу ЦБ на дату получения.`);
  else add('info', 'Валюты и страны', 'Весь портфель в рублях. Если рубль ослабнет, покупательная способность капитала снизится. Часть капитала в валютных активах (зарубежный брокер, юаневые облигации, золото) снижает этот риск.');
  const bal = accBalances(), safe = S.accounts.filter(a => ['savings', 'deposit', 'card', 'cash'].includes(a.type)).reduce((s, a) => s + Math.max(0, bal[a.id] || 0) * fx(a.currency), 0);
  const exp = [1, 2, 3].map(k => monthStats(addMonths(ym(today()), -k)).expense).reduce((a, b) => a + b, 0) / 3;
  if (exp) { const mcov = safe / exp; add(mcov < 3 ? 'bad' : mcov < 6 ? 'warn' : 'ok', 'Подушка безопасности', `Деньги на счетах покрывают ${nf2.format(mcov).replace(/,00$/, '')} мес. расходов. Принято держать 3–6 месяцев вне биржи.`); }
  if (bc / (pv + bc) > 0.1) add('warn', 'Деньги без дела', `У брокера лежит ${rub(bc)} — ${nf0.format(bc / (pv + bc) * 100)}% портфеля. Их можно направить в фонд денежного рынка или короткие ОФЗ.`);
  const soon = moneyEvents(today(), shiftDay(today(), 90)).filter(e => e.kind === 'offer' || e.kind === 'maturity');
  if (soon.length) add('warn', 'Оферты и погашения в ближайшие 90 дней', soon.map(e => `${dLabel(e.date)} — ${e.label}`).join('; ') + '. Решите заранее, куда направить деньги или принимать ли оферту.');
  const bonds = pos.filter(p => p.cls === 'bond' && p.sec?.duration_days);
  if (bonds.length) {
    const bv = bonds.reduce((s, p) => s + p.value, 0), dur = bonds.reduce((s, p) => s + p.value * p.sec.duration_days, 0) / bv / 365;
    add(dur > 7 ? 'warn' : 'info', 'Дюрация облигаций', `Средневзвешенная дюрация ${nf2.format(dur)} года: при росте ставок на 1 п.п. облигации подешевеют примерно на ${nf2.format(dur)}%, при снижении — подорожают.`);
    const lvl3 = pos.filter(p => p.cls === 'bond' && p.sec?.list_level === 3).reduce((s, p) => s + p.value, 0);
    if (lvl3 / pv > 0.2) add('warn', 'Риск эмитентов', `${nf0.format(lvl3 / pv * 100)}% портфеля — облигации 3-го уровня листинга. Обычно это менее надёжные компании.`);
  }
  const buys = pos.reduce((s, p) => s + p.buys + p.sells, 0), fees = pos.reduce((s, p) => s + p.fees, 0);
  if (buys) add(fees / buys > 0.003 ? 'warn' : 'ok', 'Комиссии', `${rub(fees)} — ${nf2.format(fees / buys * 100)}% от оборота.${fees / buys > 0.003 ? ' Стоит проверить тариф брокера.' : ''}`);
  const irr = S.trades[0] && monthsBetween(S.trades[0].date, today()) >= 3 ? portfolioXirr() : NaN;
  if (ana.imoex == null && S.trades[0]) loadImoex(S.trades[0].date);
  if (isFinite(irr) && ana.imoex?.change != null) { const idxY = (Math.pow(1 + ana.imoex.change / 100, 1 / Math.max(ana.imoex.years, 0.25)) - 1) * 100;
    add(irr * 100 >= idxY ? 'ok' : 'warn', 'Доходность против индекса', `Портфель: ${pct(irr * 100)} годовых. Индекс Мосбиржи за тот же период: ${pct(idxY)} годовых (без учёта дивидендов).`); }
  const tax = Math.max(0, positions().realizedYear) * NDFL;
  const ldvSoon = pos.filter(p => p.firstBuy && daysBetween(p.firstBuy, today()) > 365 * 3 - 120 && daysBetween(p.firstBuy, today()) < 365 * 3);
  if (tax || ldvSoon.length) add('info', 'Налоги', `${tax ? `С продаж в этом году набежало около ${rub(tax)} налога.` : ''}${ldvSoon.length ? ` Скоро 3 года владения: ${ldvSoon.map(p => p.ticker).join(', ')} — после этого прибыль до 3 млн ₽ в год не облагается.` : ''}`);
  const score = Math.max(0, 100 - out.filter(c => c.level === 'bad').length * 15 - out.filter(c => c.level === 'warn').length * 7);
  return {checks: out, score};
}
function aiSummary(){
  const S = ctx.S, pos = positions().filter(p => p.open), pv = pos.reduce((s, p) => s + p.value, 0), nw = netWorthNow();
  const exp = [1, 2, 3].map(k => monthStats(addMonths(ym(today()), -k))), r = reviewChecks(), f = incomeForecast();
  return {date: today(), net_worth: Math.round(nw.total), invested: Math.round(nw.invested), cash_accounts: Math.round(nw.cash), broker_cash: Math.round(brokerCash()),
    targets_pct: S.settings.targets,
    positions: pos.map(p => ({ticker: p.ticker, name: p.name, class: CLS[p.cls], value: Math.round(p.value), share_pct: +(p.value / pv * 100).toFixed(1), profit_pct: +p.totalPct.toFixed(1),
      bond: p.cls === 'bond' && p.sec ? {ytm: p.sec.ytm, coupon_pct: p.sec.coupon_pct, maturity: p.sec.mat_date, offer: p.sec.offer_date, listing: p.sec.list_level, duration_years: p.sec.duration_days ? +(p.sec.duration_days / 365).toFixed(2) : null} : undefined})),
    budget_last_3_months: exp.map(m => ({income: Math.round(m.income), expense: Math.round(m.expense)})),
    passive_income_next_12m: Math.round(f.total), checks: r.checks.map(c => `${c.level}: ${c.title} — ${c.text}`)};
}
function mdLite(t){
  const lines = esc(t).split('\n'); let html = '', inList = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^[-*•] /.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${l.slice(2).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^#{1,4} /.test(l)) html += `<h4>${l.replace(/^#+ /, '')}</h4>`; else if (l) html += `<p>${l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
const CHECK_TERMS = {'Концентрация': 'concentration', 'Подушка безопасности': 'cushion', 'Дюрация облигаций': 'duration', 'Комиссии': null, 'Налоги': 'tax', 'Доходность против индекса': 'xirr', 'Структура против цели': 'targets', 'Валюты и страны': 'fx', 'Деньги без дела': 'mmf'};
export function viewAnalysis(){
  const {checks, score} = reviewChecks();
  const LV = {ok: '✓', warn: '!', bad: '!', info: 'i'};
  const ai = ana.ai;
  return `<div class="head"><div><h1>Анализ портфеля</h1><p class="sub">Автоматическая проверка: концентрация, структура, подушка, оферты, дюрация, комиссии, налоги и сравнение с индексом Мосбиржи. Плюс развёрнутый разбор от ИИ по кнопке.</p></div></div>
  <div class="grid2">
    <section class="panel"><div class="panel-head"><h2>Проверки</h2>${score != null ? `<span class="chip ${score >= 80 ? 'pos' : score >= 60 ? 'warn' : 'neg'}">${score >= 80 ? 'Порядок' : score >= 60 ? 'Есть что улучшить' : 'Нужно внимание'}</span>` : ''}</div>
      <div>${checks.map(c => `<div class="check ${c.level}"><span class="ic">${LV[c.level]}</span><div><b>${CHECK_TERMS[c.title] ? term(CHECK_TERMS[c.title], c.title) : esc(c.title)}</b><p>${esc(c.text)}</p></div></div>`).join('')}</div>
    </section>
    <div style="display:flex;flex-direction:column;gap:16px">
      ${score != null ? `<section class="statement" style="grid-template-columns:1fr"><span class="label">Оценка портфеля</span><div class="score"><span class="big">${score}</span><span style="color:var(--on-ink-muted)">из 100</span></div><p style="margin:0;color:var(--on-ink-muted);font-size:13px">Минус 15 за каждую серьёзную проблему и 7 за каждое замечание.</p></section>` : ''}
      <section class="panel"><h2>Разбор от ИИ</h2>
        <p class="note">Claude получит сводку портфеля и бюджета (без имени и почты) и разберёт сильные стороны, риски и три сценария на год. Это не индивидуальная инвестиционная рекомендация.</p>
        <label class="f">Вопрос (необязательно)<textarea id="ai-q" rows="2" placeholder="Например: что делать с деньгами от погашения в марте?"></textarea></label>
        <div><button class="btn accent" data-act="ai-run" ${ana.aiLoading ? 'disabled' : ''}>${ana.aiLoading ? 'Анализирую… до минуты' : 'Получить разбор'}</button></div>
        ${ai ? `<div class="ai-text" style="border-top:1px solid var(--line);padding-top:6px">${ai}</div>` : ''}
      </section>
    </div>
  </div>
  ${stressPanel()}`;
}
async function runAi(){
  ana.aiLoading = true; ana.ai = null; ctx.render();
  const question = $('#ai-q')?.value || '';
  try {
    const { data, error } = await sb.functions.invoke('ai-analyze', {body: {summary: aiSummary(), question}});
    if (error) throw error;
    if (data?.demo) ana.ai = '<p>В демо-режиме ИИ не вызывается. Войдите в аккаунт, чтобы получить разбор своего портфеля.</p>';
    else if (data?.error === 'no_key') ana.ai = `<h4>ИИ ещё не подключён</h4><p>Разбор делает Claude, ему нужен ключ API Anthropic. Один разбор стоит около 5–15 ₽.</p><ul><li>Создайте ключ на console.anthropic.com → API Keys.</li><li>В Supabase откройте проект moi-kapital → Edge Functions → Secrets и добавьте секрет <b>ANTHROPIC_API_KEY</b> со значением ключа.</li><li>Вернитесь сюда и нажмите кнопку ещё раз.</li></ul>`;
    else if (data?.error === 'bad_key') ana.ai = '<p>Ключ API не подошёл. Проверьте секрет ANTHROPIC_API_KEY в Supabase.</p>';
    else if (data?.error === 'rate_limited') ana.ai = '<p>Слишком много запросов подряд. Попробуйте через минуту.</p>';
    else if (data?.error) ana.ai = '<p>Не получилось получить разбор. Попробуйте позже.</p>';
    else ana.ai = mdLite(data.text || '') + (data.truncated ? '<p class="note">Ответ обрезан по длине.</p>' : '');
  } catch { ana.ai = '<p>Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.</p>'; }
  ana.aiLoading = false; ctx.render();
}

// ---------- instrument card ----------
export async function openInstrument(ticker){
  const S = ctx.S;
  let s = S.sec[ticker];
  if (!s) { s = (await q(sb.from('securities').select('*').eq('ticker', ticker).maybeSingle(), true).catch(() => null)); if (s?.logo) ctx.logos[ticker] = s.logo; }
  let fq = !s ? S.fq?.[ticker] || await q(sb.from('foreign_quotes').select('*').eq('symbol', ticker).maybeSingle(), true).catch(() => null) : null;
  if (!s && !fq && !DEMO) { const { data } = await sb.functions.invoke('foreign', {body: {action: 'quote', symbols: [ticker]}}).catch(() => ({})); fq = data?.quotes?.[0] || null; }
  if (fq) { S.fq = {...(S.fq || {}), [ticker]: fq}; s = {...fq, ticker, cls: positions().find(x => x.ticker === ticker)?.cls || 'stock', foreign: true}; }
  const p = positions().find(x => x.ticker === ticker);
  const name = s?.name || p?.name || ticker, bond = (s?.cls || p?.cls) === 'bond';
  const info = bond && s ? [[term('ytm'), s.ytm != null ? nf2.format(s.ytm) + '%' : '—'], [term('coupon'), s.coupon_pct != null ? `${nf2.format(s.coupon_pct)}% · ${rub(s.coupon_value, 1)}` : '—'], ['Выплат в год', s.coupon_period ? Math.round(365 / s.coupon_period) : '—'],
      ['Ближайший купон', s.next_coupon ? s.next_coupon.split('-').reverse().join('.') : '—'], [term('maturity'), s.mat_date ? s.mat_date.split('-').reverse().join('.') : '—'], [term('offer'), s.offer_date ? s.offer_date.split('-').reverse().join('.') : 'нет'],
      [term('nkd'), s.accrued != null ? rub(s.accrued, 1) : '—'], [term('duration'), s.duration_days ? nf2.format(s.duration_days / 365) + ' г.' : '—'], [term('listing'), s.list_level ?? '—']]
    : s?.foreign ? [['Биржа', s.exchange || '—'], ['Валюта', s.currency], ['Цена в рублях', s.price != null ? rub(s.price * fx(s.currency)) : '—'], [term('fx'), nf2.format(fx(s.currency)) + ' ₽']]
    : s ? [[term('cap'), s.capitalization ? short(s.capitalization) + ' ₽' : '—'], ['Лот', s.lot ?? '—'], [term('turnover', 'Оборот сегодня'), s.value_today ? short(s.value_today) + ' ₽' : '—'], [term('listing'), s.list_level ?? '—']] : [];
  openModal(name, `
    <div class="row" style="justify-content:space-between;align-items:flex-start"><div class="sec">${logo(ticker, name, 44)}<div><b style="font-size:16px">${esc(name)}</b><div class="sub2">${esc(ticker)} · ${esc(CLS[s?.cls || p?.cls] || '')}</div></div></div>
      <div style="text-align:right"><div class="row" style="justify-content:flex-end;gap:4px;flex-wrap:nowrap"><button type="button" class="star" data-act="watch-toggle" data-t="${esc(ticker)}" aria-pressed="${isWatched(ticker)}" title="Избранное" aria-label="Избранное">${isWatched(ticker) ? '★' : '☆'}</button><div style="font-size:22px;font-weight:650;letter-spacing:-.02em" class="num">${s?.price != null ? money(s.price, s.currency || 'RUB', 1) : '—'}</div></div>${s?.change_pct != null ? `<div class="num ${sgn(s.change_pct)}">${pct(s.change_pct)} за день</div>` : ''}</div></div>
    <div class="periods" role="group" aria-label="Период">${[['1m', '1М'], ['6m', '6М'], ['1y', '1Г'], ['3y', '3Г'], ['all', 'Всё']].map(([k, l]) => `<button type="button" data-act="inst-period" data-k="${k}" data-t="${esc(ticker)}" aria-pressed="${k === '1y'}">${l}</button>`).join('')}</div>
    <div id="inst-chart"><p class="note">Загружаю график с Мосбиржи…</p></div>
    ${p?.open ? `<div class="result"><div class="strong"><span class="l">Ваша позиция</span><span class="v num">${p.cur !== 'RUB' ? money(p.valueCur, p.cur) : rub(p.value)}</span></div><div><span class="l">Количество · средняя</span><span class="v num">${nf2.format(p.qty).replace(/,00$/, '')} · ${money(p.avg, p.cur, 1)}</span></div><div><span class="l">Результат</span><span class="v num ${sgn(p.total)}">${rub(p.total)} (${pct(p.totalPct)})</span></div></div>` : ''}
    ${info.length ? `<div class="result">${info.map(([l, v]) => `<div><span class="l">${l}</span><span class="v num" style="font-size:15px">${esc(String(v))}</span></div>`).join('')}</div>` : ''}
    ${bond ? '<div id="inst-sched"></div>' : ''}
    <div class="row"><button type="button" class="btn" data-act="scr-buy" data-t="${esc(ticker)}">Записать покупку</button><button type="button" class="btn ghost" data-act="watch-alert" data-t="${esc(ticker)}">Сигнал по цене</button>${p?.open ? `<button type="button" class="btn ghost" data-act="inst-sell" data-t="${esc(ticker)}">Записать продажу</button>` : ''}${!bond && s?.cls === 'stock' ? `<button type="button" class="btn ghost" data-act="add-div" data-t="${esc(ticker)}">Ожидаемый дивиденд</button>` : ''}</div>`, null, {wide: true});
  loadChart(ticker, s, '1y');
  if (bond) loadSchedule(ticker, p);
}
async function loadChart(ticker, s, period){
  const box = () => $('#inst-chart');
  if (!s?.board) {
    if (!s?.foreign) { if (box()) box().innerHTML = '<p class="note">Нет данных о цене — графика нет.</p>'; return; }
    const { data } = await sb.functions.invoke('foreign', {body: {action: 'history', symbol: ticker, range: {'1m': '1mo', '6m': '6mo', '1y': '1y', '3y': '3y', all: 'max'}[period] || '1y'}}).catch(() => ({}));
    const pts = data?.points || [], from = pts[0]?.d || today();
    const marks = ctx.S.trades.filter(t => t.ticker === ticker && t.type !== 'income' && t.date >= from).map(t => ({d: t.date, kind: t.type}));
    const cur = s.currency || data?.currency || 'USD';
    if (box()) box().innerHTML = pts.length ? priceChart(ticker, pts, marks, v => money(v, cur, 1)) + `<p class="note">Проведите по графику, чтобы увидеть цену на дату. ${marks.length ? 'Золотые точки — ваши покупки, красные — продажи.' : ''}</p>` : '<p class="note">Не удалось загрузить график.</p>';
    return;
  }
  const from = shiftDay(today(), -({'1m': 31, '6m': 183, '1y': 366, '3y': 365 * 3, all: 365 * 12}[period] || 366));
  const market = s.cls === 'bond' ? 'bonds' : 'shares', interval = period === 'all' ? 31 : period === '3y' ? 7 : 24;
  try {
    const all = [];
    for (let start = 0; start < 2000; start += 500) {
      const j = await fetch(`${ISS}/engines/stock/markets/${market}/boards/${s.board}/securities/${encodeURIComponent(ticker)}/candles.json?iss.meta=off&from=${from}&interval=${interval}&start=${start}&candles.columns=begin,close`).then(r => r.json());
      const rows = j.candles.data; all.push(...rows); if (rows.length < 500) break;
    }
    const k = s.cls === 'bond' ? (s.face_value || 1000) / 100 : 1;
    const points = all.map(r => ({d: r[0].slice(0, 10), v: r[1] * k}));
    const marks = ctx.S.trades.filter(t => t.ticker === ticker && t.type !== 'income' && t.date >= from).map(t => ({d: t.date, kind: t.type}));
    if (box()) box().innerHTML = points.length >= 2 ? priceChart(ticker, points, marks, v => nf2.format(v) + ' ₽') + `<p class="note">Проведите по графику, чтобы увидеть цену на дату.${marks.length ? ' Золотые точки — ваши покупки, красные — продажи.' : ''}</p>` : '<p class="note">Мало данных для графика.</p>';
  } catch { if (box()) box().innerHTML = '<p class="note">Не удалось загрузить график с Мосбиржи.</p>'; }
}
async function loadSchedule(ticker, p){
  let ev = await q(sb.from('bond_events').select('*').eq('ticker', ticker).gte('date', today()).order('date').limit(40), true).catch(() => []);
  if (!ev.length && !DEMO) { await syncBondSchedules([ticker]); ev = await q(sb.from('bond_events').select('*').eq('ticker', ticker).gte('date', today()).order('date').limit(40), true).catch(() => []); }
  const box = $('#inst-sched'); if (!box) return;
  const qty = p?.qty || 0;
  box.innerHTML = ev.length ? `<h3>Ближайшие выплаты</h3>${ev.slice(0, 8).map(e => `<div class="list-row"><span><span class="chip ${e.kind === 'offer' ? 'warn' : 'gold'}">${KIND[e.kind]}</span> <span class="num muted">${e.date.split('-').reverse().join('.')}</span></span><span class="num">${e.value_rub ? rub(e.value_rub, 1) + ' на бумагу' : ''}${qty && e.value_rub ? ` · <b>${rub(e.value_rub * qty * (e.kind === 'coupon' ? 1 - NDFL : 1))}</b> вам` : ''}</span></div>`).join('')}` : '<p class="note">График выплат Мосбиржа не публикует.</p>';
}

// ---------- expected dividends & goal ----------
function divModal(ticker){
  const held = positions().filter(p => p.open && p.cls === 'stock');
  openModal('Ожидаемый дивиденд', `<div class="form">${inp('ticker', 'Тикер акции', ticker || held[0]?.ticker || '', 'text', 'required list="div-tickers" style="text-transform:uppercase"')}<datalist id="div-tickers">${held.map(p => `<option value="${esc(p.ticker)}">${esc(p.name)}</option>`).join('')}</datalist>
    ${inp('per_share', 'Дивиденд на акцию, ₽', '', 'number', 'required min="0.0001"')}${inp('record_date', 'Дата закрытия реестра', '', 'date', 'required')}${inp('note', 'Комментарий', '', 'text', 'placeholder="например, рекомендация совета директоров"')}</div>
    <p class="note">Чтобы получить дивиденд, акции нужно купить за день до закрытия реестра.</p>`, async fd => {
    const row = {ticker: fd.ticker.trim().toUpperCase(), per_share: num(fd.per_share), record_date: fd.record_date, note: fd.note || ''};
    if (!(row.per_share > 0)) { toast('Укажите сумму на акцию'); return false; }
    ctx.S.divs.push(await q(sb.from('expected_dividends').insert(row).select().single()));
    ctx.S.divs.sort((a, b) => a.record_date.localeCompare(b.record_date)); toast('Дивиденд добавлен в прогноз');
  }, {after: () => ctx.afterChange()});
}

export const INVEST_ACTIONS = {
  'goto-cal': b => { calState.month = b.dataset.m; calState.day = null; ctx.go('calendar'); },
  'cal-month': b => { calState.month = addMonths(calState.month, +b.dataset.d); calState.day = null; ctx.render(); },
  'cal-today': () => { calState.month = ym(today()); calState.day = null; ctx.render(); },
  'cal-day': b => { calState.day = b.dataset.d && calState.day !== b.dataset.d ? b.dataset.d : null; ctx.render(); },
  'cal-filter': b => { calState.filter = b.dataset.k; ctx.render(); },
  'scr-cls': b => { scr.cls = b.dataset.k; if (scr.cls === 'watch') return ctx.render(); scr.sort = b.dataset.k === 'bond' ? {col: 'ytm', asc: false} : {col: 'value_today', asc: false}; scr.f.liq = b.dataset.k === 'bond' ? 1 : 5; scr.rows = null; ctx.render(); },
  'scr-sort': b => { const c = b.dataset.col; scr.sort = {col: c, asc: scr.sort.col === c ? !scr.sort.asc : ['mat_date', 'duration_days', 'list_level', 'price'].includes(c)}; loadScreener(); },
  'scr-preset': b => {
    if (scr.cls === 'bond') { const p = BOND_PRESETS.find(x => x[0] === b.dataset.k); scr.f = {...scr.f, ...p[2]}; scr.sort = {col: 'ytm', asc: false}; }
    else { const p = STOCK_PRESETS.find(x => x[0] === b.dataset.k); scr.f = {...scr.f, ...p[2]}; scr.sort = p[3]; }
    scr.rows = null; ctx.render();
  },
  'scr-buy': async b => { const t = b.dataset.t; const s = ctx.S.sec[t] || await q(sb.from('securities').select('ticker,name,cls,price').eq('ticker', t).maybeSingle(), true).catch(() => null); closeModal(); ctx.openTrade({type: 'buy', ticker: t, name: s?.name || '', cls: s?.cls || 'stock', price: s?.price ?? '', date: today(), qty: '', fee: ''}); },
  'inst-sell': b => { const p = positions().find(x => x.ticker === b.dataset.t); closeModal(); ctx.openTrade({type: 'sell', ticker: p.ticker, name: p.name, cls: p.cls, price: p.price ?? '', date: today(), qty: p.qty, fee: '', portfolio_id: ''}); },
  instrument: b => openInstrument(b.dataset.t),
  'inst-period': b => { b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); const t = b.dataset.t; loadChart(t, ctx.S.sec[t] || (ctx.S.fq?.[t] ? {...ctx.S.fq[t], foreign: true} : null), b.dataset.k); },
  'add-div': b => { closeModal(); divModal(b.dataset.t); },
  'del-div': guard(async (b, id) => { await q(sb.from('expected_dividends').delete().eq('id', id)); ctx.S.divs = ctx.S.divs.filter(d => d.id !== id); ctx.afterChange(); toast('Удалено'); }),
  'passive-goal': () => openModal('Цель пассивного дохода', inp('goal', 'Хочу получать в месяц, ₽', ctx.S.settings.passiveGoal || '', 'number', 'required'), async fd => { ctx.S.settings.passiveGoal = num(fd.goal); await ctx.saveSettings(); toast('Цель сохранена'); }, {after: () => ctx.afterChange()}),
  'ai-run': () => runAi(),
  'inc-tab': b => { incTab.k = b.dataset.k; ctx.render(); },
};
export function investInput(e){
  if (e.target.closest('#scr-form')) {
    const form = e.target.closest('#scr-form');
    for (const el of form.elements) if (el.name) scr.f[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    clearTimeout(investInput.t); investInput.t = setTimeout(loadScreener, 350);
    return true;
  }
  if (e.target.id === 'pl-want' || e.target.id === 'pl-yield') { $('#pl-out').innerHTML = plannerOut(num($('#pl-want').value), num($('#pl-yield').value)); return true; }
  return false;
}
