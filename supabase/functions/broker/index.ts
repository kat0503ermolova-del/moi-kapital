// T-Invest (Tinkoff) read-only connection.
//  {action:"connect", token}  validate the token, keep it in Vault, create one portfolio per account, then sync
//  {action:"sync"}             import executed operations since the last sync (deduplicated by operation id)
//  {action:"disconnect"}       forget the token; imported trades stay
// The token never reaches the browser again and is readable only by service_role.
// Operations in any currency are imported with that currency; foreign quotes are then refreshed.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { RU_ROOT_CA } from "./ru-ca.ts";

const API = "https://invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1.";
// T-Bank's servers use a certificate from the Russian Trusted Root CA, which the runtime does not trust by default;
// this client trusts it for T-Invest requests only, everything else keeps the standard trust store
const tls = (Deno as any).createHttpClient({ caCerts: [RU_ROOT_CA] });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, "Content-Type": "application/json" } });
type Any = Record<string, any>;

const money = (m: Any | undefined) => (m ? Number(m.units || 0) + Number(m.nano || 0) / 1e9 : 0);
const cur = (m: Any | undefined) => { const c = String(m?.currency || "rub").toUpperCase(); return c === "RUR" || c === "SUR" ? "RUB" : c; };
const CLS: Record<string, string> = { share: "stock", bond: "bond", etf: "fund" };
const logoUrl = (n?: string) => (n ? `https://invest-brands.cdn-tinkoff.ru/${n.replace(/\.png$/, "")}x160.png` : null);

async function call(token: string, method: string, body: Any) {
  const r = await fetch(API + method, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), client: tls } as RequestInit);
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("bad_token"), { code: "bad_token" });
  if (!r.ok) throw new Error(`${method}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function refreshLogos(db: any, token: string) {
  const { count } = await db.from("securities").select("*", { count: "exact", head: true }).not("logo", "is", null);
  if ((count || 0) > 200) return 0;
  const out: Any[] = [];
  for (const m of ["InstrumentsService/Shares", "InstrumentsService/Bonds", "InstrumentsService/Etfs"]) {
    const j = await call(token, m, { instrumentStatus: "INSTRUMENT_STATUS_BASE" }).catch(() => ({ instruments: [] }));
    for (const i of j.instruments || []) { const url = logoUrl(i.brand?.logoName); if (i.ticker && url) out.push({ ticker: i.ticker, logo: url }); }
  }
  const { data } = await db.rpc("set_logos", { p: out });
  return data || 0;
}

// The operations history misses some events (ticker changes like YNDX → YDEX, security transfers, fund redenominations),
// so after importing it the result is checked against the broker's own portfolio. Any difference becomes one correcting
// trade per security ("tinvest:adj:<account>:<ticker>"), rewritten on every sync, so quantities always match the broker.
async function reconcile(db: any, userId: string, token: string, acc: Any, portfolioId: string | null, instr: Map<string, Any>) {
  const pf = await call(token, "OperationsService/GetPortfolio", { accountId: acc.id, currency: "RUB" });
  const snap = { ...acc, total: money(pf.totalAmountPortfolio), cash: money(pf.totalAmountCurrencies), at: new Date().toISOString(), fixed: 0 };
  if (!portfolioId) return snap;
  const want = new Map<string, Any>();
  for (const p of pf.positions || []) {
    if (p.instrumentType === "currency" || !p.instrumentUid) continue;
    let ins = instr.get(p.instrumentUid);
    if (!ins) { ins = (await call(token, "InstrumentsService/GetInstrumentBy", { idType: "INSTRUMENT_ID_TYPE_UID", id: p.instrumentUid }).catch(() => null))?.instrument || {}; instr.set(p.instrumentUid, ins); }
    const cls = CLS[ins.instrumentType] || CLS[p.instrumentType];
    if (!cls || !ins.ticker) continue;
    const t = ins.ticker.replace(/@$/, ""), w = want.get(t) || { qty: 0, avg: money(p.averagePositionPrice), cur: cur(p.averagePositionPrice), name: ins.name || "", cls };
    w.qty += money(p.quantity); want.set(t, w);
  }
  const { data: rows } = await db.from("trades").select("ticker,type,qty,price,date,ext_id,name,cls,currency").eq("user_id", userId).eq("portfolio_id", portfolioId).in("type", ["buy", "sell"]).order("date");
  const have = new Map<string, Any>();
  for (const r of rows || []) {
    if (String(r.ext_id || "").startsWith("tinvest:adj:")) continue;
    const h = have.get(r.ticker) || { qty: 0, first: r.date, lastBuy: null, lastSell: null, name: r.name, cls: r.cls, cur: r.currency };
    h.qty += r.type === "buy" ? Number(r.qty) : -Number(r.qty);
    if (r.type === "buy") h.lastBuy = Number(r.price); else h.lastSell = Number(r.price);
    have.set(r.ticker, h);
  }
  const today = new Date().toISOString().slice(0, 10), adj: Any[] = [], keep: string[] = [];
  for (const t of new Set([...want.keys(), ...have.keys()])) {
    const w = want.get(t), h = have.get(t), diff = (w?.qty || 0) - (h?.qty || 0);
    if (Math.abs(diff) < 1e-6) continue;
    const ext = `tinvest:adj:${acc.id}:${t}`;
    keep.push(ext);
    // missing shares are added before the first trade at the broker's average price (or the sale price, so no fake profit appears);
    // extra shares are removed today at the last purchase price
    adj.push({ user_id: userId, ext_id: ext, portfolio_id: portfolioId, ticker: t, name: w?.name || h?.name || "", cls: w?.cls || h?.cls || "stock", currency: w?.cur || h?.cur || "RUB",
      type: diff > 0 ? "buy" : "sell", qty: Math.abs(diff), price: diff > 0 ? (w?.avg || h?.lastSell || h?.lastBuy || 0) : (h?.lastBuy || w?.avg || 0), fee: 0, amount: null, kind: "Сверка с брокером", date: diff > 0 ? (h?.first || today) : today });
  }
  const { data: old } = await db.from("trades").select("ext_id").eq("user_id", userId).like("ext_id", `tinvest:adj:${acc.id}:%`);
  const stale = (old || []).map((r: Any) => r.ext_id).filter((e: string) => !keep.includes(e));
  if (stale.length) await db.from("trades").delete().eq("user_id", userId).in("ext_id", stale);
  if (adj.length) { const { error } = await db.from("trades").upsert(adj, { onConflict: "user_id,ext_id" }); if (error) throw new Error(error.message); }
  snap.fixed = adj.length;
  return snap;
}

async function sync(db: any, userId: string, token: string) {
  const { data: conn } = await db.from("broker_connections").select("*").eq("user_id", userId).eq("broker", "tinvest").single();
  const { data: ports } = await db.from("portfolios").select("id, ext_account").eq("user_id", userId).not("ext_account", "is", null);
  const pid = new Map((ports || []).map((p: Any) => [p.ext_account, p.id]));
  const from = conn?.last_sync ? new Date(new Date(conn.last_sync).getTime() - 7 * 864e5).toISOString() : "2015-01-01T00:00:00Z";
  const to = new Date().toISOString();
  const instr = new Map<string, Any>();
  let added = 0, skipped = 0, foreign = 0;
  const bonds = new Set<string>(), snaps: Any[] = [];

  for (const acc of conn?.accounts || []) {
    const items: Any[] = [];
    let cursor = "";
    for (let page = 0; page < 50; page++) {
      const j = await call(token, "OperationsService/GetOperationsByCursor", { accountId: acc.id, from, to, cursor, limit: 1000, state: "OPERATION_STATE_EXECUTED", withoutCommissions: false, withoutTrades: true, withoutOvernights: true });
      items.push(...(j.items || []));
      if (!j.hasNext || !j.nextCursor) break;
      cursor = j.nextCursor;
    }
    // taxes withheld on payouts, by instrument and day
    const tax = new Map<string, number>();
    for (const it of items) if (/TAX/.test(it.type) && it.instrumentUid) { const k = it.instrumentUid + "|" + it.date.slice(0, 10); tax.set(k, (tax.get(k) || 0) + Math.abs(money(it.payment))); }
    const rows: Any[] = [];
    for (const it of items) {
      const t = String(it.type || "");
      const kind = /OPERATION_TYPE_(BUY|BUY_CARD)$/.test(t) ? "buy" : /OPERATION_TYPE_(SELL|SELL_CARD)$/.test(t) ? "sell"
        : t === "OPERATION_TYPE_DIVIDEND" ? "div" : t === "OPERATION_TYPE_COUPON" ? "cpn" : t === "OPERATION_TYPE_BOND_REPAYMENT" ? "amort" : t === "OPERATION_TYPE_BOND_REPAYMENT_FULL" ? "full" : null;
      if (!kind || !it.instrumentUid) continue;
      let ins = instr.get(it.instrumentUid);
      if (!ins) {
        ins = (await call(token, "InstrumentsService/GetInstrumentBy", { idType: "INSTRUMENT_ID_TYPE_UID", id: it.instrumentUid }).catch(() => null))?.instrument || {};
        instr.set(it.instrumentUid, ins);
      }
      const cls = CLS[ins.instrumentType] || CLS[it.instrumentType] || null;
      if (!cls || !ins.ticker) { skipped++; continue; }
      if (cls === "bond") bonds.add(ins.ticker);
      const currency = cur(it.payment?.currency ? it.payment : it.price);
      if (currency !== "RUB") foreign++;
      // "TGLD@" is the same fund bought off-exchange from the management company: one ticker keeps one position and its price
      const base = { user_id: userId, ext_id: `tinvest:${it.id}`, date: it.date.slice(0, 10), ticker: ins.ticker.replace(/@$/, ""), name: ins.name || "", cls, currency, portfolio_id: pid.get(acc.id) || null };
      const pay = Math.abs(money(it.payment));
      if (kind === "buy" || kind === "sell") {
        const qty = Number(it.quantityDone || it.quantity || 0); if (!qty) continue;
        const price = money(it.price) || pay / qty;
        rows.push({ ...base, type: kind, qty, price, fee: Math.abs(money(it.commission)), amount: null, kind: null });
      } else if (kind === "full") {
        const qty = Number(it.quantity || it.quantityDone || 0) || Math.round(pay / 1000) || 1;
        rows.push({ ...base, type: "sell", qty, price: pay / qty, fee: 0, amount: null, kind: null });
      } else {
        const net = pay - (tax.get(it.instrumentUid + "|" + it.date.slice(0, 10)) || 0);
        if (net <= 0) continue;
        rows.push({ ...base, type: "income", qty: null, price: null, fee: 0, amount: Math.round(net * 100) / 100, kind: kind === "div" ? "Дивиденды" : kind === "cpn" ? "Купон" : "Амортизация" });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await db.from("trades").upsert(rows.slice(i, i + 500), { onConflict: "user_id,ext_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(error.message);
      added += data?.length || 0;
    }
    snaps.push(await reconcile(db, userId, token, acc, pid.get(acc.id) || null, instr).catch((e) => ({ ...acc, error: String(e.message || e).slice(0, 120) })));
  }
  const fnUrl = Deno.env.get("SUPABASE_URL") + "/functions/v1/";
  // bond payment schedules for anything new, foreign quotes, logos once
  if (bonds.size) await fetch(fnUrl + "moex-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: [...bonds].slice(0, 30) }) }).catch(() => null);
  if (foreign) {
    const cron = (await db.rpc("secret_get", { p_name: "cron_secret" })).data;
    await fetch(fnUrl + "foreign", { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": cron || "" }, body: "{}" }).catch(() => null);
  }
  const logos = await refreshLogos(db, token).catch(() => 0);
  const status = `ok: +${added}${foreign ? `, валютных операций: ${foreign}` : ""}${skipped ? `, пропущено прочих: ${skipped}` : ""}`;
  await db.from("broker_connections").update({ last_sync: to, last_status: status, accounts: snaps }).eq("user_id", userId).eq("broker", "tinvest");
  return { added, skipped, foreign, logos, fixed: snaps.reduce((s, a) => s + (a.fixed || 0), 0) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "auth" });
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const secretName = `tinvest:${user.id}`;
  try {
    if (body.action === "connect") {
      const token = String(body.token || "").trim();
      if (!/^t\.[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: "bad_format" });
      const { accounts } = await call(token, "UsersService/GetAccounts", {});
      const open = (accounts || []).filter((a: Any) => a.status === "ACCOUNT_STATUS_OPEN").map((a: Any) => ({ id: a.id, name: a.name || "Счёт", type: a.type }));
      if (!open.length) return json({ error: "no_accounts" });
      await db.rpc("secret_put", { p_name: secretName, p_value: token });
      await db.from("broker_connections").upsert({ user_id: user.id, broker: "tinvest", accounts: open, last_sync: null, last_status: "connected" });
      const { data: existing } = await db.from("portfolios").select("ext_account").eq("user_id", user.id);
      const have = new Set((existing || []).map((p: Any) => p.ext_account));
      const fresh = open.filter((a: Any) => !have.has(a.id)).map((a: Any, i: number) => ({ user_id: user.id, name: `Т-Инвестиции · ${a.name}`, kind: a.type === "ACCOUNT_TYPE_TINKOFF_IIS" ? "iis" : "broker", region: "ru", currency: "RUB", sort: 10 + i, ext_account: a.id }));
      if (fresh.length) await db.from("portfolios").insert(fresh);
      const r = await sync(db, user.id, token);
      return json({ ok: true, accounts: open.length, ...r });
    }
    const token = (await db.rpc("secret_get", { p_name: secretName })).data as string | null;
    if (body.action === "disconnect") {
      await db.rpc("secret_drop", { p_name: secretName });
      await db.from("broker_connections").delete().eq("user_id", user.id).eq("broker", "tinvest");
      return json({ ok: true });
    }
    if (body.action === "sync") {
      if (!token) return json({ error: "not_connected" });
      return json({ ok: true, ...(await sync(db, user.id, token)) });
    }
    return json({ error: "bad_action" });
  } catch (e) {
    const code = (e as Any).code === "bad_token" ? "bad_token" : "failed";
    if (code === "failed") await db.from("broker_connections").update({ last_status: `error: ${String((e as Error).message).slice(0, 200)}` }).eq("user_id", user.id).eq("broker", "tinvest");
    return json({ error: code, message: String((e as Error).message).slice(0, 200) });
  }
});
