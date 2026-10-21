// Formatting, dates and small SVG charts shared by every screen.
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf0 = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0});
const nf2 = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const rub = (n, d) => (d ? nf2 : nf0).format(Math.round((+n || 0) * 100) / 100) + ' ₽';
const pct = n => (isFinite(n) ? (n >= 0 ? '+' : '') + nf2.format(n) + '%' : '—');
const sgn = n => n > 0.005 ? 'pos' : n < -0.005 ? 'neg' : 'muted';
// dates live as plain 'YYYY-MM-DD' strings: no time zones, no shifting
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const ym = s => s.slice(0, 7);
const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const MONTHS_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const ymLabel = s => MONTHS_FULL[+s.slice(5,7)-1] + ' ' + s.slice(0,4);
const dLabel = s => +s.slice(8,10) + ' ' + MONTHS[+s.slice(5,7)-1];
const addMonths = (s, k) => { let y = +s.slice(0,4), m = +s.slice(5,7) - 1 + k; y += Math.floor(m/12); m = ((m%12)+12)%12; return y + '-' + String(m+1).padStart(2,'0'); };
const COLORS = ['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)'];


function donut(items, size=168){
  const total = items.reduce((s,i) => s+i.v, 0) || 1; let a = -Math.PI/2; const R = size/2-6, r = R-22, c = size/2;
  const arcs = items.filter(i => i.v > 0).map((it, k) => {
    const da = it.v/total*Math.PI*2, a2 = a + Math.min(da, Math.PI*2-1e-4), large = da > Math.PI ? 1 : 0;
    const p = (ang, rad) => [c + rad*Math.cos(ang), c + rad*Math.sin(ang)];
    const [x1,y1]=p(a,R),[x2,y2]=p(a2,R),[x3,y3]=p(a2,r),[x4,y4]=p(a,r);
    const d = `M${x1},${y1}A${R},${R} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${r},${r} 0 ${large} 0 ${x4},${y4}Z`;
    a = a2; return `<path d="${d}" fill="${it.color}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Распределение" style="flex:none;max-width:100%">${arcs || `<circle cx="${c}" cy="${c}" r="${R-11}" fill="none" stroke="var(--line)" stroke-width="22"/>`}</svg>`;
}
function bars(groups, opts={}){
  // groups: [{label, a, b}] a = income (accent), b = expense (neg)
  const W = 640, H = 200, P = {l:56, r:8, t:10, b:24};
  const max = Math.max(1, ...groups.flatMap(g => [g.a, g.b ?? 0]));
  const nice = niceMax(max), iw = W-P.l-P.r, ih = H-P.t-P.b, gw = iw/groups.length, bw = Math.min(26, gw/3);
  const y = v => P.t + ih - v/nice*ih;
  let s = '';
  for (let i=0;i<=4;i++){ const v = nice*i/4; s += `<line x1="${P.l}" x2="${W-P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${P.l-6}" y="${y(v)+4}" text-anchor="end">${short(v)}</text>`; }
  groups.forEach((g,i) => {
    const x = P.l + gw*i + gw/2;
    if (g.b == null) s += `<rect x="${x-bw/2}" y="${y(g.a)}" width="${bw}" height="${ih-(y(g.a)-P.t)}" rx="3" fill="var(--accent)"><title>${esc(g.label)}: ${rub(g.a)}</title></rect>`;
    else {
      s += `<rect x="${x-bw-1}" y="${y(g.a)}" width="${bw}" height="${P.t+ih-y(g.a)}" rx="3" fill="var(--accent)"><title>Доходы: ${rub(g.a)}</title></rect>`;
      s += `<rect x="${x+1}" y="${y(g.b)}" width="${bw}" height="${P.t+ih-y(g.b)}" rx="3" fill="var(--neg)" opacity=".8"><title>Расходы: ${rub(g.b)}</title></rect>`;
    }
    s += `<text x="${x}" y="${H-6}" text-anchor="middle">${esc(g.label)}</text>`;
  });
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:420px;height:auto" role="img" aria-label="${esc(opts.label||'График')}">${s}</svg></div>`;
}
function area(series, labels, opts={}){
  // series: [{values, color, label}] stacked bottom→top
  const W = 640, H = 220, P = {l:60, r:10, t:10, b:24}, n = labels.length;
  const tops = labels.map((_,i) => series.reduce((s,se) => s + (se.values[i]||0), 0));
  const nice = niceMax(Math.max(1,...tops)), iw = W-P.l-P.r, ih = H-P.t-P.b;
  const x = i => P.l + (n<=1 ? 0 : iw*i/(n-1)), y = v => P.t + ih - v/nice*ih;
  let s = '';
  for (let i=0;i<=4;i++){ const v = nice*i/4; s += `<line x1="${P.l}" x2="${W-P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${P.l-6}" y="${y(v)+4}" text-anchor="end">${short(v)}</text>`; }
  const base = labels.map(()=>0);
  series.forEach(se => {
    const top = base.map((b,i) => b + (se.values[i]||0));
    const d = `M${x(0)},${y(top[0])}` + top.map((v,i)=>`L${x(i)},${y(v)}`).join('') + base.map((v,i)=>`L${x(n-1-i)},${y(base[n-1-i])}`).join('') + 'Z';
    s += `<path d="${d}" fill="${se.color}" opacity=".85"><title>${esc(se.label)}</title></path>`;
    top.forEach((v,i) => base[i] = v);
  });
  const step = Math.ceil(n/8);
  labels.forEach((l,i) => { if (i % step === 0 || i === n-1) s += `<text x="${x(i)}" y="${H-6}" text-anchor="middle">${esc(l)}</text>`; });
  s += `<circle cx="${x(n-1)}" cy="${y(tops[n-1])}" r="4" fill="var(--fg)"/>`;
  const leg = series.map(se => `<span class="row" style="gap:6px"><i class="sw" style="background:${se.color}"></i>${esc(se.label)}</span>`).join('');
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:420px;height:auto" role="img" aria-label="${esc(opts.label||'Рост')}">${s}</svg></div><div class="row" style="gap:16px;font-size:13px;color:var(--muted)">${leg}</div>`;
}
function niceMax(v){ const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v/p; return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p; }
function short(v){ const a = Math.abs(v); return a>=1e9 ? nf2.format(v/1e9).replace(/,00$/,'')+' млрд' : a>=1e6 ? nf2.format(v/1e6).replace(/,00$/,'')+' млн' : a>=1e3 ? nf0.format(v/1e3)+' тыс' : nf0.format(v); }


export { $, uid, esc, nf0, nf2, rub, pct, sgn, today, ym, MONTHS, MONTHS_FULL, ymLabel, dLabel, addMonths, COLORS, donut, bars, area, niceMax, short };
