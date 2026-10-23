// Demo mode (?demo): an in-memory stand-in for the Supabase client, so the app
// can be tried without an account. Nothing is sent anywhere; a reload resets it.
const uuid = () => crypto.randomUUID();
const DEMO_USER = {id: '00000000-0000-4000-8000-000000000001', email: 'demo@kapital.test'};
const now = new Date(), pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const plusDays = n => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d); };
const mon = k => { const d = new Date(now.getFullYear(), now.getMonth() + k, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };

const bond = (ticker, name, board, pricePct, ytm, cpn, years, extra = {}) => ({ticker, name, board, cls: 'bond', price: pricePct * 10, prev_price: pricePct * 10 * 0.998, change_pct: 0.2, face_value: 1000,
  ytm, coupon_pct: cpn, coupon_value: cpn * 1000 / 100 / 2, coupon_period: 182, next_coupon: plusDays(20 + years * 7 % 90), mat_date: plusDays(Math.round(years * 365)), duration_days: Math.round(years * 0.85 * 365),
  list_level: board === 'TQOB' ? 1 : 2, value_today: 30e6 + years * 5e6, offer_date: null, accrued: 12.4, ...extra});
const stock = (ticker, name, price, chg, cap, val) => ({ticker, name, board: 'TQBR', cls: 'stock', price, prev_price: price / (1 + chg / 100), change_pct: chg, capitalization: cap * 1e9, value_today: val * 1e6, list_level: 1, lot: 10});
const tables = {
  profiles: [], accounts: [], transactions: [], recurring: [], trades: [], manual_prices: [], goals: [], net_worth: [], portfolios: [], expected_dividends: [], bond_events: [], capital_daily: [], watchlist: [], broker_connections: [], tg_links: [], fx_rates: [{code: 'RUB', rate: 1, date: plusDays(0)}, {code: 'USD', rate: 82.89, date: plusDays(0)}, {code: 'EUR', rate: 93.04, date: plusDays(0)}, {code: 'CNY', rate: 12.37, date: plusDays(0)}],
  foreign_quotes: [
    {symbol: 'AAPL', name: 'Apple Inc.', price: 239.5, prev_price: 237.1, change_pct: 1.01, currency: 'USD', exchange: 'NasdaqGS', quote_type: 'EQUITY'},
    {symbol: 'VOO', name: 'Vanguard S&P 500 ETF', price: 541.2, prev_price: 538.9, change_pct: 0.43, currency: 'USD', exchange: 'NYSEArca', quote_type: 'ETF'},
    {symbol: 'MSFT', name: 'Microsoft Corporation', price: 431.8, prev_price: 434.6, change_pct: -0.64, currency: 'USD', exchange: 'NasdaqGS', quote_type: 'EQUITY'}], app_config: [{id: 1, owner: null, bot_username: null}],
  market_sync: [{id: 1, last_run: now.toISOString(), last_status: 'demo'}],
  securities: [
    stock('SBER', 'Сбербанк', 312.4, 1.07, 6700, 5200), stock('LKOH', 'ЛУКОЙЛ', 7150, -0.56, 4900, 2100), stock('GAZP', 'Газпром', 128.3, 0.4, 3000, 3300),
    stock('ROSN', 'Роснефть', 455, -1.2, 4800, 900), stock('YDEX', 'Яндекс', 4120, 2.3, 1500, 1800), stock('TATN', 'Татнефть', 640, 0.9, 1400, 600),
    stock('MGNT', 'Магнит', 5100, -0.3, 520, 400), stock('MOEX', 'Мосбиржа', 205, 1.5, 470, 350), stock('PLZL', 'Полюс', 2030, 0.1, 2700, 800),
    {ticker: 'TMOS', name: 'TMOS ETF', board: 'TQTF', cls: 'fund', price: 7.05, prev_price: 7.01, change_pct: 0.57, value_today: 90e6, list_level: 3},
    {ticker: 'LQDT', name: 'Ликвидность ETF', board: 'TQTF', cls: 'fund', price: 1.82, prev_price: 1.819, change_pct: 0.05, value_today: 900e6, list_level: 3},
    {ticker: 'GOLD', name: 'Золото ETF', board: 'TQTF', cls: 'fund', price: 2.6, prev_price: 2.58, change_pct: 0.8, value_today: 40e6, list_level: 3},
    bond('SU26238RMFS4', 'ОФЗ 26238', 'TQOB', 64.8, 14.1, 7.1, 14.6), bond('SU26248RMFS3', 'ОФЗ 26248', 'TQOB', 79.3, 14.6, 12.25, 13.6),
    bond('SU26244RMFS2', 'ОФЗ 26244', 'TQOB', 88.1, 14.8, 11.25, 7.4), bond('SU26240RMFS0', 'ОФЗ 26240', 'TQOB', 72, 14.9, 7, 9.8),
    bond('RU000A107W48', 'ИНАРКТИКА 2Р1', 'TQCB', 99.7, 18.4, 15.1, 0.4), bond('RU000A106ZL5', 'РЖД 1Р-28R', 'TQCB', 98.4, 16.9, 15.3, 3.9, {list_level: 1}),
    bond('RU000A108FX8', 'ЭН+ГИДРО 1Р5', 'TQCB', 100.2, 17.5, 17, 1.2), bond('RU000A10A3Z4', 'Самолёт 1Р-16', 'TQCB', 91.5, 27.4, 17.5, 1.8, {list_level: 3}),
    bond('RU000A109KQ8', 'ГТЛК 2Р-04', 'TQCB', 101.1, 19.1, 20.5, 2.6, {offer_date: plusDays(60)}),
    bond('RU000A10ATB6', 'Газпром Капитал БО-05', 'TQCB', 98.9, 17.2, 16.2, 3.2, {list_level: 1, coupon_period: 30, coupon_value: 13.3, next_coupon: plusDays(9)}),
    bond('RU000A10B9Q9', 'Сбербанк 2Р-SBER44', 'TQCB', 99.4, 16.6, 16, 2.4, {list_level: 1, coupon_period: 30, coupon_value: 13.1, next_coupon: plusDays(17)}),
    bond('RU000A10AV37', 'МТС 2Р-08', 'TQCB', 100.3, 17.8, 18, 2.9, {list_level: 1, coupon_period: 91, coupon_value: 44.9, next_coupon: plusDays(33)}),
    bond('RU000A1095L7', 'Ростелеком 2Р-14', 'TQCB', 97.6, 16.9, 15, 3.6, {list_level: 1, coupon_period: 91, coupon_value: 37.4, next_coupon: plusDays(62)}),
    bond('SU26247RMFS5', 'ОФЗ 26247', 'TQOB', 86.4, 14.9, 11, 12.6, {coupon_value: 54.85, next_coupon: plusDays(48)}), bond('RU000A10B4J1', 'Сегежа 3Р-5', 'TQCB', 84, 31.2, 18, 1.4, {list_level: 3}),
    bond('SU26219RMFS4', 'ОФЗ 26219', 'TQOB', 97.5, 13.2, 7.75, 0.9), bond('SU26226RMFS9', 'ОФЗ 26226', 'TQOB', 91.2, 13.9, 7.95, 1.9), bond('SU26229RMFS3', 'ОФЗ 26229', 'TQOB', 90.4, 14.2, 7.15, 3.1),
    bond('SU26241RMFS8', 'ОФЗ 26241', 'TQOB', 83.5, 14.7, 9.5, 6.1), bond('RU000A10BNF8', 'Россети 2Р-01', 'TQCB', 99.1, 16.4, 15.2, 1.1, {list_level: 1}),
    bond('RU000A10C5L7', 'Сибур Холдинг ПБО-05', 'TQCB', 98.2, 16.8, 15.5, 4.6, {list_level: 1}), bond('RU000A10DA41', 'ВТБ Б-1-410', 'TQCB', 100.1, 16.2, 16, 0.7, {list_level: 1}),
  ],
};
const PK = {capital_daily: 'date', fx_rates: 'code', foreign_quotes: 'symbol', watchlist: 'ticker', app_config: 'id', tg_links: 'user_id', broker_connections: 'user_id', profiles: 'user_id', manual_prices: 'ticker', net_worth: 'month', securities: 'ticker', market_sync: 'id'};

(function seed(){
  const u = DEMO_USER.id, ts = now.toISOString();
  const day = (k, dd) => mon(k) + '-' + pad(Math.min(dd, k === 0 ? now.getDate() : 28));
  const A = {card: uuid(), cash: uuid(), sav: uuid(), brk: uuid(), ff: uuid()}, P = {iis: uuid(), ff: uuid()};
  tables.accounts.push(
    {id: A.card, user_id: u, name: 'Карта', type: 'card', start_balance: 40000, rate: null, archived: false, created_at: ts},
    {id: A.cash, user_id: u, name: 'Наличные', type: 'cash', start_balance: 8000, rate: null, archived: false, created_at: ts},
    {id: A.sav, user_id: u, name: 'Накопительный счёт', type: 'savings', start_balance: 280000, rate: 16, archived: false, created_at: ts},
    {id: A.brk, user_id: u, name: 'Т-Инвестиции', type: 'broker', currency: 'RUB', start_balance: 0, rate: null, archived: false, created_at: ts},
    {id: A.ff, user_id: u, name: 'Freedom Finance', type: 'broker', currency: 'USD', start_balance: 3900, rate: null, archived: false, created_at: ts});
  tables.portfolios.push({id: P.iis, user_id: u, name: 'ИИС', kind: 'iis', region: 'ru', currency: 'RUB', account_id: null, sort: 0, created_at: ts},
    {id: P.ff, user_id: u, name: 'Freedom Finance', kind: 'foreign', region: 'foreign', currency: 'USD', account_id: A.ff, sort: 1, created_at: ts});
  tables.profiles.push({user_id: u, settings: {limits: {'Продукты': 30000, 'Кафе': 8000, 'Развлечения': 6000}, targets: {stock: 35, bond: 45, fund: 15, cash: 5}, defaultAccount: A.card, passiveGoal: 15000}});
  const tx = (k, dd, type, amount, category, note = '', acc = A.card, to = null) => tables.transactions.push({id: uuid(), user_id: u, date: day(k, dd), type, amount, account_id: acc, to_account_id: to, category, note, recurring_id: null, created_at: ts});
  for (const k of [-5, -4, -3, -2, -1, 0]) {
    tx(k, 5, 'income', 120000, 'Зарплата');
    tx(k, 7, 'expense', 35000, 'Жильё и ЖКХ', 'Аренда');
    tx(k, 9, 'expense', 9000 + (k + 5) * 700, 'Продукты', 'Перекрёсток'); tx(k, 17, 'expense', 13000 + (k + 5) * 900, 'Продукты');
    tx(k, 11, 'expense', 1800, 'Кафе', 'Кофе с подругой'); tx(k, 22, 'expense', 3000 + ((k * 37) % 5 + 5) * 600, 'Кафе');
    tx(k, 16, 'expense', 3200, 'Транспорт', 'Такси');
    if (k % 2) tx(k, 18, 'expense', 6500, 'Развлечения', 'Концерт');
    tx(k, 20, 'transfer', 30000, '', 'На инвестиции', A.card, A.brk);
    tx(k, 28, 'income', 3600 + (k + 5) * 120, 'Проценты', '', A.sav);
  }
  tx(0, 1, 'expense', 899, 'Подписки', 'Музыка');
  const tr = (k, dd, type, ticker, name, cls, qty, price, extra = {}) => tables.trades.push({id: uuid(), user_id: u, date: day(k, dd), type, ticker, name, cls, qty, price, fee: qty && price ? Math.round(qty * price * 0.0005) : 0, amount: null, kind: null, portfolio_id: null, currency: 'RUB', created_at: ts, ...extra});
  tr(-5, 21, 'buy', 'SBER', 'Сбербанк', 'stock', 100, 285);
  tr(-4, 21, 'buy', 'LKOH', 'ЛУКОЙЛ', 'stock', 3, 6900);
  tr(-4, 22, 'buy', 'SU26238RMFS4', 'ОФЗ 26238', 'bond', 30, 620, {portfolio_id: P.iis});
  tr(-3, 21, 'buy', 'RU000A106ZL5', 'РЖД 1Р-28R', 'bond', 25, 978, {portfolio_id: P.iis});
  tr(-3, 23, 'buy', 'RU000A109KQ8', 'ГТЛК 2Р-04', 'bond', 15, 1004);
  tr(-2, 21, 'buy', 'TMOS', 'TMOS ETF', 'fund', 2000, 6.6);
  tr(-1, 21, 'sell', 'SBER', 'Сбербанк', 'stock', 20, 318);
  tr(-5, 12, 'buy', 'VOO', 'Vanguard S&P 500 ETF', 'fund', 3, 498, {currency: 'USD', portfolio_id: P.ff, fee: 1});
  tr(-3, 12, 'buy', 'AAPL', 'Apple Inc.', 'stock', 4, 221, {currency: 'USD', portfolio_id: P.ff, fee: 1});
  tr(-2, 14, 'buy', 'MSFT', 'Microsoft Corporation', 'stock', 2, 418, {currency: 'USD', portfolio_id: P.ff, fee: 1});
  tr(-1, 9, 'income', 'VOO', 'Vanguard S&P 500 ETF', 'fund', null, null, {amount: 4.6, kind: 'Дивиденды', currency: 'USD', portfolio_id: P.ff});
  tr(-2, 25, 'income', 'SBER', 'Сбербанк', 'stock', null, null, {amount: 2900, kind: 'Дивиденды'});
  tr(-1, 3, 'income', 'SU26238RMFS4', 'ОФЗ 26238', 'bond', null, null, {amount: 924, kind: 'Купон', portfolio_id: P.iis});
  // bond schedules for the held bonds: coupons every 6 months (monthly for RZD), GTLK offer in 60 days
  const ev = (ticker, date, kind, value_rub) => tables.bond_events.push({ticker, date, kind, value_rub, value_pct: null, record_date: null});
  for (let i = 0; i < 3; i++) { ev('SU26238RMFS4', plusDays(18 + 182 * i), 'coupon', 35.4); ev('RU000A109KQ8', plusDays(40 + 91 * i), 'coupon', 51.1); }
  for (let i = 0; i < 12; i++) ev('RU000A106ZL5', plusDays(5 + 30 * i), 'coupon', 12.6);
  ev('RU000A109KQ8', plusDays(60), 'offer', 1000);
  tables.expected_dividends.push({id: uuid(), user_id: u, ticker: 'SBER', record_date: plusDays(250), per_share: 40, note: 'прогноз', created_at: ts}, {id: uuid(), user_id: u, ticker: 'LKOH', record_date: plusDays(65), per_share: 541, note: 'промежуточные', created_at: ts});
  tables.watchlist.push({user_id: u, ticker: 'YDEX', alert_below: 3900, alert_above: null, note: 'жду коррекции', created_at: ts}, {user_id: u, ticker: 'SU26248RMFS3', alert_below: null, alert_above: 820, note: '', created_at: ts});
  tables.recurring.push({id: uuid(), user_id: u, type: 'expense', amount: 35000, account_id: A.card, to_account_id: null, category: 'Жильё и ЖКХ', note: 'Аренда', day: 7, start_month: mon(0), last_month: mon(0), active: true, created_at: ts});
  tables.goals.push(
    {id: uuid(), user_id: u, name: 'Подушка безопасности', kind: 'goal', achieved: false, target: 600000, saved: 320000, deadline: mon(10) + '-01', ret: 14, created_at: ts},
    {id: uuid(), user_id: u, name: 'Отпуск в Италии', kind: 'goal', achieved: false, target: 180000, saved: 55000, deadline: mon(7) + '-01', ret: 12, created_at: ts},
    {id: uuid(), user_id: u, name: 'Первоначальный взнос', kind: 'goal', achieved: false, target: 2500000, saved: 240000, deadline: mon(48) + '-01', ret: 12, created_at: ts},
    {id: uuid(), user_id: u, name: 'Кофемашина', kind: 'wish', achieved: false, target: 60000, saved: 0, deadline: mon(6) + '-01', ret: 0, created_at: ts},
    {id: uuid(), user_id: u, name: 'Новый ноутбук', kind: 'goal', achieved: true, target: 150000, saved: 150000, deadline: mon(-2) + '-01', ret: 0, created_at: ts});
  [[-8, 452000, 160000], [-7, 470000, 178000], [-6, 488000, 205000], [-5, 505000, 236000], [-4, 521000, 290000], [-3, 536000, 338000], [-2, 548000, 366000], [-1, 560000, 389000]]
    .forEach(([k, cash, inv]) => tables.net_worth.push({user_id: u, month: mon(k), total: cash + inv, invested: inv, cash}));
  // a year of daily capital so the 1M/6M/1Y charts have texture
  let v = 640000, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const walk = []; for (let i = 400; i >= 1; i--) { v = v * (1 + (rnd() - 0.47) * 0.012) + 900; walk.push([plusDays(-i), v]); }
  const k = 965000 / walk[walk.length - 1][1]; // end close to today's computed capital
  walk.forEach(([date, x]) => tables.capital_daily.push({user_id: u, date, total: Math.round(x * k), invested: Math.round(x * k * 0.4), cash: Math.round(x * k * 0.6)}));
})();

const cmp = (a, b) => (a == null) - (b == null) || (a > b ? 1 : a < b ? -1 : 0);
function query(table){
  const filters = [], st = {op: 'select', order: [], range: null, limit: null, single: false, maybe: false, payload: null};
  const api = {
    select(){ return api; },
    insert(p){ st.op = 'insert'; st.payload = p; return api; },
    update(p){ st.op = 'update'; st.payload = p; return api; },
    upsert(p){ st.op = 'upsert'; st.payload = p; return api; },
    delete(){ st.op = 'delete'; return api; },
    eq(c, v){ filters.push(r => r[c] === v); return api; },
    in(c, vs){ filters.push(r => vs.includes(r[c])); return api; },
    gte(c, v){ filters.push(r => r[c] != null && r[c] >= v); return api; },
    lte(c, v){ filters.push(r => r[c] != null && r[c] <= v); return api; },
    gt(c, v){ filters.push(r => r[c] != null && r[c] > v); return api; },
    lt(c, v){ filters.push(r => r[c] != null && r[c] < v); return api; },
    is(c, v){ filters.push(r => (r[c] ?? null) === v); return api; },
    not(c, op, v){ filters.push(r => !((r[c] ?? null) === v)); return api; },
    or(expr){ const s = ((expr.match(/ticker\.ilike\.(.*?)%/) || [])[1] || '').toLowerCase(); filters.push(r => r.ticker.toLowerCase().startsWith(s) || (r.name || '').toLowerCase().includes(s)); return api; },
    order(c, o = {}){ st.order.push([c, o.ascending !== false]); return api; },
    range(a, b){ st.range = [a, b]; return api; },
    limit(n){ st.limit = n; return api; },
    single(){ st.single = true; return api; },
    maybeSingle(){ st.maybe = true; return api; },
    then(res, rej){ return Promise.resolve(run()).then(res, rej); },
  };
  const match = r => filters.every(f => f(r));
  const fill = r => {
    const row = {...r};
    if (!PK[table]) row.id ||= uuid();
    if (!['securities', 'market_sync', 'bond_events', 'app_config', 'fx_rates', 'foreign_quotes'].includes(table)) row.user_id = DEMO_USER.id;
    row.created_at ||= now.toISOString();
    if (table === 'accounts') { row.start_balance ??= 0; row.archived ??= false; row.rate ??= null; }
    if (table === 'transactions') { row.to_account_id ??= null; row.recurring_id ??= null; row.category ??= ''; row.note ??= ''; }
    if (table === 'trades') { row.fee ??= 0; row.portfolio_id ??= null; }
    if (table === 'recurring') { row.active ??= true; row.last_month ??= null; }
    if (table === 'goals') { row.kind ??= 'goal'; row.achieved ??= false; }
    return row;
  };
  function run(){
    let data;
    if (st.op === 'select') {
      data = tables[table].filter(match);
      for (const [c, asc] of [...st.order].reverse()) data = [...data].sort((a, b) => cmp(a[c], b[c]) * (asc ? 1 : -1));
      if (st.range) data = data.slice(st.range[0], st.range[1] + 1);
      if (st.limit) data = data.slice(0, st.limit);
    } else if (st.op === 'insert' || st.op === 'upsert') {
      data = (Array.isArray(st.payload) ? st.payload : [st.payload]).map(fill).map(r => {
        const k = PK[table], i = st.op === 'upsert' && k ? tables[table].findIndex(x => x[k] === r[k]) : -1;
        if (i >= 0) { tables[table][i] = {...tables[table][i], ...r}; return tables[table][i]; }
        tables[table].push(r); return r;
      });
    } else if (st.op === 'update') data = tables[table].filter(match).map(r => Object.assign(r, st.payload));
    else { data = tables[table].filter(match); tables[table] = tables[table].filter(r => !match(r)); }
    data = data.map(r => ({...r}));
    if (st.single) return {data: data[0] ?? null, error: data[0] ? null : {message: 'not found'}};
    if (st.maybe) return {data: data[0] ?? null, error: null};
    return {data, error: null};
  }
  return api;
}

export function createDemoClient(){
  const session = {user: DEMO_USER};
  return {
    from: query,
    functions: {invoke: async (name, opts = {}) => {
      const b = opts.body || {};
      if (name === 'ai-analyze') return {data: {demo: true}, error: null};
      if (name === 'moex-sync' && Array.isArray(b.tickers)) {
        // build schedules from the coupon period, like the exchange's bondization data
        for (const t of b.tickers) { const s = tables.securities.find(x => x.ticker === t); if (!s?.next_coupon || tables.bond_events.some(e => e.ticker === t)) continue;
          for (let d = s.next_coupon, n = 0; d <= s.mat_date && n < 60; d = (() => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + s.coupon_period); return iso(x); })(), n++) tables.bond_events.push({ticker: t, date: d, kind: 'coupon', value_rub: s.coupon_value, value_pct: s.coupon_pct, record_date: null}); }
        return {data: {events: 1}, error: null};
      }
      if (name === 'foreign' && b.action === 'search') return {data: {results: [{symbol: 'NVDA', name: 'NVIDIA Corporation', type: 'stock', exchange: 'NASDAQ'}, {symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'fund', exchange: 'NYSEArca'}, {symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', exchange: 'NASDAQ'}].filter(r => (r.symbol + r.name).toLowerCase().includes(String(b.q).toLowerCase().slice(0, 3)))}, error: null};
      if (name === 'foreign' && b.action === 'history') { const base = tables.foreign_quotes.find(f => f.symbol === b.symbol)?.price || 100; return {data: {points: Array.from({length: 52}, (_, i) => ({d: plusDays(-364 + i * 7), v: base * (0.82 + i * 0.0035 + Math.sin(i / 4) * 0.03)})), currency: 'USD'}, error: null}; }
      return {data: {}, error: null};
    }},
    auth: {
      getSession: async () => ({data: {session}}),
      onAuthStateChange(cb){ setTimeout(() => cb('SIGNED_IN', session)); return {data: {subscription: {unsubscribe(){}}}}; },
      signOut: async () => { location.href = location.pathname; },
      signInWithOtp: async () => ({error: null}),
    },
  };
}
