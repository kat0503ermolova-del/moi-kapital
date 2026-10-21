// Connections: T-Invest read-only API, Telegram bot (expenses + reminders), broker report import from Excel/CSV.
import { $, esc, nf2, rub, today } from './util.js';
import { ctx, sb, q, DEMO, CLS, loadAll, toast, openModal, closeModal, guard, saveSettings, syncBondSchedules } from './core.js';

const fmtTime = s => s ? new Date(s).toLocaleString('ru-RU', {day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'}) : 'ещё не было';
async function call(fn, body){
  if (DEMO) { toast('В демо-режиме подключения не работают — войдите в аккаунт'); return null; }
  const { data, error } = await sb.functions.invoke(fn, {body});
  if (error) { toast('Нет связи с сервером, попробуйте ещё раз'); return null; }
  return data;
}

export function viewConnections(){
  const S = ctx.S, b = S.broker, tg = S.tg, cfg = S.cfg || {}, me = ctx.user?.id;
  const n = {events: true, limits: true, watch: true, ...(S.settings.notify || {})};
  const brokerBlock = b ? `
      <div class="row" style="justify-content:space-between"><span class="chip pos">Подключено</span><span class="note">Синхронизация: ${fmtTime(b.last_sync)}</span></div>
      ${(b.accounts || []).map(a => `<div class="list-row"><span><b>${esc(a.name)}</b><div class="sub2 muted">${a.type === 'ACCOUNT_TYPE_TINKOFF_IIS' ? 'ИИС' : 'Брокерский счёт'}</div></span><span class="chip">свой портфель</span></div>`).join('')}
      ${b.last_status && b.last_status.startsWith('error') ? `<div class="banner"><span>Последняя синхронизация не удалась: ${esc(b.last_status.slice(7))}</span></div>` : ''}
      <div class="row"><button class="btn" data-act="broker-sync">Синхронизировать сейчас</button><button class="btn danger" data-act="broker-off">Отключить</button></div>
      <p class="note">Приложение само синхронизируется, если с прошлого раза прошло больше 12 часов. Отключение удаляет токен, загруженные сделки остаются.</p>` : `
      <ol><li>В приложении Т-Инвестиций: Настройки → Токены T-Invest API → «Создать токен».</li><li>Выберите <b>«Только для чтения»</b> и доступ ко всем счетам.</li><li>Скопируйте токен (начинается с «t.») и вставьте ниже.</li></ol>
      <label class="f">Токен только для чтения<input id="tinv-token" type="password" autocomplete="off" spellcheck="false" placeholder="t.…"></label>
      <div><button class="btn" data-act="broker-connect">Подключить</button></div>
      <p class="note">Токен «только для чтения» не позволяет покупать, продавать или выводить деньги. Он хранится в зашифрованном хранилище на сервере и в браузер больше не возвращается. Отозвать его можно в любой момент в приложении брокера.</p>`;
  const isOwner = !cfg.owner || cfg.owner === me;
  const tgBlock = !cfg.bot_username ? (isOwner ? `
      <ol><li>В Telegram откройте <b>@BotFather</b> и отправьте <b>/newbot</b>.</li><li>Придумайте имя и адрес бота (например, moi_kapital_bot).</li><li>Скопируйте токен бота и вставьте ниже.</li></ol>
      <label class="f">Токен бота<input id="tg-token" type="password" autocomplete="off" spellcheck="false" placeholder="123456789:AA…"></label>
      <div><button class="btn" data-act="tg-setup">Подключить бота</button></div>
      <p class="note">Бот будет только вашим: токен хранится в зашифрованном хранилище, а писать в приложение может только чат, который вы привяжете.</p>`
      : '<p class="note">Бота настраивает владелец приложения. Пока он не подключён.</p>')
    : !tg?.chat_id ? `
      <p class="note">Бот <b>@${esc(cfg.bot_username)}</b> готов. Привяжите свой чат: нажмите кнопку, откройте ссылку и нажмите «Start» в Telegram.</p>
      <div class="row"><button class="btn" data-act="tg-link">Подключить чат</button><button class="btn ghost" data-act="tg-refresh">Я нажала Start</button></div>
      <div id="tg-link-out"></div>`
    : `
      <div class="row" style="justify-content:space-between"><span class="chip pos">Чат подключён</span><a class="note" href="https://t.me/${esc(cfg.bot_username)}" target="_blank" rel="noopener">@${esc(cfg.bot_username)}</a></div>
      <p class="note">Пишите боту траты: «450 кофе», «1200 такси вчера», «+120 000 зарплата». Команды: /month — итоги месяца, /undo — отменить последнюю запись.</p>
      <h3>Уведомления</h3>
      <label class="row" style="gap:8px"><input type="checkbox" data-notify="events" ${n.events ? 'checked' : ''}> Купоны, оферты, погашения и дивиденды — за 3 дня</label>
      <label class="row" style="gap:8px"><input type="checkbox" data-notify="limits" ${n.limits ? 'checked' : ''}> Превышение лимита по категории</label>
      <label class="row" style="gap:8px"><input type="checkbox" data-notify="watch" ${n.watch ? 'checked' : ''}> Сигналы по ценам из избранного</label>
      <div class="row"><button class="btn ghost" data-act="tg-test">Отправить проверку</button><button class="btn danger" data-act="tg-unlink">Отвязать чат</button></div>`;
  return `<div class="grid">
    <section class="panel conn"><div class="panel-head"><h2>Т-Инвестиции</h2><span class="chip gold">API</span></div>${brokerBlock}</section>
    <section class="panel conn"><div class="panel-head"><h2>Telegram-бот</h2><span class="chip gold">траты и напоминания</span></div>${tgBlock}</section>
    <section class="panel conn"><div class="panel-head"><h2>Freedom Finance</h2><span class="chip gold">отчёт брокера</span></div>
      <ol><li>В личном кабинете Freedom (Tradernet): Отчёты → Брокерский отчёт или «История сделок».</li><li>Выберите период и скачайте в Excel или CSV.</li><li>Загрузите файл ниже и выберите портфель «Freedom Finance».</li></ol>
      <p class="note">API у Freedom есть, но его ключи позволяют выставлять заявки, а режима «только чтение» в документации нет. Хранить такой ключ на сервере небезопасно, поэтому подключаем через отчёт. Цены зарубежных бумаг подтягиваются автоматически.</p></section>
    <section class="panel conn"><h2>Отчёт брокера из файла</h2><p class="note">Freedom Finance, Сбер, ВТБ, Альфа и другие: выгрузите отчёт о сделках в Excel или CSV. Приложение определит колонки (дата, тикер, операция, количество, цена, комиссия, валюта) и не добавит одну сделку дважды.</p>
      <div><label class="btn" for="report-file" style="cursor:pointer">Выбрать файл</label><input type="file" id="report-file" accept=".xlsx,.xls,.csv" hidden></div></section>
  </div>`;
}

// ---------- broker report import ----------
const FIELDS = [['date', 'Дата', /дата|date/i], ['ticker', 'Тикер или ISIN', /тикер|isin|код бумаги|код инстр|ticker|symbol/i], ['name', 'Название', /наименов|название|инструмент|бумага|эмитент/i],
  ['type', 'Операция', /операц|вид сделки|направл|тип сделки|покупка\/продажа|^тип$|side/i], ['qty', 'Количество', /кол-?во|количество|qty|quantity/i], ['price', 'Цена', /^цена|цена за|price/i],
  ['fee', 'Комиссия', /комисс|fee|commission/i], ['amount', 'Сумма (для дивидендов и купонов)', /^сумма|amount/i], ['currency', 'Валюта', /валют|currency|curr/i]];
let XLSX = null;
async function loadXlsx(){
  if (XLSX) return XLSX;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  return (XLSX = window.XLSX);
}
const parseDate = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
};
const toNum = v => typeof v === 'number' ? v : +String(v ?? '').replace(/\s| /g, '').replace(',', '.') || 0;
const kindOf = v => { const s = String(v || '').toLowerCase(); return /покуп|buy|^b$|^к$/.test(s) ? 'buy' : /прода|sell|^s$|^п$/.test(s) ? 'sell' : /дивид/.test(s) ? 'div' : /купон/.test(s) ? 'cpn' : null; };
let report = null;
async function openReport(file){
  try {
    let sheets;
    if (/\.csv$/i.test(file.name)) {
      // Russian broker CSVs use ";" — detect the delimiter instead of trusting the default comma
      const text = (await file.text()).replace(/^﻿/, ''), lines = text.split(/\r?\n/);
      const delim = [';', '\t', ','].sort((a, b) => lines.slice(0, 20).join('').split(b).length - lines.slice(0, 20).join('').split(a).length)[0];
      const split = l => { const out = []; let cur = '', quoted = false; for (const ch of l) { if (ch === '"') quoted = !quoted; else if (ch === delim && !quoted) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
      sheets = [lines.map(split)];
    } else {
      const X = await loadXlsx();
      const wb = X.read(await file.arrayBuffer(), {type: 'array', cellDates: false});
      sheets = wb.SheetNames.map(name => X.utils.sheet_to_json(wb.Sheets[name], {header: 1, raw: true, defval: ''}));
    }
    let best = null;
    for (const rows of sheets) {
      const name = '';
      const hi = rows.findIndex(r => r.some(c => /дата|date/i.test(String(c))) && r.some(c => /цена|price|кол|сумма/i.test(String(c))));
      if (hi >= 0 && (!best || rows.length > best.rows.length)) best = {name, rows, hi};
    }
    if (!best) return toast('Не нашла в файле таблицу сделок: нужна строка заголовков с датой и ценой или суммой');
    const head = best.rows[best.hi].map(c => String(c).trim()), data = best.rows.slice(best.hi + 1).filter(r => r.some(c => c !== ''));
    const map = Object.fromEntries(FIELDS.map(([k, , re]) => [k, head.findIndex(h => re.test(h))]));
    report = {head, data, map, file: file.name};
    renderReport();
  } catch (e) { console.error(e); toast('Не удалось прочитать файл'); }
}
function reportRows(){
  const {data, map} = report, get = (r, k) => map[k] >= 0 ? r[map[k]] : '';
  return data.map(r => {
    const date = parseDate(get(r, 'date')), ticker = String(get(r, 'ticker') || '').trim().toUpperCase(), kind = kindOf(get(r, 'type'));
    if (!date || !ticker || !kind) return null;
    const qty = Math.abs(toNum(get(r, 'qty'))), price = Math.abs(toNum(get(r, 'price'))), fee = Math.abs(toNum(get(r, 'fee'))), amount = Math.abs(toNum(get(r, 'amount')));
    if ((kind === 'buy' || kind === 'sell') && !(qty && price)) return null;
    if ((kind === 'div' || kind === 'cpn') && !amount) return null;
    const c = String(get(r, 'currency') || '').trim().toUpperCase().replace(/^(RUR|SUR)$/, 'RUB');
    return {date, ticker, name: String(get(r, 'name') || '').trim(), kind, qty, price, fee, amount, currency: /^[A-Z]{3}$/.test(c) ? c : null};
  }).filter(Boolean);
}
function renderReport(){
  const rows = reportRows(), {head, map} = report;
  openModal(`Импорт: ${report.file}`, `<p class="note">Проверьте, какие колонки за что отвечают. Строки без даты, тикера или понятной операции пропускаются.</p>
    <div class="map-grid">${FIELDS.map(([k, l]) => `<label class="f">${l}<select data-map="${k}"><option value="-1">— нет —</option>${head.map((h, i) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(h || 'колонка ' + (i + 1))}</option>`).join('')}</select></label>`).join('')}</div>
    <h3>Найдено сделок: ${rows.length} из ${report.data.length} строк</h3>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Дата</th><th>Бумага</th><th>Операция</th><th class="r">Кол-во × цена</th><th class="r">Сумма</th></tr></thead><tbody>${rows.slice(0, 6).map(r => `<tr><td class="num">${r.date.split('-').reverse().join('.')}</td><td>${esc(r.ticker)}${r.name ? ` <span class="muted">${esc(r.name)}</span>` : ''}</td><td>${{buy: 'Покупка', sell: 'Продажа', div: 'Дивиденды', cpn: 'Купон'}[r.kind]}</td><td class="r num">${r.qty ? `${nf2.format(r.qty).replace(/,00$/, '')} × ${nf2.format(r.price)}` : ''}</td><td class="r num">${rub(r.amount || r.qty * r.price, 1)}</td></tr>`).join('')}</tbody></table></div>${rows.length > 6 ? `<p class="note">…и ещё ${rows.length - 6}</p>` : ''}` : '<div class="empty">Пока ни одной сделки — поправьте соответствие колонок.</div>'}
    ${ctx.S.portfolios.length ? `<label class="f">В какой портфель<select id="imp-pf"><option value="">Основной</option>${ctx.S.portfolios.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>` : ''}`,
  rows.length ? async () => {
    const tickers = [...new Set(rows.map(r => r.ticker))];
    const sec = Object.fromEntries((await q(sb.from('securities').select('ticker,name,cls').in('ticker', tickers), true).catch(() => [])).map(s => [s.ticker, s]));
    const pid = $('#imp-pf')?.value || null, pfo = ctx.S.portfolios.find(p => p.id === pid), defCur = pfo?.currency || 'RUB';
    const ins = rows.map(r => { const s = sec[r.ticker], cls = s?.cls || (/^(SU|RU)\d/.test(r.ticker) ? 'bond' : 'stock');
      return {date: r.date, ticker: r.ticker.replace(/\.US$/, ''), name: s?.name || r.name, cls, portfolio_id: pid, currency: r.currency || (s ? 'RUB' : defCur), ext_id: `file:${r.date}:${r.ticker}:${r.kind}:${r.qty}:${r.price}:${r.amount}`,
        ...(r.kind === 'buy' || r.kind === 'sell' ? {type: r.kind, qty: r.qty, price: r.price, fee: r.fee, amount: null, kind: null} : {type: 'income', qty: null, price: null, fee: 0, amount: r.amount, kind: r.kind === 'div' ? 'Дивиденды' : 'Купон'})}; });
    let added = 0;
    for (let i = 0; i < ins.length; i += 500) { const data = await q(sb.from('trades').upsert(ins.slice(i, i + 500), {onConflict: 'user_id,ext_id', ignoreDuplicates: true}).select()); added += data.length; }
    const foreign = [...new Set(ins.filter(r => r.currency !== 'RUB').map(r => r.ticker))];
    if (foreign.length && !DEMO) await sb.functions.invoke('foreign', {body: {action: 'quote', symbols: foreign.slice(0, 30)}}).catch(() => null);
    const bonds = [...new Set(ins.filter(r => r.cls === 'bond').map(r => r.ticker))];
    if (bonds.length) await syncBondSchedules(bonds.slice(0, 30));
    await loadAll(); report = null;
    toast(`Добавлено сделок: ${added}${ins.length - added ? `, уже были: ${ins.length - added}` : ''}`);
  } : null, {wide: true, submit: `Импортировать ${rows.length}`, after: () => ctx.afterChange()});
}

export const CONNECT_ACTIONS = {
  'broker-connect': guard(async b => {
    const token = $('#tinv-token').value.trim();
    if (!/^t\.[A-Za-z0-9_-]{20,}$/.test(token)) return toast('Токен должен начинаться с «t.» — скопируйте его целиком');
    b.disabled = true; b.textContent = 'Подключаю и загружаю сделки…';
    const r = await call('broker', {action: 'connect', token});
    b.disabled = false; b.textContent = 'Подключить';
    if (!r) return;
    if (r.error) return toast(r.error === 'bad_token' ? 'Токен не подошёл. Проверьте, что он не отозван' : r.error === 'no_accounts' ? 'На этом токене нет открытых счетов' : 'Не удалось подключиться: ' + (r.message || r.error));
    await loadAll(); ctx.afterChange(); toast(`Подключено счетов: ${r.accounts}. Загружено операций: ${r.added}`);
  }),
  'broker-sync': guard(async b => {
    b.disabled = true; b.textContent = 'Синхронизирую…';
    const r = await call('broker', {action: 'sync'});
    if (r?.error) toast(r.error === 'bad_token' ? 'Токен больше не действует — подключите заново' : 'Не удалось: ' + (r.message || r.error));
    else if (r) { await loadAll(); ctx.afterChange(); toast(`Новых операций: ${r.added}`); }
    if (b.isConnected) { b.disabled = false; b.textContent = 'Синхронизировать сейчас'; }
  }),
  'broker-off': guard(async b => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Нажмите ещё раз, чтобы отключить'; return; }
    const r = await call('broker', {action: 'disconnect'});
    if (r?.ok) { ctx.S.broker = null; ctx.afterChange(); toast('Т-Инвестиции отключены, токен удалён'); }
  }),
  'tg-setup': guard(async b => {
    const botToken = $('#tg-token').value.trim();
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) return toast('Токен бота выглядит как 123456789:AA… — скопируйте его целиком из @BotFather');
    b.disabled = true;
    const r = await call('tg-admin', {action: 'setup', botToken});
    b.disabled = false;
    if (!r) return;
    if (r.error) return toast(r.error === 'not_owner' ? 'Бот уже настроен другим владельцем' : r.error === 'bad_token' ? 'Telegram не принял токен' : 'Не удалось: ' + (r.message || r.error));
    ctx.S.cfg = {...(ctx.S.cfg || {}), owner: ctx.user.id, bot_username: r.bot}; ctx.afterChange(); toast(`Бот @${r.bot} подключён. Теперь привяжите чат`);
  }),
  'tg-link': guard(async () => {
    const r = await call('tg-admin', {action: 'link'});
    if (!r) return;
    if (r.error) return toast('Бот ещё не настроен');
    $('#tg-link-out').innerHTML = `<div class="banner info"><span>Откройте ссылку и нажмите «Start». Ссылка действует 15 минут.</span><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Открыть @${esc(r.bot)}</a></div>`;
  }),
  'tg-refresh': guard(async () => {
    ctx.S.tg = await q(sb.from('tg_links').select('*').maybeSingle(), true).catch(() => null);
    ctx.render(); toast(ctx.S.tg?.chat_id ? 'Чат подключён' : 'Пока не вижу подключения — нажмите Start в боте');
  }),
  'tg-test': guard(async () => { const r = await call('tg-admin', {action: 'test'}); if (r?.ok) toast('Сообщение отправлено в Telegram'); }),
  'tg-unlink': guard(async b => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Нажмите ещё раз'; return; }
    const r = await call('tg-admin', {action: 'unlink'}); if (r?.ok) { ctx.S.tg = null; ctx.afterChange(); toast('Чат отвязан'); }
  }),
};
export async function connectChange(e){
  if (e.target.id === 'report-file' && e.target.files[0]) { await openReport(e.target.files[0]); e.target.value = ''; return true; }
  if (e.target.dataset.map && report) { report.map[e.target.dataset.map] = +e.target.value; renderReport(); return true; }
  if (e.target.dataset.notify) {
    ctx.S.settings.notify = {events: true, limits: true, watch: true, ...(ctx.S.settings.notify || {}), [e.target.dataset.notify]: e.target.checked};
    await guard(saveSettings)(); toast('Настройки уведомлений сохранены'); return true;
  }
  return false;
}
// quietly pull new broker operations if the last sync is older than 12 hours
export async function autoSync(){
  const b = ctx.S?.broker;
  if (DEMO || !b || (b.last_sync && Date.now() - Date.parse(b.last_sync) < 12 * 3600e3)) return;
  const { data } = await sb.functions.invoke('broker', {body: {action: 'sync'}}).catch(() => ({}));
  if (data?.added) { await loadAll(); ctx.afterChange(); toast(`Из Т-Инвестиций подтянуто операций: ${data.added}`); }
}
