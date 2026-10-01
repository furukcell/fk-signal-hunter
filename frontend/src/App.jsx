import {useEffect,useMemo,useState} from "react";
import {Activity,BarChart3,Bot,Gauge,LayoutDashboard,ListFilter,Menu,RefreshCw,Settings,ShieldCheck,Signal,Target,TrendingUp,Wallet,X} from "lucide-react";

const nav=[
  ["Dashboard",LayoutDashboard],
  ["24H Scanner",TrendingUp],
  ["Signals",Signal],
  ["Trades",ListFilter],
  ["Performance",BarChart3],
  ["Score Engine",Gauge],
  ["Risk",ShieldCheck],
  ["Settings",Settings]
];

const SNAPSHOT_URL="https://firestore.googleapis.com/v1/projects/fk-signal-hunter/databases/(default)/documents/public/latest";

async function fetchSnapshot(){
  const res=await fetch(SNAPSHOT_URL,{cache:"no-store"});
  if(!res.ok) throw new Error("Snapshot unavailable");
  const doc=await res.json();
  const raw=doc?.fields?.payload?.stringValue;
  if(!raw) throw new Error("Snapshot payload missing");
  return JSON.parse(raw);
}

function Stat({icon:Icon,label,value,detail}){
  return <div className="card stat"><div className="statIcon"><Icon size={17}/></div><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}
function Score({n}){const x=Number(n||0);return <span className={"score "+(x>=82?"high":x>=70?"mid":"low")}>{x}</span>;}
function pct(n,d=1){return n==null?"—":Number(n).toFixed(d)+"%";}
function price(n){return n==null?"—":Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4});}
function fmtDate(ts){return ts?new Date(ts).toLocaleString("tr-TR",{hour:"2-digit",minute:"2-digit"}):"—";}
function marketCount(m){return m?.activeExchangeCount??m?.exchangeCount??0;}

export default function App(){
  const [open,setOpen]=useState(false);
  const [tab,setTab]=useState("Dashboard");
  const [data,setData]=useState(null);
  const [market,setMarket]=useState(null);
  const [error,setError]=useState(null);

  useEffect(()=>{
    let alive=true;
    const load=async()=>{
      try{
        const d=await fetchSnapshot();
        const preferred=market?.symbol;
        const next=d.markets?.find(x=>x.symbol===preferred)??d.markets?.[0]??null;
        if(alive){setData(d);setMarket(next);setError(null);}
      }catch(e){if(alive)setError(e.message);}
    };
    load();
    const id=setInterval(load,60000);
    return()=>{alive=false;clearInterval(id)};
  },[market?.symbol]);

  const markets=data?.markets??[];
  const analytics=data?.analytics24h;
  const connected=Number(data?.health?.exchangesWithData||0)>0;

  const selectMarket=s=>setMarket(markets.find(m=>m.symbol===s)||market);

  return <div className="app">
    <aside className={open?"side open":"side"}>
      <div className="brand"><div className="mark"><Target size={18}/></div><div><b>FK SIGNAL HUNTER</b><span>Market Intelligence</span></div><button className="close" onClick={()=>setOpen(false)}><X size={18}/></button></div>
      <nav>{nav.map(([name,Icon])=><button className={tab===name?"active":""} key={name} onClick={()=>{setTab(name);setOpen(false)}}><Icon size={17}/><span>{name}</span></button>)}</nav>
      <div className="bottom"><div className="paper"><i/> <div><b>PAPER MODE</b><span>Real money disabled</span></div></div><div className="engine"><Bot size={16}/> Engine <b>ONLINE</b></div></div>
    </aside>
    <main>
      <header><button className="menu" onClick={()=>setOpen(true)}><Menu size={20}/></button><div><small>PERSONAL TRADING SYSTEM</small><h1>{tab}</h1></div><div className="actions"><span className="market"><i className={connected?"live":""}/> {connected?"5-minute snapshot online":"Snapshot disconnected"}</span><button className="start" disabled><Bot size={15}/> Start Bot</button></div></header>
      <section className="content">
        {error&&<div className="notice"><RefreshCw size={17}/><div><b>Market data:</b> {error}</div></div>}
        {tab==="Dashboard"&&<Dashboard data={data} market={market} selectMarket={selectMarket}/>}
        {tab==="24H Scanner"&&<Scanner analytics={analytics} markets={markets} selectMarket={selectMarket}/>}
        {tab==="Signals"&&<Signals data={data} analytics={analytics}/>}
        {tab==="Trades"&&<Trades paper={data?.paper}/>}
        {tab==="Performance"&&<Performance paper={data?.paper}/>}
        {tab==="Score Engine"&&<ScoreEngine/>}
        {tab==="Risk"&&<Risk data={data}/>}
        {tab==="Settings"&&<SettingsPage/>}
      </section>
    </main>
  </div>;
}

function Dashboard({data,market,selectMarket}){
  const a=data?.analytics24h;
  const s=a?.summary||{};
  const score=market?.score??0;
  return <>
    <div className="notice"><Activity size={17}/><div><b>Bu ekran artık sadece “şu an”ı göstermiyor.</b> Her 5 dakikada tüm 100 coin taranıyor; 82+ skor eşiğini geçen fırsatlar kaydediliyor ve 30 dk / 1 saat / 2 saat sonraki fiyat sonucu ölçülüyor.</div></div>
    <div className="stats">
      <Stat icon={Wallet} label="Paper Equity" value={(data?.paper?.equity??1000).toFixed(2)+" TL"} detail={(data?.paper?.returnPct??0).toFixed(2)+"% since start"}/>
      <Stat icon={Target} label="24H Fırsat" value={s.totalOpportunities24h??0} detail="Score ≥ 82"/>
      <Stat icon={TrendingUp} label="30M Pozitif" value={pct(s.positiveRate30m)} detail={(s.resolved30m??0)+" resolved"}/>
      <Stat icon={TrendingUp} label="1H Pozitif" value={pct(s.positiveRate1h)} detail={(s.resolved1h??0)+" resolved"}/>
      <Stat icon={Gauge} label="2H Ortalama" value={pct(s.avgReturn2h,3)} detail={(s.resolved2h??0)+" resolved"}/>
    </div>
    <div className="two">
      <section className="card chartCard">
        <div className="head"><div><small>24 SAAT / 15 DK ÖRNEKLEME</small><h2>Score Timeline</h2></div><select value={market?.symbol||""} onChange={e=>selectMarket(e.target.value)}>{(data?.markets||[]).map(m=><option key={m.symbol} value={m.symbol}>{m.symbol.replace("USDT","/USDT")}</option>)}</select></div>
        <ScoreChart points={a?.scorePoints||[]} symbol={market?.symbol}/>
        <div className="chartLegend"><span><i/> {market?.symbol?.replace("USDT","/USDT")||"—"} score</span><span>WATCH ≥ 82</span></div>
      </section>
      <section className="card risk">
        <div className="head"><div><small>SEÇİLİ COIN</small><h2>{market?.symbol?.replace("USDT","/USDT")||"—"}</h2></div><Score n={score}/></div>
        <div className="decision"><Score n={score}/><div><b>{score>=82?"WATCH FIRSATI":score>=70?"MONITOR":"WAIT"}</b><span>Bu skor henüz “garantili alım” anlamına gelmez.</span></div></div>
        <Row label="Buy pressure" value={pct(market?.buyPressurePct)} width={market?.buyPressurePct??0}/>
        <Row label="Order-book imbalance" value={pct(market?.weightedImbalancePct)} width={Math.min(100,Math.abs(market?.weightedImbalancePct||0)*2.5)}/>
        <Row label="24H momentum" value={pct(market?.priceChangePct24h)} width={Math.min(100,Math.abs(market?.priceChangePct24h||0)*20)}/>
        <Row label="Spread" value={pct(market?.spreadPct,3)} width={Math.min(100,(market?.spreadPct||0)*500)}/>
        <footer>Son snapshot: {fmtDate(data?.generatedAt)}</footer>
      </section>
    </div>
    <OpportunityTable analytics={a} limit={10}/>
  </>;
}

function Scanner({analytics,markets,selectMarket}){
  const rows=useMemo(()=>[...(analytics?.markets||[])].sort((a,b)=>(b.opportunities24h-a.opportunities24h)||((b.score||0)-(a.score||0))),[analytics]);
  return <>
    <div className="notice"><TrendingUp size={17}/><div><b>24H Scanner.</b> Buradaki “fırsat” bir gerçek emir değil; skorun 82 eşiğini yukarı kesmesi. Sonuçlar daha sonra ölçülüyor.</div></div>
    <div className="stats">
      <Stat icon={Target} label="Coin sayısı" value={markets.length} detail="Universe"/>
      <Stat icon={Signal} label="Fırsat" value={analytics?.summary?.totalOpportunities24h??0} detail="Last 24h"/>
      <Stat icon={TrendingUp} label="Avg 30M" value={pct(analytics?.summary?.avgReturn30m,3)} detail="Resolved"/>
      <Stat icon={TrendingUp} label="Avg 1H" value={pct(analytics?.summary?.avgReturn1h,3)} detail="Resolved"/>
      <Stat icon={TrendingUp} label="Avg 2H" value={pct(analytics?.summary?.avgReturn2h,3)} detail="Resolved"/>
    </div>
    <section className="card tableCard"><div className="head"><div><small>100 COIN / SON 24 SAAT</small><h2>Fırsat Sonuçları</h2></div><span className="tag">5 MIN DATA</span></div><div className="tableWrap"><table><thead><tr><th>COIN</th><th>SKOR</th><th>FIRSAT</th><th>30M ORT.</th><th>1H ORT.</th><th>2H ORT.</th><th>2H POZİTİF</th><th>EXCHANGES</th></tr></thead><tbody>{rows.map(r=><tr key={r.symbol} onClick={()=>selectMarket(r.symbol)} className="clickRow"><td><b>{r.symbol.replace("USDT","/USDT")}</b></td><td><Score n={r.score}/></td><td>{r.opportunities24h}</td><td>{pct(r.avgReturn30m,3)}</td><td>{pct(r.avgReturn1h,3)}</td><td>{pct(r.avgReturn2h,3)}</td><td>{pct(r.positiveRate2h,1)}</td><td>{marketCount(markets.find(m=>m.symbol===r.symbol))}/10</td></tr>)}</tbody></table></div></section>
  </>;
}

function Signals({data,analytics}){
  const rows=[...(data?.markets||[])].sort((a,b)=>(b.score||0)-(a.score||0));
  const map=new Map((analytics?.markets||[]).map(x=>[x.symbol,x]));
  return <section className="card tableCard"><div className="head"><div><small>CURRENT STATE</small><h2>Signal Radar</h2></div><span className="tag">TOP 100</span></div><div className="tableWrap"><table><thead><tr><th>PAIR</th><th>SCORE</th><th>BUY FLOW</th><th>BOOK</th><th>24H MOM.</th><th>EXCHANGES</th><th>24H FIRSAT</th><th>STATUS</th></tr></thead><tbody>{rows.map(m=>{const h=map.get(m.symbol);return <tr key={m.symbol}><td><b>{m.symbol.replace("USDT","/USDT")}</b></td><td><Score n={m.score}/></td><td>{pct(m.buyPressurePct,1)}</td><td>{pct(m.weightedImbalancePct,1)}</td><td>{pct(m.priceChangePct24h,2)}</td><td>{marketCount(m)}/10</td><td>{h?.opportunities24h??0}</td><td><label className={"tag "+(m.score>=82?"good":"")}>{m.signal}</label></td></tr>})}</tbody></table></div></section>;
}

function OpportunityTable({analytics,limit=20}){
  const events=analytics?.events||[];
  return <section className="card tableCard"><div className="head"><div><small>RECENT WATCH EVENTS</small><h2>Fırsat → Sonuç</h2></div><span className="tag">{events.length} stored</span></div><div className="tableWrap"><table><thead><tr><th>TIME</th><th>PAIR</th><th>ENTRY SCORE</th><th>30M</th><th>1H</th><th>2H</th><th>MAX 2H</th></tr></thead><tbody>{events.slice(0,limit).map(e=><tr key={e.id}><td>{fmtDate(e.signalAt)}</td><td><b>{e.symbol.replace("USDT","/USDT")}</b></td><td><Score n={e.score}/></td><td className={e.r30m>0?"positive":e.r30m<0?"negative":""}>{pct(e.r30m,3)}</td><td className={e.r1h>0?"positive":e.r1h<0?"negative":""}>{pct(e.r1h,3)}</td><td className={e.r2h>0?"positive":e.r2h<0?"negative":""}>{pct(e.r2h,3)}</td><td>{pct(e.maxReturn2h,3)}</td></tr>)}</tbody></table></div></section>;
}

function ScoreChart({points,symbol}){
  const values=(points||[]).map(p=>({ts:p.ts,v:p.markets?.find(m=>m.s===symbol)?.score})).filter(x=>x.v!=null);
  if(values.length<2) return <div className="chartEmpty">24 saatlik grafik doluyor. Sistem 15 dakikada bir score noktası saklıyor.</div>;
  const w=900,h=220,pad=24,min=0,max=100;
  const xy=(d,i)=>({x:pad+(i/(values.length-1))*(w-pad*2),y:h-pad-(d.v/100)*(h-pad*2)});
  const line=values.map((d,i)=>{const q=xy(d,i);return (i?"L":"M")+q.x.toFixed(1)+" "+q.y.toFixed(1)}).join(" ");
  const area=line+" L "+(w-pad)+" "+(h-pad)+" L "+pad+" "+(h-pad)+" Z";
  return <div className="scoreChart"><svg viewBox={"0 0 "+w+" "+h}><line x1={pad} x2={w-pad} y1={h-pad-(82/100)*(h-pad*2)} y2={h-pad-(82/100)*(h-pad*2)} className="threshold"/><path d={area} className="area"/><path d={line} className="line"/>{values.slice(-1).map((d,i)=>{const q=xy(d,values.length-1);return <circle key={i} cx={q.x} cy={q.y} r="4"/>})}</svg><div className="chartAxis"><span>24s önce</span><span>82 WATCH</span><span>Şimdi</span></div></div>;
}

function Row({label,value,width}){return <div className="riskRow"><div><span>{label}</span><b>{value}</b></div><div className="bar"><i style={{width:Math.max(0,Math.min(100,width||0))+"%"}}/></div></div>;}

function Trades({paper}){
  const trades=paper?.trades||[];
  return <><div className="notice"><ListFilter size={17}/><div><b>Paper trades only.</b> Gerçek borsaya emir gönderilmiyor.</div></div><section className="card tableCard"><div className="head"><div><small>EXECUTION LOG</small><h2>Paper Trades</h2></div><span className="tag">{trades.length} closed</span></div><div className="tableWrap"><table><thead><tr><th>TIME</th><th>PAIR</th><th>EXCHANGE</th><th>ENTRY</th><th>EXIT</th><th>P&L</th><th>REASON</th></tr></thead><tbody>{trades.slice(0,100).map(t=><tr key={t.id}><td>{fmtDate(t.closedAt)}</td><td><b>{t.symbol}</b></td><td>{t.exchange}</td><td>{price(t.entryPrice)}</td><td>{price(t.exitPrice)}</td><td className={t.netPnl>0?"positive":"negative"}>{Number(t.netPnl||0).toFixed(3)}</td><td>{t.reason}</td></tr>)}</tbody></table></div></section></>;
}

function Performance({paper}){
  const trades=paper?.trades||[];
  const wins=trades.filter(t=>t.netPnl>0).length;
  const gp=trades.filter(t=>t.netPnl>0).reduce((s,t)=>s+t.netPnl,0);
  const gl=Math.abs(trades.filter(t=>t.netPnl<0).reduce((s,t)=>s+t.netPnl,0));
  return <><div className="stats"><Stat icon={Wallet} label="Equity" value={(paper?.equity??1000).toFixed(2)+" TL"} detail="Paper"/><Stat icon={TrendingUp} label="Return" value={(paper?.returnPct??0).toFixed(2)+"%"} detail="Since start"/><Stat icon={Target} label="Win rate" value={trades.length?(wins/trades.length*100).toFixed(1)+"%":"—"} detail={trades.length+" closed"}/><Stat icon={Gauge} label="Profit factor" value={gl?((gp/gl).toFixed(2)):"—"} detail="Modeled fees"/></div><section className="card empty"><BarChart3 size={24}/><h2>1 aylık istatistik alanı</h2><p>30 günlük snapshot geçmişi ayrı tutuluyor. Bu ekranın sonraki adımında aynı fırsatları gün/gün ve coin/coin agregasyonuna çevireceğiz; şu an burada yalnızca paper execution gösteriliyor.</p></section></>;
}

function ScoreEngine(){
  const rows=[
    ["24H momentum","±10","Fiyatın son 24 saatteki yönü"],
    ["Likidite","+8 / +4","24H quote volume"],
    ["Borsa kapsamı","+7 / +4 / -8","Kaç borsada sağlıklı fiyat var"],
    ["Fiyat dağılımı","±4","Borsalar arası fiyat farkı"],
    ["Order-book","±12","Top depth bid/ask dengesi"],
    ["Spread","+4 / -5","İşlem maliyeti / likidite kalitesi"],
    ["Buy pressure","±10","Binance son işlem örneklemindeki alıcı baskısı"]
  ];
  return <><div className="notice"><Gauge size={17}/><div><b>Bu motor şu an prototip.</b> 82+ sadece “WATCH fırsatı” üretir. İstatistikler birikmeden bu skorun kârlı olduğu varsayılmıyor.</div></div><section className="card tableCard"><div className="head"><div><small>CURRENT FORMULA</small><h2>Score Engine</h2></div><span className="tag">PROTOTYPE</span></div><div className="formulaGrid">{rows.map(r=><div key={r[0]}><b>{r[0]}</b><strong>{r[1]}</strong><span>{r[2]}</span></div>)}</div></section><section className="card empty"><Target size={24}/><h2>Gelecek “AL” motoru</h2><p>Gerçek alım kararı için bu score tek başına kullanılmayacak. 5M momentum, volume anomaly, gerçek trade-flow penceresi, slippage, volatilite, cross-exchange teyidi ve risk blokları ayrı Entry Engine olarak test edilecek.</p></section></>;
}

function Risk({data}){
  const h=data?.health||{};
  return <><div className="stats"><Stat icon={ShieldCheck} label="Open positions" value={(data?.paper?.positions?.length??0)+" / 2"} detail="Paper limit"/><Stat icon={Activity} label="Exchange feeds" value={(h.exchangesWithData??0)+"/10"} detail="Snapshot coverage"/><Stat icon={Signal} label="Depth markets" value={h.depthMarkets??0} detail="Top-depth enriched"/><Stat icon={Bot} label="Mode" value="PAPER" detail="No real orders"/></div><section className="card empty"><ShieldCheck size={24}/><h2>Risk controls</h2><p>Gerçek para modu kapalı. Mevcut paper engine 1,000 TL başlangıç, %15 pozisyon ve maksimum 2 açık pozisyon ile çalışıyor.</p></section></>;
}

function SettingsPage(){
  return <><div className="notice"><Settings size={17}/><div><b>Free mode.</b> Snapshot scheduler dış cron + GitHub Actions kullanıyor; market verileri public API'lerden geliyor.</div></div><section className="card empty"><Settings size={24}/><h2>System settings</h2><p>Snapshot: 5 dk · Score history: 15 dk · Fırsat horizon: 30 dk / 1 saat / 2 saat · Retention: 30 gün.</p></section></>;
}
