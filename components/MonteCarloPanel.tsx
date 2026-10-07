
"use client";
import { useState } from "react";

type Stats = {
  symbol: string;
  normalized: string;
  count: number;
  startDate: string;
  endDate: string;
  actualYears: number;
  isLessThanRequested?: boolean;
  stats: {
    mu_log_annual: number;
    sigma_annual: number;
    arithmeticAnnual: number;
    cagr: number;
  }
};

function gbmPathsWithDCA(
  S0: number,
  mu: number,
  sigma: number,
  years: number,
  stepsPerYear: number,
  nPaths: number,
  monthlyDCA: number,
  initialShares: number
) {
  const dt = 1 / stepsPerYear;
  const totalSteps = Math.floor(years * stepsPerYear);
  const pricePaths: number[][] = [];
  const portfolioPaths: number[][] = []; // with DCA
  const portfolioNoDCA: number[][] = []; // buy & hold

  for (let p = 0; p < nPaths; p++) {
    let S = S0;
    let shares = initialShares;
    const pricePath = [S];
    const portPath = [shares * S];
    const portNoDCA = [shares * S];

    for (let i = 0; i < totalSteps; i++) {
      const Z = randn();
      S = S * Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * Z);
      pricePath.push(S);

      // DCA: 每個月投入 (stepsPerYear=12 代表每月一步)
      if (monthlyDCA > 0) {
        shares += monthlyDCA / S;
      }
      portPath.push(shares * S);
      portNoDCA.push(initialShares * S);
    }
    pricePaths.push(pricePath);
    portfolioPaths.push(portPath);
    portfolioNoDCA.push(portNoDCA);
  }
  return { pricePaths, portfolioPaths, portfolioNoDCA };
}

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(arr: number[], p: number) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

type Props = {
  currentPrice: number;
  initialShares?: number;
  symbolHint?: string;
};

export default function MonteCarloPanel({ currentPrice, initialShares = 1000, symbolHint }: Props) {
  const [symbol, setSymbol] = useState(symbolHint || "00981A");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [years, setYears] = useState(10);
  const [nPaths, setNPaths] = useState(500);
  const [monthlyDCA, setMonthlyDCA] = useState(10000);
  const [enableDCA, setEnableDCA] = useState(true);
  const [customInitial, setCustomInitial] = useState(initialShares);
  const [result, setResult] = useState<{
    priceMedian: number[]; priceP10: number[]; priceP90: number[];
    portMedian: number[]; portP10: number[]; portP90: number[];
    portNoDCAMedian: number[];
    finalPriceMedian: number; finalPortMedian: number; finalPortNoDCAMedian: number;
    totalInvested: number;
  } | null>(null);
  const [error, setError] = useState("");

  // 當外部 currentPrice / shares 變動，同步初始股數
  // (用 effect 太複雜，這裡簡單用 initialShares prop 初始值，使用者可手動改)
  async function fetchStats() {
    setLoading(true); setError(""); setStats(null); setResult(null);
    try {
      const r = await fetch(`/api/finmind/stats?symbol=${symbol}&years=10`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "查詢失敗");
      setStats(j);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  function runSimulation() {
    if (!stats) return;
    const S0 = currentPrice || 15;
    const mu = stats.stats.mu_log_annual;
    const sigma = stats.stats.sigma_annual;
    const shares0 = customInitial || initialShares || 1000;
    const dca = enableDCA ? monthlyDCA : 0;

    const { pricePaths, portfolioPaths, portfolioNoDCA } = gbmPathsWithDCA(S0, mu, sigma, years, 12, nPaths, dca, shares0);

    const steps = pricePaths[0].length;
    const priceMedian: number[] = [], priceP10: number[] = [], priceP90: number[] = [];
    const portMedian: number[] = [], portP10: number[] = [], portP90: number[] = [];
    const portNoDCAMedian: number[] = [];

    for (let t = 0; t < steps; t++) {
      priceMedian.push(percentile(pricePaths.map(p => p[t]), 50));
      priceP10.push(percentile(pricePaths.map(p => p[t]), 10));
      priceP90.push(percentile(pricePaths.map(p => p[t]), 90));
      portMedian.push(percentile(portfolioPaths.map(p => p[t]), 50));
      portP10.push(percentile(portfolioPaths.map(p => p[t]), 10));
      portP90.push(percentile(portfolioPaths.map(p => p[t]), 90));
      portNoDCAMedian.push(percentile(portfolioNoDCA.map(p => p[t]), 50));
    }

    const totalInvested = shares0 * S0 + (enableDCA ? monthlyDCA * 12 * years : 0);

    setResult({
      priceMedian, priceP10, priceP90,
      portMedian, portP10, portP90,
      portNoDCAMedian,
      finalPriceMedian: priceMedian[priceMedian.length - 1],
      finalPortMedian: portMedian[portMedian.length - 1],
      finalPortNoDCAMedian: portNoDCAMedian[portNoDCAMedian.length - 1],
      totalInvested
    });
  }

  const effectiveShares = customInitial || initialShares;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mt-6">
      <h3 className="font-bold text-lg mb-1">資產成長預估 (GBM + 蒙地卡羅 + DCA)</h3>
      <p className="text-xs text-zinc-500 mb-4">
        FinMind 還原股價自動算 μ/σ，成立少於10年自動用成立至今。GBM: S(t)=S0·exp((μ-½σ²)t+σW(t))，每月 DCA 買入 shares += 金額 / 價格
      </p>

      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div><label className="text-xs text-zinc-400">代號</label><input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} className="block bg-zinc-800 border border-zinc-700 rounded px-3 py-2 mt-1 w-28" /></div>
        <div><label className="text-xs text-zinc-400">現價起點</label><input type="number" value={currentPrice} disabled className="block bg-zinc-800 border border-zinc-700 rounded px-3 py-2 mt-1 w-24 opacity-60" /></div>
        <div><label className="text-xs text-zinc-400">初始股數</label><input type="number" value={customInitial} onChange={e => setCustomInitial(Number(e.target.value))} className="block bg-zinc-800 border border-zinc-700 rounded px-3 py-2 mt-1 w-24" /></div>
        <button onClick={fetchStats} disabled={loading} className="bg-violet-600 hover:bg-violet-700 px-4 py-2 rounded-lg h-10 disabled:opacity-50">{loading ? "計算中..." : "1. 抓10年績效算 μ/σ"}</button>
        {stats && <span className="text-xs text-emerald-400">✓ {stats.startDate}~{stats.endDate} ({stats.actualYears}年, {stats.count}筆) {stats.isLessThanRequested && "(成立至今)"}</span>}
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
          <div className="bg-zinc-800 p-3 rounded"><div className="text-zinc-400 text-xs">CAGR</div><div className="font-bold text-lg">{(stats.stats.cagr * 100).toFixed(2)}%</div></div>
          <div className="bg-zinc-800 p-3 rounded"><div className="text-zinc-400 text-xs">年化 μ (log)</div><div className="font-bold">{(stats.stats.mu_log_annual * 100).toFixed(2)}%</div></div>
          <div className="bg-zinc-800 p-3 rounded"><div className="text-zinc-400 text-xs">年化波動 σ</div><div className="font-bold">{(stats.stats.sigma_annual * 100).toFixed(2)}%</div></div>
          <div className="bg-zinc-800 p-3 rounded"><div className="text-zinc-400 text-xs">算術年化</div><div className="font-bold">{(stats.stats.arithmeticAnnual * 100).toFixed(2)}%</div></div>
        </div>
      )}

      {stats && (
        <div className="bg-zinc-800/50 p-4 rounded-lg mb-4 border border-zinc-700/50">
          <div className="flex items-center gap-2 mb-3">
            <input type="checkbox" checked={enableDCA} onChange={e => setEnableDCA(e.target.checked)} id="dcaCheck" className="w-4 h-4" />
            <label htmlFor="dcaCheck" className="font-medium text-sm">啟用 DCA 定期定額</label>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div><label className="text-xs text-zinc-400">每月投入 (NT$)</label><input type="number" value={monthlyDCA} onChange={e => setMonthlyDCA(Number(e.target.value))} disabled={!enableDCA} className="block bg-zinc-900 border border-zinc-700 rounded px-3 py-2 mt-1 w-32 disabled:opacity-40" /></div>
            <div><label className="text-xs text-zinc-400">預估年限</label><select value={years} onChange={e => setYears(Number(e.target.value))} className="block bg-zinc-900 border border-zinc-700 rounded px-3 py-2 mt-1"><option value={1}>1年</option><option value={3}>3年</option><option value={5}>5年</option><option value={10}>10年</option><option value={20}>20年</option><option value={30}>30年</option></select></div>
            <div><label className="text-xs text-zinc-400">模擬路徑</label><select value={nPaths} onChange={e => setNPaths(Number(e.target.value))} className="block bg-zinc-900 border border-zinc-700 rounded px-3 py-2 mt-1"><option value={200}>200條</option><option value={500}>500條</option><option value={1000}>1000條</option><option value={2000}>2000條</option></select></div>
            <button onClick={runSimulation} className="bg-emerald-600 hover:bg-emerald-700 px-5 py-2 rounded-lg h-10">2. 跑蒙地卡羅 + DCA</button>
          </div>
          <div className="text-xs text-zinc-500 mt-2">
            初始市值 NT$ {(effectiveShares * currentPrice).toLocaleString()} + 每月 {enableDCA ? `NT$ ${monthlyDCA.toLocaleString()} × ${years * 12} 月 = NT$ ${(monthlyDCA * 12 * years).toLocaleString()}` : "0"} → 總投入 NT$ {((effectiveShares * currentPrice) + (enableDCA ? monthlyDCA * 12 * years : 0)).toLocaleString()}
          </div>
        </div>
      )}

      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="bg-zinc-800 p-3 rounded border border-zinc-700"><div className="text-zinc-400 text-xs">預估 {years}年後股價中位數</div><div className="font-bold text-lg text-violet-300">NT$ {result.finalPriceMedian.toFixed(2)}</div><div className="text-xs text-zinc-500">起點 NT$ {currentPrice}</div></div>
            <div className="bg-zinc-800 p-3 rounded border border-emerald-800/50"><div className="text-zinc-400 text-xs">資產總值 (Buy & Hold)</div><div className="font-bold text-lg">NT$ {result.finalPortNoDCAMedian.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div><div className="text-xs text-zinc-500">初始 {effectiveShares}股不加碼</div></div>
            <div className="bg-emerald-950/30 p-3 rounded border border-emerald-800"><div className="text-zinc-400 text-xs">資產總值 (含 DCA) P50</div><div className="font-bold text-lg text-emerald-300">NT$ {result.finalPortMedian.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div><div className="text-xs text-zinc-400">總投入 NT$ {result.totalInvested.toLocaleString()}，報酬 {(result.finalPortMedian / result.totalInvested - 1) * 100 > 0 ? "+" : ""}{((result.finalPortMedian / result.totalInvested - 1) * 100).toFixed(1)}%</div></div>
          </div>

          <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-800">
            <div className="text-xs font-medium mb-2 text-zinc-300">股價預估 (P10/P50/P90) — {years}年</div>
            <div className="w-full overflow-x-auto">
              <svg width={Math.max(600, result.priceMedian.length * 10)} height="180" className="block">
                {(() => {
                  const all = [...result.priceP10, ...result.priceP90, ...result.priceMedian];
                  const min = Math.min(...all) * 0.9;
                  const max = Math.max(...all) * 1.1;
                  const h = 160;
                  const w = Math.max(600, result.priceMedian.length * 10);
                  const sy = (v: number) => h - ((v - min) / (max - min)) * h;
                  const sx = (i: number) => (i / (result.priceMedian.length - 1)) * w;
                  const line = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(v)}`).join(" ");
                  return <>
                    <path d={line(result.priceP90)} fill="none" stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />
                    <path d={line(result.priceP10)} fill="none" stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />
                    <path d={line(result.priceMedian)} fill="none" stroke="#8b5cf6" strokeWidth={2} />
                  </>;
                })()}
              </svg>
            </div>
          </div>

          <div className="bg-zinc-950 rounded-lg p-3 border border-emerald-900/30">
            <div className="text-xs font-medium mb-2 text-emerald-300">資產總值預估 (含 DCA vs 不含) — {years}年</div>
            <div className="w-full overflow-x-auto">
              <svg width={Math.max(600, result.portMedian.length * 10)} height="200" className="block">
                {(() => {
                  const all = [...result.portP10, ...result.portP90, ...result.portMedian, ...result.portNoDCAMedian];
                  const min = Math.min(...all) * 0.85;
                  const max = Math.max(...all) * 1.1;
                  const h = 180;
                  const w = Math.max(600, result.portMedian.length * 10);
                  const sy = (v: number) => h - ((v - min) / (max - min)) * h;
                  const sx = (i: number) => (i / (result.portMedian.length - 1)) * w;
                  const line = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(v)}`).join(" ");
                  return <>
                    <path d={line(result.portP90)} fill="none" stroke="#064e3b" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
                    <path d={line(result.portP10)} fill="none" stroke="#064e3b" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
                    <path d={line(result.portNoDCAMedian)} fill="none" stroke="#6b7280" strokeWidth={1.5} strokeDasharray="6 3" />
                    <path d={line(result.portMedian)} fill="none" stroke="#10b981" strokeWidth={2.5} />
                  </>;
                })()}
              </svg>
              <div className="flex gap-4 text-[10px] text-zinc-500 mt-1">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block"></span>含 DCA 中位數</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-zinc-500 inline-block border-dashed"></span>不含 DCA (Buy & Hold)</span>
                <span>虛線為 P10/P90 區間</span>
              </div>
            </div>
          </div>

          <div className="text-xs text-zinc-500 bg-zinc-800/30 p-3 rounded">
            <div className="font-medium text-zinc-300 mb-1">DCA 說明</div>
            <div>• 每月投入 NT$ {monthlyDCA.toLocaleString()}，在當月模擬價格買入 shares += 金額/價格</div>
            <div>• 總投入 = 初始市值 ({effectiveShares}股 × {currentPrice}) + {years * 12}個月 × {monthlyDCA.toLocaleString()} = NT$ {result.totalInvested.toLocaleString()}</div>
            <div>• 最終資產 = 最終股數 × 最終價格，中位數已含波動率 {stats ? (stats.stats.sigma_annual * 100).toFixed(1) + "%" : ""} 的隨機性</div>
            <div>• 可比較 Buy & Hold vs DCA 差異，DCA 在高波動時有微笑曲線效果</div>
          </div>
        </div>
      )}
    </div>
  );
}
