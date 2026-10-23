// Position-by-position review: when each asset was bought, what it has earned (price, coupons, dividends, sales),
// its annual return, and a verdict with reasons — hold, add, trim, review or "don't sell yet" — from transparent rules.
import { esc, nf0, nf2, rub, pct, sgn, today } from './util.js';
import { ctx, NDFL, CLS, fx, money, positions, portfolioXirr, xirr, brokerCash, daysBetween, shiftDay, logo } from './core.js';
import { term } from './glossary.js';
import { universe, MMF } from './strategy.js';

export const rv = {open: new Set(), U: null, loading: false, sort: 'value'};
const fmtD = d => d.split('-').reverse().join('.');
const LV = {trim: ['Сократить', 'neg', 5], review: ['Пересмотреть', 'warn', 4], wait: ['Не продавать', 'gold', 3], add: ['Можно докупить', 'pos', 2], hold: ['Держать', '', 1]};
const ago = d => { const m = Math.round(daysBetween(d, today()) / 30.44); return m < 1 ? 'меньше месяца' : m < 12 ? `${m} мес` : `${nf2.format(m / 12).replace(/,?0+$/, '')} г.`; };

function tradesOf(t){ return ctx.S.trades.filter(x => x.ticker === t).sort((a, b) => a.date.localeCompare(b.date)); }
function posXirr(p, tr){
  const flows = tr.map(t => ({d: t.date, v: (t.type === 'buy' ? -(t.qty * t.price + (+t.fee || 0)) : t.type === 'sell' ? t.qty * t.price - (+t.fee || 0) : +t.amount) * fx(t.currency)}));
  if (p.open && p.value > 0) flows.push({d: today(), v: p.value});
  // under a year an annual rate just extrapolates a few months of luck, so it is shown only from 12 months on
  return flows.length > 1 && daysBetween(flows[0].d, today()) >= 365 ? xirr(flows) : NaN;
}
// actual minus target share of each asset class, in percentage points (free broker cash counts as "cash")
function classGaps(open){
  const alloc = {}; open.forEach(p => alloc[p.cls] = (alloc[p.cls] || 0) + p.value);
  alloc.cash = (alloc.cash || 0) + Math.max(0, brokerCash());
  const sum = Object.values(alloc).reduce((a, b) => a + b, 0) || 1, tg = ctx.S.settings.targets || {};
  return Object.fromEntries(Object.keys({...tg, ...alloc}).map(k => [k, (alloc[k] || 0) / sum * 100 - (+tg[k] || 0)]));
}

function signals(p, c){
  const out = [], add = (lv, text) => out.push({lv, text}), s = p.sec, share = p.value / c.pv * 100, days = p.firstBuy ? daysBetween(p.firstBuy, today()) : 0;
  const taxNote = p.unreal > 0 ? ` С прибыли при продаже удержат около ${rub(p.unreal * NDFL)} налога.` : '';
  // tax: three years of ownership make the gain tax-free (ЛДВ); a loss sold before 31 December lowers this year's tax
  if (days > 365 * 3 - 150 && days < 365 * 3 && p.unreal > 0 && !p.foreign) add('wait', `${fmtD(shiftDay(p.firstBuy, 365 * 3 + 1))} исполнится 3 года владения: прибыль станет свободной от налога (${term('ldv', 'ЛДВ')}), экономия около ${rub(p.unreal * NDFL)}. Если продавать — после этой даты.`);
  if (+today().slice(5, 7) >= 10 && p.unreal < -1000 && c.realizedYear > 0) add('review', `Бумага в минусе на ${rub(-p.unreal)}, а в этом году уже есть прибыль от продаж. Если продать до 31 декабря, убыток уменьшит налог примерно на ${rub(Math.min(-p.unreal, c.realizedYear) * NDFL)}; бумагу можно сразу купить обратно.`);
  if (p.cls === 'bond') {
    if (!s?.mat_date) { add('hold', 'Нет данных биржи по облигации — проверьте её вручную.'); return out; }
    const dm = daysBetween(today(), s.mat_date), lvl = s.board === 'TQOB' ? 0 : s.list_level;
    if (dm <= 60) add('hold', `Погашение ${fmtD(s.mat_date)}: держите до конца, вернётся около ${rub(p.qty * (s.face_value || 1000) * fx(p.cur))}. Заранее решите, куда вложить деньги, — например, в «Стратегиях».`);
    if (s.offer_date && s.offer_date > today() && daysBetween(today(), s.offer_date) <= 90) add('review', `Оферта ${fmtD(s.offer_date)}: перед ней эмитент объявит новый купон. Если он окажется ниже рынка — подайте заявку на выкуп через брокера.`);
    if (/плав/i.test(s.bond_type || '')) add('hold', 'Купон плавающий — привязан к ставке ЦБ: при снижении ставки доход снизится, зато цена почти не колеблется.');
    if (lvl >= 3 || (s.ytm && c.U && +s.ytm > c.U.ofzMed + 10)) add(share > 5 ? 'trim' : 'review', `Рынок требует ${nf2.format(+s.ytm || 0)}% годовых — это заметно выше ОФЗ (${nf2.format(c.U?.ofzMed ?? 0)}%): так оценивают повышенный риск эмитента.${share > 5 ? ` Доля ${nf0.format(share)}% — для такой бумаги принято не больше 5%.` : ''} Следите за новостями компании.`);
    else if (c.U && s.ytm && dm > 365) {
      const yrs = dm / 365, alt = c.U.bonds.filter(b => b.ticker !== p.ticker && (lvl === 0 ? b.gov : b.gov || b.list_level <= Math.max(1, lvl)) && b.ytm <= 24 && Math.abs(b.years - yrs) <= Math.max(1, yrs * 0.3)).sort((a, b) => b.ytm - a.ytm)[0];
      if (alt && alt.ytm - s.ytm >= 3) add('review', `Похожие облигации того же уровня надёжности дают больше: ${esc(alt.name)} — ${nf2.format(alt.ytm)}% против ${nf2.format(+s.ytm)}% у этой (погашение ${fmtD(alt.mat_date)}). Замена добавит около ${rub(p.value * (alt.ytm - s.ytm) / 100 * (1 - NDFL))} в год после налога.${taxNote}`);
    }
    if (!out.some(x => x.lv !== 'hold' && x.lv !== 'wait') && dm > 60) {
      if (c.gaps.bond < -5 && share < 10 && lvl <= 1) add('add', `Облигаций в портфеле на ${nf0.format(-c.gaps.bond)} п.п. меньше цели. Эта бумага надёжная и даёт ${nf2.format(+s.ytm || 0)}% — её можно докупить.`);
      else add('hold', `Держите до погашения ${fmtD(s.mat_date)}: ${term('ytm', 'доходность')} ${nf2.format(+s.ytm || 0)}% годовых, купоны около ${rub(s.coupon_value && s.coupon_period ? p.qty * s.coupon_value * 365 / s.coupon_period * (1 - NDFL) * fx(p.cur) : 0)} в год после налога.`);
    }
    return out;
  }
  if (MMF.includes(p.ticker)) { add('hold', 'Фонд денежного рынка — место для свободных денег и подушки: растёт почти каждый день вместе с ключевой ставкой, продать можно в любой день.'); return out; }
  if (share > 20) {
    const k = fx(p.cur), sell = p.price ? Math.ceil((p.value - 0.15 * c.pv) / (p.price * k)) : 0;
    add('trim', `Доля ${nf0.format(share)}% — слишком много в одной бумаге. Продайте около ${nf0.format(sell)} шт. (≈ ${rub(sell * p.price * k)}), чтобы доля стала 15%.${taxNote}`);
  } else if (share > 15) add('review', `Доля ${nf0.format(share)}% — крупная. Новые деньги лучше направлять в другие бумаги.`);
  if (p.totalPct < -30) add('review', `Бумага в минусе на ${nf0.format(-p.totalPct)}%. Проверьте, изменилось ли что-то в самой компании, а не только цена. Если причина покупки в силе — держите; если нет — продажа зафиксирует убыток, и он уменьшит налог с других прибылей.`);
  if (p.totalPct > 60 && share > 10) add('review', `Бумага выросла на ${nf0.format(p.totalPct)}%. Можно зафиксировать часть прибыли, чтобы вернуть долю к плану.`);
  const gap = c.gaps[p.cls] ?? 0;
  if (!out.length && gap < -5 && share < 10) add('add', `${CLS[p.cls]} в портфеле на ${nf0.format(-gap)} п.п. меньше цели — эту бумагу можно докупить.`);
  if (!out.length) add('hold', `Доля ${nf0.format(share)}% в норме, результат ${pct(p.totalPct)}. Держите, пока причина покупки актуальна.`);
  return out;
}

function analyse(){
  const all = positions(), open = all.filter(p => p.open), pv = open.reduce((s, p) => s + p.value, 0) || 1;
  const c = {pv, gaps: classGaps(open), U: rv.U, realizedYear: all.realizedYear || 0};
  const rows = all.map(p => {
    const tr = tradesOf(p.ticker), sig = p.open ? signals(p, c) : [];
    const verdict = sig.reduce((best, x) => LV[x.lv][2] > LV[best][2] ? x.lv : best, 'hold');
    const first = tr.find(t => t.type === 'buy')?.date || p.firstBuy, lastSell = [...tr].reverse().find(t => t.type === 'sell')?.date;
    return {...p, tr, sig, verdict, first, lastSell, irr: posXirr(p, tr), share: p.open ? p.value / pv * 100 : 0, pid: [...tr].reverse().find(t => t.portfolio_id)?.portfolio_id || ''};
  });
  return {rows, open: rows.filter(r => r.open), closed: rows.filter(r => !r.open), pv, gaps: c.gaps};
}

export function viewReview(){
  if (!rv.U && !rv.loading && ctx.S.trades.some(t => t.cls === 'bond')) { rv.loading = true; universe().then(u => { rv.U = u; }).catch(() => {}).finally(() => { rv.loading = false; ctx.render(); }); }
  const a = analyse();
  if (!a.rows.length) return '<div class="empty">Добавьте сделки в «Портфеле» — здесь появится разбор каждой бумаги.</div>';
  const sum = k => a.rows.reduce((s, p) => s + (p[k] || 0), 0), openSum = k => a.open.reduce((s, p) => s + (p[k] || 0), 0);
  const irr = portfolioXirr(), best = [...a.open].sort((x, y) => y.totalPct - x.totalPct), inc12 = ctx.S.trades.filter(t => t.type === 'income' && t.date > shiftDay(today(), -365)).reduce((s, t) => s + +t.amount * fx(t.currency), 0);
  const todo = a.open.flatMap(p => p.sig.filter(s => s.lv !== 'hold').map(s => ({p, ...s}))).sort((x, y) => LV[y.lv][2] - LV[x.lv][2]);
  const sorted = [...a.open].sort((x, y) => rv.sort === 'result' ? y.total - x.total : rv.sort === 'verdict' ? LV[y.verdict][2] - LV[x.verdict][2] || y.value - x.value : y.value - x.value);
  const bc = Math.max(0, brokerCash()), under = Object.entries(a.gaps).filter(([k, d]) => d < -5 && k !== 'cash').sort((x, y) => x[1] - y[1]);
  return `<section class="statement">
    <div style="display:flex;flex-direction:column;gap:10px"><span class="label">${term('result', 'Заработано за всё время')}</span><span class="big ${''}">${sum('total') >= 0 ? '+' : '−'}${nf0.format(Math.abs(sum('total')))}<small>₽</small></span>
      <div class="chips"><span class="chip ${isFinite(irr) ? (irr >= 0 ? 'pos' : 'neg') : ''}">${isFinite(irr) ? pct(irr * 100) + ' годовых' : 'годовая доходность — после 3 месяцев'}</span><span class="chip">${a.open.length} бумаг сейчас · ${a.closed.length} закрыто</span></div></div>
    <div class="figs">
      <div class="fig"><div class="l">Вложено сейчас</div><div class="v">${rub(openSum('cost'))}</div></div>
      <div class="fig"><div class="l">Стоит сейчас</div><div class="v">${rub(openSum('value'))}</div></div>
      <div class="fig"><div class="l">Рост цены</div><div class="v">${rub(openSum('unreal'))}</div></div>
      <div class="fig"><div class="l">Прибыль от продаж</div><div class="v">${rub(sum('realized'))}</div></div>
      <div class="fig"><div class="l">Купоны и дивиденды</div><div class="v">${rub(sum('income'))}<div class="l">за 12 мес: ${rub(inc12)}</div></div></div>
      <div class="fig"><div class="l">Комиссии</div><div class="v">−${rub(sum('fees'))}</div></div>
    </div>
  </section>
  <div class="grid2">
    <section class="panel"><div class="panel-head"><h2>Что сделать сейчас</h2><span class="note">${todo.length ? `${todo.length} ${todo.length === 1 ? 'пункт' : todo.length < 5 ? 'пункта' : 'пунктов'}` : ''}</span></div>
      ${todo.length ? todo.map(t => `<div class="check ${t.lv === 'trim' ? 'bad' : t.lv === 'add' ? 'ok' : t.lv === 'wait' ? 'info' : 'warn'}"><span class="ic">${t.lv === 'add' ? '+' : t.lv === 'wait' ? '⏳' : '!'}</span><div><b>${LV[t.lv][0]} · <button type="button" class="link" data-act="instrument" data-t="${esc(t.p.ticker)}" style="all:unset;cursor:pointer;text-decoration:underline dotted">${esc(t.p.name || t.p.ticker)}</button></b><p>${t.text}</p></div></div>`).join('')
        : '<p class="note">Срочных действий нет: все бумаги в пределах правил. Разбор каждой — в таблице ниже.</p>'}
    </section>
    <section class="panel"><h2>Что купить</h2>
      ${bc > 1000 ? `<div class="list-row"><span><b>Свободно у брокера ${rub(bc)}</b><div class="sub2 muted">Деньги без дела теряют в цене из-за инфляции</div></span><button class="btn ghost sm" data-act="rv-strategy" data-k="${under[0]?.[0] === 'stock' ? 'growth' : under[0]?.[0] === 'bond' ? 'ladder' : 'reserve'}" data-s="${Math.floor(bc)}">Подобрать</button></div>` : ''}
      ${under.map(([k, d]) => `<div class="list-row"><span><b>${CLS[k] || k}: меньше цели на ${nf0.format(-d)} п.п.</b><div class="sub2 muted">≈ ${rub(-d / 100 * (a.pv + bc))} до ${term('targets', 'целевой доли')}</div></span><button class="btn ghost sm" data-act="rv-strategy" data-k="${k === 'stock' || k === 'fund' ? 'growth' : k === 'bond' ? 'ladder' : 'reserve'}" data-s="${Math.round(-d / 100 * (a.pv + bc))}">Подобрать</button></div>`).join('')}
      ${!under.length && bc <= 1000 ? '<p class="note">Структура близка к целевой. Новые деньги распределяйте по целевым долям — или выберите цель в «Стратегиях».</p>' : ''}
      ${a.open.filter(p => p.verdict === 'add').length ? `<p class="note">Из того, что уже есть, можно докупить: ${a.open.filter(p => p.verdict === 'add').map(p => esc(p.name || p.ticker)).join(', ')}.</p>` : ''}
      <div><button class="btn ghost sm" data-go="strategy">Все стратегии →</button></div>
    </section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Каждая бумага</h2>
    <div class="periods" role="group" aria-label="Сортировка">${[['value', 'По сумме'], ['result', 'По результату'], ['verdict', 'По вердикту']].map(([k, l]) => `<button type="button" data-act="rv-sort" data-k="${k}" aria-pressed="${rv.sort === k}">${l}</button>`).join('')}</div></div>
    ${rv.loading ? '<p class="note">Сравниваю облигации с рынком…</p>' : ''}
    <div class="tbl-wrap"><table class="rv"><thead><tr><th>Бумага</th><th class="r">Куплено</th><th class="r">${term('invested', 'Вложено')}</th><th class="r">Сейчас</th><th class="r">${term('result', 'Заработано')}</th><th class="r">${term('xirr', 'Годовых')}</th><th>Вердикт</th></tr></thead><tbody>
    ${sorted.map(p => row(p)).join('')}
    </tbody></table></div>
    <p class="note">Нажмите на строку — откроется история сделок и объяснение вердикта. «Годовых» появляется после года владения: за меньший срок пересчёт в годовые искажает картину. Вердикты — правила, а не индивидуальная рекомендация: решение остаётся за вами.</p>
  </section>
  ${a.closed.length ? `<section class="panel"><h2>Закрытые позиции</h2><div class="tbl-wrap"><table><thead><tr><th>Бумага</th><th class="r">Держали</th><th class="r">Купили на</th><th class="r">Получили</th><th class="r">Результат</th><th class="r">Годовых</th></tr></thead><tbody>
    ${a.closed.sort((x, y) => (y.lastSell || '').localeCompare(x.lastSell || '')).map(p => `<tr class="click" data-act="instrument" data-t="${esc(p.ticker)}"><td><div class="sec">${logo(p.ticker, p.name)}<div><b>${esc(p.name || p.ticker)}</b><div class="sub2">${esc(CLS[p.cls] || '')}</div></div></div></td>
      <td class="r num">${p.first ? fmtD(p.first) : '—'} – ${p.lastSell ? fmtD(p.lastSell) : '—'}</td><td class="r num">${rub(p.buys)}</td><td class="r num">${rub(p.sells + p.income)}</td>
      <td class="r num ${sgn(p.total)}">${p.total >= 0 ? '+' : '−'}${rub(Math.abs(p.total))}<div class="sub2">${pct(p.totalPct)}</div></td><td class="r num ${sgn(p.irr)}">${isFinite(p.irr) ? pct(p.irr * 100) : '—'}</td></tr>`).join('')}
  </tbody></table></div></section>` : ''}`;
}

function row(p){
  const [vl, vc] = LV[p.verdict], isOpen = rv.open.has(p.ticker), cur = p.cur !== 'RUB';
  const T = {buy: 'Покупка', sell: 'Продажа', income: 'Выплата'};
  return `<tr class="click" data-act="rv-open" data-t="${esc(p.ticker)}" aria-expanded="${isOpen}"><td><div class="sec">${logo(p.ticker, p.name)}<div><b>${esc(p.name || p.ticker)}</b><div class="sub2">${esc(CLS[p.cls] || '')} · ${nf0.format(p.share)}% портфеля${cur ? ` · ${p.cur}` : ''}</div></div></div></td>
    <td class="r num">${p.first ? fmtD(p.first) : '—'}<div class="sub2">${p.first ? ago(p.first) + ' назад' : ''}${p.tr.filter(t => t.type === 'buy').length > 1 ? ` · ${p.tr.filter(t => t.type === 'buy').length} покупок` : ''}</div></td>
    <td class="r num">${rub(p.cost)}<div class="sub2">${nf2.format(p.qty).replace(/,00$/, '')} × ${money(p.avg, p.cur, 2)}</div></td>
    <td class="r num"><b>${rub(p.value)}</b><div class="sub2">${p.price != null ? money(p.price, p.cur, 2) : 'нет цены'}</div></td>
    <td class="r num ${sgn(p.total)}">${p.total >= 0 ? '+' : '−'}${rub(Math.abs(p.total))}<div class="sub2">${pct(p.totalPct)}</div></td>
    <td class="r num ${sgn(p.irr)}">${isFinite(p.irr) ? pct(p.irr * 100) : '<span class="muted" title="Годовая доходность считается после года владения">—</span>'}</td>
    <td><span class="chip ${vc}">${vl}</span></td></tr>
  ${isOpen ? `<tr class="rv-detail"><td colspan="7"><div class="rv-box">
    <div>${p.sig.map(s => `<div class="check ${s.lv === 'trim' ? 'bad' : s.lv === 'review' ? 'warn' : s.lv === 'add' ? 'ok' : 'info'}"><span class="ic">${s.lv === 'add' ? '+' : s.lv === 'hold' ? '✓' : s.lv === 'wait' ? '⏳' : '!'}</span><div><b>${LV[s.lv][0]}</b><p>${s.text}</p></div></div>`).join('')}</div>
    <div><h3>Из чего результат</h3>
      <div class="list-row"><span>Рост цены</span><span class="num ${sgn(p.unreal)}">${rub(p.unreal)}</span></div>
      ${p.income ? `<div class="list-row"><span>${p.cls === 'bond' ? 'Купоны' : 'Дивиденды'}</span><span class="num pos">${rub(p.income)}</span></div>` : ''}
      ${p.realized ? `<div class="list-row"><span>Продажи</span><span class="num ${sgn(p.realized)}">${rub(p.realized)}</span></div>` : ''}
      ${p.fees ? `<div class="list-row"><span>Комиссии</span><span class="num">−${rub(p.fees)}</span></div>` : ''}
      <h3 style="margin-top:12px">Сделки</h3>
      ${p.tr.map(t => `<div class="list-row"><span><span class="chip ${t.type === 'sell' ? 'warn' : t.type === 'income' ? 'pos' : ''}">${T[t.type]}</span> <span class="num muted">${fmtD(t.date)}</span></span><span class="num">${t.type === 'income' ? money(+t.amount, t.currency || 'RUB') : `${nf2.format(+t.qty).replace(/,00$/, '')} × ${money(+t.price, t.currency || 'RUB', 2)}`}</span></div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="btn ghost sm" data-act="instrument" data-t="${esc(p.ticker)}">Карточка и график</button><button class="btn ghost sm" data-act="scr-buy" data-t="${esc(p.ticker)}">Докупить</button><button class="btn ghost sm" data-act="rv-sell" data-t="${esc(p.ticker)}">Записать продажу</button></div>
    </div></div></td></tr>` : ''}`;
}

export const RV_ACTIONS = {
  'rv-open': (b, id, e) => { if (e.target.closest('.term,button:not([data-act="rv-open"])')) return; const t = b.dataset.t; rv.open.has(t) ? rv.open.delete(t) : rv.open.add(t); ctx.render(); },
  'rv-sort': b => { rv.sort = b.dataset.k; ctx.render(); },
  'rv-sell': b => { const p = analyse().open.find(x => x.ticker === b.dataset.t); if (p) ctx.openTrade({type: 'sell', ticker: p.ticker, name: p.name, cls: p.cls, price: p.price ?? '', date: today(), qty: p.qty, fee: '', portfolio_id: p.pid, currency: p.cur}); },
};
