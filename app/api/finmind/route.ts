
import { NextRequest, NextResponse } from "next/server";

const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";

function normalizeTWCode(raw: string): string {
  let s = raw.trim().toUpperCase().replace(".TW","").replace(".TWO","").replace(".TPEX","");
  // 0981A -> 00981A? 若是 4碼+A，前面補0變5碼+A，比較符合集保正式代號
  const m4A = s.match(/^(\d{4})([A-Z])$/);
  if (m4A) {
    s = "0" + m4A[1] + m4A[2]; // 0981A -> 00981A
  }
  return s;
}

function isTaiwanSymbol(s: string): boolean {
  // 純數字 4-6碼: 2330, 2317
  // 主動式ETF: 00981A, 00982A, 00980A, 0981A(會被normalize成00981A)
  // 嘗試型: 4-6碼 + 1個英文字母
  return /^\d{4,6}$/.test(s) || /^\d{4,6}[A-Z]$/.test(s);
}

export async function GET(req: NextRequest) {
  const token = process.env.FINMIND_TOKEN;
  if (!token) return NextResponse.json({ error: "FINMIND_TOKEN 未設定" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  const symbols = searchParams.get("symbols");
  const type = searchParams.get("type") || "price";

  const list = symbols ? symbols.split(",") : symbol ? [symbol] : [];
  if (list.length === 0) return NextResponse.json({ error: "請提供 symbol 或 symbols" }, { status: 400 });

  try {
    if (type === "info") {
      const results = await Promise.all(list.map(async (id) => {
        const clean = normalizeTWCode(id);
        if (!isTaiwanSymbol(clean)) {
          return { symbol: id, data: null, isTW: false };
        }
        const url = `${FINMIND_BASE}?dataset=TaiwanStockInfo&data_id=${clean}&token=${token}`;
        const r = await fetch(url);
        const j = await r.json();
        // 若找不到，嘗試不補0的原碼
        let data = j.data?.[0] || null;
        if (!data && clean !== id.toUpperCase()) {
          const url2 = `${FINMIND_BASE}?dataset=TaiwanStockInfo&data_id=${id.toUpperCase().replace(".TW","")}&token=${token}`;
          const r2 = await fetch(url2);
          const j2 = await r2.json();
          data = j2.data?.[0] || null;
        }
        return { symbol: id, normalized: clean, data, isTW: true, raw: j };
      }));
      return NextResponse.json({ results });
    } else {
      const start_date = new Date(Date.now() - 10*24*60*60*1000).toISOString().split("T")[0];
      const results = await Promise.all(list.map(async (id) => {
        const clean = normalizeTWCode(id);
        if (!isTaiwanSymbol(clean)) {
          return { symbol: id, isTW: false, needYahoo: true, normalized: clean };
        }
        // 先試 normalize 後的代號
        let url = `${FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${clean}&start_date=${start_date}&token=${token}`;
        let r = await fetch(url);
        let j = await r.json();
        let arr = j.data || [];
        // 若空的，試原代號 (例如使用者打 0981A)
        if (arr.length === 0) {
          const orig = id.toUpperCase().replace(".TW","").replace(".TWO","");
          if (orig !== clean) {
            url = `${FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${orig}&start_date=${start_date}&token=${token}`;
            r = await fetch(url);
            j = await r.json();
            arr = j.data || [];
          }
        }
        const last = arr[arr.length-1];
        const prev = arr[arr.length-2];
        return {
          symbol: id,
          normalized: clean,
          isTW: true,
          last,
          prev,
          dayChange: last && prev ? last.close - prev.close : 0,
          dayChangePercent: last && prev ? ((last.close - prev.close)/prev.close*100) : 0,
          count: arr.length,
          found: arr.length > 0,
        };
      }));
      return NextResponse.json({ results, start_date });
    }
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
