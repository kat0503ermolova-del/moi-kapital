// Income builder: "I want N ₽ a month (or in these months) — what should I buy and by when?"
// Uses only bonds whose every coupon inside the horizon is already fixed in the Moscow Exchange schedule,
// so the plan is built on published numbers, not forecasts. Expected dividends the user entered can be counted on top.
import { $, esc, nf0, nf2, rub, today, ym, addMonths, MONTHS, MONTHS_FULL, ymLabel, dLabel } from './util.js';
import { ctx, sb, q, NDFL, DEMO, moneyEvents, shiftDay, daysBetween, num, toast, logo, guard, saveSettings } from './core.js';
import { term } from './glossary.js';
import { stackBars } from './invest.js';

export const ip = {prio: 'diverse', target: 30000, mode: 'monthly', months: [], horizon: 12, risk: 'balanced', existing: true, maxShare: 20, result: null, loading: false, err: null};
const RISKS = [['safe', 'Только ОФЗ', 'государственные облигации — максимальная надёжность'], ['balanced', 'ОФЗ + надёжные компании', 'плюс облигации 1-го уровня листинга'], ['yield', 'Повышенная доходность', 'плюс 2-й уровень листинга, доходность до 30%']];

function loadSaved(){ const s = ctx.S.settings.incomePlan; if (s) Object.assign(ip, s, {result: null}); }

async function buildPlan(){
  ip.loading = true; ip.err = null; ip.result = null; ctx.render();
  try {
    // the plan starts next month: this month's coupon dates have mostly passed
    const start = addMonths(ym(today()), 1), endDate = shiftDay(addMonths(start, ip.horizon) + '-01', -1);
    const months = Array.from({length: ip.horizon}, (_, i) => addMonths(start, i)).filter(m => ip.mode === 'monthly' || ip.months.includes(+m.slice(5)));
    if (!months.length) throw new Error('Выберите хотя бы один месяц');
    // 1. candidates: liquid rouble bonds that live past the horizon and have no offer inside it
    let qy = sb.from('securities').select('ticker,name,board,price,accrued,face_value,ytm,coupon_value,coupon_period,coupon_pct,mat_date,offer_date,list_level,value_today,logo')
      .eq('cls', 'bond').not('price', 'is', null).gt('coupon_value', 0).gt('coupon_period', 0).gt('mat_date', endDate).gte('value_today', 500000).gte('ytm', 4).lte('ytm', ip.risk === 'yield' ? 30 : 24);
    if (ip.risk === 'safe') qy = qy.eq('board', 'TQOB');
    else if (ip.risk === 'balanced') qy = qy.lte('list_level', 1);
    else qy = qy.lte('list_level', 2);
    let cands = await q(qy.order('ytm', {ascending: false}).limit(70), true);
    cands = cands.filter(c => !c.offer_date || c.offer_date > endDate);
    if (!cands.length) throw new Error('Не нашлось облигаций под эти условия');
    cands.forEach(c => { if (c.logo) ctx.logos[c.ticker] = c.logo; });
    // 2. exact coupon schedules from the exchange (fetched on demand, cached in bond_events)
    const tickers = cands.map(c => c.ticker);
    let ev = await q(sb.from('bond_events').select('ticker,date,kind,value_rub').in('ticker', tickers).gte('date', today()).lte('date', endDate), true).catch(() => []);
    const have = new Set(ev.map(e => e.ticker)), missing = tickers.filter(t => !have.has(t));
    for (let i = 0; i < missing.length; i += 30) await sb.functions.invoke('moex-sync', {body: {tickers: missing.slice(i, i + 30)}}).catch(() => null);
    if (missing.length) ev = await q(sb.from('bond_events').select('ticker,date,kind,value_rub').in('ticker', tickers).gte('date', today()).lte('date', endDate), true).catch(() => []);
    // 3. keep only bonds whose every coupon in the horizon is already known
    const byT = {};
    ev.filter(e => e.kind === 'coupon').forEach(e => (byT[e.ticker] ||= []).push(e));
    const pool = cands.map(c => {
      const cps = byT[c.ticker] || [];
      if (!cps.length || cps.some(e => !(+e.value_rub > 0))) return null;
      const perMonth = {}; cps.forEach(e => { const m = e.date.slice(0, 7); perMonth[m] = (perMonth[m] || 0) + e.value_rub * (1 - NDFL); });
      const unit = +c.price + (+c.accrued || 0), issuer = c.name.replace(/\s*[\d].*$/, '').replace(/\s+(БО|ПБО|обл).*/i, '').trim().toUpperCase();
      return {...c, cps, perMonth, unit, issuer, firstCoupon: cps.map(e => e.date).sort()[0]};
    }).filter(Boolean);
    if (!pool.length) throw new Error('У подходящих облигаций будущие купоны ещё не объявлены');
    // 4. what is still missing each month after current holdings
    const existing = {};
    if (ip.existing) moneyEvents(today(), endDate).filter(e => e.kind === 'coupon' || e.kind === 'dividend').forEach(e => { const m = e.date.slice(0, 7); existing[m] = (existing[m] || 0) + e.amount; });
    const need = Object.fromEntries(months.map(m => [m, Math.max(0, ip.target - (existing[m] || 0))]));
    // 5. greedy: repeatedly add the bond that covers the most remaining shortfall per rouble, with a per-issuer cap
    const avgYield = pool.reduce((s, b) => s + b.ytm, 0) / pool.length / 100 * (1 - NDFL);
    const estTotal = ip.target * (ip.mode === 'monthly' ? 12 : Math.max(1, months.length * 12 / ip.horizon)) / Math.max(0.05, avgYield);
    const cap = estTotal * ip.maxShare / 100, spent = {}, units = {};
    // government bonds (OFZ) are not capped per issuer; if the cap stops the plan short, a second pass lifts it
    const isGov = b => b.board === 'TQOB';
    let relaxed = false;
    // raise the issuer cap step by step instead of dropping it, so no single company takes over the plan
    for (const mult of [1, 1.5, 2, 3, Infinity]) {
      if (months.every(m => need[m] <= 1)) break;
      if (mult > 1) relaxed = true;
      const lim = cap * mult;
      for (let it = 0; it < 4000; it++) {
        let best = null;
        for (const b of pool) {
          if (!isGov(b) && (spent[b.issuer] || 0) + b.unit > lim && (spent[b.issuer] || 0) > 0) continue;
          let gain = 0;
          for (const m of months) if (need[m] > 0 && b.perMonth[m]) gain += Math.min(need[m], b.perMonth[m]);
          if (gain <= 0) continue;
          const score = gain / b.unit;
          if (!best || score > best.score) best = {b, score};
        }
        if (!best) break;
        const b = best.b, mm = months.filter(m => need[m] > 0 && b.perMonth[m]);
        const room = !isGov(b) && lim < Infinity ? Math.max(1, Math.floor((lim - (spent[b.issuer] || 0)) / b.unit)) : Infinity;
        const k = Math.max(1, Math.min(Math.floor(Math.min(...mm.map(m => need[m] / b.perMonth[m]))), room));
        units[b.ticker] = (units[b.ticker] || 0) + k; spent[b.issuer] = (spent[b.issuer] || 0) + k * b.unit;
        months.forEach(m => { if (b.perMonth[m]) need[m] -= k * b.perMonth[m]; });
        if (months.every(m => need[m] <= 1)) break;
      }
    }
    // trim surplus a little at a time, always from the issuer with the largest share, while every month stays covered
    for (let it = 0; it < 3000; it++) {
      const removable = pool.filter(b => units[b.ticker]).map(b => {
        const ms = months.filter(m => b.perMonth[m]);
        const drop = ms.length ? Math.min(units[b.ticker], ...ms.map(m => Math.floor(Math.max(0, -need[m]) / b.perMonth[m]))) : units[b.ticker];
        return {b, drop};
      }).filter(x => x.drop > 0).sort((x, y) => (spent[y.b.issuer] || 0) - (spent[x.b.issuer] || 0) || x.b.ytm - y.b.ytm);
      // a cut is allowed only if the largest non-government issuer's share does not get worse (or stays within the limit)
      const maxShareOf = sp => { const t = Object.values(sp).reduce((s, v) => s + v, 0) || 1; return Math.max(0, ...pool.filter(x => !isGov(x) && sp[x.issuer] > 0).map(x => sp[x.issuer] / t * 100)); };
      const before = maxShareOf(spent);
      const pick = removable.map(x => ({...x, k: Math.max(1, Math.ceil(x.drop / 3))})).find(({b, k}) => { const sp = {...spent, [b.issuer]: spent[b.issuer] - k * b.unit}; return ip.prio === 'cheap' || maxShareOf(sp) <= Math.max(before, ip.maxShare) + 0.01; });
      if (!pick) break;
      const {b, k} = pick;
      units[b.ticker] -= k; spent[b.issuer] -= k * b.unit;
      months.forEach(m => { if (b.perMonth[m]) need[m] += k * b.perMonth[m]; });
    }
    const rows = pool.filter(b => units[b.ticker]).map(b => ({...b, qty: units[b.ticker], cost: units[b.ticker] * b.unit,
      buyBy: shiftDay(b.firstCoupon, -2), income: Object.fromEntries(Object.entries(b.perMonth).map(([m, v]) => [m, v * units[b.ticker]]))})).sort((a, b) => a.buyBy.localeCompare(b.buyBy));
    const plan = Array.from({length: ip.horizon}, (_, i) => addMonths(start, i)).map(m => ({m, label: MONTHS[+m.slice(5) - 1], have: existing[m] || 0, plan: rows.reduce((s, r) => s + (r.income[m] || 0), 0), target: months.includes(m)}));
    const uncovered = months.filter(m => need[m] > 1);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    rows.forEach(r => { r.share = totalCost ? (spent[r.issuer] || 0) / totalCost * 100 : 0; r.over = !isGov(r) && r.share > ip.maxShare + 0.5; });
    ip.result = {relaxed: relaxed && rows.some(r => r.over), rows, plan, months, uncovered, total: rows.reduce((s, r) => s + r.cost, 0), yearIncome: plan.reduce((s, p) => s + p.plan, 0), poolSize: pool.length};
  } catch (e) { ip.err = e.message || 'Не удалось подобрать'; }
  ip.loading = false; ctx.render();
}

export function viewPlan(){
  if (!ip._loaded) { loadSaved(); ip._loaded = true; }
  const r = ip.result;
  const monthPick = MONTHS_FULL.map((m, i) => `<button type="button" data-act="ip-month" data-k="${i + 1}" aria-pressed="${ip.months.includes(i + 1)}">${m.slice(0, 3)}</button>`).join('');
  return `<section class="panel"><div class="panel-head"><h2>Подбор под цель</h2><span class="note">Только опубликованные купоны Мосбиржи</span></div>
    <form class="form" id="ip-form" autocomplete="off">
      <label class="f">Хочу получать, ₽ после налога<input name="target" type="number" inputmode="decimal" value="${ip.target}"></label>
      <label class="f">Когда<select name="mode"><option value="monthly" ${ip.mode === 'monthly' ? 'selected' : ''}>каждый месяц</option><option value="custom" ${ip.mode === 'custom' ? 'selected' : ''}>в выбранные месяцы</option></select></label>
      <label class="f">На сколько вперёд<select name="horizon">${[6, 12, 24, 36].map(h => `<option value="${h}" ${ip.horizon === h ? 'selected' : ''}>${h} мес</option>`).join('')}</select></label>
      <label class="f">Надёжность<select name="risk">${RISKS.map(([k, l]) => `<option value="${k}" ${ip.risk === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Не больше в одного эмитента, %<input name="maxShare" type="number" inputmode="decimal" value="${ip.maxShare}"></label>
      <label class="f">Приоритет<select name="prio"><option value="diverse" ${ip.prio === 'diverse' ? 'selected' : ''}>разнообразие — меньше риска</option><option value="cheap" ${ip.prio === 'cheap' ? 'selected' : ''}>минимум вложений</option></select></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px;padding-top:22px"><input name="existing" type="checkbox" ${ip.existing ? 'checked' : ''}> Учесть то, что уже есть</label>
    </form>
    ${ip.mode === 'custom' ? `<div class="filters" role="group" aria-label="Месяцы">${monthPick}</div>` : ''}
    <p class="note">${RISKS.find(x => x[0] === ip.risk)[2]}. В подбор попадают только облигации, у которых все ${term('coupon', 'купоны')} на выбранный срок уже объявлены, нет ${term('offer', 'оферты')} и погашение позже срока. Дивиденды в подбор не входят: их размер заранее неизвестен.</p>
    <div class="row"><button class="btn" data-act="ip-build" ${ip.loading ? 'disabled' : ''}>${ip.loading ? 'Подбираю… до 30 секунд' : 'Подобрать'}</button>${r ? '<button class="btn ghost" data-act="ip-save">Запомнить параметры</button>' : ''}</div>
  </section>
  ${ip.err ? `<div class="banner"><span>${esc(ip.err)}. Ослабьте условия: увеличьте долю на эмитента или выберите другой уровень надёжности.</span></div>` : ''}
  ${r ? planResult(r) : ''}`;
}

function planResult(r){
  const covered = r.months.length - r.uncovered.length;
  return `<section class="statement">
    <div style="display:flex;flex-direction:column;gap:10px"><span class="label">Нужно вложить</span><span class="big">${nf0.format(r.total)}<small>₽</small></span>
      <div class="chips"><span class="chip">${r.rows.length} облигаций</span><span class="chip ${r.uncovered.length ? 'neg' : 'pos'}">цель закрыта в ${covered} из ${r.months.length} мес.</span></div></div>
    <div class="figs">
      <div class="fig"><div class="l">Доход за ${ip.horizon} мес</div><div class="v">${rub(r.yearIncome)}</div></div>
      <div class="fig"><div class="l">В среднем в месяц</div><div class="v">${rub(r.yearIncome / ip.horizon)}</div></div>
      <div class="fig"><div class="l">Доходность купонов</div><div class="v">${r.total ? nf2.format(r.yearIncome / r.total * 12 / ip.horizon * 100) : 0}% годовых</div></div>
      <div class="fig"><div class="l">Подходящих облигаций</div><div class="v">${r.poolSize}</div></div>
    </div>
  </section>
  ${r.uncovered.length ? `<div class="banner"><span>В ${r.uncovered.map(m => ymLabel(m).toLowerCase()).join(', ')} цель не закрыта: среди подходящих облигаций нет купонов в эти месяцы. Попробуйте «Повышенная доходность» или другой срок.</span></div>` : ''}
  ${r.yearIncome / ip.horizon > ip.target * 1.2 && ip.mode === 'monthly' ? `<div class="banner info"><span>В среднем выйдет ${rub(r.yearIncome / ip.horizon)} в месяц — больше цели. Купоны приходят неравномерно: чтобы закрыть каждый месяц разными бумагами, в другие месяцы получается перебор. Режим «минимум вложений» снизит сумму, но соберёт подборку из меньшего числа эмитентов.</span></div>` : ''}
  ${r.relaxed ? `<div class="banner"><span>Чтобы закрыть цель, по некоторым эмитентам пришлось превысить лимит ${ip.maxShare}% — они отмечены в таблице. Если это неприемлемо, уменьшите цель или выберите другой уровень надёжности.</span></div>` : ''}
  <section class="panel"><h2>Календарь дохода</h2>
    ${stackBars(r.plan.map(p => ({label: p.label, have: p.have, plan: p.plan})), [{key: 'have', label: 'Уже есть', color: 'var(--c3)'}, {key: 'plan', label: 'Из подборки', color: 'var(--c1)'}], {label: 'Доход по месяцам'})}
    <p class="note">Цель — ${rub(ip.target)} в ${ip.mode === 'monthly' ? 'каждый месяц' : 'выбранные месяцы'}. Суммы после налога 13%.</p>
  </section>
  <section class="panel"><div class="panel-head"><h2>Что и когда купить</h2><span class="note">Цена с ${term('nkd', 'НКД')}, отсортировано по сроку покупки</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Облигация</th><th class="r">Купить до</th><th class="r">Штук</th><th class="r">Сумма</th><th class="r">${term('ytm', 'Доходность')}</th><th>Купоны по месяцам</th><th class="r">${term('maturity', 'Погашение')}</th><th></th></tr></thead><tbody>
    ${r.rows.map(b => `<tr class="click" data-act="instrument" data-t="${esc(b.ticker)}"><td><div class="sec">${logo(b.ticker, b.name)}<div><b>${esc(b.name)}</b><div class="sub2">${b.board === 'TQOB' ? 'ОФЗ' : `уровень ${b.list_level}`} · купон ${nf2.format(b.coupon_pct || 0)}%${b.over ? ` · <span class="warn">${nf0.format(b.share)}% подборки</span>` : ''}</div></div></div></td>
      <td class="r num">${dLabel(b.buyBy)}<div class="sub2">${daysBetween(today(), b.buyBy) <= 7 ? '<span class="warn">на этой неделе</span>' : `через ${daysBetween(today(), b.buyBy)} дн.`}</div></td>
      <td class="r num">${nf0.format(b.qty)}</td><td class="r num"><b>${rub(b.cost)}</b></td><td class="r num">${nf2.format(b.ytm)}%</td>
      <td>${(() => { const ks = Object.keys(b.income).sort(); return ks.length >= ip.horizon - 1 ? '<span class="chip gold">ежемесячно</span>' : `<div class="row" style="gap:4px;min-width:150px">${ks.slice(0, 6).map(m => `<span class="chip gold" title="${rub(b.income[m])}">${MONTHS[+m.slice(5) - 1]}</span>`).join('')}${ks.length > 6 ? `<span class="chip">+${ks.length - 6}</span>` : ''}</div>`; })()}</td>
      <td class="r num">${b.mat_date.split('-').reverse().join('.')}</td>
      <td class="r"><button class="btn ghost sm" data-act="scr-buy" data-t="${esc(b.ticker)}">Купить</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">«Купить до» — за 2 дня до первого купона в плане: облигация должна быть на счёте на дату фиксации. Если купить позже, этот купон получит продавец, остальные — вы. Подборка — расчёт по данным биржи, а не индивидуальная рекомендация: проверьте эмитента перед покупкой.</p>
  </section>`;
}

export const IP_ACTIONS = {
  'ip-build': () => buildPlan(),
  'ip-month': b => { const k = +b.dataset.k; ip.months = ip.months.includes(k) ? ip.months.filter(x => x !== k) : [...ip.months, k].sort((a, c) => a - c); b.setAttribute('aria-pressed', ip.months.includes(k)); },
  'ip-save': guard(async () => { const {target, mode, months, horizon, risk, existing, maxShare, prio} = ip; ctx.S.settings.incomePlan = {target, mode, months, horizon, risk, existing, maxShare, prio}; await saveSettings(); toast('Параметры сохранены'); }),
};
export function ipInput(e){
  const f = e.target.closest('#ip-form'); if (!f) return false;
  for (const el of f.elements) if (el.name) ip[el.name] = el.type === 'checkbox' ? el.checked : ['target', 'horizon', 'maxShare'].includes(el.name) ? num(el.value) : el.value;
  if (e.target.name === 'mode') { if (ip.mode === 'custom' && !ip.months.length) ip.months = [3, 6, 9, 12]; ctx.render(); }
  return true;
}
