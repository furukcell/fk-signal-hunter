import {useState} from 'react';
import {Activity,BarChart3,Bot,Gauge,LayoutDashboard,ListFilter,Menu,Settings,ShieldCheck,Signal,Target,TrendingUp,Wallet,X} from 'lucide-react';

const signals=[['BTC/USDT',87,'71%','6.4x','0.01%','WATCH'],['ETH/USDT',82,'66%','4.9x','0.02%','WATCH'],['SOL/USDT',76,'59%','3.8x','0.03%','WAIT'],['XRP/USDT',68,'54%','2.7x','0.04%','WAIT']];
const trades=[['14:42:18','BTC/USDT','BUY','104,250','150 USDT',89,'+2.41'],['13:18:04','ETH/USDT','SELL','3,982','120 USDT',84,'+1.12'],['11:56:31','SOL/USDT','SELL','188.42','100 USDT',78,'-0.63']];
const nav=[['Dashboard',LayoutDashboard],['Signals',Signal],['Trades',ListFilter],['Performance',BarChart3],['Risk',ShieldCheck],['Settings',Settings]];

function Stat({icon:Icon,label,value,detail}){return <div className="card stat"><div className="statIcon"><Icon size={17}/></div><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>}
function Score({n}){return <span className={'score '+(n>=85?'high':n>=75?'mid':'low')}>{n}</span>}

export default function App(){
 const [open,setOpen]=useState(false); const [tab,setTab]=useState('Dashboard');
 return <div className="app">
  <aside className={open?'side open':'side'}>
   <div className="brand"><div className="mark"><Target size={18}/></div><div><b>FK SIGNAL HUNTER</b><span>Market Intelligence</span></div><button className="close" onClick={()=>setOpen(false)}><X size={18}/></button></div>
   <nav>{nav.map(([name,Icon])=><button className={tab===name?'active':''} key={name} onClick={()=>{setTab(name);setOpen(false)}}><Icon size={17}/><span>{name}</span></button>)}</nav>
   <div className="bottom"><div className="paper"><i/> <div><b>PAPER MODE</b><span>Real money disabled</span></div></div><div className="engine"><Bot size={16}/> Engine <b>ONLINE</b></div></div>
  </aside>
  <main>
   <header><button className="menu" onClick={()=>setOpen(true)}><Menu size={20}/></button><div><small>PERSONAL TRADING SYSTEM</small><h1>{tab}</h1></div><div className="actions"><span className="market"><i/> Market data disconnected</span><button className="start"><Bot size={15}/> Start Bot</button></div></header>
   <section className="content">
    {tab==='Dashboard' ? <DashboardContent/> : <ModuleView tab={tab}/>} 
   </section>
  </main>
 </div>
}
function ModuleView({tab}){const data={Signals:['Live signal radar','Signal score, buy pressure, volume, spread and signal reasons.'],Trades:['Paper trade history','Entries, exits, fees, slippage and net P&L.'],Performance:['Performance analytics','Equity curve, expectancy, profit factor and drawdown.'],Risk:['Risk controls','Position sizing, daily loss, spread and exposure limits.'],Settings:['System settings','Signal threshold, TP/SL, position size, fee profile and bot controls.']}[tab];return <><div className="notice"><Activity size={17}/><div><b>{data[0]}</b> {data[1]}</div></div><div className="card empty"><Target size={24}/><h2>{tab} module ready</h2><p>This screen is API-ready. The data layer will be connected after the dashboard foundation.</p></div></>}
function DashboardContent(){return <>

    <div className="notice"><Activity size={17}/><div><b>Paper trading is active.</b> Exchange APIs are not connected yet. No real orders can be placed.</div></div>
    <div className="stats">
     <Stat icon={Wallet} label="Paper Balance" value="1,000.00 TL" detail="+0.00% today"/>
     <Stat icon={TrendingUp} label="Today's P&L" value="+18.42 TL" detail="+1.84%"/>
     <Stat icon={Gauge} label="Open Positions" value="1" detail="Max 2"/>
     <Stat icon={Signal} label="Signal Score" value="87 / 100" detail="BTC/USDT"/>
     <Stat icon={ShieldCheck} label="Net Cost" value="0.00%" detail="Mock fee profile"/>
    </div>
    <div className="two">
     <section className="card chartCard"><div className="head"><div><small>EQUITY CURVE</small><h2>Paper Portfolio</h2></div><select><option>7 days</option><option>30 days</option></select></div><div className="chart"><svg viewBox="0 0 700 250" preserveAspectRatio="none"><path d="M0 215 C80 210 100 174 155 185 S230 137 280 151 S350 128 400 141 S470 89 520 108 S610 61 700 72 L700 250 L0 250Z"/><path className="line" d="M0 215 C80 210 100 174 155 185 S230 137 280 151 S350 128 400 141 S470 89 520 108 S610 61 700 72"/></svg><div><span>Sep 24</span><span>Sep 27</span><span>Sep 30</span></div></div></section>
     <section className="card risk"><div className="head"><div><small>RISK</small><h2>Session Health</h2></div><ShieldCheck size={18}/></div><Row a="Daily loss limit" b="0.00% / 1.50%" p="3%"/><Row a="Open positions" b="1 / 2" p="50%"/><Row a="Max spread" b="0.04% / 0.10%" p="40%"/><footer>● Risk engine ready</footer></section>
    </div>
    <Table title="LIVE SIGNALS" subtitle="Market Radar" action="View all signals →"><thead><tr><th>PAIR</th><th>SCORE</th><th>BUY PRESSURE</th><th>VOLUME</th><th>SPREAD</th><th>STATUS</th></tr></thead><tbody>{signals.map(s=><tr key={s[0]}><td><b>{s[0]}</b></td><td><Score n={s[1]}/></td><td>{s[2]}</td><td>{s[3]}</td><td>{s[4]}</td><td><label className="tag">{s[5]}</label></td></tr>)}</tbody></Table>
    <Table title="RECENT ACTIVITY" subtitle="Paper Trades" action="Trade history →"><thead><tr><th>TIME</th><th>PAIR</th><th>SIDE</th><th>ENTRY</th><th>SIZE</th><th>SCORE</th><th>NET P&L</th></tr></thead><tbody>{trades.map(t=><tr key={t[0]}><td className="muted">{t[0]}</td><td><b>{t[1]}</b></td><td className={t[2]==='BUY'?'buy':'sell'}>{t[2]}</td><td>{t[3]}</td><td>{t[4]}</td><td><Score n={t[5]}/></td><td className={t[6][0]==='+'?'positive':'negative'}>{t[6]} USDT</td></tr>)}</tbody></Table>

</>}
function Row