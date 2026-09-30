import {useEffect,useMemo,useState} from 'react';
import {Activity,BarChart3,Bot,Gauge,LayoutDashboard,ListFilter,Menu,RefreshCw,Settings,ShieldCheck,Signal,Target,TrendingUp,Wallet,X} from 'lucide-react';

const trades=[['--:--:--','BTC/USDT','PAPER','—','—',0,'—']];
const nav=[['Dashboard',LayoutDashboard],['Signals',Signal],['Trades',ListFilter],['Performance',BarChart3],['Risk',ShieldCheck],['Settings',Settings]];

function Stat({icon:Icon,label,value,detail}){return <div className="card stat"><div className="statIcon"><Icon size={17}/></div><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>}
function Score({n}){return <span className={'score '+(n>=85?'high':n>=75?'mid':'low')}>{n}</span>}
function fmtPrice(n){return n==null?'—':Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtPct(n){return n==null?'—':n.toFixed(3)+'%'}
function exchangeCount(m){return m?.exchangeCount ?? Object.keys(m?.exchangeData ?? {}).length ?? 0;}
function signalScore(market){ return market?.score ?? 0; }

export default function App(){
 const [open,setOpen]=useState(false);
 const [tab,setTab]=useState('Dashboard');
 const [market,setMarket]=useState(null);
 const [scanner,setScanner]=useState([]);
 const [error,setError]=useState(null);
 const [paper,setPaper]=useState(null);

 useEffect(()=>{
  let alive=true;
  const load=async()=>{
   try{
    const res=await fetch('/api/market/scanner');
    if(!res.ok)throw new Error('Market scanner unavailable');
    const data=await res.json();
    const btc=data.markets?.find(m=>m.symbol==='BTCUSDT') ?? data.markets?.[0] ?? null;
    const paperRes=await fetch('/api/paper');
    const paperData=paperRes.ok?await paperRes.json():null;
    if(alive){setScanner(data.markets ?? []);setMarket(btc);setPaper(paperData);setError(null);}
   }catch(err){if(alive)setError(err.message);}
  };
  load();
  const id=setInterval(load,1000);
  return()=>{alive=false;clearInterval(id)};
 },[]);

 const score=useMemo(()=>signalScore(market),[market]);
 const connected=exchangeCount(market)>0;

 return <div className="app">
  <aside className={open?'side open':'side'}>
   <div className="brand"><div className="mark"><Target size={18}/></div><div><b>FK SIGNAL HUNTER</b><span>Market Intelligence</span></div><button className="close" onClick={()=>setOpen(false)}><X size={18}/></button></div>
   <nav>{nav.map(([name,Icon])=><button className={tab===name?'active':''} key={name} onClick={()=>{setTab(name);setOpen(false)}}><Icon size={17}/><span>{name}</span></button>)}</nav>
   <div className="bottom"><div className="paper"><i/> <div><b>PAPER MODE</b><span>Real money disabled</span></div></div><div className="engine"><Bot size={16}/> Engine <b>ONLINE</b></div></div>
  </aside>
  <main>
   <header><button className="menu" onClick={()=>setOpen(true)}><Menu size={20}/></button><div><small>PERSONAL TRADING SYSTEM</small><h1>{tab}</h1></div><div className="actions"><span className="market"><i className={connected?'live':''}/> {connected?'Market data connected':'Market data disconnected'}</span><button className="start" disabled><Bot size={15}/> Start Bot</button></div></header>
   <section className="content">{tab==='Dashboard'?<DashboardContent market={market} scanner={scanner} score={score} connected={connected} error={error} paper={paper}/>:<ModuleView tab={tab}/>}</section>
  </main>
 </div>
}

function ModuleView({tab}){
 const [data,setData]=useState(null);
 const [wf,setWf]=useState(null);
 const [wfLoading,setWfLoading]=useState(false);
 const runValidation=async()=>{
  setWfLoading(true);
  try{
   const r=await fetch('/api/walk-forward',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({options:{baseOptions:{entryDelayMs:10000,maxHoldMs:15*60*1000,cooldownMs:60*1000,slippageBps:5}}})});
   const d=await r.json();
   if(r.ok)setWf(d); else setWf({error:d.error||'Validation failed'});
  }catch(e){setWf({error:e.message});}
  finally{setWfLoading(false);}
 };
 useEffect(()=>{
  let alive=true;
  const load=async()=>{
   try{
    const path=tab==='Signals'?'/api/signals':tab==='Risk'?'/api/data-health':'/api/paper';
    const r=await fetch(path);
    if(r.ok){const d=await r.json();if(alive)setData(d);}
   }catch{}
  };
  load(); const id=setInterval(load,2000);
  return()=>{alive=false;clearInterval(id)};
 },[tab]);

 if(tab==='Signals'){
  return <><div className="notice"><Signal size={17}/><div><b>Live signal radar.</b> Cross-exchange confirmation, buy pressure, spread and opportunity data.</div></div>
   <Table title="SIGNAL RADAR" subtitle="Live" action={(data?.signals?.length??0)+" candidates"}><thead><tr><th>PAIR</th><th>SCORE</th><th>BUY PRESSURE</th><th>EXCHANGES</th><th>CONSENSUS</th><th>EDGE</th><th>STATUS</th></tr></thead><tbody>{(data?.signals??[]).slice(0,20).map(m=><tr key={m.symbol}><td><b>{m.symbol.replace('USDT','/USDT')}</b></td><td><Score n={m.score}/></td><td>{m.buyPressurePct==null?'—':m.buyPressurePct.toFixed(1)+'%'}</td><td>{m.activeExchangeCount??m.exchangeCount}/10</td><td>{(m.buyConsensus*100).toFixed(0)}%</td><td>{m.opportunity?.estimatedNetCrossExchangeEdgePct==null?'—':m.opportunity.estimatedNetCrossExchangeEdgePct.toFixed(3)+'%'}</td><td><label className={'tag '+(m.signal==='WATCH'?'good':'')}>{m.signal}</label></td></tr>)}</tbody></Table></>;
 }
 if(tab==='Trades'){
  return <><div className="notice"><ListFilter size={17}/><div><b>Paper trades.</b> No real orders are enabled.</div></div><Table title="PAPER TRADES" subtitle="Execution log" action={(data?.trades?.length??0)+" trades"}><thead><tr><th>TIME</th><th>PAIR</th><th>EXCHANGE</th><th>ENTRY</th><th>EXIT</th><th>NET P&L</th><th>REASON</th></tr></thead><tbody>{(data?.trades??[]).slice(0,50).map(t=><tr key={t.id}><td>{new Date(t.closedAt).toLocaleTimeString()}</td><td><b>{t.symbol}</b></td><td>{t.exchange}</td><td>{Number(t.entryPrice).toFixed(4)}</td><td>{Number(t.exitPrice).toFixed(4)}</td><td>{Number(t.netPnl).toFixed(2)}</td><td>{t.reason}</td></tr>)}</tbody></Table></>;
 }
 if(tab==='Performance'){
  const trades=data?.trades??[];
  const wins=trades.filter(t=>t.netPnl>0).length;
  const pf=(()=>{const gp=trades.filter(t=>t.netPnl>0).reduce((s,t)=>s+t.netPnl,0);const gl=Math.abs(trades.filter(t=>t.netPnl<0).reduce((s,t)=>s+t.netPnl,0));return gl?gp/gl:null})();
  const a=wf?.result?.aggregate;
  const signalStats=data?.signalStats||{};
  const maxDd=Number(data?.maxDrawdownPct||0);
  const conversion=signalStats.actionable?((signalStats.entries/signalStats.actionable)*100):0;
  return <><div className="stats"><Stat icon={Wallet} label="Equity" value={(data?.equity??1000).toFixed(2)+' TL'} detail="Paper"/><Stat icon={TrendingUp} label="Return" value={(data?.returnPct??0).toFixed(2)+'%'} detail="Since start"/><Stat icon={Target} label="Win Rate" value={trades.length?((wins/trades.length)*100).toFixed(1)+'%':'—'} detail={trades.length+' closed trades'}/><Stat icon={Gauge} label="Profit Factor" value={pf==null?'—':pf.toFixed(2)} detail="Net after modeled costs"/><Stat icon={ShieldCheck} label="Max Drawdown" value={maxDd.toFixed(2)+'%'} detail="Peak-to-equity"/></div>
  <section className="card">
   <div className="head"><div><small>PAPER EXECUTION QUALITY</small><h2>Live Performance</h2></div><span className="tag">PAPER</span></div>
   <div className="stats">
    <Stat icon={Activity} label="Actionable Signals" value={signalStats.actionable??0} detail="Observed since restart"/>
    <Stat icon={Target} label="Signal → Entry" value={conversion.toFixed(1)+'%'} detail={(signalStats.entries??0)+' entries'}/>
    <Stat icon={ShieldCheck} label="Rejected" value={signalStats.rejected??0} detail="Risk / cooldown / duplicate"/>
    <Stat icon={TrendingUp} label="Equity Samples" value={data?.equityHistory?.length??0} detail="Recent history"/>
   </div>
  </section>
  <section className="card">
   <div className="head"><div><small>HISTORICAL VALIDATION</small><h2>Walk-Forward Test</h2></div><button className="linkBtn" onClick={runValidation} disabled={wfLoading}>{wfLoading?'Running…':'Run validation'}</button></div>
   <p className="muted">7-day training → 1-day unseen test. Parameters are selected only from the training window; test results are out-of-sample.</p>
   {wf?.error&&<div className="notice"><RefreshCw size={17}/><div><b>Validation:</b> {wf.error}</div></div>}
   {a&&<div className="stats"><Stat icon={BarChart3} label="Test Windows" value={a.windows} detail={a.skippedWindows+' skipped'}/><Stat icon={TrendingUp} label="Positive Windows" value={(a.positiveWindowRate*100).toFixed(1)+'%'} detail={a.positiveWindows+' windows'}/><Stat icon={Target} label="Avg OOS Return" value={a.averageOutOfSampleReturnPct.toFixed(2)+'%'} detail="Per test window"/><Stat icon={Wallet} label="OOS P&L" value={a.totalOutOfSamplePnl.toFixed(2)+' TL'} detail="Aggregate"/></div>}
   {wf?.result?.windows?.length>0&&<Table title="OUT-OF-SAMPLE WINDOWS" subtitle="Walk-forward" action={wf.result.candidates+' parameter sets'}><thead><tr><th>TEST</th><th>SELECTED</th><th>TRAIN RETURN</th><th>OOS RETURN</th><th>OOS TRADES</th><th>OOS PF</th><th>DRAWDOWN</th></tr></thead><tbody>{wf.result.windows.filter(w=>w.outOfSample).map((w,i)=><tr key={i}><td>{new Date(w.testStart).toLocaleDateString()}</td><td>{w.selected?'S'+w.selected.entryScore+' / TP '+(w.selected.tpPct*100).toFixed(1)+' / SL '+(w.selected.slPct*100).toFixed(1):'—'}</td><td>{w.inSample.returnPct.toFixed(2)}%</td><td>{w.outOfSample.returnPct.toFixed(2)}%</td><td>{w.outOfSample.trades}</td><td>{w.outOfSample.profitFactor==null?'—':w.outOfSample.profitFactor.toFixed(2)}</td><td>{w.outOfSample.maxDrawdownPct.toFixed(2)}%</td></tr>)}</tbody></Table>}
  </section></>;
 }
 if(tab==='Risk'){
  const h=data||{};
  return <><div className="stats">
   <Stat icon={ShieldCheck} label="Open Positions" value={(h.paper?.openPositions??0)+' / '+(h.paper?.maxOpenPositions??2)} detail="Paper risk limit"/>
   <Stat icon={Activity} label="Feed Coverage" value={(h.feedCoveragePct??0).toFixed(1)+'%'} detail={(h.totalActiveFeeds??0)+' / '+(h.totalExpectedFeeds??0)+' active feeds'}/>
   <Stat icon={Signal} label="Market Coverage" value={(h.marketCoveragePct??0).toFixed(1)+'%'} detail={(h.marketsWith3PlusExchanges??0)+' / '+(h.marketsTracked??0)+' markets'}/>
   <Stat icon={BarChart3} label="Live Exchanges" value={(h.liveExchanges??0)+' / 10'} detail={(h.healthyExchanges??0)+' with ≥80% coverage'}/>
  </div>
  <section className="card tableCard"><div className="head"><div><small>DATA QUALITY</small><h2>Exchange Feed Health</h2></div><span className="tag good">LIVE</span></div>
   <div className="tableWrap"><table><thead><tr><th>EXCHANGE</th><th>STATUS</th><th>ACTIVE</th><th>EXPECTED</th><th>COVERAGE</th><th>LAST UPDATE</th></tr></thead><tbody>{Object.entries(h.exchanges||{}).map(([name,x])=><tr key={name}><td><b>{name.toUpperCase()}</b></td><td><label className={'tag '+(x.status==='live'&&x.coveragePct>=80?'good':'')}>{x.status}</label></td><td>{x.activeFeeds}</td><td>{x.expectedFeeds}</td><td>{Number(x.coveragePct||0).toFixed(1)}%</td><td>{x.lastUpdateAt?new Date(x.lastUpdateAt).toLocaleTimeString():'—'}</td></tr>)}</tbody></table></div>
  </section>
  <section className="card empty"><ShieldCheck size={24}/><h2>Risk engine + data health</h2><p>Position sizing and loss controls remain paper-only. Feed coverage is shown separately so backtests and signals are not trusted blindly when market data is incomplete.</p></section></>;
 }
 return <><div className="notice"><Settings size={17}/><div><b>System settings.</b> Current paper parameters are intentionally conservative and are not validated trading rules.</div></div><div className="card empty"><Settings size={24}/><h2>Settings module</h2><p>Current defaults: 1,000 TL paper balance, 15% position size, max 2 positions, +2% TP, -0.8% SL.</p></div></>;
}

function DashboardContent({market,scanner=[],score,connected,error,paper}){
 const buy=market?.buyPressurePct;
 const total=market?.flowVolume;
 const status=score>=82?'WATCH':score>=70?'MONITOR':'WAIT';
 const statusClass=score>=82?'good':'mutedTag';
 return <>
  <div className="notice"><Activity size={17}/><div><b>Paper trading only.</b> Public market data is connected; no exchange account or real order capability is enabled.</div></div>
  {error&&<div className="notice"><RefreshCw size={17}/><div><b>Market API:</b> {error}. Start the backend service to restore live data.</div></div>}
  <div className="stats">
   <Stat icon={Wallet} label="Paper Equity" value={(paper?.equity??1000).toFixed(2)+" TL"} detail={(paper?.returnPct??0).toFixed(2)+"% since start"}/>
   <Stat icon={TrendingUp} label="BTC Price" value={fmtPrice(market?.last)} detail={market?.lastTradeAt?new Date(market.lastTradeAt).toLocaleTimeString(): 'Waiting for stream'}/>
   <Stat icon={Gauge} label="Buy Pressure" value={buy==null?'—':buy.toFixed(1)+'%'} detail={total==null?'No trades yet':total.toFixed(4)+' BTC flow'}/>
   <Stat icon={Signal} label="Signal Score" value={score+' / 100'} detail="Current leader"/>
   <Stat icon={ShieldCheck} label="Spread" value={fmtPct(market?.spreadPct)} detail={connected?'Live bookTicker':'Disconnected'}/><Stat icon={Activity} label="Exchange Coverage" value={exchangeCount(market)+' / 10'} detail="Cross-exchange feeds"/>
  </div>
  <div className="two">
   <section className="card chartCard">
    <div className="head"><div><small>LIVE MARKET</small><h2>BTC/USDT</h2></div><span className={connected?'tag good':'tag'}>{connected?'LIVE':'OFFLINE'}</span></div>
    <div className="marketGrid">
      <div><small>LAST</small><strong>{fmtPrice(market?.last)}</strong></div>
      <div><small>BID</small><strong>{fmtPrice(market?.bid)}</strong></div>
      <div><small>ASK</small><strong>{fmtPrice(market?.ask)}</strong></div>
      <div><small>TRADES</small><strong>{market?.trades??0}</strong></div>
    </div>
    <div className="flow"><span>Sell flow</span><div><i style={{width:(100-(buy??50))+'%'}}/><b>{buy==null?'—':(100-buy).toFixed(1)+'%'}</b></div><span>Buy flow</span></div>
   </section>
   <section className="card risk"><div className="head"><div><small>SIGNAL</small><h2>Current Decision</h2></div><Signal size={18}/></div><div className="decision"><Score n={score}/><div><b>{status}</b><span>{market?.signal||'WAIT'} · score is informational only</span></div></div><Row a="Buy pressure" b={buy==null?'—':buy.toFixed(1)+'%'} p={(buy??0)+'%'}/><Row a="Book imbalance" b={market?.weightedImbalancePct==null?'—':market.weightedImbalancePct.toFixed(1)+'%'} p={Math.min(100,Math.abs(market?.weightedImbalancePct??0)*2.5)+'%'}/><Row a="Volume anomaly" b={market?.volumeAnomaly==null?'—':market.volumeAnomaly.toFixed(2)+'x'} p={Math.min(100,(market?.volumeAnomaly??0)*25)+'%'}/><Row a="1m momentum" b={fmtPct(market?.momentumPct1m)} p={Math.min(100,Math.abs(market?.momentumPct1m??0)*100)+'%'}/><Row a="Spread" b={fmtPct(market?.spreadPct)} p={Math.min(100,((market?.spreadPct??0)/0.1)*100)+'%'}/><footer>● {connected?'Market stream healthy':'Waiting for market stream'}</footer></section>
  </div>
  <Table title="LIVE SIGNALS" subtitle="Top 100 market-cap scanner" action="Top 100 market cap"><thead><tr><th>PAIR</th><th>SCORE</th><th>BUY PRESSURE</th><th>24H QUOTE VOL</th><th>EXCHANGES</th><th>IMBALANCE</th><th>SPREAD</th><th>STATUS</th></tr></thead><tbody>{scanner.slice(0,10).map(m=>{const s=m.score??0;return <tr key={m.symbol}><td><b>{m.symbol.replace('USDT','/USDT')}</b></td><td><Score n={s}/></td><td>{m.buyPressurePct==null?'—':m.buyPressurePct.toFixed(1)+'%'}</td><td>{m.quoteVolume24h>=1e9?(m.quoteVolume24h/1e9).toFixed(2)+'B':(m.quoteVolume24h/1e6).toFixed(1)+'M'}</td><td>{exchangeCount(m)}/10</td><td>{m.imbalancePct==null?'—':m.imbalancePct.toFixed(1)+'%'}</td><td>{fmtPct(m.spreadPct)}</td><td><label className={'tag '+(s>=82?'good':'')}>{m.signal}</label></td></tr>})}</tbody></Table>
  <Table title="RECENT ACTIVITY" subtitle="Paper Trades" action={(paper?.trades?.length??0)+" trades"}><thead><tr><th>TIME</th><th>PAIR</th><th>SIDE</th><th>ENTRY</th><th>SIZE</th><th>SCORE</th><th>NET P&L</th></tr></thead><tbody>{(paper?.trades?.slice(0,10)??trades).map(t=>{const row=Array.isArray(t)?t:[new Date(t.closedAt).toLocaleTimeString(),t.symbol,t.side,t.entryPrice,t.quantity,t.score,t.netPnl];return <tr key={Array.isArray(t)?t[0]:t.id}><td className="muted">{row[0]}</td><td><b>{row[1]}</b></td><td className="muted">{row[2]}</td><td>{row[3]}</td><td>{row[4]}</td><td><Score n={row[5]}/></td><td className="muted">{row[6]}</td></tr>})}</tbody></Table>
 </>
}

function Row({a,b,p}){return <div className="riskRow"><span>{a}</span><b>{b}</b><div className="bar"><i style={{width:p}}/></div></div>}
function Table({title,subtitle,action,children}){return <section className="card tableCard"><div className="head"><div><small>{subtitle}</small><h2>{title}</h2></div><button className="linkBtn">{action}</button></div><div className="tableWrap"><table>{children}</table></div></section>}
