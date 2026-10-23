import { rub, nf2, area } from './util.js';

const NDFL = 0.13;
function annuity(P, rYear, n){ const r = rYear/100/12; return r ? P*r/(1-Math.pow(1+r,-n)) : P/n; }
function loanSchedule(P, rYear, n, type, extra=0, extraMode='term'){
  const r = rYear/100/12; let bal = P, paid = 0, interest = 0, m = 0, pay = type==='ann' ? annuity(P,rYear,n) : 0, first = 0; const yearly = [];
  const principalPart = P/n;
  while (bal > 0.01 && m < 1200) {
    const i = bal*r; let p;
    if (type==='ann') p = Math.min(bal, pay - i); else p = Math.min(bal, principalPart);
    let total = p + i; bal -= p;
    if (extra > 0 && bal > 0) { const e = Math.min(bal, extra); bal -= e; total += e;
      if (type==='ann' && extraMode==='pay' && bal > 0) pay = annuity(bal, rYear, n-m-1); }
    if (m===0) first = total;
    paid += total; interest += i; m++;
    if (m % 12 === 0 || bal <= 0.01) yearly.push({bal: Math.max(0,bal), interest, principal: paid - interest});
  }
  return {months:m, paid, interest, first, yearly, pay};
}
function ytm(price, nominal, cpnRate, freq, years){
  const c = nominal*cpnRate/100/freq, n = Math.max(1, Math.round(years*freq));
  const pv = y => { let s = 0; for (let k=1;k<=n;k++) s += c/Math.pow(1+y/freq,k); return s + nominal/Math.pow(1+y/freq,n); };
  let lo = -0.9, hi = 3; for (let i=0;i<120;i++){ const mid=(lo+hi)/2; if (pv(mid) > price) lo = mid; else hi = mid; }
  return (lo+hi)/2;
}
function growth(start, monthly, rYear, years, inflation=0){
  const r = rYear/100/12; let bal = start, contrib = start; const yrs = [], cs = [], gs = [];
  for (let m=1;m<=years*12;m++){ bal = bal*(1+r) + monthly; contrib += monthly; if (m%12===0){ yrs.push(m/12+' г'); cs.push(contrib); gs.push(bal-contrib); } }
  return {bal, contrib, yrs, cs, gs, real: bal/Math.pow(1+inflation/100, years)};
}

const growthTable = g => ({head:['Год','Вложено','Доход','Итого'], rows: g.yrs.map((y,i)=>[y, g.cs[i], g.gs[i], g.cs[i]+g.gs[i]])});
export const CALCS = [
  {id:'compound', t:'Сложный процент', d:'Как растут вложения с пополнениями',
    f:[['start','Начальная сумма, ₽',100000],['monthly','Пополнение в месяц, ₽',15000],['rate','Доходность, % годовых',14],['years','Срок, лет',10],['infl','Инфляция, % в год',6]],
    run:v=>{ const g = growth(v.start,v.monthly,v.rate,v.years,v.infl);
      return {table: growthTable(g), res:[['Итоговая сумма',g.bal,1],['Вы вложите',g.contrib],['Доход от процентов',g.bal-g.contrib],['В сегодняшних деньгах',g.real]], chart: area([{values:g.cs,color:'var(--c2)',label:'Ваши вложения'},{values:g.gs,color:'var(--c1)',label:'Доход'}], g.yrs)}; }},
  {id:'mortgage', t:'Ипотечный', d:'Платёж, переплата, досрочные взносы',
    f:[['price','Стоимость жилья, ₽',9000000],['down','Первый взнос, ₽',2000000],['rate','Ставка, % годовых',18],['years','Срок, лет',25],['type','Тип платежа','ann',[['ann','Аннуитетный'],['diff','Дифференцированный']]],['extra','Досрочно в месяц, ₽',0],['mode','Досрочно уменьшать','term',[['term','срок'],['pay','платёж']]]],
    run:v=>{ const P = Math.max(0,v.price-v.down), base = loanSchedule(P,v.rate,v.years*12,v.type), s = loanSchedule(P,v.rate,v.years*12,v.type,v.extra,v.mode);
      const res = [['Ежемесячный платёж'+(v.type==='diff'?' (первый)':''),base.first,1],['Сумма кредита',P],['Переплата по процентам',s.interest],['Всего выплатите',s.paid]];
      if (v.extra>0) res.push(['Экономия на досрочных',base.interest-s.interest],['Срок с досрочными',s.months,0,'мес']);
      return {res, table: {head:['Год','Выплачено долга','Выплачено процентов','Остаток долга'], rows: s.yearly.map((y,i)=>[i+1, y.principal, y.interest, y.bal])}, chart: area([{values:s.yearly.map(y=>y.principal),color:'var(--c2)',label:'Выплачено долга'},{values:s.yearly.map(y=>y.interest),color:'var(--c5)',label:'Выплачено процентов'}], s.yearly.map((_,i)=>i+1+' г'))}; }},
  {id:'credit', t:'Кредитный', d:'Потребительский кредит',
    f:[['amount','Сумма кредита, ₽',500000],['rate','Ставка, % годовых',24],['months','Срок, мес',36],['type','Тип платежа','ann',[['ann','Аннуитетный'],['diff','Дифференцированный']]]],
    run:v=>{ const s = loanSchedule(v.amount,v.rate,v.months,v.type); return {res:[['Ежемесячный платёж'+(v.type==='diff'?' (первый)':''),s.first,1],['Переплата',s.interest],['Всего выплатите',s.paid],['Переплата к сумме',s.interest/v.amount*100,0,'%']]}; }},
  {id:'early', t:'Досрочного погашения', d:'Сколько сэкономите',
    f:[['bal','Остаток долга, ₽',3500000],['rate','Ставка, % годовых',16],['left','Осталось месяцев',180],['once','Разовый взнос сейчас, ₽',300000],['extra','Плюс ежемесячно, ₽',5000],['mode','Уменьшать','term',[['term','срок'],['pay','платёж']]]],
    run:v=>{ const base = loanSchedule(v.bal,v.rate,v.left,'ann'), b2 = Math.max(0, v.bal - v.once);
      const s = v.mode==='pay' ? loanSchedule(b2,v.rate,v.left,'ann',v.extra,'pay') : loanSchedule(b2,v.rate,v.left,'ann',v.extra,'term');
      if (v.mode==='term' && v.once>0) { const pay = base.pay; let bal=b2, r=v.rate/100/12, m=0, i=0; while(bal>0.01&&m<1200){ const ii=bal*r; bal -= Math.min(bal, pay-ii+v.extra); i+=ii; m++; } s.interest=i; s.months=m; s.first=pay; }
      return {res:[['Экономия на процентах',base.interest-s.interest,1],['Платёж сейчас',base.pay],['Платёж после',v.mode==='pay'?s.first:base.pay],['Срок после',s.months,0,'мес'],['Сокращение срока',v.left-s.months,0,'мес']]}; }},
  {id:'goal', t:'Расчёта целей', d:'Сколько откладывать в месяц',
    f:[['target','Нужная сумма, ₽',2000000],['have','Уже есть, ₽',200000],['years','Через сколько лет',4],['rate','Доходность, % годовых',12],['infl','Учесть инфляцию, %',0]],
    run:v=>{ const tgt = v.target*Math.pow(1+v.infl/100,v.years), n=v.years*12, r=v.rate/100/12, need = Math.max(0, tgt - v.have*Math.pow(1+r,n)), pmt = r ? need*r/(Math.pow(1+r,n)-1) : need/n;
      return {res:[['Откладывать в месяц',pmt,1],['Сумма с учётом инфляции',tgt],['Вложите сами',v.have+pmt*n],['Заработает доходность',tgt-v.have-pmt*n]]}; }},
  {id:'refi', t:'Рефинансирования', d:'Выгодно ли перекредитоваться',
    f:[['bal','Остаток долга, ₽',1200000],['rate','Текущая ставка, %',22],['left','Осталось месяцев',48],['nrate','Новая ставка, %',17],['nmonths','Новый срок, мес',48],['cost','Расходы на оформление, ₽',10000]],
    run:v=>{ const a = loanSchedule(v.bal,v.rate,v.left,'ann'), b = loanSchedule(v.bal,v.nrate,v.nmonths,'ann'); const save = a.paid - b.paid - v.cost;
      return {res:[['Выгода',save,1],['Платёж сейчас',a.pay],['Новый платёж',b.pay],['Осталось заплатить сейчас',a.paid],['Заплатите после',b.paid+v.cost]], note: save<0 ? 'Рефинансирование невыгодно: итоговая сумма выплат вырастет.' : ''}; }},
  {id:'bond', t:'Облигаций', d:'Доходность к погашению',
    f:[['price','Цена, % от номинала',96.5],['nominal','Номинал, ₽',1000],['cpn','Купон, % годовых',12],['freq','Выплат купона в год',2],['years','До погашения, лет',3],['tax','Учитывать НДФЛ 13%','yes',[['yes','да'],['no','нет']]]],
    run:v=>{ const P = v.price/100*v.nominal, y = ytm(P,v.nominal,v.cpn,v.freq,v.years), cy = v.cpn/v.price*100;
      const k = v.tax==='yes' ? 1-NDFL : 1; const cpns = v.nominal*v.cpn/100*v.years, gain = v.nominal - P;
      const net = cpns*k + (gain>0 ? gain*k : gain), simple = net/P/v.years*100;
      return {res:[['Доходность к погашению',y*100,1,'%'],['Текущая доходность',cy,0,'%'],['Простая доходность после налога',simple,0,'%'],['Купонов за срок на 1 бумагу',cpns*k],['Разница номинала и цены',gain]], note:'Доходность к погашению считается без учёта налога и НКД, как на бирже.'}; }},
  {id:'fx', t:'Конвертер валют', d:'С учётом комиссии банка',
    f:[['amount','Сумма',1000],['rate','Курс, ₽ за единицу',92.5],['dir','Направление','buy',[['buy','покупаю валюту за рубли'],['sell','продаю валюту за рубли']]],['spread','Комиссия или спред, %',1.5]],
    run:v=>{ const k = v.spread/100; if (v.dir==='buy') { const rub_ = v.amount*v.rate*(1+k); return {res:[['Заплатите рублей',rub_,1],['Эффективный курс',v.rate*(1+k),0,'₽'],['Потеря на комиссии',v.amount*v.rate*k]]}; }
      const r_ = v.amount*v.rate*(1-k); return {res:[['Получите рублей',r_,1],['Эффективный курс',v.rate*(1-k),0,'₽'],['Потеря на комиссии',v.amount*v.rate*k]], note:'Курс введите вручную — актуальный смотрите в банке или на сайте ЦБ.'}; }},
  {id:'savings', t:'Накоплений', d:'Сколько накопится и что это будет стоить',
    f:[['monthly','Откладываю в месяц, ₽',20000],['years','Срок, лет',5],['rate','Доходность, % годовых',12],['infl','Инфляция, % в год',6]],
    run:v=>{ const g = growth(0,v.monthly,v.rate,v.years,v.infl); return {table: growthTable(g), res:[['Накопится',g.bal,1],['Отложите сами',g.contrib],['Проценты',g.bal-g.contrib],['В сегодняшних деньгах',g.real]], chart: area([{values:g.cs,color:'var(--c2)',label:'Ваши взносы'},{values:g.gs,color:'var(--c1)',label:'Проценты'}], g.yrs)}; }},
  {id:'vacation', t:'Отпускных', d:'По среднему заработку за 12 месяцев',
    f:[['income','Доход за 12 месяцев, ₽',1440000],['days','Дней отпуска',14],['excluded','Исключаемые дни (больничные и т. п.)',0]],
    run:v=>{ const months = 12 - v.excluded/29.3; const daily = v.income/(12*29.3) * (12/Math.max(0.1,months)) ; const gross = daily*v.days;
      return {res:[['На руки',gross*(1-NDFL),1],['Начислено',gross],['Средний дневной заработок',daily],['НДФЛ 13%',gross*NDFL]], note:'Упрощённый расчёт: 29,3 дня в месяце. Если в расчётном периоде были неполные месяцы, бухгалтерия посчитает точнее.'}; }},
  {id:'deposit', t:'Вкладов', d:'С капитализацией и налогом',
    f:[['amount','Сумма вклада, ₽',500000],['rate','Ставка, % годовых',17],['months','Срок, мес',12],['cap','Капитализация','month',[['month','ежемесячная'],['none','без капитализации']]],['topup','Пополнение в месяц, ₽',0],['free','Необлагаемый процентный доход за год, ₽',210000],['other','Другие проценты по вкладам за год, ₽',0]],
    run:v=>{ const r = v.rate/100/12; let bal = v.amount, earned = 0, contrib = v.amount;
      for (let m=0;m<v.months;m++){ const i = bal*r; earned += i; if (v.cap==='month') bal += i; bal += v.topup; contrib += v.topup; }
      if (v.cap==='none') bal += earned;
      const yearly = earned/Math.max(1,v.months)*Math.min(12,v.months) + v.other; const tax = Math.max(0, yearly - v.free)*NDFL*(Math.min(1, earned/Math.max(1,yearly)));
      return {res:[['Доход по процентам',earned,1],['Сумма в конце срока',bal],['Эффективная ставка',(earned/Math.max(1,v.amount)*12/v.months*100),0,'%'],['Налог (оценка)',tax],['Чистый доход',earned-tax]], note:'Налог берётся с процентов сверх необлагаемой суммы: 1 млн ₽ × максимальная ключевая ставка ЦБ за год. Лимит меняется каждый год — проверьте актуальный.'}; }},
  {id:'inflation', t:'Инфляции', d:'Как обесцениваются деньги',
    f:[['amount','Сумма сегодня, ₽',100000],['infl','Инфляция, % в год',7],['years','Через сколько лет',10]],
    run:v=>{ const k = Math.pow(1+v.infl/100,v.years); const yrs = Array.from({length:v.years},(_,i)=>i+1+' г');
      return {res:[['Будет стоить столько же',v.amount*k,1],['Покупательная способность',v.amount/k],['Потеря',v.amount-v.amount/k],['Рост цен за срок',(k-1)*100,0,'%']], chart: area([{values:yrs.map((_,i)=>v.amount/Math.pow(1+v.infl/100,i+1)),color:'var(--c3)',label:'Реальная стоимость суммы'}], yrs)}; }},
  {id:'iis', t:'Доходности ИИС', d:'ИИС-3 с вычетом на взносы',
    f:[['yearly','Взнос в год, ₽',400000],['years','Срок, лет',5],['rate','Доходность, % годовых',13],['ndfl','Ваша ставка НДФЛ, %',13],['reinvest','Вычет вносить обратно на ИИС','yes',[['yes','да'],['no','нет']]]],
    run:v=>{ const r = v.rate/100; let bal = 0, ded = 0, contrib = 0;
      for (let y=0;y<v.years;y++){ bal = bal*(1+r) + v.yearly; contrib += v.yearly; const d = Math.min(v.yearly,400000)*v.ndfl/100; ded += d; if (v.reinvest==='yes' && y<v.years-1) bal += d; }
      const k = v.reinvest==='yes' ? 0 : ded;
      return {res:[['Итого на счёте и вычетах',bal+k,1],['Вычеты за весь срок',ded],['Ваши взносы',contrib],['Доход',bal+k-contrib],['Вычет в год (макс.)',Math.min(v.yearly,400000)*v.ndfl/100]], note:'ИИС-3: вычет до 400 000 ₽ взносов в год, минимальный срок 5 лет для счетов, открытых с 2024 по 2026 год. Доход до 30 млн ₽ освобождается от налога при соблюдении срока.'}; }},
  {id:'pds', t:'Долгосрочных сбережений', d:'ПДС с софинансированием государства',
    f:[['income','Ваш доход в месяц, ₽',90000],['yearly','Взнос в год, ₽',36000],['years','Срок, лет',15],['rate','Доходность, % годовых',10]],
    run:v=>{ const ratio = v.income<=80000 ? 1 : v.income<=150000 ? 0.5 : 0.25; const cof = v.yearly>=2000 ? Math.min(36000, v.yearly*ratio) : 0;
      let bal = 0, own = 0, gov = 0;
      for (let y=0;y<v.years;y++){ const g = y<10 ? cof : 0; bal = bal*(1+v.rate/100) + v.yearly + g; own += v.yearly; gov += g; }
      return {res:[['Накопится',bal,1],['Ваши взносы',own],['Добавит государство',gov],['Доход от инвестирования',bal-own-gov],['Налоговый вычет в год',Math.min(v.yearly,400000)*NDFL]], note:`Ваш доход даёт софинансирование ${ratio===1?'1 ₽ на 1 ₽':ratio===0.5?'1 ₽ на 2 ₽':'1 ₽ на 4 ₽'}, до 36 000 ₽ в год в течение 10 лет при взносе от 2 000 ₽. Условия программы могут меняться.`}; }},
  {id:'fire', t:'Финансовой независимости', d:'Когда капитал заменит зарплату',
    f:[['expenses','Расходы в месяц сегодня, ₽',120000],['wr','Безопасное изъятие, % в год',4],['have','Капитал сейчас, ₽',1000000],['monthly','Инвестирую в месяц, ₽',40000],['real','Реальная доходность, % (за вычетом инфляции)',5]],
    run:v=>{ const need = v.expenses*12/(v.wr/100); let bal = v.have, m = 0; const r = v.real/100/12; while (bal < need && m < 1200){ bal = bal*(1+r)+v.monthly; m++; }
      return {res:[['Нужный капитал',need,1],['Лет до цели',m>=1200?NaN:m/12,0,'лет'],['Не хватает сейчас',Math.max(0,need-v.have)],['Пассивный доход с текущего капитала',v.have*v.wr/100/12,0,'₽/мес']], note:'Все суммы в сегодняшних деньгах: поэтому доходность берётся реальная, за вычетом инфляции.'}; }},
];

export const GROUPS = [['savings','Накопления и вклады'],['loans','Кредиты и ипотека'],['invest','Инвестиции'],['tax','Зарплата и налоги']];
const G = {"compound": "savings", "savings": "savings", "deposit": "savings", "inflation": "savings", "goal": "savings", "mortgage": "loans", "credit": "loans", "early": "loans", "refi": "loans", "bond": "invest", "iis": "invest", "pds": "invest", "fire": "invest", "fx": "invest", "vacation": "tax"};
CALCS.forEach(c => c.g = G[c.id] || 'savings');
export { loanSchedule, annuity, growth, ytm };
