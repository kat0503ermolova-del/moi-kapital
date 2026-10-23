// Strategy builder: pick a goal (money by a date, a bond ladder, locking in today's rates, a reserve, long-term growth),
// enter the amounts and get a concrete plan — what to buy, how much, when the money comes back and what to do along the way.
// Only Moscow Exchange instruments: the plan is for the Russian broker account (foreign assets live at Freedom Finance).
import { esc, nf0, nf2, rub, today, ym, addMonths, bars } from './util.js';
import { ctx, sb, q, NDFL, shiftDay, daysBetween, num, toast, logo, guard, saveSettings, brokerCash } from './core.js';
import { term } from './glossary.js';
import { ichart } from './chart.js';

export const MMF = ['LQDT', 'AKMM', 'SBMM', 'TMON'], IDX = ['EQMX', 'TMOS', 'SBMX'], GLD = ['GOLD', 'AKGD', 'TGLD'];
export const st = {goal: 'date', sum: 300000, monthly: 20000, date: '', target: 0, years: 4, months: 12, gyears: 5, risk: 'balanced', profile: 'bal', style: 'index', result: null, loading: false, err: null};
const GOALS = [
  ['date', 'Накопить к дате', 'Деньги вернутся к нужному сроку: квартира, машина, учёба'],
  ['income', 'Пассивный доход', 'Купоны каждый месяц на нужную сумму'],
  ['ladder', 'Лестница облигаций', 'Деньги возвращаются частями каждый год'],
  ['lock', 'Зафиксировать ставку', 'Длинные ОФЗ: высокий купон на годы вперёд'],
  ['reserve', 'Подушка и свободные деньги', 'Без просадок, забрать можно в любой день'],
  ['growth', 'Рост капитала', 'Акции, облигации и золото на 3 года и больше'],
];
const RISKS = [['safe', 'Только ОФЗ'], ['balanced', 'ОФЗ + надёжные компании'], ['yield', 'Повышенная доходность']];
const PROFILES = {cons: ['Осторожный', {stock: 25, bond: 60, gold: 10, mmf: 5}], bal: ['Сбалансированный', {stock: 45, bond: 40, gold: 10, mmf: 5}], aggr: ['Агрессивный', {stock: 70, bond: 20, gold: 10, mmf: 0}]};
// long-run assumptions for the growth scenarios, % a year in roubles: pessimistic / base / optimistic
const ASSUME = {stock: [0, 12, 20], gold: [2, 8, 14]};
const KIND_COLOR = {bond: 'var(--c1)', stock: 'var(--c3)', fund: 'var(--c4)', gold: 'var(--c2)', mmf: 'var(--c6)'};
const KIND_LABEL = {bond: 'Облигации', stock: 'Акции', gold: 'Золото', mmf: 'Денежный рынок'};

const fmtD = d => d.split('-').reverse().join('.');
const netY = ytm => ytm / 100 * (1 - NDFL);
export const issuerOf = name => (name || '').replace(/\s*[\d].*$/, '').replace(/\s+(БО|ПБО|обл).*/i, '').trim().toUpperCase();
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

// ---------- market universe (cached for 10 minutes) ----------
const U = {at: 0};
export async function universe(){
  if (U.bonds && Date.now() - U.at < 6e5) return U;
  const [bonds, funds, stocks] = await Promise.all([
    q(sb.from('securities').select('ticker,name,board,price,accrued,face_value,ytm,coupon_value,coupon_period,coupon_pct,next_coupon,mat_date,offer_date,list_level,value_today,duration_days,bond_type,logo')
      .eq('cls', 'bond').not('price', 'is', null).gt('coupon_value', 0).gt('mat_date', shiftDay(today(), 30)).gte('value_today', 300000).gte('ytm', 3).lte('ytm', 32).limit(1000), true),
    q(sb.from('securities').select('ticker,name,board,price,value_today,lot,logo').in('ticker', [...MMF, ...IDX, ...GLD]), true),
    q(sb.from('securities').select('ticker,name,board,price,value_today,lot,capitalization,list_level,logo').eq('cls', 'stock').eq('list_level', 1).not('price', 'is', null).order('capitalization', {ascending: false}).limit(25), true),
  ]);
  // only bonds whose coupon is fixed and known, without an offer: the plan then rests on published numbers
  const fixed = b => !b.bond_type || /фиксированным \(известным\)/i.test(b.bond_type);
  let all = bonds.filter(b => fixed(b) && !(b.offer_date && b.offer_date > today())).map(b => ({...b, ytm: +b.ytm, price: +b.price, unit: +b.price + (+b.accrued || 0),
    face: +b.face_value || 1000, gov: b.board === 'TQOB', issuer: b.board === 'TQOB' ? 'ОФЗ' : issuerOf(b.name), years: daysBetween(today(), b.mat_date) / 365}));
  U.ofzMed = median(all.filter(b => b.gov).map(b => b.ytm)) ?? 15;
  // a corporate yield far above government bonds means the market doubts the issuer — such bonds never enter a plan
  U.bonds = all.filter(b => b.gov || b.ytm <= U.ofzMed + 10);
  U.funds = Object.fromEntries(funds.map(f => [f.ticker, {...f, price: +f.price, lot: +f.lot || 1}]));
  U.stocks = stocks.filter(s => +s.value_today >= 2e7 && +s.price > 0).map(s => ({...s, price: +s.price, lot: +s.lot || 1}));
  // money-market funds earn roughly the overnight rate; short top-tier bonds are the closest published proxy
  const short = U.bonds.filter(b => (b.gov || b.list_level <= 1) && b.years < 1).map(b => b.ytm);
  U.mmfY = Math.min(25, Math.max(5, (median(short) ?? U.ofzMed) - 1));
  [...bonds, ...funds, ...stocks].forEach(s => { if (s.logo) ctx.logos[s.ticker] = s.logo; });
  U.at = Date.now();
  return U;
}
const pickFund = list => list.map(t => U.funds[t]).filter(f => f?.price).sort((a, b) => b.value_today - a.value_today)[0] || null;
const riskOk = (b, risk) => risk === 'safe' ? b.gov : risk === 'balanced' ? b.gov || (b.list_level <= 1 && b.ytm <= 24) : b.gov || b.list_level <= 2;
// best yields first, one bond per company (government bonds may repeat)
function pick(cands, n, used = new Set()){
  const out = [];
  for (const b of [...cands].sort((a, c) => c.ytm - a.ytm)) {
    if (out.length >= n) break;
    if (out.some(x => x.ticker === b.ticker) || (!b.gov && used.has(b.issuer))) continue;
    out.push(b); if (!b.gov) used.add(b.issuer);
  }
  return out;
}
// "balanced" keeps roughly 40% in government bonds so one company's trouble cannot sink the plan
function mix(cands, n, risk, used = new Set()){
  if (risk === 'safe') return pick(cands.filter(b => b.gov), n, used);
  if (risk === 'yield') return pick(cands, n, used);
  const gov = pick(cands.filter(b => b.gov), Math.max(1, Math.round(n * 0.4)), used);
  const corp = pick(cands.filter(b => !b.gov), n - gov.length, used);
  const got = [...gov, ...corp];
  return got.length < n ? [...got, ...pick(cands.filter(b => !got.includes(b)), n - got.length, used)] : got;
}
const bondRow = (b, money, extra = {}) => { const qty = Math.floor(money / b.unit); return qty > 0 ? {kind: 'bond', b, ticker: b.ticker, name: b.name, qty, cost: qty * b.unit, ytm: b.ytm, back: b.mat_date, ...extra} : null; };
const lotRow = (s, money, kind, extra = {}) => { const qty = Math.floor(money / (s.price * s.lot)) * s.lot; return qty > 0 ? {kind, ticker: s.ticker, name: s.name, qty, cost: qty * s.price, lot: s.lot, ...extra} : null; };
const yearCoupons = r => r.kind === 'bond' && r.b.coupon_period ? r.qty * r.b.coupon_value * 365 / r.b.coupon_period * (1 - NDFL) : 0;
// monthly projection: lump grows at r a year, `monthly` is added each month for the first `until` months
function proj(lump, monthly, r, months, until = months){
  const dates = [today()], vals = [lump], k = Math.pow(1 + r, 1 / 12);
  let v = lump;
  for (let i = 1; i <= months; i++) { v = v * k + (i <= until ? monthly : 0); vals.push(v); dates.push(addMonths(ym(today()), i) + '-01'); }
  return {dates, vals, last: v};
}
const sumCost = rows => rows.reduce((s, r) => s + r.cost, 0);
function cashRow(money, why){
  const f = pickFund(MMF);
  return f && money > f.price * f.lot ? lotRow(f, money, 'mmf', {role: why, back: null}) : null;
}

// ---------- strategies ----------
function sDate(){
  const end = st.date && st.date > today() ? st.date : shiftDay(today(), 730);
  const days = daysBetween(today(), end), T = days / 365, months = Math.max(1, Math.round(days / 30.44));
  if (days < 180) { const r = sReserve(months); r.banners.unshift('До цели меньше полугода: облигации под такой срок почти ничего не добавляют, поэтому деньги лучше держать в фонде денежного рынка — их можно забрать в любой день.'); return r; }
  const win = Math.min(365, Math.max(90, days * 0.25));
  let cands = U.bonds.filter(b => riskOk(b, st.risk) && b.mat_date <= end && b.mat_date >= shiftDay(end, -win));
  if (cands.length < 2) cands = U.bonds.filter(b => riskOk(b, st.risk) && b.mat_date <= end && b.mat_date >= shiftDay(end, -Math.max(win, 540)));
  if (!cands.length) throw new Error('Нет облигаций с погашением незадолго до этой даты. Сдвиньте дату или выберите другой уровень надёжности');
  const n = st.sum >= 400000 ? 4 : st.sum >= 150000 ? 3 : st.sum >= 50000 ? 2 : 1;
  const picks = mix(cands, n, st.risk);
  const rows = picks.map(b => bondRow(b, st.sum / picks.length, {role: 'держать до погашения'})).filter(Boolean);
  const rest = cashRow(st.sum - sumCost(rows), 'остаток — до следующей покупки'); if (rest) rows.push(rest);
  const mmfR = netY(U.mmfY);
  // money from each bond waits in the money-market fund between its maturity and the target date
  const fvNow = rows.reduce((s, r) => s + (r.kind === 'bond' ? r.cost * Math.pow(1 + netY(r.ytm), r.b.years) * Math.pow(1 + mmfR, Math.max(0, T - r.b.years)) : r.cost * Math.pow(1 + mmfR, T)), 0) + (st.sum - sumCost(rows));
  const y = st.sum > 0 ? Math.pow(fvNow / st.sum, 1 / T) - 1 : netY(picks.reduce((s, b) => s + b.ytm, 0) / picks.length);
  const until = Math.max(0, months - Math.round(win / 30.44));
  const pr = proj(st.sum, st.monthly, y, months, until), factor = proj(0, 1, y, months, until).last;
  const banners = [], figs = [['К дате будет', rub(pr.last)], ['Доходность после налога', nf2.format(y * 100) + '% годовых'], ['Срок', `${months} мес · до ${fmtD(end)}`], ['Доход за срок', rub(pr.last - st.sum - st.monthly * until)]];
  if (st.target > 0) {
    if (pr.last >= st.target) banners.push(`Цель ${rub(st.target)} достигается${st.monthly ? '' : ` — хватит вложить ${rub(st.target / Math.pow(1 + y, T))} сейчас`}.`);
    else banners.push(`До цели ${rub(st.target)} не хватает ${rub(st.target - pr.last)}. Чтобы успеть, откладывайте ${rub(Math.max(0, (st.target - fvNow) / factor))} в месяц вместо ${rub(st.monthly)} или вложите сейчас ${rub(Math.max(0, (st.target - st.monthly * factor) / Math.pow(1 + y, T)))}.`);
  }
  const steps = [{date: today(), text: `Купить: ${rows.map(r => `${esc(r.name)} — ${nf0.format(r.qty)} шт.`).join(', ')}`, amount: sumCost(rows)}];
  if (st.monthly > 0 && until > 0) steps.push({date: addMonths(ym(today()), 1) + '-01', text: `Каждый месяц до ${fmtD(addMonths(ym(today()), until) + '-01')} докупать облигации из списка по очереди на ${rub(st.monthly)}. Если доходность заметно изменится — пересоберите план с новыми цифрами.`, amount: st.monthly});
  const nc = rows.filter(r => r.kind === 'bond' && r.b.next_coupon).map(r => r.b.next_coupon).sort()[0];
  if (nc) steps.push({date: nc, text: `Первые купоны. Около ${rub(rows.reduce((s, r) => s + yearCoupons(r), 0))} в год после налога — сразу докупайте те же облигации или фонд денежного рынка: так работает сложный процент.`});
  rows.filter(r => r.kind === 'bond').forEach(r => steps.push({date: r.back, text: `Погашение ${esc(r.name)}: вернётся номинал. ${daysBetween(r.back, end) > 30 ? `До ${fmtD(end)} держите деньги в фонде денежного рынка.` : 'Деньги готовы к цели.'}`, amount: r.qty * r.b.face}));
  steps.push({date: end, text: `Цель: на счёте около ${rub(pr.last)}.`, final: true});
  return {title: 'Накопить к дате', invest: sumCost(rows), rows, figs, banners, steps,
    extra: `<section class="panel"><h2>Как будут расти деньги</h2>${ichart({id: 'st-proj', dates: pr.dates, series: [{name: 'Капитал', values: pr.vals, color: 'var(--gold-light)', fill: true}], height: 200})}<p class="note">Облигации погашаются незадолго до вашей даты, поэтому цена к сроку вернётся к номиналу, какой бы ни была ставка ЦБ. Купоны и погашения уже известны — расчёт опирается на них.</p></section>`,
    notes: ['Купоны реинвестируются по той же доходности. Налог 13% учтён.']};
}

function sLadder(){
  const N = Math.max(1, st.years), per = st.sum / N, used = new Set(), rows = [], empty = [];
  for (let k = 1; k <= N; k++) {
    const from = shiftDay(today(), k === 1 ? 90 : (k - 1) * 365), to = shiftDay(today(), k * 365);
    const picks = mix(U.bonds.filter(b => riskOk(b, st.risk) && b.mat_date > from && b.mat_date <= to), per >= 150000 ? 2 : 1, st.risk, used);
    const got = picks.map(b => bondRow(b, per / picks.length, {role: `ступень ${k}: ${to.slice(0, 4) === from.slice(0, 4) ? from.slice(0, 4) : `${from.slice(0, 4)}–${to.slice(0, 4)}`}`})).filter(Boolean);
    if (!got.length) empty.push(k);
    rows.push(...got);
  }
  if (!rows.length) throw new Error('Не нашлось облигаций под эти условия');
  const rest = cashRow(st.sum - sumCost(rows), empty.length ? 'деньги пустых ступеней — до появления облигаций' : 'остаток'); if (rest) rows.push(rest);
  const income = rows.reduce((s, r) => s + yearCoupons(r), 0), byYear = {};
  rows.filter(r => r.kind === 'bond').forEach(r => { const y = r.back.slice(0, 4); byYear[y] = (byYear[y] || 0) + r.qty * r.b.face; });
  const avgY = rows.filter(r => r.kind === 'bond').reduce((s, r) => s + r.cost * r.ytm, 0) / Math.max(1, sumCost(rows.filter(r => r.kind === 'bond')));
  const steps = [{date: today(), text: `Купить ${rows.filter(r => r.kind === 'bond').length} облигаций с погашением в разные годы.`, amount: sumCost(rows)}];
  if (st.monthly > 0) steps.push({date: addMonths(ym(today()), 1) + '-01', text: `Пополнения ${rub(st.monthly)} в месяц добавляйте в ступень, где сейчас меньше всего денег — лестница останется ровной.`, amount: st.monthly});
  rows.filter(r => r.kind === 'bond').sort((a, b) => a.back.localeCompare(b.back)).forEach(r => steps.push({date: r.back, text: `Погашение ${esc(r.name)}. Вернувшиеся деньги вложите в облигацию сроком на ${N} ${N === 1 ? 'год' : N < 5 ? 'года' : 'лет'} — она станет новой дальней ступенью, и лестница продолжится по текущим ставкам.`, amount: r.qty * r.b.face}));
  return {title: 'Лестница облигаций', invest: sumCost(rows), rows, steps,
    banners: empty.length ? [`Для ступеней ${empty.join(', ')} нет подходящих облигаций с выбранной надёжностью. Их деньги пока в фонде денежного рынка — попробуйте другой уровень надёжности.`] : [],
    figs: [['Купоны в год после налога', rub(income)], ['В среднем в месяц', rub(income / 12)], [term('ytm', 'Доходность к погашению'), nf2.format(avgY) + '%'], ['Ступеней', N]],
    extra: `<section class="panel"><h2>Когда вернутся деньги</h2>${bars(Object.keys(byYear).sort().map(y => ({label: y, a: byYear[y]})), {label: 'Погашения по годам'})}<p class="note">Каждый год часть денег возвращается. Если ставки выросли — вложите их дороже, если нужны деньги — заберите без продажи и без потерь на цене.</p></section>`,
    notes: ['Облигации гасятся по номиналу, поэтому колебания цены до погашения не важны, если вы держите до конца.']};
}

function sLock(){
  const cands = U.bonds.filter(b => b.duration_days && (b.gov ? b.years >= 5 : st.risk !== 'safe' && b.years >= 3 && b.list_level <= 1 && b.ytm <= 24));
  // mostly government bonds: a fixed rate for many years only makes sense with an issuer that will surely be there
  const n = st.sum >= 200000 ? 3 : 2, gov = pick(cands.filter(b => b.gov), st.risk === 'safe' ? n : n - 1);
  const picks = [...gov, ...pick(cands.filter(b => !b.gov), n - gov.length)];
  if (!picks.length) throw new Error('Не нашлось длинных облигаций с фиксированным купоном');
  const rows = picks.map(b => bondRow(b, st.sum / picks.length, {role: 'фиксированный купон на годы'})).filter(Boolean);
  const rest = cashRow(st.sum - sumCost(rows), 'остаток'); if (rest) rows.push(rest);
  const bonds = rows.filter(r => r.kind === 'bond'), bv = sumCost(bonds) || 1;
  const ytm = bonds.reduce((s, r) => s + r.cost * r.ytm, 0) / bv, dur = bonds.reduce((s, r) => s + r.cost * r.b.duration_days / 365, 0) / bv, md = dur / (1 + ytm / 100);
  const income = rows.reduce((s, r) => s + yearCoupons(r), 0);
  const sc = [-4, -2, 0, 2].map(d => ({d, pct: ytm * (1 - NDFL) - md * d}));
  const steps = [{date: today(), text: `Купить: ${bonds.map(r => r.name).join(', ')}.`, amount: sumCost(rows)}];
  if (st.monthly > 0) steps.push({date: addMonths(ym(today()), 1) + '-01', text: `Каждый месяц докупать на ${rub(st.monthly)}, пока доходность длинных ОФЗ выше ${nf0.format(ytm - 2)}%. Если она упадёт сильнее — пересоберите план.`, amount: st.monthly});
  steps.push({date: shiftDay(today(), 365), text: 'Проверка через год. Если цена выросла на 10% и больше, можно продать часть и зафиксировать прибыль — или держать ради купона.'});
  bonds.forEach(r => steps.push({date: r.back, text: `Погашение ${esc(r.name)}.`, amount: r.qty * r.b.face}));
  return {title: 'Зафиксировать ставку', invest: sumCost(rows), rows, steps, banners: [],
    figs: [['Купоны в год после налога', rub(income)], ['В среднем в месяц', rub(income / 12)], [term('ytm', 'Доходность к погашению'), nf2.format(ytm) + '%'], [term('duration', 'Дюрация'), nf2.format(dur) + ' г.']],
    extra: `<section class="panel"><h2>Что будет через год при разной ставке ЦБ</h2>
      <div class="tbl-wrap"><table><thead><tr><th>Ставки на рынке</th><th class="r">Цена облигаций</th><th class="r">Итог за год</th><th class="r">В рублях</th></tr></thead><tbody>
      ${sc.map(s => `<tr><td>${s.d < 0 ? `снизятся на ${-s.d} п.п.` : s.d > 0 ? `вырастут на ${s.d} п.п.` : 'не изменятся'}</td><td class="r num ${s.d < 0 ? 'pos' : s.d > 0 ? 'neg' : ''}">${s.d ? (s.d < 0 ? '+' : '−') + nf2.format(Math.abs(md * s.d)) + '%' : '0%'}</td><td class="r num ${s.pct >= 0 ? 'pos' : 'neg'}">${s.pct >= 0 ? '+' : '−'}${nf2.format(Math.abs(s.pct))}%</td><td class="r num">${s.pct >= 0 ? '+' : '−'}${rub(Math.abs(sumCost(bonds) * s.pct / 100))}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">Купон фиксирован до погашения: если ставки снизятся, вы продолжите получать высокий доход, а цена облигаций вырастет. Если ставки вырастут, цена временно упадёт, но купоны и номинал при погашении не изменятся. Стратегия для тех, кто готов держать долго.</p></section>`,
    notes: ['Расчёт изменения цены — по дюрации, приблизительно. Налог 13% с купонов учтён, налог с роста цены — только при продаже.']};
}

function sReserve(months = st.months){
  const f = pickFund(MMF);
  if (!f) throw new Error('Нет данных по фондам денежного рынка');
  const short = months > 6 ? mix(U.bonds.filter(b => (b.gov || b.list_level <= 1) && b.ytm <= 24 && b.years > 0.15 && b.years <= Math.min(1, months / 12)), 2, 'balanced') : [];
  const rows = short.map(b => bondRow(b, st.sum * 0.5 / short.length, {role: 'короткая облигация'})).filter(Boolean);
  const fr = lotRow(f, st.sum - sumCost(rows), 'mmf', {role: 'забрать можно в любой день', back: null}); if (fr) rows.push(fr);
  const y = (sumCost(rows.filter(r => r.kind === 'bond').map(r => ({cost: r.cost * r.ytm}))) + (fr ? fr.cost * U.mmfY : 0)) / Math.max(1, sumCost(rows));
  const steps = [{date: today(), text: `Купить ${f.ticker}${rows.length > 1 ? ' и короткие облигации' : ''}.`, amount: sumCost(rows)},
    {date: shiftDay(today(), 1), text: `Когда понадобятся деньги — продайте ${f.ticker} в любой торговый день: деньги будут на счёте на следующий день, без потери накопленного дохода.`}];
  if (st.monthly > 0) steps.push({date: addMonths(ym(today()), 1) + '-01', text: `Каждый месяц докупать ${f.ticker} на ${rub(st.monthly)}.`, amount: st.monthly});
  rows.filter(r => r.kind === 'bond').forEach(r => steps.push({date: r.back, text: `Погашение ${esc(r.name)}: деньги вернутся — переложите их в ${f.ticker}.`, amount: r.qty * r.b.face}));
  return {title: 'Подушка и свободные деньги', invest: sumCost(rows), rows, steps, banners: [],
    figs: [['Доход в год после налога', '≈ ' + rub(sumCost(rows) * netY(y))], ['Доходность', '≈ ' + nf2.format(y) + '% годовых'], ['Забрать', rows.length > 1 ? 'фонд — в любой день' : 'в любой день'], ['Просадки', 'практически нет']],
    notes: [`${term('mmf', 'Фонд денежного рынка')} растёт почти каждый день вместе с ключевой ставкой. Его доходность — оценка по коротким облигациям: около ${nf2.format(U.mmfY)}% до налога. Подушку на 3–6 месяцев расходов лучше держать вне биржи, на накопительном счёте.`]};
}

function sGrowth(){
  const w = PROFILES[st.profile][1], years = Math.max(1, st.gyears), months = years * 12, rows = [], banners = [];
  if (years < 3 && w.stock > 30) banners.push('Для акций горизонт меньше 3 лет короткий: за это время рынок может не успеть восстановиться после падения. Подумайте об осторожном профиле.');
  const sPart = st.sum * w.stock / 100;
  if (st.style === 'index' || U.stocks.length < 4) { const f = pickFund(IDX); const r = f && lotRow(f, sPart, 'stock', {role: 'акции крупнейших компаний одним фондом', back: null}); if (r) rows.push(r); }
  else { const list = U.stocks.slice(0, 8); list.forEach(s => { const r = lotRow(s, sPart / list.length, 'stock', {role: 'голубая фишка', back: null}); if (r) rows.push(r); }); }
  const bPicks = mix(U.bonds.filter(b => riskOk(b, 'balanced') && b.years >= 1.5 && b.years <= Math.max(2, Math.min(4, years))), 3, 'balanced');
  bPicks.forEach(b => { const r = bondRow(b, st.sum * w.bond / 100 / bPicks.length, {role: 'облигации — стабильный доход'}); if (r) rows.push(r); });
  const g = pickFund(GLD), gr = g && w.gold && lotRow(g, st.sum * w.gold / 100, 'gold', {role: 'защита от ослабления рубля', back: null}); if (gr) rows.push(gr);
  const cr = cashRow(st.sum - sumCost(rows), 'резерв для докупок'); if (cr) rows.push({...cr, kind: 'mmf'});
  const tot = Math.max(1, sumCost(rows)), part = k => sumCost(rows.filter(r => r.kind === k)) / tot;
  const bondY = rows.filter(r => r.kind === 'bond').reduce((s, r) => s + r.cost * netY(r.ytm), 0) / Math.max(1, sumCost(rows.filter(r => r.kind === 'bond')));
  const rate = i => part('stock') * ASSUME.stock[i] / 100 + part('gold') * ASSUME.gold[i] / 100 + part('bond') * (bondY - (i === 0 ? 0.02 : 0)) + part('mmf') * netY(U.mmfY);
  const sc = [0, 1, 2].map(i => ({r: rate(i), ...proj(st.sum, st.monthly, rate(i), months)}));
  const draw = st.sum * (part('stock') * 0.35 + part('gold') * 0.15 + part('bond') * 0.05);
  const steps = [{date: today(), text: `Купить по списку: ${Object.entries(KIND_LABEL).filter(([k]) => part(k) > 0).map(([k, l]) => `${l.toLowerCase()} ${nf0.format(part(k) * 100)}%`).join(', ')}.`, amount: sumCost(rows)}];
  if (st.monthly > 0) steps.push({date: addMonths(ym(today()), 1) + '-01', text: `Каждый месяц ${rub(st.monthly)}: ${Object.entries(w).filter(([, v]) => v).map(([k, v]) => `${rub(st.monthly * v / 100)} — ${KIND_LABEL[k].toLowerCase()}`).join(', ')}. Покупка частями сглаживает неудачные моменты входа.`, amount: st.monthly});
  for (let y = 1; y <= Math.min(years, 5); y++) steps.push({date: shiftDay(today(), 365 * y), text: `${term('rebalance', 'Ребалансировка')}: верните доли к ${w.stock}/${w.bond}/${w.gold}/${w.mmf} (акции/облигации/золото/деньги). Продавайте то, что выросло, докупайте то, что отстало.`});
  if (years >= 3) steps.push({date: shiftDay(today(), 365 * 3 + 1), text: `3 года владения: прибыль от продажи бумаг, купленных сегодня, до 3 млн ₽ в год не облагается налогом (${term('ldv', 'ЛДВ')}).`});
  rows.filter(r => r.kind === 'bond').forEach(r => steps.push({date: r.back, text: `Погашение ${esc(r.name)}: вложите деньги в новую облигацию на 2–4 года.`, amount: r.qty * r.b.face}));
  return {title: 'Рост капитала', invest: sumCost(rows), rows, steps, banners,
    figs: [['Через ' + years + ' ' + (years === 1 ? 'год' : years < 5 ? 'года' : 'лет') + ' (базовый)', rub(sc[1].last)], ['Пессимистичный', rub(sc[0].last)], ['Оптимистичный', rub(sc[2].last)], ['Временная просадка в кризис', '≈ −' + rub(draw)]],
    extra: `<section class="panel"><h2>Три сценария</h2>${ichart({id: 'st-proj', dates: sc[1].dates, series: [{name: 'Оптимистичный', values: sc[2].vals, color: 'var(--pos)', width: 1.6, dash: true}, {name: 'Базовый', values: sc[1].vals, color: 'var(--gold-light)', fill: true}, {name: 'Пессимистичный', values: sc[0].vals, color: 'var(--neg)', width: 1.6, dash: true}], height: 220})}
      <p class="note">Допущения: акции с дивидендами ${ASSUME.stock.join(' / ')}% годовых, золото ${ASSUME.gold.join(' / ')}%, облигации — их ${term('ytm', 'доходность к погашению')} после налога, фонд денежного рынка — около ${nf2.format(U.mmfY)}%. Это не прогноз: за отдельные годы рынок может падать на 30–40%. Сценарии показывают диапазон, а не обещание.</p></section>`,
    notes: [`Профиль «${PROFILES[st.profile][0]}»: ${w.stock}% акции, ${w.bond}% облигации, ${w.gold}% золото, ${w.mmf}% деньги.`]};
}

async function build(){
  if (st.goal === 'income') return;
  st.loading = true; st.err = null; st.result = null; ctx.render();
  try {
    if (!(st.sum > 0)) throw new Error('Укажите, сколько готовы вложить');
    await universe();
    st.result = {date: sDate, ladder: sLadder, lock: sLock, reserve: () => sReserve(), growth: sGrowth}[st.goal]();
  } catch (e) { console.error(e); st.err = e.message || 'Не удалось собрать стратегию'; }
  st.loading = false; ctx.render();
}

// ---------- view ----------
const opt = (v, cur, l) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
export function viewStrategy(){
  if (!st.date) st.date = shiftDay(today(), 730);
  const saved = ctx.S.settings.strategies || [], bc = Math.max(0, brokerCash());
  const g = st.goal, f = [];
  if (g !== 'income') {
    f.push(`<label class="f">Вложу сейчас, ₽<input name="sum" type="number" inputmode="decimal" value="${st.sum}"></label>`);
    f.push(`<label class="f">Пополнять в месяц, ₽<input name="monthly" type="number" inputmode="decimal" value="${st.monthly}"></label>`);
  }
  if (g === 'date') f.push(`<label class="f">Когда нужны деньги<input name="date" type="date" value="${st.date}" min="${shiftDay(today(), 30)}"></label>`, `<label class="f">Цель к дате, ₽<input name="target" type="number" inputmode="decimal" value="${st.target || ''}" placeholder="необязательно"></label>`);
  if (g === 'ladder') f.push(`<label class="f">Ступеней (лет)<select name="years">${[1, 2, 3, 4, 5, 6, 7].map(y => opt(y, st.years, y)).join('')}</select></label>`);
  if (g === 'reserve') f.push(`<label class="f">Деньги могут понадобиться через<select name="months">${[[1, 'месяц'], [3, '3 месяца'], [6, 'полгода'], [12, 'год'], [24, '2 года']].map(([v, l]) => opt(v, st.months, l)).join('')}</select></label>`);
  if (g === 'growth') f.push(`<label class="f">Горизонт<select name="gyears">${[3, 5, 7, 10, 15, 20].map(y => opt(y, st.gyears, `${y} лет`.replace(/^3 лет/, '3 года'))).join('')}</select></label>`,
    `<label class="f">Профиль риска<select name="profile">${Object.entries(PROFILES).map(([k, [l, w]]) => opt(k, st.profile, `${l} — ${w.stock}% акций`)).join('')}</select></label>`,
    `<label class="f">Акции<select name="style">${opt('index', st.style, 'одним фондом на индекс')}${opt('stocks', st.style, 'отдельные голубые фишки')}</select></label>`);
  if (['date', 'ladder', 'lock'].includes(g)) f.push(`<label class="f">Надёжность<select name="risk">${RISKS.filter(([k]) => g !== 'lock' || k !== 'yield').map(([k, l]) => opt(k, st.risk, l)).join('')}</select></label>`);
  return `<div class="head"><div><h1>Стратегии</h1><p class="sub">Выберите цель — приложение соберёт план по живым данным Мосбиржи: что купить, сколько, когда и когда вернутся деньги. Только российский рынок, для брокерского счёта в РФ.</p></div></div>
  ${saved.length ? `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="muted" style="font-size:13px">Сохранённые:</span>${saved.map((s, i) => `<span class="chip gold" style="gap:6px"><button type="button" class="link" data-act="st-load" data-i="${i}" style="all:unset;cursor:pointer">${esc(s.label)}</button><button type="button" data-act="st-del" data-i="${i}" aria-label="Удалить" style="all:unset;cursor:pointer;opacity:.6">×</button></span>`).join('')}</div>` : ''}
  <div class="goals" role="group" aria-label="Цель">${GOALS.map(([k, t, d]) => `<button type="button" class="goal" data-act="st-goal" data-k="${k}" aria-pressed="${g === k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
  ${g === 'income' ? `<section class="panel"><h2>Пассивный доход</h2><p class="note">Для этой цели есть отдельный конструктор: укажите, сколько хотите получать в месяц или в какие месяцы, — он подберёт облигации по опубликованным купонам и покажет, что и до какой даты купить.</p><div><button class="btn" data-act="st-income">Открыть конструктор дохода</button></div></section>` : `
  <section class="panel"><form class="form" id="st-form" autocomplete="off">${f.join('')}</form>
    ${bc > 1000 ? `<p class="note">Свободно у брокера: <b>${rub(bc)}</b>. <button type="button" class="btn ghost sm" data-act="st-cash">Вложить их</button></p>` : ''}
    <div class="row"><button class="btn" data-act="st-build" ${st.loading ? 'disabled' : ''}>${st.loading ? 'Собираю…' : 'Собрать стратегию'}</button>${st.result ? '<button class="btn ghost" data-act="st-save">Сохранить</button>' : ''}</div>
  </section>
  ${st.err ? `<div class="banner"><span>${esc(st.err)}.</span></div>` : ''}
  ${st.result ? viewResult(st.result) : ''}`}`;
}

function viewResult(r){
  const tot = Math.max(1, sumCost(r.rows)), kinds = {};
  r.rows.forEach(x => kinds[x.kind === 'fund' ? 'mmf' : x.kind] = (kinds[x.kind === 'fund' ? 'mmf' : x.kind] || 0) + x.cost);
  const leftover = st.sum - r.invest;
  return `<section class="statement">
    <div style="display:flex;flex-direction:column;gap:10px"><span class="label">${esc(r.title)} · вложить сейчас</span><span class="big">${nf0.format(r.invest)}<small>₽</small></span>
      <div class="alloc" aria-label="Распределение">${Object.entries(kinds).map(([k, v]) => `<i style="width:${v / tot * 100}%;background:${KIND_COLOR[k]}" title="${KIND_LABEL[k]} ${nf0.format(v / tot * 100)}%"></i>`).join('')}</div>
      <div class="chips">${Object.entries(kinds).map(([k, v]) => `<span class="chip"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${KIND_COLOR[k]};margin-right:6px"></i>${KIND_LABEL[k]} ${nf0.format(v / tot * 100)}%</span>`).join('')}${leftover > 1 ? `<span class="chip">не вложено ${rub(leftover)}</span>` : ''}</div></div>
    <div class="figs">${r.figs.map(([l, v]) => `<div class="fig"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
  </section>
  ${r.banners.map(b => `<div class="banner info"><span>${esc(b)}</span></div>`).join('')}
  <section class="panel"><div class="panel-head"><h2>Что купить</h2><span class="note">Цены — последние с Мосбиржи, облигации с ${term('nkd', 'НКД')}</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Бумага</th><th class="hide-m">Зачем</th><th class="r">Штук</th><th class="r">Сумма</th><th class="r">${term('ytm', 'Доходность')}</th><th class="r">Деньги вернутся</th><th></th></tr></thead><tbody>
    ${r.rows.map(x => `<tr class="click" data-act="instrument" data-t="${esc(x.ticker)}"><td><div class="sec">${logo(x.ticker, x.name)}<div><b>${esc(x.name)}</b><div class="sub2">${x.kind === 'bond' ? (x.b.gov ? 'ОФЗ' : `уровень ${x.b.list_level}`) + ` · купон ${nf2.format(x.b.coupon_pct || 0)}%` : esc(x.ticker) + (x.lot > 1 ? ` · лот ${x.lot}` : '')}</div><div class="sub2 show-m">${esc(x.role || '')}</div></div></div></td>
      <td class="muted hide-m" style="font-size:13px">${esc(x.role || '')}</td><td class="r num">${nf0.format(x.qty)}</td><td class="r num"><b>${rub(x.cost)}</b></td>
      <td class="r num">${x.kind === 'bond' ? nf2.format(x.ytm) + '%' : x.kind === 'mmf' ? '≈' + nf2.format(U.mmfY) + '%' : '—'}</td>
      <td class="r num">${x.back ? `${fmtD(x.back)}<div class="sub2">через ${nf0.format(daysBetween(today(), x.back) / 30.44)} мес</div>` : '<span class="muted">в любой день</span>'}</td>
      <td class="r"><button class="btn ghost sm" data-act="scr-buy" data-t="${esc(x.ticker)}">Купить</button></td></tr>`).join('')}
    </tbody></table></div>
    ${r.notes.map(n => `<p class="note">${n}</p>`).join('')}
  </section>
  ${r.extra || ''}
  <section class="panel"><h2>План действий</h2>
    <div class="steps">${r.steps.sort((a, b) => a.date.localeCompare(b.date)).map(s => `<div class="step${s.final ? ' final' : ''}"><span class="num muted">${s.date === today() ? 'Сегодня' : fmtD(s.date)}</span><span>${s.text}</span><span class="num">${s.amount ? rub(s.amount) : ''}</span></div>`).join('')}</div>
    <p class="note">Это расчёт по правилам и данным биржи, а не индивидуальная инвестиционная рекомендация. Перед покупкой откройте карточку бумаги и проверьте эмитента.</p>
  </section>`;
}

const label = () => {
  const s = rub(st.sum);
  return {date: `К ${fmtD(st.date)}${st.target ? ` · ${rub(st.target)}` : ` · ${s}`}`, ladder: `Лестница ${st.years} г. · ${s}`, lock: `Ставка · ${s}`, reserve: `Подушка · ${s}`, growth: `Рост ${st.gyears} лет · ${s}`}[st.goal];
};
const PARAMS = ['goal', 'sum', 'monthly', 'date', 'target', 'years', 'months', 'gyears', 'risk', 'profile', 'style'];
export const ST_ACTIONS = {
  'st-goal': b => { st.goal = b.dataset.k; st.result = null; st.err = null; ctx.render(); },
  'st-build': () => build(),
  'rv-strategy': b => { st.goal = b.dataset.k; st.sum = +b.dataset.s || st.sum; st.result = null; st.err = null; ctx.go('strategy'); },
  'st-cash': () => { st.sum = Math.floor(Math.max(0, brokerCash())); ctx.render(); },
  'st-save': guard(async () => {
    const list = ctx.S.settings.strategies ||= [];
    list.unshift({label: label(), params: Object.fromEntries(PARAMS.map(k => [k, st[k]]))}); list.splice(10);
    await saveSettings(); toast('Стратегия сохранена'); ctx.render();
  }),
  'st-load': b => { Object.assign(st, ctx.S.settings.strategies[+b.dataset.i].params); build(); },
  'st-del': guard(async b => { ctx.S.settings.strategies.splice(+b.dataset.i, 1); await saveSettings(); ctx.render(); }),
};
export function stInput(e){
  const f = e.target.closest('#st-form'); if (!f) return false;
  for (const el of f.elements) if (el.name) st[el.name] = ['date', 'risk', 'profile', 'style'].includes(el.name) ? el.value : num(el.value);
  return true;
}
