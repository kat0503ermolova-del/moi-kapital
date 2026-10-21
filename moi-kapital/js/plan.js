// Stress test (what happens to capital if the dollar, stock markets or interest rates move)
// and the financial-independence plan built from the user's own budget and portfolio.
import { $, esc, nf0, nf2, rub, pct, sgn, today, ym, addMonths, area } from './util.js';
import { ctx, fx, positions, accBalances, brokerCashMap, accountBalance, monthStats, netWorthNow, num, saveSettings, guard, toast } from './core.js';
import { term } from './glossary.js';

// ---------- stress test ----------
const usdNow = () => fx('USD') || 90;
export const stress = {usd: null, ru: 0, intl: 0, rate: 0};
const PRESETS = [
  ['Рубль ослаб: $ = 120', {usd: 120, ru: 0, intl: 0, rate: 0}],
  ['Рубль укрепился: $ = 70', {usd: 70, ru: 0, intl: 0, rate: 0}],
  ['Кризис в России', {usd: 115, ru: -35, intl: -5, rate: 4}],
  ['Мировой кризис', {usd: 105, ru: -25, intl: -30, rate: 2}],
  ['ЦБ снизил ставку на 4 п.п.', {usd: null, ru: 15, intl: 0, rate: -4}],
];
const kindOf = p => {
  const n = `${p.ticker} ${p.name || ''}`;
  if (/золот|gold|tgld|glda|akgd|sbgd/i.test(n)) return 'gold';
  if (/ликвидн|денежн|lqdt|tmon|sbmm|akmm|amnr|money market/i.test(n)) return 'mmf';
  if (p.cls === 'bond') return 'bond';
  if (p.cls === 'stock' || p.cls === 'fund') return p.cur !== 'RUB' ? 'intl' : 'ru';
  return 'other';
};
const GROUPS = {ru: 'Акции и фонды РФ', intl: 'Зарубежные акции и фонды', bond: 'Облигации', gold: 'Золото', mmf: 'Фонды денежного рынка', other: 'Другое', cashRub: 'Деньги в рублях', cashFx: 'Деньги в валюте'};
function runStress(){
  const s = {...stress, usd: stress.usd ?? usdNow()}, k = s.usd / usdNow(), out = {};
  const add = (g, now, next) => { const r = out[g] ||= {now: 0, next: 0}; r.now += now; r.next += next; };
  positions().filter(p => p.open).forEach(p => {
    const g = kindOf(p), fxK = p.cur !== 'RUB' ? k : 1;
    let m = 1;
    if (g === 'ru') m = 1 + s.ru / 100;
    if (g === 'intl') m = 1 + s.intl / 100;
    if (g === 'bond') m = 1 - (p.sec?.duration_days ? p.sec.duration_days / 365 : 2) * s.rate / 100;
    if (g === 'gold') m = p.cur === 'RUB' ? k : 1; // gold is priced in dollars: a rouble fund follows the dollar
    add(g, p.value, p.value * m * fxK);
  });
  const bal = accBalances(), cash = brokerCashMap();
  ctx.S.accounts.filter(a => !a.archived).forEach(a => {
    const v = accountBalance(a, bal, cash) * fx(a.currency);
    if ((a.currency || 'RUB') === 'RUB') add('cashRub', v, v); else add('cashFx', v, v * k);
  });
  const now = Object.values(out).reduce((t, r) => t + r.now, 0), next = Object.values(out).reduce((t, r) => t + r.next, 0);
  return {out, now, next, s};
}
function stressResult(){
  const {out, now, next} = runStress(), d = next - now;
  return `<div class="result"><div class="strong"><span class="l">Капитал в сценарии</span><span class="v num">${rub(next)}</span></div><div><span class="l">Сейчас</span><span class="v num">${rub(now)}</span></div><div><span class="l">Изменение</span><span class="v num ${sgn(d)}">${d >= 0 ? '+' : '−'}${rub(Math.abs(d))} · ${pct(now ? d / now * 100 : 0)}</span></div></div>
  <div class="tbl-wrap"><table><thead><tr><th>Часть капитала</th><th class="r">Сейчас</th><th class="r">В сценарии</th><th class="r">Изменение</th></tr></thead><tbody>
  ${Object.entries(out).filter(([, r]) => Math.abs(r.now) > 1).sort((a, b) => b[1].now - a[1].now).map(([g, r]) => `<tr><td>${GROUPS[g]}</td><td class="r num">${rub(r.now)}</td><td class="r num">${rub(r.next)}</td><td class="r num ${sgn(r.next - r.now)}">${Math.abs(r.next - r.now) < 1 ? '—' : (r.next >= r.now ? '+' : '−') + rub(Math.abs(r.next - r.now))}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="note">Упрощённая модель: облигации меняются на величину ${term('duration', 'дюрации')} × изменение ставки, валютные активы и золото — вместе с курсом, деньги в рублях не меняются. Дивиденды и купоны за время сценария не учтены.</p>`;
}
export function stressPanel(){
  const s = {...stress, usd: stress.usd ?? Math.round(usdNow())};
  const slider = (k, label, min, max, step, unit) => `<div class="field-slider"><label class="f">${label}<span class="num" id="st-${k}-v" style="color:var(--fg);font-weight:600">${k === 'usd' ? nf2.format(s[k]) + ' ₽' : (s[k] > 0 ? '+' : '') + s[k] + unit}</span></label><input type="range" data-stress="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}" aria-label="${esc(label)}"></div>`;
  return `<section class="panel"><div class="panel-head"><h2>${term('stress')}</h2><button class="btn ghost sm" data-act="stress-reset">Сбросить</button></div>
    <div class="filters">${PRESETS.map(([l], i) => `<button data-act="stress-preset" data-k="${i}">${l}</button>`).join('')}</div>
    <div class="form" id="stress-form">
      ${slider('usd', `Курс доллара (сейчас ${nf2.format(usdNow())} ₽)`, 50, 200, 1, '')}
      ${slider('ru', 'Акции и фонды РФ', -60, 60, 5, '%')}
      ${slider('intl', 'Зарубежные акции и фонды', -60, 60, 5, '%')}
      ${slider('rate', 'Ключевая ставка, изменение', -8, 8, 0.5, ' п.п.')}
    </div>
    <div id="stress-out">${stressResult()}</div>
  </section>`;
}

// ---------- financial independence ----------
const fireDefaults = () => {
  const last = Array.from({length: 6}, (_, i) => monthStats(addMonths(ym(today()), -1 - i))).filter(m => m.income || m.expense);
  const exp = last.length ? last.reduce((s, m) => s + m.expense, 0) / last.length : 80000;
  const save = last.length ? last.reduce((s, m) => s + Math.max(0, m.income - m.expense), 0) / last.length : 20000;
  return {expenses: Math.round(exp / 1000) * 1000, monthly: Math.round(save / 1000) * 1000, swr: 4, real: 5, age: ''};
};
const fireVals = () => ({...fireDefaults(), ...(ctx.S.settings.fire || {})});
function fireCapital(){
  // what works for independence: investments plus savings and deposits; everyday cards and cash are left out
  const bal = accBalances();
  const savings = ctx.S.accounts.filter(a => !a.archived && (a.type === 'savings' || a.type === 'deposit')).reduce((s, a) => s + Math.max(0, bal[a.id] || 0) * fx(a.currency), 0);
  return netWorthNow().invested + savings;
}
function project(cap, monthly, real, target, maxYears = 60){
  const r = real / 100 / 12, pts = [cap];
  let m = 0, c = cap, hit = cap >= target ? 0 : null;
  while (m < maxYears * 12) { c = c * (1 + r) + monthly; m++; if (m % 12 === 0) pts.push(c); if (hit == null && c >= target) hit = m; if (hit != null && m >= Math.max(hit + 24, 120)) break; }
  return {months: hit, pts};
}
function fireOut(){
  const v = fireVals(), cap = fireCapital(), target = v.expenses * 12 / (v.swr / 100);
  const base = project(cap, v.monthly, v.real, target);
  const yrs = m => {
    if (m == null) return 'больше 60 лет'; if (m === 0) return 'уже сейчас';
    const y = Math.round(m / 12 * 10) / 10, n = Math.floor(y), whole = y === n;
    const w = !whole ? 'года' : n % 10 === 1 && n % 100 !== 11 ? 'год' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'года' : 'лет';
    return `${nf2.format(y).replace(/,00$/, '').replace(/(,\d)0$/, '$1')} ${w}`;
  };
  const when = m => { if (m == null) return ''; const d = new Date(); d.setMonth(d.getMonth() + m); return ` · ${d.getFullYear()}${v.age ? `, вам будет ${+v.age + Math.round(m / 12)}` : ''}`; };
  const alt = [[`Откладывать на 10 000 ₽ больше`, project(cap, v.monthly + 10000, v.real, target).months], [`Откладывать на 25 000 ₽ больше`, project(cap, v.monthly + 25000, v.real, target).months],
    [`Расходы на 10% меньше`, project(cap, v.monthly, v.real, target * 0.9).months], [`Доходность на 2 п.п. выше`, project(cap, v.monthly, v.real + 2, target).months]];
  const progress = Math.min(100, cap / target * 100), passiveNow = cap * v.swr / 100 / 12;
  const milestones = [25, 50, 75, 100].map(p => [p, project(cap, v.monthly, v.real, target * p / 100).months]);
  return `<section class="statement">
    <div style="display:flex;flex-direction:column;gap:10px"><span class="label">До финансовой независимости</span><span class="big">${yrs(base.months)}</span>
      <div class="chips"><span class="chip">${nf0.format(progress)}% пути пройдено</span>${base.months ? `<span class="chip">${when(base.months).slice(3)}</span>` : ''}</div></div>
    <div class="figs">
      <div class="fig"><div class="l">Нужный капитал</div><div class="v">${rub(target)}</div></div>
      <div class="fig"><div class="l">Работающий капитал сейчас</div><div class="v">${rub(cap)}</div></div>
      <div class="fig"><div class="l">Капитал уже даёт в месяц</div><div class="v">${rub(passiveNow)}</div></div>
      <div class="fig"><div class="l">Покрывает расходов</div><div class="v">${nf0.format(passiveNow / (v.expenses || 1) * 100)}%</div></div>
    </div>
    <div style="grid-column:1/-1"><div class="bar gold"><i style="width:${progress}%"></i></div></div>
  </section>
  <div class="grid2">
    <section class="panel"><h2>Как будет расти капитал</h2>
      ${area([{values: base.pts.map(p => Math.min(p, target * 1.5)), color: 'var(--c2)', label: 'Капитал (в сегодняшних деньгах)'}], base.pts.map((_, i) => i ? `${new Date().getFullYear() + i}` : 'сейчас'), {label: 'Рост капитала'})}
      <div class="row" style="gap:16px;flex-wrap:wrap">${milestones.map(([p, m]) => `<span class="chip ${p === 100 ? 'gold' : ''}">${p}% — ${m == null ? 'не достигается' : m === 0 ? 'есть' : new Date(Date.now() + m * 30.4 * 864e5).getFullYear()}</span>`).join('')}</div>
      <p class="note">Все суммы — в сегодняшних деньгах, поэтому используется ${term('realReturn', 'реальная доходность')}. Работающий капитал = инвестиции + накопительные счета и вклады; деньги на картах не учитываются.</p>
    </section>
    <section class="panel"><h2>Что ускорит</h2>
      ${alt.map(([l, m]) => `<div class="list-row"><span>${l}</span><span class="num"><b>${yrs(m)}</b>${base.months && m != null && m < base.months ? ` <span class="pos">−${nf2.format((base.months - m) / 12).replace(/,00$/, '')} г.</span>` : ''}</span></div>`).join('')}
    </section>
  </div>`;
}
export function viewFire(){
  const v = fireVals(), d = fireDefaults();
  const f = (k, label, extra = '') => `<label class="f">${label}<input name="${k}" type="number" inputmode="decimal" value="${v[k]}" ${extra}></label>`;
  return `<section class="panel"><div class="panel-head"><h2>Исходные данные</h2><span class="note">По умолчанию — средние за 6 месяцев из бюджета</span></div>
    <form class="form" id="fire-form" autocomplete="off">
      ${f('expenses', 'Расходы в месяц, ₽', `placeholder="${d.expenses}"`)}${f('monthly', 'Откладываю в месяц, ₽', `placeholder="${d.monthly}"`)}
      <label class="f">${term('swr')}, % в год<input name="swr" type="number" inputmode="decimal" step="0.1" value="${v.swr}"></label>
      <label class="f">${term('realReturn')}, %<input name="real" type="number" inputmode="decimal" step="0.5" value="${v.real}"></label>
      ${f('age', 'Ваш возраст (необязательно)', 'placeholder="например, 30"')}
    </form>
    <div class="row"><button class="btn sm" data-act="fire-save">Запомнить</button><button class="btn ghost sm" data-act="fire-reset">Взять из бюджета</button></div>
  </section>
  <div id="fire-out">${fireOut()}</div>`;
}

export const PLAN_ACTIONS = {
  'stress-preset': b => { Object.assign(stress, PRESETS[+b.dataset.k][1]); ctx.render(); },
  'stress-reset': () => { Object.assign(stress, {usd: null, ru: 0, intl: 0, rate: 0}); ctx.render(); },
  'fire-save': guard(async () => { ctx.S.settings.fire = {...fireVals()}; await saveSettings(); toast('Сохранено'); }),
  'fire-reset': guard(async () => { delete ctx.S.settings.fire; await saveSettings(); ctx.render(); }),
};
export function planInput(e){
  if (e.target.dataset.stress) {
    const k = e.target.dataset.stress; stress[k] = +e.target.value;
    $(`#st-${k}-v`).textContent = k === 'usd' ? nf2.format(stress[k]) + ' ₽' : (stress[k] > 0 ? '+' : '') + stress[k] + (k === 'rate' ? ' п.п.' : '%');
    $('#stress-out').innerHTML = stressResult(); return true;
  }
  if (e.target.closest('#fire-form')) {
    const f = e.target.closest('#fire-form'), cur = {...fireVals()};
    for (const el of f.elements) if (el.name) cur[el.name] = el.name === 'age' ? el.value : num(el.value);
    ctx.S.settings.fire = cur; $('#fire-out').innerHTML = fireOut(); return true;
  }
  return false;
}
