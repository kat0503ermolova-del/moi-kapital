// Quick entry: "450 кофе", "+120 000 зарплата", "1200 такси вчера" → a transaction draft.
import { today } from './util.js';
import { ctx, num, pad, shiftDay } from './core.js';

const SYN = {
  'Продукты':['продукт','еда','магазин','пятерочка','пятёрочка','перекресток','перекрёсток','ашан','вкусвилл','лента','магнит','самокат','супермаркет'],
  'Кафе':['кафе','кофе','ресторан','обед','ужин','завтрак','доставка','бар','фастфуд'],
  'Транспорт':['такси','метро','бензин','транспорт','автобус','парковка','каршеринг','электричка','поезд'],
  'Жильё и ЖКХ':['аренда','жкх','квартплата','коммуналка','интернет','электричество','ремонт'],
  'Здоровье':['аптека','врач','здоровье','лекарства','стоматолог','анализы','спорт','фитнес'],
  'Одежда':['одежда','обувь','кроссовки'],
  'Развлечения':['кино','концерт','развлечения','театр','игры','музей'],
  'Подписки':['подписка','плюс','музыка','облако'],
  'Подарки':['подарок','подарки'],
  'Зарплата':['зарплата','зп','аванс','премия'],
  'Подработка':['подработка','фриланс','заказ'],
  'Проценты':['проценты','процент','кэшбэк','кешбэк'],
};
export function parseQuick(raw){
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  let date = today();
  if (/позавчера/.test(s)) { date = shiftDay(date, -2); s = s.replace('позавчера', ' '); }
  else if (/вчера/.test(s)) { date = shiftDay(date, -1); s = s.replace('вчера', ' '); }
  const dm = s.match(/\b(\d{1,2})\.(\d{1,2})\b/);
  if (dm) { const y = today().slice(0, 4); date = `${y}-${pad(dm[2])}-${pad(dm[1])}`; s = s.replace(dm[0], ' '); }
  // amount: first numeric token, with "120 000" digit groups and an optional "к"/"тыс" token or suffix
  const tokens = s.split(/\s+/).filter(Boolean);
  const i0 = tokens.findIndex(t => /^[+-]?\d+([.,]\d+)?(к|тыс\.?)?$/.test(t));
  if (i0 < 0) return null;
  let i1 = i0 + 1, digits = tokens[i0];
  while (/^[+-]?\d+$/.test(digits) && /^\d{3}([.,]\d+)?$/.test(tokens[i1] || '')) digits += tokens[i1++];
  let k = /(к|тыс\.?)$/.test(digits);
  if (!k && /^(к|тыс\.?)$/.test(tokens[i1] || '')) { k = true; i1++; }
  const m = [null, digits.startsWith('+') ? '+' : ''];
  const amount = num(digits.replace(/^[+-]/, '').replace(/(к|тыс\.?)$/, '')) * (k ? 1000 : 1);
  if (!amount) return null;
  const rest = [...tokens.slice(0, i0), ...tokens.slice(i1)].join(' ');
  const cats = ctx.S.settings.categories;
  let cat = null, catType = null, matched = '';
  const tryList = (type) => {
    for (const c of cats[type]) {
      const words = [c.toLowerCase(), ...(SYN[c] || [])];
      const w = words.find(w => rest.split(' ').some(r => r.startsWith(w) || (w.length > 3 && w.startsWith(r) && r.length >= 3)));
      if (w) { cat = c; catType = type; matched = w; return true; }
    }
  };
  const income = m[1] === '+';
  if (income) tryList('income') || tryList('expense'); else tryList('expense') || tryList('income');
  const type = income ? 'income' : (catType === 'income' && !cats.expense.includes(cat) ? 'income' : 'expense');
  if (!cat || !cats[type].includes(cat)) cat = 'Прочее';
  const note = rest.split(' ').filter(r => !(r.startsWith(matched) || matched.startsWith(r)) || !matched).join(' ');
  return {type, amount, date, category: cat, note: note ? note[0].toUpperCase() + note.slice(1) : '', account_id: ctx.S.settings.defaultAccount && ctx.S.accounts.some(a => a.id === ctx.S.settings.defaultAccount) ? ctx.S.settings.defaultAccount : (ctx.S.accounts.find(a => a.type === 'card') || ctx.S.accounts[0])?.id};
}
