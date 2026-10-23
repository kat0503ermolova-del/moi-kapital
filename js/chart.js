// Interactive line chart: a finger or the mouse moves a crosshair, the tooltip shows the date, every series'
// value and the change since the start of the period; an optional "bind" mirrors the value into the page
// (the big capital number follows the finger, like broker apps do).
import { esc, nf0, nf2, rub } from './util.js';
import { smoothPath } from './core.js';

const charts = {};
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtDate = d => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const short = v => { const a = Math.abs(v); return a >= 1e6 ? nf2.format(v / 1e6).replace(/,?0+$/, '') + ' млн' : a >= 1e3 ? nf0.format(v / 1e3) + ' тыс' : nf2.format(v).replace(/,00$/, ''); };

// dates: ['YYYY-MM-DD'…]; series: [{name, values, color, fill}] (first series drives the change figure)
export function ichart({id, dates, series, height = 220, fmt = v => rub(v), marks = [], bind = null, axis = true, dark = false}){
  if (dates.length < 2) return '<p class="note">Для графика нужно хотя бы два значения.</p>';
  const W = 800, H = height, P = {l: axis ? 6 : 2, r: axis ? 64 : 12, t: 14, b: axis ? 26 : 6};
  const all = series.flatMap(s => s.values.filter(v => v != null));
  let min = Math.min(...all), max = Math.max(...all); const pad = (max - min) * 0.08 || Math.abs(max) * 0.05 || 1; min -= pad; max += pad;
  const x = i => P.l + i / (dates.length - 1) * (W - P.l - P.r), y = v => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  charts[id] = {dates, series, fmt, bind, x, y, W, H, P};
  let s = '', labels = '';
  if (axis) for (let k = 0; k <= 3; k++) { const v = min + (max - min) * k / 3; s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>`; labels += `<span class="yl" style="top:${y(v) / H * 100}%">${short(v)}</span>`; }
  series.forEach((se, k) => {
    const pts = se.values.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
    const d = smoothPath(pts);
    if (se.fill) s += `<defs><linearGradient id="${id}-g${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${se.color}" stop-opacity=".32"/><stop offset="1" stop-color="${se.color}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${pts[pts.length - 1][0]},${H - P.b}L${pts[0][0]},${H - P.b}Z" fill="url(#${id}-g${k})"/>`;
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width || 2.2}" ${se.dash ? 'stroke-dasharray="5 5"' : ''} vector-effect="non-scaling-stroke"/>`;
  });
  marks.forEach(m => { const i = dates.findIndex(d => d >= m.d); if (i < 0) return; const v = series[0].values[i]; if (v == null) return; s += `<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="${m.kind === 'sell' ? 'var(--neg)' : 'var(--gold-light)'}" stroke="var(--surface)" stroke-width="2" vector-effect="non-scaling-stroke"><title>${m.kind === 'sell' ? 'Продажа' : 'Покупка'} ${fmtDate(m.d)}</title></circle>`; });
  if (axis) { const step = Math.max(1, Math.ceil(dates.length / 6)), spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 864e5;
    dates.forEach((d, i) => { if (i % step === 0 && i < dates.length - step / 2) labels += `<span class="xl" style="left:${x(i) / W * 100}%">${spanDays > 400 ? `${MON[+d.slice(5, 7) - 1].slice(0, 3)} ${d.slice(2, 4)}` : `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1].slice(0, 3)}`}</span>`; }); }
  const lastY = y(series[0].values[series[0].values.length - 1]);
  return `<div class="ichart" data-chart="${id}" style="--h:${H}px">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="График. Проведите пальцем, чтобы увидеть значение на дату">${s}<line class="xh" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" stroke="var(--gold-light)" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0"/></svg>
 ${labels}
    <span class="dot end" style="left:${x(dates.length - 1) / W * 100}%;top:${lastY / H * 100}%"></span>
    ${series.map((se, k) => `<span class="dot hov" data-k="${k}" style="--c:${se.color}" hidden></span>`).join('')}
    <div class="tip" hidden></div>
  </div>`;
}

function show(el, clientX){
  const c = charts[el.dataset.chart]; if (!c) return;
  const r = el.getBoundingClientRect(), vx = (clientX - r.left) / r.width * c.W;
  const i = Math.max(0, Math.min(c.dates.length - 1, Math.round((vx - c.P.l) / (c.W - c.P.l - c.P.r) * (c.dates.length - 1))));
  const px = c.x(i) / c.W * 100;
  el.querySelector('.xh').setAttribute('x1', c.x(i)); el.querySelector('.xh').setAttribute('x2', c.x(i)); el.querySelector('.xh').setAttribute('opacity', '.7');
  el.querySelector('.dot.end').hidden = true;
  c.series.forEach((se, k) => { const d = el.querySelector(`.dot.hov[data-k="${k}"]`), v = se.values[i]; if (v == null) { d.hidden = true; return; } d.hidden = false; d.style.left = px + '%'; d.style.top = c.y(v) / c.H * 100 + '%'; });
  const first = c.series[0].values.find(v => v != null), cur = c.series[0].values[i], diff = cur - first, rel = first ? diff / Math.abs(first) * 100 : 0;
  const tip = el.querySelector('.tip');
  tip.innerHTML = `<b>${fmtDate(c.dates[i])}</b>${c.series.map(se => se.values[i] == null ? '' : `<div><i style="background:${se.color}"></i>${esc(se.name)}<span class="num">${c.fmt(se.values[i])}</span></div>`).join('')}<div class="chg ${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '+' : '−'}${c.fmt(Math.abs(diff))} · ${diff >= 0 ? '+' : '−'}${nf2.format(Math.abs(rel))}% с начала периода</div>`;
  tip.hidden = false;
  tip.style.left = Math.min(Math.max(px, 18), 82) + '%';
  if (c.bind) { const b = document.getElementById(c.bind.value), s = document.getElementById(c.bind.sub); if (b) b.textContent = nf0.format(cur); if (s) { s.textContent = `${fmtDate(c.dates[i])} · ${diff >= 0 ? '+' : '−'}${c.fmt(Math.abs(diff))} за период`; s.className = 'chip ' + (diff >= 0 ? 'pos' : 'neg'); } }
}
function hide(el){
  const c = charts[el.dataset.chart]; if (!c) return;
  el.querySelector('.xh').setAttribute('opacity', '0'); el.querySelector('.tip').hidden = true; el.querySelectorAll('.dot.hov').forEach(d => d.hidden = true); el.querySelector('.dot.end').hidden = false;
  if (c.bind) { const b = document.getElementById(c.bind.value), s = document.getElementById(c.bind.sub); if (b && c.bind.restore) b.textContent = c.bind.restore; if (s && c.bind.restoreSub != null) { s.textContent = c.bind.restoreSub; s.className = c.bind.restoreSubClass || 'chip'; } }
}
let active = null;
document.addEventListener('pointermove', e => {
  const el = e.target.closest?.('.ichart');
  if (active && active !== el) { hide(active); active = null; }
  if (el) { active = el; show(el, e.clientX); }
});
document.addEventListener('pointerdown', e => { const el = e.target.closest?.('.ichart'); if (el) { active = el; show(el, e.clientX); } });
document.addEventListener('pointerout', e => { if (active && !active.contains(e.relatedTarget)) { hide(active); active = null; } });
document.addEventListener('touchend', () => { if (active) { const el = active; setTimeout(() => { hide(el); }, 1800); active = null; } }, {passive: true});
