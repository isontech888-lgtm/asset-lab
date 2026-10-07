
import { NextRequest, NextResponse } from "next/server";

const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";

function normalizeTWCode(raw: string): string {
  let s = raw.trim().toUpperCase().replace(".TW","").replace(".TWO","").replace(".TPEX","");
  const m4A = s.match(/^(\d{4})([A-Z])$/);
  if (m4A) s = "0" + m4A[1] + m4A[2];
  return s;
}
function isTaiwanSymbol(s: string): boolean {
  return /^\d{4,6}$/.test(s) || /^\d{4,6}[A-Z]$/.test(s);
}

export async function GET(req: NextRequest) {
  const token = process.env.FINMIND_TOKEN;
  if (!token) return NextResponse.json({ error: "FINMIND_TOKEN 未設定" }, { status: 500 });
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  const yearsParam = searchParams.get("years") || "10";
  const years = Math.max(1, Math.min(20, parseInt(yearsParam) || 10));
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const clean = normalizeTWCode(symbol);
  if (!isTaiwanSymbol(clean)) {
    return NextResponse.json({ error: "僅支援台股/ETF，例如 2330, 00981A" }, { status: 400 });
  }

  // 優先用還原股價 TaiwanStockPriceAdj，算含息報酬更準，若失敗 fallback 到 TaiwanStockPrice
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - years);
  const startStr = start.toISOString().split("T")[0];
  const endStr = end.toISOString().split("T")[0];

  async function fetchDataset(dataset: string) {
    const url = `${FINMIND_BASE}?dataset=${dataset}&data_id=${clean}&start_date=${startStr}&end_date=${endStr}&token=${token}`;
    const r = await fetch(url);
    const j = await r.json();
    return j.data || [];
  }

  let data = await fetchDataset("TaiwanStockPriceAdj");
  let usedDataset = "TaiwanStockPriceAdj";
  if (!data || data.length < 50) {
    data = await fetchDataset("TaiwanStockPrice");
    usedDataset = "TaiwanStockPrice";
  }

  if (!data || data.length < 30) {
    // 成立不足，擴大到從 2000 開始，取成立至今
    const fallback = await fetch(`${FINMIND_BASE}?dataset=${usedDataset}&data_id=${clean}&start_date=2000-01-01&end_date=${endStr}&token=${token}`).then(r=>r.json());
    data = fallback.data || data;
  }

  if (!data || data.length < 20) {
    return NextResponse.json({ error: "歷史資料不足，無法計算", symbol, clean, count: data?.length || 0 }, { status: 404 });
  }

  // 排序 by date
  data.sort((a:any,b:any)=> new Date(a.date).getTime() - new Date(b.date).getTime());

  const closes = data.map((d:any)=> Number(d.close)).filter((n:number)=> !isNaN(n) && n>0);
  if (closes.length < 20) return NextResponse.json({ error: "close 資料不足" }, { status: 404 });

  // 計算日對數報酬率
  const logReturns: number[] = [];
  for (let i=1;i<closes.length;i++) {
    logReturns.push(Math.log(closes[i]/closes[i-1]));
  }
  const mean = logReturns.reduce((a,b)=>a+b,0)/logReturns.length;
  const variance = logReturns.reduce((a,b)=>a + (b-mean)*(b-mean),0)/(logReturns.length-1);
  const std = Math.sqrt(variance);

  // 年化: 台股一年約 252 交易日
  const tradingDays = 252;
  const mu_annual = mean * tradingDays; // log return 年化
  const sigma_annual = std * Math.sqrt(tradingDays);

  // 算術年化報酬 (用於 GBM drift 轉換) : exp(mu + 0.5 sigma^2) -1 也可提供
  const arithmeticAnnual = Math.exp(mu_annual + 0.5*sigma_annual*sigma_annual) - 1;

  // 幾何年化 (CAGR) 用首尾價
  const totalYears = (new Date(data[data.length-1].date).getTime() - new Date(data[0].date).getTime()) / (365.25*24*3600*1000);
  const cagr = totalYears>0 ? Math.pow(closes[closes.length-1]/closes[0], 1/totalYears) -1 : 0;

  // 近10年/成立至今的實際年化波動與報酬已算出
  return NextResponse.json({
    symbol,
    normalized: clean,
    dataset: usedDataset,
    count: closes.length,
    startDate: data[0].date,
    endDate: data[data.length-1].date,
    actualYears: Number(totalYears.toFixed(2)),
    requestedYears: years,
    isLessThanRequested: totalYears < years*0.9,
    closeFirst: closes[0],
    closeLast: closes[closes.length-1],
    stats: {
      mu_log_annual: mu_annual,
      sigma_annual,
      arithmeticAnnual,
      cagr,
      meanDaily: mean,
      stdDaily: std,
    }
  });
}
