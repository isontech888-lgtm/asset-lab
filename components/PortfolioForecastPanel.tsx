
"use client";
import { useState } from "react";
type Asset = { symbol: string; stockName?: string; shares: number; currentPrice: number; };
type AssetStat = { symbol: string; S0: number; shares0: number; marketValue: number; mu: number; sigma: number; cagr: number; actualYears: number; startDate: string; endDate: string; };
function randn(){let u=0,v=0;while(u===0)u=Math.random();while(v===0)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function percentile(arr:number[],p:number){const s=[...arr].sort((a,b)=>a-b);const idx=Math.floor(p/100*(s.length-1));return s[idx];}
function simulatePortfolio(stats:AssetStat[],years:number,nPaths:number,monthlyDCA:number,allocations:number[]){
  const stepsPerYear=12;const dt=1/stepsPerYear;const totalSteps=years*stepsPerYear;const nAssets=stats.length;
  const portfolioPaths:number[][]=[];const portfolioNoDCA:number[][]=[];
  for(let p=0;p<nPaths;p++){
    let prices=stats.map(s=>s.S0);let shares=stats.map(s=>s.shares0);
    const portPath:number[]=[];const portNoDCAPath:number[]=[];
    portPath.push(shares.reduce((sum,sh,i)=>sum+sh*prices[i],0));portNoDCAPath.push(portPath[0]);
    for(let step=0;step<totalSteps;step++){
      for(let i=0;i<nAssets;i++){const Z=randn();const mu=stats[i].mu;const sigma=stats[i].sigma;prices[i]=prices[i]*Math.exp((mu-0.5*sigma*sigma)*dt+sigma*Math.sqrt(dt)*Z);}
      if(monthlyDCA>0){for(let i=0;i<nAssets;i++){const buy=monthlyDCA*allocations[i];shares[i]+=buy/prices[i];}}
      const total=shares.reduce((sum,sh,i)=>sum+sh*prices[i],0);
      const totalNoDCA=stats.reduce((sum,s,i)=>sum+s.shares0*prices[i],0);
      portPath.push(total);portNoDCAPath.push(totalNoDCA);
    }
    portfolioPaths.push(portPath);portfolioNoDCA.push(portNoDCAPath);
  }
  return {portfolioPaths,portfolioNoDCA};
}
export default function PortfolioForecastPanel({assets}:{assets:Asset[]}){
  const [stats,setStats]=useState<AssetStat[]|null>(null);const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [monthlyDCA,setMonthlyDCA]=useState(20000);const [years,setYears]=useState(10);const [nPaths,setNPaths]=useState(300);const [allocMode,setAllocMode]=useState<"market"|"equal"|"custom">("market");const [customAllocs,setCustomAllocs]=useState<number[]>([]);const [result,setResult]=useState<any>(null);
  async function fetchAllStats(){
    if(assets.length===0){setError("目前沒有持股，請先新增至少一檔");return;}
    setLoading(true);setError("");setStats(null);setResult(null);
    try{
      const results:AssetStat[]=[];
      for(const a of assets){
        const r=await fetch(`/api/finmind/stats?symbol=${a.symbol}&years=10`);const j=await r.json();
        if(!r.ok)throw new Error(`${a.symbol}: ${j.error}`);
        results.push({symbol:a.symbol,S0:a.currentPrice,shares0:a.shares,marketValue:a.shares*a.currentPrice,mu:j.stats.mu_log_annual,sigma:j.stats.sigma_annual,cagr:j.stats.cagr,actualYears:j.actualYears,startDate:j.startDate,endDate:j.endDate});
      }
      setStats(results);setCustomAllocs(results.map(()=>1/results.length));
    }catch(e:any){setError(e.message);}finally{setLoading(false);}
  }
  function getAllocations():number[]{
    if(!stats)return[];const n=stats.length;
    if(allocMode==="equal")return Array(n).fill(1/n);
    if(allocMode==="market"){const total=stats.reduce((s,x)=>s+x.marketValue,0);return stats.map(x=>x.marketValue/total);}
    const sum=customAllocs.reduce((a,b)=>a+b,0)||1;return customAllocs.map(v=>v/sum);
  }
  function run(){
    if(!stats)return;const allocs=getAllocations();
    const {portfolioPaths,portfolioNoDCA}=simulatePortfolio(stats,years,nPaths,monthlyDCA,allocs);
    const steps=portfolioPaths[0].length;const median:number[]=[],p10:number[]=[],p90:number[]=[],noDcaMedian:number[]=[];
    for(let t=0;t<steps;t++){median.push(percentile(portfolioPaths.map(p=>p[t]),50));p10.push(percentile(portfolioPaths.map(p=>p[t]),10));p90.push(percentile(portfolioPaths.map(p=>p[t]),90));noDcaMedian.push(percentile(portfolioNoDCA.map(p=>p[t]),50));}
    const initialValue=stats.reduce((s,x)=>s+x.marketValue,0);const totalInvested=initialValue+monthlyDCA*12*years;
    setResult({median,p10,p90,noDcaMedian,initialValue,totalInvested,allocs});
  }
  const totalMarket=assets.reduce((s,a)=>s+a.shares*a.currentPrice,0);
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mt-8">
      <h3 className="font-bold text-lg">整體資產成長預估 (投組 GBM + 多檔 DCA)</h3>
      <p className="text-xs text-zinc-500 mt-1">用 FinMind <span className="text-emerald-400">TaiwanStockPriceAdj 還原股價</span> (已還原分割/除息，不會失真) 計算每檔 μ/σ，多資產蒙地卡羅。現價起點=持股現價。</p>
      <div className="flex flex-wrap gap-2 items-center mt-4">
        <button onClick={fetchAllStats} disabled={loading||assets.length===0} className="bg-violet-600 hover:bg-violet-700 px-4 py-2 rounded-lg disabled:opacity-40 text-sm">{loading?"計算中...":`1. 計算投組 μ/σ (共 ${assets.length} 檔)`}</button>
        <span className="text-xs text-zinc-400">總市值 NT$ {totalMarket.toLocaleString()}，已用還原股價校正分割</span>
      </div>
      {stats && (
        <div className="mt-4">
          <div className="overflow-x-auto"><table className="w-full text-xs border border-zinc-800 rounded"><thead className="text-zinc-400 bg-zinc-800/50"><tr><th className="p-2 text-left">代號</th><th>權重</th><th>CAGR</th><th>μ</th><th>σ</th><th>期間</th><th>分配%</th></tr></thead><tbody>{stats.map((s,i)=>{const allocs=getAllocations();return (<tr key={s.symbol} className="border-t border-zinc-800"><td className="p-2 font-mono">{s.symbol}</td><td className="p-2">{(s.marketValue/stats.reduce((a,b)=>a+b.marketValue,0)*100).toFixed(1)}%</td><td className="p-2">{(s.cagr*100).toFixed(1)}%</td><td className="p-2">{(s.mu*100).toFixed(1)}%</td><td className="p-2">{(s.sigma*100).toFixed(1)}%</td><td className="p-2 text-zinc-500">{s.actualYears}年</td><td className="p-2">{allocMode==="custom"?(<input type="number" value={customAllocs[i]?.toFixed(2)||0} onChange={e=>{const v=[...customAllocs];v[i]=Number(e.target.value);setCustomAllocs(v);}} className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5" />):`${(allocs[i]*100).toFixed(1)}%`}</td></tr>);})}</tbody></table></div>
          <div className="bg-zinc-800/40 p-4 rounded-lg mt-4 border border-zinc-700/50"><div className="flex flex-wrap gap-4 items-end"><div><label className="text-xs text-zinc-400">每月總投入</label><input type="number" value={monthlyDCA} onChange={e=>setMonthlyDCA(Number(e.target.value))} className="block bg-zinc-900 border border-zinc-700 rounded px-3 py-2 mt-1 w-36" /></div><div><label className="text-xs text-zinc-400">分配</label><select value={allocMode} onChange={e=>setAllocMode(e.target.value as any)} className="block bg-zinc-900 border border-zinc-700 rounded px-3 py-2 mt-1"><option value="market">按市值比例</option><option value="equal">等權重</option><option value="custom">自訂</option></select></div><div><label className="text-xs text-zinc-400">年限</label><select value={years} onChange={e=>setYears(Number(e.target.value))} className="block bg-zinc-900 border border-zinc-700 rounded px-3 py-2 mt-1"><option value={5}>5年</option><option value={10}>10年</option><option value={20}>20年</option><option value={30}>30年</option></select></div><div><label className="text-xs text-zinc-400">路徑</label><select value={nPaths} onChange={e=>setNPaths(Number(e.target.value))} className="block bg-zinc-900 border border-zinc-700 rounded px-3 py-2 mt-1"><option value={200}>200</option><option value={300}>300</option><option value={500}>500</option></select></div><button onClick={run} className="bg-emerald-600 hover:bg-emerald-700 px-5 py-2 rounded-lg h-10">2. 跑投組蒙地卡羅</button></div><div className="text-xs text-zinc-500 mt-2">初始 NT$ {stats.reduce((s,x)=>s+x.marketValue,0).toLocaleString()} + 每月 {monthlyDCA.toLocaleString()} × {years*12}月 = 總投入 NT$ {(stats.reduce((s,x)=>s+x.marketValue,0)+monthlyDCA*12*years).toLocaleString()}，分配：{getAllocations().map((a,i)=>`${stats[i].symbol} ${(a*100).toFixed(0)}%`).join(" / ")}</div></div>
        </div>
      )}
      {error && <div className="text-red-400 text-sm mt-3">{error}</div>}
      {result && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm"><div className="bg-zinc-800 p-3 rounded border border-zinc-700"><div className="text-zinc-400 text-xs">初始總值</div><div className="font-bold text-lg">NT$ {result.initialValue.toLocaleString(undefined,{maximumFractionDigits:0})}</div></div><div className="bg-zinc-800 p-3 rounded border border-zinc-700"><div className="text-zinc-400 text-xs">Buy & Hold {years}年後</div><div className="font-bold text-lg text-zinc-300">NT$ {result.noDcaMedian[result.noDcaMedian.length-1].toLocaleString(undefined,{maximumFractionDigits:0})}</div></div><div className="bg-emerald-950/30 p-3 rounded border border-emerald-800"><div className="text-zinc-400 text-xs">含多檔 DCA {years}年後 P50</div><div className="font-bold text-lg text-emerald-300">NT$ {result.median[result.median.length-1].toLocaleString(undefined,{maximumFractionDigits:0})}</div><div className="text-xs text-zinc-400">總投入 {result.totalInvested.toLocaleString()}，報酬 {((result.median[result.median.length-1]/result.totalInvested-1)*100).toFixed(1)}%</div></div></div>
          <div className="bg-zinc-950 rounded-lg p-3 border border-emerald-900/30"><div className="text-xs font-medium mb-2 text-emerald-300">整體資產預估</div><div className="w-full overflow-x-auto"><svg width={Math.max(600,result.median.length*8)} height="220" className="block">{(()=>{const all=[...result.p10,...result.p90,...result.median,...result.noDcaMedian];const min=Math.min(...all)*0.85;const max=Math.max(...all)*1.1;const h=200;const w=Math.max(600,result.median.length*8);const sy=(v:number)=>h-((v-min)/(max-min))*h;const sx=(i:number)=>(i/(result.median.length-1))*w;const line=(arr:number[])=>arr.map((v,i)=>`${i===0?"M":"L"} ${sx(i)} ${sy(v)}`).join(" ");return (<><path d={line(result.p90)} fill="none" stroke="#064e3b" strokeWidth={1} strokeDasharray="4 4" opacity={0.5}/><path d={line(result.p10)} fill="none" stroke="#064e3b" strokeWidth={1} strokeDasharray="4 4" opacity={0.5}/><path d={line(result.noDcaMedian)} fill="none" stroke="#6b7280" strokeWidth={1.5} strokeDasharray="6 3"/><path d={line(result.median)} fill="none" stroke="#10b981" strokeWidth={2.5}/></>);})()}</svg></div></div>
          <div className="text-xs text-zinc-500 bg-zinc-800/30 p-3 rounded"><div className="font-medium text-zinc-300 mb-1">解決你的問題</div><div>1. 多檔 DCA：每月總額按分配買入不同標的，各自 GBM 路徑</div><div>2. 分割失真：後端用 TaiwanStockPriceAdj 還原股價，已校正分割除息</div><div>3. 現價起點：S0 用持股明細每檔現價</div></div>
        </div>
      )}
    </div>
  );
}
