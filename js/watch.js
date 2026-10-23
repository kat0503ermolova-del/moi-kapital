// Watchlist with price alerts, side-by-side comparison of up to four securities, and the bond maturity ladder.
import { $, esc, nf0, nf2, rub, pct, sgn, today, dLabel, short, bars } from './util.js';
import { money, quoteOf } from './core.js';
import { term } from './glossary.js';
import { ctx, sb, q, ISS, CLS, positions, shiftDay, daysBetween, num, toast, openModal, closeModal, inp, guard, logo } from './core.js';

export const cmp = new Set();
const COLORS = ['#9C2F5C', '#A8874F', '#4F6D8F', '#6E8F6A'];

// ---------- watchlist ----------
export const isWatched = t => (ctx.S.watch || []).some(w => w.ticker === t);
export function viewWatch(){
  const list = ctx.S.watch || [];
  if (!list.length) return '<div class="empty">Добавляйте бумаги в избранное звёздочкой в карточке бумаги. Здесь будут их цены и сигналы, а при достижении уровня бот пришлёт сообщение в Telegram.</div>';
  return `<div class="tbl-wrap"><table><thead><tr><th></th><th>Бумага</th><th class="r">Цена</th><th class="r">За день</th><th class="r">Сигнал ниже</th><th class="r">Сигнал выше</th><th></th></tr></thead><tbody>
  ${list.map(w => { const s = quoteOf(w.ticker) || {}, hitLow = w.alert_below != null && s.price <= w.alert_below, hitHigh = w.alert_above != null && s.price >= w.alert_above;
    return `<tr class="click" data-act="instrument" data-t="${esc(w.ticker)}"><td><input class="cmp" type="checkbox" data-act="cmp-toggle" data-t="${esc(w.ticker)}" ${cmp.has(w.ticker) ? 'checked' : ''} aria-label="Сравнить"></td>
      <td><div class="sec">${logo(w.ticker, s.name)}<div><b>${esc(s.name || w.ticker)}</b><div class="sub2">${esc(w.ticker)} · ${CLS[s.cls] || ''}${w.note ? ' · ' + esc(w.note) : ''}</div></div></div></td>
      <td class="r num">${s.price != null ? money(s.price, s.currency || 'RUB', 1) : '—'}</td><td class="r num ${s.change_pct == null ? 'faint' : sgn(s.change_pct)}">${s.change_pct != null ? pct(s.change_pct) : '—'}</td>
      <td class="r num">${w.alert_below != null ? `<span class="chip ${hitLow ? 'neg' : ''}">${nf2.format(w.alert_below)}</span>` : '—'}</td><td class="r num">${w.alert_above != null ? `<span class="chip ${hitHigh ? 'pos' : ''}">${nf2.format(w.alert_above)}</span>` : '—'}</td>
      <td class="r" style="white-space:nowrap"><button class="icon-btn" data-act="watch-alert" data-t="${esc(w.ticker)}" aria-label="Сигналы">✎</button><button class="icon-btn" data-act="watch-del" data-t="${esc(w.ticker)}" aria-label="Убрать">✕</button></td></tr>`; }).join('')}
  </tbody></table></div><p class="note">Сигнал срабатывает, когда цена Мосбиржи пересекает уровень. Уведомление приходит в Telegram раз в день на бумагу.</p>`;
}
function alertModal(t){
  const w = (ctx.S.watch || []).find(x => x.ticker === t) || {}, s = quoteOf(t) || {};
  openModal(`Сигналы · ${s.name || t}`, `<p class="note">Текущая цена ${s.price != null ? money(s.price, s.currency || 'RUB', 1) : 'неизвестна'}, уровни — в той же валюте. Оставьте поле пустым, если сигнал не нужен.</p>
    <div class="form">${inp('below', 'Сообщить, если цена ниже, ₽', w.alert_below ?? '', 'number')}${inp('above', 'Сообщить, если цена выше, ₽', w.alert_above ?? '', 'number')}${inp('note', 'Заметка', w.note || '', 'text', 'placeholder="например, жду дивидендной отсечки"')}</div>`, async fd => {
    const row = {ticker: t, alert_below: fd.below === '' ? null : num(fd.below), alert_above: fd.above === '' ? null : num(fd.above), note: fd.note || ''};
    const saved = await q(sb.from('watchlist').upsert(row).select().single());
    ctx.S.watch = [...(ctx.S.watch || []).filter(x => x.ticker !== t), saved];
    toast('Сигналы сохранены');
  }, {after: () => ctx.afterChange()});
}

// ---------- comparison ----------
export function cmpBar(){
  if (!cmp.size) return '';
  return `<div class="cmp-bar"><span>Выбрано для сравнения: ${cmp.size}</span><button class="btn sm" data-act="cmp-open" ${cmp.size < 2 ? 'disabled' : ''}>Сравнить</button><button class="btn ghost sm" data-act="cmp-clear">Сбросить</button></div>`;
}
async function openCompare(){
  const tickers = [...cmp];
  const rows = await q(sb.from('securities').select('*').in('ticker', tickers), true).catch(() => []);
  rows.forEach(r => { if (r.logo) ctx.logos[r.ticker] = r.logo; });
  const by = Object.fromEntries(rows.map(r => [r.ticker, r])), list = tickers.map(t => by[t]).filter(Boolean);
  const bond = list.every(r => r.cls === 'bond');
  const fields = [
    ['Цена', r => r.price != null ? (r.cls === 'bond' && r.face_value ? nf2.format(r.price / r.face_value * 100) + '%' : nf2.format(r.price) + ' ₽') : '—'],
    ['За день', r => r.change_pct != null ? pct(r.change_pct) : '—'],
    ...(bond || list.some(r => r.cls === 'bond') ? [
      ['Доходность к погашению', r => r.ytm != null ? nf2.format(r.ytm) + '%' : '—'], ['Купон', r => r.coupon_pct != null ? nf2.format(r.coupon_pct) + '%' : '—'],
      ['Выплат в год', r => r.coupon_period ? Math.round(365 / r.coupon_period) : '—'], ['Погашение', r => r.mat_date ? `${r.mat_date.split('-').reverse().join('.')} (${nf2.format(daysBetween(today(), r.mat_date) / 365).replace(/,00$/, '')} г.)` : '—'],
      ['Оферта', r => r.offer_date ? r.offer_date.split('-').reverse().join('.') : r.cls === 'bond' ? 'нет' : '—'], ['Дюрация', r => r.duration_days ? nf2.format(r.duration_days / 365) + ' г.' : '—']] : []),
    ...(list.some(r => r.cls !== 'bond') ? [['Капитализация', r => r.capitalization ? short(r.capitalization) + ' ₽' : '—']] : []),
    ['Уровень листинга', r => r.list_level ?? '—'], ['Оборот за день', r => r.value_today ? short(r.value_today) + ' ₽' : '—'],
    ['В вашем портфеле', r => { const p = positions().find(x => x.ticker === r.ticker && x.open); return p ? rub(p.value) : '—'; }],
  ];
  openModal('Сравнение бумаг', `<div class="tbl-wrap"><table><thead><tr><th></th>${list.map((r, i) => `<th class="r"><div class="sec" style="justify-content:flex-end;min-width:0"><span style="width:10px;height:10px;border-radius:3px;background:${COLORS[i]}"></span>${logo(r.ticker, r.name, 24)}<span>${esc(r.name)}</span></div></th>`).join('')}</tr></thead>
    <tbody>${fields.map(([l, f]) => `<tr><td class="muted">${l}</td>${list.map(r => `<td class="r num">${f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <h3>Цена за год, в процентах от начала</h3><div id="cmp-chart"><p class="note">Загружаю графики с Мосбиржи…</p></div>`, null, {wide: true});
  const from = shiftDay(today(), -365);
  const series = await Promise.all(list.map(async r => {
    try {
      const j = await fetch(`${ISS}/engines/stock/markets/${r.cls === 'bond' ? 'bonds' : 'shares'}/boards/${r.board}/securities/${encodeURIComponent(r.ticker)}/candles.json?iss.meta=off&from=${from}&interval=7&candles.columns=begin,close`).then(x => x.json());
      const pts = j.candles.data.map(d => ({d: d[0].slice(0, 10), v: d[1]}));
      return pts.length ? pts.map(p => ({d: p.d, v: (p.v / pts[0].v - 1) * 100})) : [];
    } catch { return []; }
  }));
  const box = $('#cmp-chart'); if (box) box.innerHTML = multiLine(series, list.map(r => r.name));
}
function multiLine(series, names){
  const all = series.flat(); if (!all.length) return '<p class="note">Нет данных для графика.</p>';
  const W = 720, H = 240, P = {l: 50, r: 10, t: 12, b: 24};
  const dates = [...new Set(all.map(p => p.d))].sort(), min = Math.min(0, ...all.map(p => p.v)), max = Math.max(0, ...all.map(p => p.v)), span = (max - min) || 1;
  const x = d => P.l + dates.indexOf(d) / Math.max(1, dates.length - 1) * (W - P.l - P.r), y = v => P.t + (1 - (v - min) / span) * (H - P.t - P.b);
  let s = '';
  for (let i = 0; i <= 4; i++) { const v = min + span * i / 4; s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${nf0.format(v)}%</text>`; }
  s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line-2)" stroke-dasharray="3 3"/>`;
  series.forEach((pts, i) => { if (pts.length > 1) s += `<path d="${pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}" fill="none" stroke="${COLORS[i]}" stroke-width="2"><title>${esc(names[i])}</title></path>`; });
  const step = Math.ceil(dates.length / 6);
  dates.forEach((d, i) => { if (i % step === 0) s += `<text x="${x(d)}" y="${H - 6}" text-anchor="middle">${dLabel(d)}</text>`; });
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:420px;height:auto" role="img" aria-label="Сравнение цен">${s}</svg></div>
    <div class="row" style="gap:14px;font-size:12.5px;color:var(--muted)">${names.map((n, i) => `<span class="row" style="gap:6px"><i class="sw" style="background:${COLORS[i]}"></i>${esc(n)}</span>`).join('')}</div>`;
}

// ---------- bond ladder ----------
export function ladderPanel(open){
  const bonds = open.filter(p => p.cls === 'bond' && p.sec?.mat_date);
  if (!bonds.length) return '';
  const y0 = +today().slice(0, 4), years = {};
  bonds.forEach(p => {
    const date = p.sec.offer_date && p.sec.offer_date > today() ? p.sec.offer_date : p.sec.mat_date, y = +date.slice(0, 4);
    const k = y - y0 >= 10 ? `${y0 + 10}+` : String(y);
    (years[k] ||= {sum: 0, items: []}).sum += (p.sec.face_value || 1000) * p.qty;
    years[k].items.push(`${p.name || p.ticker}${p.sec.offer_date && date === p.sec.offer_date ? ' (оферта)' : ''}`);
  });
  const keys = Array.from({length: 11}, (_, i) => i === 10 ? `${y0 + 10}+` : String(y0 + i));
  const gaps = keys.slice(0, 5).filter(k => !years[k]);
  return `<section class="panel"><h2>${term('ladder')}</h2>
    <p class="note">Когда вернутся деньги по облигациям (по номиналу, с учётом оферт). Равномерная «лестница» позволяет реинвестировать каждый год по текущим ставкам.</p>
    ${bars(keys.map(k => ({label: k, a: years[k]?.sum || 0})), {label: 'Погашения по годам'})}
    ${keys.filter(k => years[k]).map(k => `<div class="list-row"><span><b>${k}</b> <span class="muted">· ${years[k].items.map(esc).join(', ')}</span></span><span class="num">${rub(years[k].sum)}</span></div>`).join('')}
    ${gaps.length ? `<p class="note">Пустые годы в ближайшие пять лет: ${gaps.join(', ')}. Если хотите ровный поток, присмотрите облигации с погашением в эти годы в «Поиске бумаг».</p>` : ''}
  </section>`;
}

export const WATCH_ACTIONS = {
  'watch-toggle': guard(async b => {
    const t = b.dataset.t;
    if (isWatched(t)) { await q(sb.from('watchlist').delete().eq('ticker', t)); ctx.S.watch = ctx.S.watch.filter(w => w.ticker !== t); b.setAttribute('aria-pressed', 'false'); b.textContent = '☆'; toast('Убрано из избранного'); }
    else { const row = await q(sb.from('watchlist').insert({ticker: t}).select().single()); ctx.S.watch = [...(ctx.S.watch || []), row]; b.setAttribute('aria-pressed', 'true'); b.textContent = '★'; toast('Добавлено в избранное'); }
    if (!ctx.S.sec[t]) { const s = await q(sb.from('securities').select('*').eq('ticker', t).maybeSingle(), true).catch(() => null); if (s) ctx.S.sec[t] = s; }
  }),
  'watch-alert': (b) => { closeModal(); alertModal(b.dataset.t); },
  'watch-del': guard(async b => { await q(sb.from('watchlist').delete().eq('ticker', b.dataset.t)); ctx.S.watch = ctx.S.watch.filter(w => w.ticker !== b.dataset.t); ctx.afterChange(); }),
  'cmp-toggle': (b, id, e) => {
    const t = b.dataset.t;
    if (cmp.has(t)) cmp.delete(t); else { if (cmp.size >= 4) { toast('Можно сравнить до четырёх бумаг'); b.checked = false; return; } cmp.add(t); }
    const bar = $('#cmp-slot'); if (bar) bar.innerHTML = cmpBar();
  },
  'cmp-clear': () => { cmp.clear(); ctx.render(); },
  'cmp-open': () => openCompare(),
};
