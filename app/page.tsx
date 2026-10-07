
"use client";
import { useEffect, useState } from "react";
import MonteCarloPanel from "../components/MonteCarloPanel";

type Asset = {
  id: string;
  symbol: string;
  stockName?: string;
  industry?: string;
  shares: number;
  buyPrice: number;
  currentPrice: number;
  lastClose?: number;
  dayChange?: number;
  dayChangePercent?: number;
};

type Profile = { id: string; name: string; color: string; assets: Asset[] };
const DEFAULT_PROFILE: Profile = { id: "me", name: "我", color: "#6C5CE7", assets: [] };

export default function Page() {
  const [profiles, setProfiles] = useState<Profile[]>([DEFAULT_PROFILE]);
  const [activeId, setActiveId] = useState("me");
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState<number>(1000);
  const [buyPrice, setBuyPrice] = useState<number>(500);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editShares, setEditShares] = useState<number>(0);
  const [editBuyPrice, setEditBuyPrice] = useState<number>(0);
  const [editCurrentPrice, setEditCurrentPrice] = useState<number>(0);
  const [selectedForForecast, setSelectedForForecast] = useState<Asset | null>(null);

  const active = profiles.find(p=>p.id===activeId) || profiles[0];

  useEffect(()=>{
    const saved = localStorage.getItem("asset_lab_next");
    if(saved){ try{ const j=JSON.parse(saved); setProfiles(j.profiles||[DEFAULT_PROFILE]); setActiveId(j.activeId||"me"); }catch{} }
  },[]);
  useEffect(()=>{ localStorage.setItem("asset_lab_next", JSON.stringify({profiles, activeId})); },[profiles, activeId]);

  async function fetchInfoAndPrice(sym: string) {
    setLoading(true); setLog("查詢 FinMind 中...");
    try{
      const infoRes = await fetch(`/api/finmind?symbol=${sym}&type=info`);
      const infoJson = await infoRes.json();
      const priceRes = await fetch(`/api/finmind?symbol=${sym}&type=price`);
      const priceJson = await priceRes.json();
      const info = infoJson.results?.[0]?.data;
      const price = priceJson.results?.[0]?.last;
      const prev = priceJson.results?.[0]?.prev;
      if(info || price){
        setLog(`✓ ${info?.stock_name||sym} ${info?.industry_category||""} 現價 ${price?.close||" - "}`);
        return { name: info?.stock_name, industry: info?.industry_category, price: price?.close, prev: prev?.close };
      } else {
        setLog("FinMind 無資料，已用買入價當現價");
        return null;
      }
    }catch(e:any){ setLog("錯誤: "+e.message); return null; }
    finally{ setLoading(false); }
  }

  async function addAsset(){
    if(!symbol) return;
    const res = await fetchInfoAndPrice(symbol);
    const newAsset: Asset = {
      id: Date.now().toString(),
      symbol: symbol.toUpperCase(),
      stockName: res?.name,
      industry: res?.industry,
      shares: Number(shares),
      buyPrice: Number(buyPrice),
      currentPrice: Number(res?.price || buyPrice),
      lastClose: res?.prev,
      dayChange: res?.price && res?.prev ? res.price - res.prev : 0,
      dayChangePercent: res?.price && res?.prev ? (res.price-res.prev)/res.prev*100 : 0,
    };
    setProfiles(prev=>prev.map(p=>p.id===activeId?{...p, assets:[...p.assets, newAsset]}:p));
    setSymbol("");
  }

  function updateAsset(id: string, patch: Partial<Asset>){
    setProfiles(prev=>prev.map(p=> p.id!==activeId? p : {...p, assets: p.assets.map(a=> a.id===id? {...a, ...patch}: a)}));
  }
  function deleteAsset(id: string){
    if(!confirm("確定刪除這筆持股？")) return;
    setProfiles(prev=>prev.map(p=> p.id!==activeId? p : {...p, assets: p.assets.filter(a=>a.id!==id)}));
  }
  function adjustShares(id: string, delta: number){
    const a = active.assets.find(x=>x.id===id); if(!a) return;
    const newShares = Math.max(0, a.shares + delta);
    if(newShares===0){ if(confirm(`股數歸零，要直接刪除 ${a.symbol} 嗎？`)) deleteAsset(id); return; }
    updateAsset(id, { shares: newShares });
  }

  async function refreshAll(){
    if(active.assets.length===0) return;
    setLoading(true); setLog("批次更新中...");
    const symbols = active.assets.map(a=>a.symbol).join(",");
    try{
      const r = await fetch(`/api/finmind?symbols=${symbols}&type=price`);
      const j = await r.json();
      const map = new Map(j.results.map((x:any)=>[x.symbol, x]));
      setProfiles(prev=>prev.map(p=>{
        if(p.id!==activeId) return p;
        return {...p, assets: p.assets.map(a=>{
          const q = map.get(a.symbol) as any;
          if(q?.last){ return {...a, currentPrice: q.last.close, lastClose: q.prev?.close, dayChange: q.dayChange, dayChangePercent: q.dayChangePercent}; }
          return a;
        })};
      }));
      setLog(`✓ 已更新 ${j.results.length} 檔`);
    }catch(e:any){ setLog(e.message);} finally{ setLoading(false); }
  }

  function startEdit(a: Asset){ setEditingId(a.id); setEditShares(a.shares); setEditBuyPrice(a.buyPrice); setEditCurrentPrice(a.currentPrice); }
  function saveEdit(){
    if(!editingId) return;
    updateAsset(editingId, { shares: Number(editShares), buyPrice: Number(editBuyPrice), currentPrice: Number(editCurrentPrice) });
    setEditingId(null);
  }

  const totalCost = active.assets.reduce((s,a)=>s+a.shares*a.buyPrice,0);
  const totalMarket = active.assets.reduce((s,a)=>s+a.shares*a.currentPrice,0);
  const totalPnl = totalMarket-totalCost;
  const totalDay = active.assets.reduce((s,a)=>s+(a.dayChange||0)*a.shares,0);

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold">資產成長實驗室 v5 - DCA 完整版</h1>
          <p className="text-zinc-400 text-sm mt-1">可自由增減 / 編輯 / 刪除 - 支援主動式ETF + GBM蒙地卡羅 + DCA - Token 藏在後端</p>
          <p className="text-xs text-zinc-500 mt-1">{log}</p>
        </div>
        <button onClick={refreshAll} disabled={loading} className="bg-violet-600 hover:bg-violet-700 px-5 py-2 rounded-lg disabled:opacity-50">↻ 一鍵更新報價</button>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap items-center">
        {profiles.map(p=>(
          <div key={p.id} className="flex items-center gap-1">
            <button onClick={()=>setActiveId(p.id)} className={`px-4 py-2 rounded-full text-sm ${activeId===p.id?"bg-violet-600 text-white":"bg-zinc-800 hover:bg-zinc-700"}`}>{p.name}</button>
            {activeId===p.id && profiles.length>1 && <button onClick={()=>{
              const n=prompt("重新命名", p.name); if(n) setProfiles(pr=>pr.map(x=>x.id===p.id?{...x,name:n}:x));
            }} className="text-xs text-zinc-500 ml-1">✏️</button>}
          </div>
        ))}
        <button onClick={()=>{
          const name=prompt("成員名稱，例如：伴侶"); if(!name) return;
          const id=Date.now().toString();
          setProfiles([...profiles,{id, name, color:"#00cec9", assets:[]}]);
          setActiveId(id);
        }} className="px-4 py-2 rounded-full bg-zinc-900 border border-dashed border-zinc-700 text-sm">+ 新增成員</button>
        {profiles.length>1 && <button onClick={()=>{
          if(!confirm(`確定刪除成員 ${active.name} 的全部資料？`)) return;
          const rest=profiles.filter(p=>p.id!==activeId);
          setProfiles(rest); setActiveId(rest[0].id);
        }} className="px-3 py-2 rounded-full bg-red-900/30 text-red-300 text-xs ml-2">刪除此成員</button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800"><div className="text-zinc-400 text-xs">總市值</div><div className="text-2xl font-bold mt-1">NT$ {totalMarket.toLocaleString()}</div></div>
        <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800"><div className="text-zinc-400 text-xs">總成本</div><div className="text-xl mt-1">NT$ {totalCost.toLocaleString()}</div></div>
        <div className={`p-4 rounded-xl border ${totalPnl>=0?"bg-emerald-950/40 border-emerald-800 text-emerald-300":"bg-red-950/40 border-red-800 text-red-300"}`}><div className="text-xs opacity-70">總損益</div><div className="text-xl font-bold mt-1">{totalPnl>=0?"+":""}{totalPnl.toLocaleString()} <span className="text-sm">({totalCost? (totalPnl/totalCost*100).toFixed(2):0}%)</span></div></div>
        <div className="p-4 rounded-xl border bg-zinc-900 border-zinc-800"><div className="text-zinc-400 text-xs">今日損益</div><div className={`text-xl font-bold mt-1 ${totalDay>=0?"text-emerald-400":"text-red-400"}`}>{totalDay>=0?"+":""}{totalDay.toLocaleString()}</div></div>
      </div>

      <div className="bg-zinc-900 p-4 rounded-xl mb-6 border border-zinc-800">
        <div className="font-medium mb-3">新增持股</div>
        <div className="flex flex-wrap gap-3 items-end">
          <div><label className="text-xs text-zinc-400">代號</label><input value={symbol} onChange={e=>setSymbol(e.target.value)} className="block bg-zinc-800 rounded px-3 py-2 mt-1 w-36 border border-zinc-700" placeholder="2330"/></div>
          <div><label className="text-xs text-zinc-400">股數</label><div className="flex gap-1 mt-1"><button onClick={()=>setShares(Math.max(0,shares-100))} className="bg-zinc-800 px-2 py-2 rounded border border-zinc-700">-</button><input type="number" value={shares} onChange={e=>setShares(Number(e.target.value))} className="bg-zinc-800 rounded px-2 py-2 w-24 border border-zinc-700"/><button onClick={()=>setShares(shares+100)} className="bg-zinc-800 px-2 py-2 rounded border border-zinc-700">+</button></div></div>
          <div><label className="text-xs text-zinc-400">買入均價</label><input type="number" value={buyPrice} onChange={e=>setBuyPrice(Number(e.target.value))} className="block bg-zinc-800 rounded px-3 py-2 mt-1 w-28 border border-zinc-700"/></div>
          <button onClick={addAsset} disabled={loading || !symbol} className="bg-violet-600 hover:bg-violet-700 px-5 py-2.5 rounded-lg h-11 disabled:opacity-50">新增 + 自動抓名稱</button>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800">
        <div className="p-4 font-medium flex justify-between"><span>持股明細 - {active.name} ({active.assets.length})</span><span className="text-xs text-zinc-500">點 編輯，+/- 快速加減碼</span></div>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-400 text-xs border-y border-zinc-800 bg-zinc-900/50"><tr><th className="p-3">代號</th><th>名稱</th><th>股數</th><th>買入</th><th>現價</th><th>市值</th><th>損益</th><th>當日</th><th>操作</th></tr></thead>
          <tbody>
            {active.assets.map(a=>(
              <tr key={a.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="p-3 font-mono font-bold">{a.symbol}</td>
                <td><div>{a.stockName||"-"}</div><div className="text-xs text-zinc-500">{a.industry||""}</div></td>
                <td>
                  {editingId===a.id ? <input type="number" value={editShares} onChange={e=>setEditShares(Number(e.target.value))} className="w-20 bg-zinc-800 border border-violet-600 rounded px-2 py-1"/> : 
                  <div className="flex items-center gap-1"><span>{a.shares}</span><button onClick={()=>adjustShares(a.id,-100)} className="w-6 h-6 bg-zinc-800 rounded text-xs">-</button><button onClick={()=>adjustShares(a.id,100)} className="w-6 h-6 bg-zinc-800 rounded text-xs">+</button></div>}
                </td>
                <td>{editingId===a.id ? <input type="number" value={editBuyPrice} onChange={e=>setEditBuyPrice(Number(e.target.value))} className="w-20 bg-zinc-800 border border-violet-600 rounded px-2 py-1"/> : a.buyPrice}</td>
                <td>{editingId===a.id ? <input type="number" value={editCurrentPrice} onChange={e=>setEditCurrentPrice(Number(e.target.value))} className="w-20 bg-zinc-800 border border-violet-600 rounded px-2 py-1"/> : <span className="font-bold">{a.currentPrice}</span>}</td>
                <td> {(a.shares*a.currentPrice).toLocaleString()}</td>
                <td className={(a.currentPrice-a.buyPrice)>=0?"text-emerald-400":"text-red-400"}>{((a.currentPrice-a.buyPrice)*a.shares).toLocaleString()}<div className="text-xs">{(((a.currentPrice-a.buyPrice)/a.buyPrice)*100).toFixed(2)}%</div></td>
                <td className={(a.dayChange||0)>=0?"text-emerald-400":"text-red-400"}>{a.dayChange? `${a.dayChange>0?"+":""}${a.dayChange.toFixed(2)}`: "-"}</td>
                <td>
                  {editingId===a.id ? <><button onClick={saveEdit} className="bg-violet-600 px-2 py-1 rounded text-xs mr-1">儲存</button><button onClick={()=>setEditingId(null)} className="bg-zinc-800 px-2 py-1 rounded text-xs">取消</button></> :
                  <><button onClick={()=>setSelectedForForecast(a)} className="px-2 py-1 bg-violet-900/50 text-violet-300 rounded text-xs mr-1">預估</button><button onClick={()=>startEdit(a)} className="px-2 py-1 bg-zinc-800 rounded text-xs mr-1">編輯</button><button onClick={()=>deleteAsset(a.id)} className="px-2 py-1 bg-red-900/30 text-red-300 rounded text-xs">刪除</button></>}
                </td>
              </tr>
            ))}
            {active.assets.length===0 && <tr><td colSpan={9} className="p-12 text-center text-zinc-500">還沒有持股，上面輸入 2330 試試看<br/>可自由加減碼，點編輯可改任何數字</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      {selectedForForecast && (
        <MonteCarloPanel currentPrice={selectedForForecast.currentPrice} />
      )}
      {!selectedForForecast && active.assets.length>0 && (
        <div className="mt-6">
          <MonteCarloPanel currentPrice={active.assets[0]?.currentPrice || 15} />
        </div>
      )}
    </div>
  );
}
