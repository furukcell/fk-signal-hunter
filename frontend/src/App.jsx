import {useEffect,useMemo,useState} from 'react';
import {Activity,BarChart3,Bot,Gauge,LayoutDashboard,ListFilter,Menu,RefreshCw,Settings,ShieldCheck,Signal,Target,TrendingUp,Wallet,X} from 'lucide-react';

const trades=[['--:--:--','BTC/USDT','PAPER','—','—',0,'—']];
const nav=[['Dashboard',LayoutDashboard],['Signals',Signal],['Trades',ListFilter],['Performance',BarChart3],['Risk',ShieldCheck],['Settings',Settings]];

function Stat({icon:Icon,label,value,detail}){return <div className="card stat"><div className="statIcon"><Icon size={17}/></div><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>}
function Score({n}){return <span className={'score '+(n>=85?'high':n>=75?'mid':'low')}>{n}</span>}
function fmtPrice(n){return n==null?'—':Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtPct(n){return n==null?'—':n.toFixed(3)+'%'}
function signalScore(market){ return market?.score ?? 0; }

export default function App(){
 const [open,setOpen]=useState(false);
 const [tab,setTab]=useState('Dashboard');
 const [market,setMarket]=useState(null);
 const [scanner,setScanner]=useState([]);
 const [error,setError]=useState(null);

 useEffect(()=>{
  let alive=true;
  const load=async()=>{
   try{
    const res=await fetch('/api/market/scanner');
    if(!res.ok)throw new Error('Market scanner unavailable');
    const data=await res.json();
    const btc=data.markets?.find(m=>m.symbol==='BTCUSDT') ?? data.markets?.[0] ?? null;
    if(alive){setScanner(data.markets ?? []);setMarket(btc);setError(null);}
   }catch(err){if(alive)setError(err.message);}
  };
  load();
  const id=setInterval(load,1000);
  return()=>{alive=false;clearInterval(id)};
 },[]);

 const score=useMemo(()=>signalScore(market),[market]);
 const connected=Boolean(market?.connected);

 return <div className="app">
  <aside className={open?'side open':'side'}>
   <div className="brand"><div className="mark"><Target size={18}/></div><div><b>FK SIGNAL HUNTER</b><span>Market Intelligence</span></div><button className="close" onClick={()=>setOpen(false)}><X size={18}/></button></div>
   <nav>{nav.map(([name,Icon])=><button className={tab===name?'active':''} key={name} onClick={()=>{setTab(name);setOpen(false)}}><Icon size={17}/><span>{name}</span></button>)}</nav>
   <div className="bottom"><div className="paper"><i/> <div><b>PAPER MODE</b><span>Real money disabled</span></div></div><div className="engine"><Bot size={16}/> Engine <b>ONLINE</b></div></div>
  </aside>
  <main>
   <header><button className="menu" onClick={()=>setOpen(true)}><Menu size={20}/></button><div><small>PERSONAL TRADING SYSTEM</small><h1>{tab}</h1></div><div className="actions"><span className="market"><i className={connected?'live':''}/> {connected?'Market data connected':'Market data disconnected'}</span><button className="start" disabled><Bot size={15}/> Start Bot</button></div></header>
   <section className="content">{tab==='Dashboard'?<DashboardContent market={market} scanner={scanner} score={score} connected={connected} error={error}/>:<ModuleView tab={tab}/>}</section>
  </main>
 </div>
}

function ModuleView({tab}){
 const data={Signals:['Live signal radar','Signal score, buy pressure, volume, spread and signal reasons.'],Trades:['Paper trade history','Entries, exits, fees, slippage and net P&L.'],Performance:['Performance analytics','Equity curve, expectancy, profit factor and drawdown.'],Risk:['Risk controls','Position sizing, daily loss, spread and exposure limits.'],Settings:['System settings','Signal threshold, TP/SL, position size, fee profile and bot controls.']}[tab];
 return <><div className="notice"><Activity size={17}/><div><b>{data[0]}</b> {data[1]}</div></div><div className="card empty"><Target size={24}/><h2>{tab} module ready</h2><p>The module shell is ready. Its data layer will be connected after the market-data foundation.</p></div></>
}

function DashboardContent({market,scanner=[],score,connected,error}){
 const buy=market?.buyPressurePct;
 const total=market?.flowVolume;
 const status=score>=82?'WATCH':score>=70?'MONITOR':'WAIT';
 const statusClass=score>=82?'good':'mutedTag';
 return <>
  <div className="notice"><Activity size={17}/><div><b>Paper trading only.</b> Public market data is connected; no exchange account or real order capability is enabled.</div></div>
  {error&&<div className="notice"><RefreshCw size={17}/><div><b>Market API:</b> {error}. Start the backend service to restore live data.</div></div>}
  <div className="stats">
   <Stat icon={Wallet} label="Paper Balance" value="1,000.00 TL" detail="Real money disabled"/>
   <Stat icon={TrendingUp} label="BTC Price" value={fmtPrice(market?.last)} detail={market?.lastTradeAt?new Date(market.lastTradeAt).toLocaleTimeString(): 'Waiting for stream'}/>
   <Stat icon={Gauge} label="Buy Pressure" value={buy==null?'—':buy.toFixed(1)+'%'} detail={total==null?'No trades yet':total.toFixed(4)+' BTC flow'}/>
   <Stat icon={Signal} label="Signal Score" value={score+' / 100'} detail="Current leader"/>
   <Stat icon={ShieldCheck} label="Spread" value={fmtPct(market?.spreadPct)} detail={connected?'Live bookTicker':'Disconnected'}/>
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
   <section className="card risk"><div className="head"><div><small>SIGNAL</small><h2>Current Decision</h2></div><Signal size={18}/></div><div className="decision"><Score n={score}/><div><b>{status}</b><span>Initial rule set · score is informational only</span></div></div><Row a="Buy pressure" b={buy==null?'—':buy.toFixed(1)+'%'} p={(buy??0)+'%'}/><Row a="Book imbalance" b={market?.imbalancePct==null?'—':market.imbalancePct.toFixed(1)+'%'} p={Math.min(100,Math.abs(market?.imbalancePct??0)*2.5)+'%'}/><Row a="Spread" b={fmtPct(market?.spreadPct)} p={Math.min(100,((market?.spreadPct??0)/0.1)*100)+'%'}/><footer>● {connected?'Market stream healthy':'Waiting for market stream'}</footer></section>
  </div>
  <Table title="LIVE SIGNALS" subtitle="Top 100 market-cap scanner" action="Top 100 market cap"><thead><tr><th>PAIR</th><th>SCORE</th><th>BUY PRESSURE</th><th>24H QUOTE VOL</th><th>IMBALANCE</th><th>SPREAD</th><th>STATUS</th></tr></thead><tbody>{scanner.slice(0,10).map(m=>{const s=m.score??0;return <tr key={m.symbol}><td><b>{m.symbol.replace('USDT','/USDT')}</b></td><td><Score n={s}/></td><td>{m.buyPressurePct==null?'—':m.buyPressurePct.toFixed(1)+'%'}</td><td>{m.quoteVolume24h>=1e9?(m.quoteVolume24h/1e9).toFixed(2)+'B':(m.quoteVolume24h/1e6).toFixed(1)+'M'}</td><td>{m.imbalancePct==null?'—':m.imbalancePct.toFixed(1)+'%'}</td><td>{fmtPct(m.spreadPct)}</td><td><label className={'tag '+(s>=82?'good':'')}>{m.signal}</label></td></tr>})}</tbody></Table>
  <Table title="RECENT ACTIVITY" subtitle="Paper Trades" action="No live orders"><thead><tr><th>TIME</th><th>PAIR</th><th>SIDE</th><th>ENTRY</th><th>SIZE</th><th>SCORE</th><th>NET P&L</th></tr></thead><tbody>{trades.map(t=><tr key={t[0]}><td className="muted">{t[0]}</td><td><b>{t[1]}</b></td><td className="muted">{t[2]}</td><td>{t[3]}</td><td>{t[4]}</td><td><Score n={t[5]}/></td><td className="muted">{t[6]}</td></tr>)}</tbody></Table>
 </>
}

function Row({a,b,p}){return <div className="riskRow"><span>{a}</span><b>{b}</b><div className="bar"><i style={{width:p}}/></div></div>}
function Table({title,subtitle,action,children}){return <section className="card tableCard"><div className="head"><div><small>{subtitle}</small><h2>{title}</h2></div><button className="linkBtn">{action}</button></div><div className="tableWrap"><table>{children}</table></div></section>}
