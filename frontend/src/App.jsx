// FK Sinyal Hunter 24-hour market board - deployed
import {useEffect,useMemo,useState} from "react";
import {Activity,BarChart3,Bot,Gauge,LayoutAna Sayfa,ListFilter,Menu,RefreshCw,Ayarlar as AyarlarIcon,ShieldCheck,Sinyal,Target,TrendingUp,Wallet,X} from "lucide-react";

const nav=[
  ["Ana Sayfa",LayoutAna Sayfa],
  ["24 Saatlik Tarama",TrendingUp],
  ["Sinyaller",Sinyal],
  ["İşlem Geçmişi",ListFilter],
  ["Performans",BarChart3],
  ["Skor Motoru",Gauge],
  ["Risk",ShieldCheck],
  ["Ayarlar",AyarlarIcon]
];

const SNAPSHOT_URL="https://firestore.googleapis.com/v1/projects/fk-signal-hunter/databases/(default)/documents/public/latest";
const HISTORY_URL="https://firestore.googleapis.com/v1/projects/fk-signal-hunter/databases/(default)/documents:runQuery";

async function fetchTarama(){
  const res=await fetch(SNAPSHOT_URL,{cache:"no-store"});
  if(!res.ok) throw new Error("Veri alınamadı");
  const doc=await res.json();
  const raw=doc?.fields?.payload?.stringValue;
  if(!raw) throw new Error("Veri içeriği bulunamadı");
  return JSON.parse(raw);
}

async function fetchSimülasyonİşlemler(){
  const body={
    structuredQuery:{
      from:[{collectionId:"paperİşlemler"}],
      orderBy:[{field:{fieldPath:"kapananAt"},direction:"DESCENDING"}],
      limit:1000
    }
  };
  const res=await fetch(HISTORY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
  if(!res.ok) throw new Error("İşlem geçmişi alınamadı");
  const rows=await res.json();
  return (rows||[]).map(row=>row?.document?.fields).filter(Boolean).map(fields=>Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,firestoreValue(v)])));
}

function firestoreValue(v){
  if(v==null)return null;
  if(v.stringValue!==undefined)return v.stringValue;
  if(v.integerValue!==undefined)return Number(v.integerValue);
  if(v.doubleValue!==undefined)return Number(v.doubleValue);
  if(v.booleanValue!==undefined)return v.booleanValue;
  if(v.timestampValue!==undefined)return v.timestampValue;
  if(v.mapValue!==undefined)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,firestoreValue(x)]));
  if(v.arrayValue!==undefined)return (v.arrayValue.values||[]).map(firestoreValue);
  return null;
}

async function fetchHistory24h(){
  const since=new Date(Date.now()-24*60*60*1000).toISOString();
  const body={
    structuredQuery:{
      from:[{collectionId:"historicalTaramas"}],
      where:{
        fieldFilter:{
          field:{fieldPath:"generatedAt"},
          op:"GREATER_THAN_OR_EQUAL",
          value:{timestampValue:since}
        }
      },
      orderBy:[{field:{fieldPath:"generatedAt"},direction:"ASCENDING"}],
      limit:300
    }
  };
  const res=await fetch(HISTORY_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body),
    cache:"no-store"
  });
  if(!res.ok) throw new Error("24 saatlik geçmiş verisi alınamadı");
  const rows=await res.json();
  return (rows||[])
    .map(row=>row?.document?.fields?.payload?.stringValue)
    .filter(Boolean)
    .map(raw=>JSON.parse(raw));
}

function Stat({icon:Icon,label,value,detail}){
  return <div className="card stat"><div className="statIcon"><Icon size={17}/></div><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}
function Skor({n}){const x=Number(n||0);return <span className={"score "+(x>=82?"high":x>=70?"mid":"low")}>{x}</span>;}
function pct(n,d=1){return n==null?"—":Number(n).toFixed(d)+"%";}
function price(n){return n==null?"—":Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4});}
function fmtDate(ts){return ts?new Date(ts).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";}

function money(n,d=2){return Number(n||0).toLocaleString("tr-TR",{minimumFractionDigits:d,maximumFractionDigits:d})+" TL";}
function fmtMinutes(n){return n==null?"—":Number(n)<60?Number(n).toFixed(0)+" dk":(Number(n)/60).toFixed(1)+" sa";}

function marketCount(m){return m?.activeExchangeCount??m?.exchangeCount??0;}

export default function App(){
  const [açık,setOpen]=useState(false);
  const [tab,setTab]=useState("Ana Sayfa");
  const [data,setData]=useState(null);
  const [market,setMarket]=useState(null);
  const [history,setHistory]=useState([]);
  const [paperİşlemler,setSimülasyonİşlemler]=useState([]);
  const [paperİşlemlerError,setSimülasyonİşlemlerError]=useState(null);
  const [historyError,setHistoryError]=useState(null);
  const [error,setError]=useState(null);

  useEffect(()=>{
    let alive=true;
    const load=async()=>{
      try{
        const d=await fetchTarama();
        const preferred=market?.symbol;
        const next=d.markets?.find(x=>x.symbol===preferred)??d.markets?.[0]??null;
        if(alive){setData(d);setMarket(next);setError(null);}
      }catch(e){if(alive)setError(e.message);}
    };
    load();
    const id=setInterval(load,60000);
    return()=>{alive=false;clearInterval(id)};
  },[market?.symbol]);

  useEffect(()=>{
    let alive=true;
    const loadSimülasyonİşlemler=async()=>{
      try{
        const rows=await fetchSimülasyonİşlemler();
        if(alive){setSimülasyonİşlemler(rows);setSimülasyonİşlemlerError(null);}
      }catch(e){if(alive)setSimülasyonİşlemlerError(e.message);}
    };
    loadSimülasyonİşlemler();
    const id=setInterval(loadSimülasyonİşlemler,300000);
    return()=>{alive=false;clearInterval(id)};
  },[]);

  useEffect(()=>{
    let alive=true;
    const loadHistory=async()=>{
      try{
        const rows=await fetchHistory24h();
        if(alive){setHistory(rows);setHistoryError(null);}
      }catch(e){if(alive)setHistoryError(e.message);}
    };
    loadHistory();
    const id=setInterval(loadHistory,300000);
    return()=>{alive=false;clearInterval(id)};
  },[]);

  const markets=data?.markets??[];
  const analytics=data?.analytics24h;
  const connected=Number(data?.health?.exchangesWithData||0)>0;

  const selectMarket=s=>setMarket(markets.find(m=>m.symbol===s)||market);

  return <div className="app">
    <aside className={açık?"side açık":"side"}>
      <div className="brand"><div className="mark"><Target size={18}/></div><div><b>FK SIGNAL HUNTER</b><span>Piyasa İstihbaratı</span></div><button className="close" onClick={()=>setOpen(false)}><X size={18}/></button></div>
      <nav>{nav.map(([name,Icon])=><button className={tab===name?"active":""} key={name} onClick={()=>{setTab(name);setOpen(false)}}><Icon size={17}/><span>{name}</span></button>)}</nav>
      <div className="bottom"><div className="paper"><i/> <div><b>SİMÜLASYON MODU</b><span>Gerçek para devre dışı</span></div></div><div className="engine"><Bot size={16}/> Motor <b>AKTİF</b></div></div>
    </aside>
    <main>
      <header><button className="menu" onClick={()=>setOpen(true)}><Menu size={20}/></button><div><small>KİŞİSEL PİYASA SİSTEMİ</small><h1>{tab}</h1></div><div className="actions"><span className="market"><i className={connected?"live":""}/> {connected?"5 dakikalık veri aktif":"Veri bağlantısı yok"}</span><button className="start" disabled><Bot size={15}/> Botu Başlat</button></div></header>
      <section className="content">
        {error&&<div className="notice"><RefreshCw size={17}/><div><b>Piyasa verisi:</b> {error}</div></div>}
        {tab==="Ana Sayfa"&&<Ana Sayfa data={data} market={market} selectMarket={selectMarket} paperİşlemler={paperİşlemler}/>}
        {tab==="24 Saatlik Tarama"&&<Tarama analytics={analytics} markets={markets} history={history} historyError={historyError} selectMarket={selectMarket}/>}
        {tab==="Sinyaller"&&<Sinyaller data={data} analytics={analytics}/>}
        {tab==="İşlem Geçmişi"&&<İşlemler paper={data?.paper} paperİşlemler={paperİşlemler} paperİşlemlerError={paperİşlemlerError}/>}
        {tab==="Performans"&&<Performans paper={data?.paper} paperİşlemler={paperİşlemler}/>}
        {tab==="Skor Motoru"&&<SkorEngine/>}
        {tab==="Risk"&&<Risk data={data}/>}
        {tab==="Ayarlar"&&<AyarlarPage/>}
      </section>
    </main>
  </div>;
}

function Ana Sayfa({data,market,selectMarket,paperİşlemler}){
  const a=data?.analytics24h,s=a?.summary||{},paper=data?.paper||{},trades=paper.trades||[];
  return <>
    <SimülasyonHeader paper={paper}/>
    <div className="notice"><Wallet size={17}/><div><b>Bu kasa tamamen sanaldır.</b> Bot uygun gördüğü fırsatlarda mevcut kasanın %10'u ile işlem açar. Hedef +%1, zarar kes -%0,8. Gerçek emir gönderilmez.</div></div>
    <div className="stats">
      <Stat icon={Target} label="Bugünkü İşlem" value={paper.todayİşlemler??0} detail="Kapanan işlemler"/>
      <Stat icon={TrendingUp} label="Bugünkü K/Z" value={money(paper.todayPnl)} detail="Gerçekleşmiş"/>
      <Stat icon={Gauge} label="Kazanma Oranı" value={paper.winRate==null?"—":pct(paper.winRate,1)} detail={(paper.wins??0)+" kazanç / "+(paper.losses??0)+" zarar"}/>
      <Stat icon={ShieldCheck} label="Maksimum Düşüş" value={pct(paper.maxDrawdownPct)} detail="Kasa bazlı"/>
      <Stat icon={Activity} label="24 Saat Fırsat" value={s.totalOpportunities24h??0} detail="Skor 82+"/>
    </div>
    <div className="two">
      <section className="card chartCard">
        <div className="head"><div><small>KASA GEÇMİŞİ</small><h2>1.000 TL nasıl değişti?</h2></div><span className="tag">5 DK</span></div>
        <EquityChart history={paper.equityHistory||[]} initial={paper.initialBalance||1000}/>
      </section>
      <section className="card">
        <div className="head"><div><small>AÇIK POZİSYONLAR</small><h2>Şu an devam eden işlemler</h2></div><span className="tag">{paper.positions?.length||0} açık</span></div>
        <OpenPositions positions={paper.positions||[]} markets={data?.markets||[]}/>
      </section>
    </div>
    <div className="two">
      <section className="card">
        <div className="head"><div><small>SEÇİLİ COIN</small><h2>{market?.symbol?.replace("USDT","/USDT")||"—"}</h2></div><select value={market?.symbol||""} onChange={e=>selectMarket(e.target.value)}>{(data?.markets||[]).map(m=><option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}</select></div>
        <div className="signalBox"><Skor n={market?.score}/><div><b>{market?.score>=82?"FIRSAT":market?.score>=70?"TAKİP":"BEKLE"}</b><span>{(market?.reasons||[]).join(" · ")||"Henüz yeterli veri yok"}</span></div></div>
        <MiniRow label="Alıcı baskısı" value={pct(market?.buyPressurePct,1)}/>
        <MiniRow label="Emir defteri dengesi" value={pct(market?.weightedImbalancePct,1)}/>
        <MiniRow label="Son 5 dakikalık değişim" value={pct(market?.priceChangePct5m,3)}/>
        <MiniRow label="24 saatlik momentum" value={pct(market?.priceChangePct24h,2)}/>
        <MiniRow label="Alış-satış farkı" value={pct(market?.spreadPct,3)}/>
      </section>
      <section className="card">
        <div className="head"><div><small>SON KAPANAN İŞLEMLER</small><h2>İşlem Geçmişi</h2></div><span className="tag">{paper.totalİşlemler??trades.length} işlem</span></div>
        <TradeRows trades={(paperİşlemler.length?paperİşlemler:trades).slice(0,6)}/>
      </section>
    </div>
  </>;
}

function SimülasyonHeader({paper}){
  return <div className="paperHero card">
    <div><small>TOPLAM SANAL KASA</small><h2>{money(paper.equity??paper.initialBalance??1000)}</h2><span>Başlangıç: {money(paper.initialBalance??1000)}</span></div>
    <div><small>KULLANILABİLİR NAKİT</small><strong>{money(paper.availableCash??paper.balance??1000)}</strong><span>Yeni işlem için hazır</span></div>
    <div><small>GERÇEKLEŞMİŞ K/Z</small><strong className={(paper.realizedPnl||0)>=0?"positive":"negative"}>{money(paper.realizedPnl)}</strong><span>{pct(paper.returnPct)} toplam getiri</span></div>
    <div><small>AÇIK POZİSYON</small><strong>{paper.positions?.length||0}</strong><span>{paper.positions?.length?"İşlem devam ediyor":"Şu an açık işlem yok"}</span></div>
  </div>;
}

function OpenPositions({positions,markets}){
  if(!positions.length)return <div className="emptySmall"><Wallet size={22}/><b>Açık pozisyon yok</b><span>Yeni uygun fırsat geldiğinde %10'luk sanal işlem açılabilir.</span></div>;
  return <div className="positionList">{positions.map(p=>{const m=markets.find(x=>x.symbol===p.symbol),mark=m?.exchangeData?.[p.exchange]?.bid??m?.bid??p.entryPrice,r=((mark-p.entryPrice)/p.entryPrice)*100;return <div className="position" key={p.id}><div><b>{p.symbol.replace("USDT","/USDT")}</b><span>Skor {p.score} · {p.exchange}</span></div><div><b>{money(p.quoteCost)}</b><span className={r>=0?"positive":"negative"}>{pct(r)} açık K/Z</span></div></div>})}</div>;
}

function TradeRows({trades}){
  if(!trades.length)return <div className="emptySmall"><ListFilter size={22}/><b>Henüz kapanan işlem yok</b><span>Bot ilk uygun fırsatı bulduğunda burada görünecek.</span></div>;
  return <div className="tradeList">{trades.map(t=><div className="tradeRow" key={t.id}><div><b>{t.symbol.replace("USDT","/USDT")}</b><span>{fmtDate(t.kapananAt)} · Skor {t.score}</span></div><div><span>{t.reason==="TP_1PCT"?"%1 kâr":"-%0,8 zarar"}</span><span>{fmtMinutes(t.holdingMinutes)}</span></div><strong className={t.netPnl>=0?"positive":"negative"}>{t.netPnl>=0?"+":""}{Number(t.netPnl||0).toFixed(3)} TL</strong></div>)}</div>;
}

function EquityChart({history,initial}){
  const points=history.slice(-120);
  if(points.length<2)return <div className="chartEmpty"><BarChart3 size={24}/><b>Kasa grafiği oluşuyor</b><span>Her 5 dakikalık taramada bir kasa noktası kaydedilecek.</span></div>;
  const w=900,h=240,p=28,vals=points.map(x=>Number(x.equity)||initial),min=Math.min(initial,...vals),max=Math.max(initial,...vals),range=max-min||1;
  const line=vals.map((v,i)=>{const x=p+i/(vals.length-1)*(w-p*2),y=h-p-(v-min)/range*(h-p*2);return (i?"L":"M")+" "+x.toFixed(1)+" "+y.toFixed(1)}).join(" ");
  const initialY=h-p-(initial-min)/range*(h-p*2);
  return <div className="equityChart"><svg viewBox={"0 0 "+w+" "+h}><line x1={p} x2={w-p} y1={initialY} y2={initialY} className="baseline"/><path d={line} className="line"/></svg><div><span>{money(vals[0])}</span><span>Başlangıç: {money(initial)}</span><span>{money(vals[vals.length-1])}</span></div></div>;
}

function MiniRow({label,value}){return <div className="miniRow"><span>{label}</span><b>{value}</b></div>;}

function Tarama({analytics,markets,history,historyError,selectMarket}){
  const rows=useMemo(()=>[...(markets||[])].sort((a,b)=>(b.quoteVolume24h||0)-(a.quoteVolume24h||0)),[markets]);
  const [detailSymbol,setDetailSymbol]=useState(rows[0]?.symbol||"");
  useEffect(()=>{if(!rows.some(x=>x.symbol===detailSymbol))setDetailSymbol(rows[0]?.symbol||"");},[rows,detailSymbol]);

  const selected=rows.find(x=>x.symbol===detailSymbol)||rows[0]||null;
  const snapshots=useMemo(()=>[...(history||[])].sort((a,b)=>new Date(a.generatedAt)-new Date(b.generatedAt)),[history]);
  const selectedHistory=useMemo(()=>snapshots.map(s=>{
    const m=s.markets?.find(x=>x.symbol===detailSymbol);
    return m?{ts:s.generatedAt,last:m.last,score:m.score,buy:m.buyVolume5m,sell:m.sellVolume5m,net:m.netFlow5m,buyPct:m.buyPressure5mPct}:null;
  }).filter(Boolean),[snapshots,detailSymbol]);

  return <>
    <div className="notice"><TrendingUp size={17}/><div><b>24 saatlik piyasa ekranı.</b> Burada ilk 100 coin, güncel fiyatı, son 5 dakikalık para akışı ve borsalardaki fiyatları birlikte izlenir. Geçmiş taramalar 5 dakikalık aralıklarla saklanır.</div></div>
    {historyError&&<div className="notice"><RefreshCw size={17}/><div><b>Geçmiş:</b> {historyError}</div></div>}
    <div className="stats">
      <Stat icon={Target} label="Takip edilen coin" value={rows.length} detail="Hedef: ilk 100"/>
      <Stat icon={Activity} label="5 dk kayıt" value={snapshots.length} detail="Son 24 saat"/>
      <Stat icon={TrendingUp} label="Güncel veri" value={markets.filter(m=>m.last!=null).length} detail="Fiyatı bulunan"/>
      <Stat icon={Wallet} label="Para akışı" value={markets.filter(m=>m.flowVolume5m!=null).length} detail="5 dk akışı bulunan"/>
      <Stat icon={Sinyal} label="Fırsat" value={analytics?.summary?.totalOpportunities24h??0} detail="Skor 82+"/>
    </div>

    <section className="card tableCard marketBoard">
      <div className="head">
        <div><small>İLK 100 COIN / CANLI GÖRÜNÜM</small><h2>Tüm Piyasa</h2></div>
        <span className="tag">{snapshots.length ? snapshots.length+" x 5 DK" : "Geçmiş yükleniyor"}</span>
      </div>
      <div className="tableWrap">
        <table>
          <thead><tr>
            <th>#</th><th>COIN</th><th>FİYAT</th><th>5 DK</th><th>5 DK ALIŞ</th><th>5 DK SATIŞ</th><th>NET AKIŞ</th><th>ALICI %</th><th>24S HACİM</th><th>SKOR</th><th>BORSALAR</th>
          </tr></thead>
          <tbody>
            {rows.map((m,i)=>{
              const active=m.symbol===selected?.symbol;
              const ch=Number(m.priceChangePct5m||0);
              return <tr key={m.symbol} className={"clickRow "+(active?"selectedRow":"")} onClick={()=>{setDetailSymbol(m.symbol);selectMarket(m.symbol);}}>
                <td>{i+1}</td>
                <td><b>{m.symbol.replace("USDT","/USDT")}</b></td>
                <td className="marketPrice">{price(m.last)}</td>
                <td className={ch>0?"positive":ch<0?"negative":""}>{pct(m.priceChangePct5m,3)}</td>
                <td>{moneyCompact(m.buyVolume5m)}</td>
                <td>{moneyCompact(m.sellVolume5m)}</td>
                <td className={(m.netFlow5m||0)>0?"positive":(m.netFlow5m||0)<0?"negative":""}>{moneyCompact(m.netFlow5m)}</td>
                <td>{pct(m.buyPressure5mPct??m.buyPressurePct,1)}</td>
                <td>{moneyCompact(m.quoteVolume24h)}</td>
                <td><Skor n={m.score}/></td>
                <td>{marketCount(m)}/10</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>

    {selected&&<MarketDetail market={selected} history={selectedHistory}/>}
  </>;
}

function moneyCompact(n){
  if(n==null||!Number.isFinite(Number(n)))return "—";
  const x=Number(n);
  if(Math.abs(x)>=1e9)return (x/1e9).toFixed(2)+"B";
  if(Math.abs(x)>=1e6)return (x/1e6).toFixed(2)+"M";
  if(Math.abs(x)>=1e3)return (x/1e3).toFixed(1)+"K";
  return x.toFixed(2);
}

function MarketDetail({market,history}){
  const series=history.slice(-288);
  const exchangeRows=Object.entries(market.exchangeData||{})
    .map(([exchange,v])=>({exchange,...v}))
    .sort((a,b)=>(b.quoteVolume24h||0)-(a.quoteVolume24h||0));

  return <section className="card marketDetail">
    <div className="head">
      <div><small>SEÇİLİ COIN / SON 24 SAAT</small><h2>{market.symbol.replace("USDT","/USDT")} · {price(market.last)}</h2></div>
      <div className="detailBadges"><span className="tag">Skor {market.score}</span><span className="tag">{market.activeExchangeCount}/10 borsa</span></div>
    </div>

    <div className="detailStats">
      <div><small>SON 5 DK ALIŞ</small><b>{moneyCompact(market.buyVolume5m)}</b></div>
      <div><small>SON 5 DK SATIŞ</small><b>{moneyCompact(market.sellVolume5m)}</b></div>
      <div><small>NET PARA AKIŞI</small><b className={(market.netFlow5m||0)>=0?"positive":"negative"}>{moneyCompact(market.netFlow5m)}</b></div>
      <div><small>ALICI BASKISI</small><b>{pct(market.buyPressure5mPct??market.buyPressurePct,1)}</b></div>
      <div><small>5 DK HACİM</small><b>{moneyCompact(market.flowVolume5m)}</b></div>
    </div>

    <div className="flowChartCard">
      <div className="head"><div><small>5 DAKİKALIK AKIŞ</small><h3>24 saat boyunca para girişi / çıkışı</h3></div><span className="tag">{series.length} nokta</span></div>
      <FlowChart history={series}/>
    </div>

    <div className="exchangeTable">
      <div className="head"><div><small>10 BORSADAN GÜNCEL FİYATLAR</small><h3>Borsa karşılaştırması</h3></div><span className="tag">ANLIK TARAMA</span></div>
      <div className="tableWrap">
        <table><thead><tr><th>BORSA</th><th>SON FİYAT</th><th>ALIŞ</th><th>SATIŞ</th><th>SPREAD</th><th>24S HACİM</th></tr></thead>
        <tbody>{exchangeRows.map(v=><tr key={v.exchange}><td><b>{v.exchange.toUpperCase()}</b></td><td>{price(v.price)}</td><td>{price(v.bid)}</td><td>{price(v.ask)}</td><td>{pct(v.spreadPct,3)}</td><td>{moneyCompact(v.quoteVolume24h)}</td></tr>)}</tbody></table>
      </div>
    </div>
  </section>;
}

function PriceChart({history}){
  const values=history.filter(x=>Number.isFinite(Number(x.last))).map(x=>Number(x.last));
  if(values.length<2)return <div className="chartEmpty"><BarChart3 size={24}/><b>Fiyat grafiği oluşuyor</b><span>5 dakikalık geçmiş biriktikçe 24 saatlik grafik dolacak.</span></div>;
  const w=1000,h=260,p=30,min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const points=values.map((v,i)=>{
    const x=p+(i/(values.length-1))*(w-p*2);
    const y=h-p-((v-min)/range)*(h-p*2);
    return (i?"L":"M")+" "+x.toFixed(1)+" "+y.toFixed(1);
  }).join(" ");
  return <div className="priceChart"><svg viewBox={"0 0 "+w+" "+h}><path d={points} className="line"/></svg><div className="chartAxis"><span>24 saat önce</span><span>{price(values[0])}</span><span>Şimdi · {price(values[values.length-1])}</span></div></div>;
}

function FlowChart({history}){
  if(history.length<2)return <div className="chartEmpty"><BarChart3 size={24}/><b>24 saatlık akış grafiği oluşuyor</b><span>Her 5 dakikalık taramada bir nokta kaydedilecek.</span></div>;
  const w=1000,h=260,p=30,values=history.map(x=>Number(x.net)||0);
  const max=Math.max(1,...values.map(x=>Math.abs(x)));
  const y0=h/2;
  const points=values.map((v,i)=>{
    const x=p+(i/(values.length-1))*(w-p*2);
    const y=y0-(v/max)*(h/2-p);
    return (i?"L":"M")+" "+x.toFixed(1)+" "+y.toFixed(1);
  }).join(" ");
  const positiveBars=history.map((x,i)=>{const v=Number(x.buy||0);const x1=p+(i/(history.length-1))*(w-p*2);const bar=Math.max(1,(v/max)*(h/2-p));return <rect key={"b"+i} x={x1-1.2} y={y0-bar} width="2.4" height={bar} className="flowBuy"/>;});
  const negativeBars=history.map((x,i)=>{const v=Number(x.sell||0);const x1=p+(i/(history.length-1))*(w-p*2);const bar=Math.max(1,(v/max)*(h/2-p));return <rect key={"s"+i} x={x1-1.2} y={y0} width="2.4" height={bar} className="flowSell"/>;});
  return <div className="flowChart"><svg viewBox={"0 0 "+w+" "+h}><line x1={p} x2={w-p} y1={y0} y2={y0} className="baseline"/>{positiveBars}{negativeBars}<path d={points} className="line"/></svg><div className="chartAxis"><span>24 saat önce</span><span>Şimdi</span></div><div className="flowLegend"><span><i className="flowBuy"/> Alıcı para akışı</span><span><i className="flowSell"/> Satıcı para akışı</span></div></div>;
}

function Sinyaller({data,analytics}){
  const rows=[...(data?.markets||[])].sort((a,b)=>(b.score||0)-(a.score||0));
  const map=new Map((analytics?.markets||[]).map(x=>[x.symbol,x]));
  return <section className="card tableCard"><div className="head"><div><small>GÜNCEL DURUM</small><h2>Sinyal Radarı</h2></div><span className="tag">İLK 100</span></div><div className="tableWrap"><table><thead><tr><th>PARİTE</th><th>SKOR</th><th>SON 5 DK</th><th>ALICI AKIŞI</th><th>EMİR DEFTERİ</th><th>24 SAAT MOM.</th><th>BORSALAR</th><th>24 SAAT FIRSAT</th><th>DURUM</th></tr></thead><tbody>{rows.map(m=>{const h=map.get(m.symbol);return <tr key={m.symbol}><td><b>{m.symbol.replace("USDT","/USDT")}</b></td><td><Skor n={m.score}/></td><td className={(m.priceChangePct5m||0)>0?"positive":(m.priceChangePct5m||0)<0?"negative":""}>{pct(m.priceChangePct5m,3)}</td><td>{pct(m.buyPressurePct,1)}</td><td>{pct(m.weightedImbalancePct,1)}</td><td>{pct(m.priceChangePct24h,2)}</td><td>{marketCount(m)}/10</td><td>{h?.opportunities24h??0}</td><td><label className={"tag "+(m.score>=82?"good":"")}>{m.score>=82?"FIRSAT":m.score>=70?"TAKİP":"BEKLE"}</label></td></tr>})}</tbody></table></div></section>;
}

function OpportunityTable({analytics,limit=20}){
  const events=analytics?.events||[];
  return <section className="card tableCard"><div className="head"><div><small>SON FIRSATLAR</small><h2>Fırsat → Sonuç</h2></div><span className="tag">{events.length} kayıt</span></div><div className="tableWrap"><table><thead><tr><th>ZAMAN</th><th>PARİTE</th><th>GİRİŞ SKORU</th><th>30 DK</th><th>1 SAAT</th><th>2 SAAT</th><th>MAKS 2 SAAT</th></tr></thead><tbody>{events.slice(0,limit).map(e=><tr key={e.id}><td>{fmtDate(e.signalAt)}</td><td><b>{e.symbol.replace("USDT","/USDT")}</b></td><td><Skor n={e.score}/></td><td className={e.r30m>0?"positive":e.r30m<0?"negative":""}>{pct(e.r30m,3)}</td><td className={e.r1h>0?"positive":e.r1h<0?"negative":""}>{pct(e.r1h,3)}</td><td className={e.r2h>0?"positive":e.r2h<0?"negative":""}>{pct(e.r2h,3)}</td><td>{pct(e.maxReturn2h,3)}</td></tr>)}</tbody></table></div></section>;
}

function SkorChart({points,symbol}){
  const values=(points||[]).map(p=>({ts:p.ts,v:p.markets?.find(m=>m.s===symbol)?.score})).filter(x=>x.v!=null);
  if(values.length<2) return <div className="chartEmpty">24 saatlik grafik doluyor. Sistem 15 dakikada bir skor noktası saklıyor.</div>;
  const w=900,h=220,pad=24,min=0,max=100;
  const xy=(d,i)=>({x:pad+(i/(values.length-1))*(w-pad*2),y:h-pad-(d.v/100)*(h-pad*2)});
  const line=values.map((d,i)=>{const q=xy(d,i);return (i?"L":"M")+q.x.toFixed(1)+" "+q.y.toFixed(1)}).join(" ");
  const area=line+" L "+(w-pad)+" "+(h-pad)+" L "+pad+" "+(h-pad)+" Z";
  return <div className="scoreChart"><svg viewBox={"0 0 "+w+" "+h}><line x1={pad} x2={w-pad} y1={h-pad-(82/100)*(h-pad*2)} y2={h-pad-(82/100)*(h-pad*2)} className="threshold"/><path d={area} className="area"/><path d={line} className="line"/>{values.slice(-1).map((d,i)=>{const q=xy(d,values.length-1);return <circle key={i} cx={q.x} cy={q.y} r="4"/>})}</svg><div className="chartAxis"><span>24s önce</span><span>82 FIRSAT</span><span>Şimdi</span></div></div>;
}

function Row({label,value,width}){return <div className="riskRow"><div><span>{label}</span><b>{value}</b></div><div className="bar"><i style={{width:Math.max(0,Math.min(100,width||0))+"%"}}/></div></div>;}

function İşlemler({paper,paperİşlemler,paperİşlemlerError}){
  const trades=paperİşlemler?.length?paperİşlemler:(paper?.trades||[]);
  return <>
    <div className="stats">
      <Stat icon={Wallet} label="Güncel Kasa" value={(paper?.equity??1000).toFixed(2)+" TL"} detail={"Başlangıç 1.000 TL"}/>
      <Stat icon={Target} label="Kullanılabilir Nakit" value={(paper?.availableCash??paper?.balance??1000).toFixed(2)+" TL"} detail={(paper?.positionSizePct??10)+"% işlem büyüklüğü"}/>
      <Stat icon={TrendingUp} label="Net Kâr/Zarar" value={(paper?.realizedPnl??0).toFixed(2)+" TL"} detail={(paper?.returnPct??0).toFixed(2)+"%"}/>
      <Stat icon={Activity} label="Toplam İşlem" value={paper?.totalİşlemler??trades.length} detail={(paper?.winRate==null?"Henüz kapanan işlem yok":paper.winRate.toFixed(1)+"% kazanma")}/>
    </div>
    {paperİşlemlerError&&<div className="notice"><RefreshCw size={17}/><div><b>İşlem geçmişi:</b> {paperİşlemlerError}</div></div>}
    <div className="notice"><ListFilter size={17}/><div><b>Sanal işlem defteri.</b> Her kapanan işlem ayrı olarak kaydediliyor. Gerçek borsaya hiçbir emir gönderilmiyor.</div></div>
    <section className="card tableCard"><div className="head"><div><small>TÜM KAPANAN İŞLEMLER</small><h2>İşlem Geçmişi</h2></div><span className="tag">{trades.length} kayıt yüklendi</span></div><div className="tableWrap"><table><thead><tr><th>ZAMAN</th><th>PARİTE</th><th>SKOR</th><th>BORSA</th><th>GİRİŞ</th><th>ÇIKIŞ</th><th>NET K/Z</th><th>SÜRE</th><th>SONUÇ</th></tr></thead><tbody>{trades.slice(0,200).map(t=><tr key={t.id}><td>{fmtDate(t.kapananAt)}</td><td><b>{t.symbol}</b></td><td><Skor n={t.score}/></td><td>{t.exchange}</td><td>{price(t.entryPrice)}</td><td>{price(t.exitPrice)}</td><td className={t.netPnl>0?"positive":"negative"}>{Number(t.netPnl||0).toFixed(3)} TL</td><td>{Number(t.holdingMinutes||0).toFixed(0)} dk</td><td>{t.reason==="TP_1PCT"?"%1 KÂR":"-%0.8 ZARAR"}</td></tr>)}</tbody></table></div></section>
  </>;
}

function SkorEngine(){
  const rows=[
    ["24 saatlik momentum","±10","Fiyatın son 24 saatteki yönü"],
    ["Likidite","+8 / +4","24 saatlik işlem hacmi"],
    ["Borsa kapsamı","+7 / +4 / -8","Kaç borsada sağlıklı fiyat var"],
    ["Fiyat dağılımı","±4","Borsalar arası fiyat farkı"],
    ["Emir defteri","±12","Top depth bid/ask dengesi"],
    ["Spread","+4 / -5","İşlem maliyeti / likidite kalitesi"],
    ["Alıcı baskısı","±10","Binance son işlem örneklemindeki alıcı baskısı"]
  ];
  return <><div className="notice"><Gauge size={17}/><div><b>Bu motor şu an prototip.</b> 82+ sadece “FIRSAT fırsatı” üretir. İstatistikler birikmeden bu skorun kârlı olduğu varsayılmıyor.</div></div><section className="card tableCard"><div className="head"><div><small>MEVCUT FORMÜL</small><h2>Skor Motoru</h2></div><span className="tag">PROTOTİP</span></div><div className="formulaGrid">{rows.map(r=><div key={r[0]}><b>{r[0]}</b><strong>{r[1]}</strong><span>{r[2]}</span></div>)}</div></section><section className="card empty"><Target size={24}/><h2>Gelecek “AL” motoru</h2><p>Gerçek alım kararı için bu skor tek başına kullanılmayacak. 5 dakikalık momentum, hacim anomalisi, gerçek işlem akışı, kayma, volatilite, borsalar arası teyit ve risk kuralları ayrı bir giriş motorunda test edilecek.</p></section></>;
}

function Risk({data}){
  const h=data?.health||{};
  const p=data?.paper||{};
  return <>
    <div className="stats">
      <Stat icon={ShieldCheck} label="Açık Pozisyon" value={String(p.positions?.length??0)} detail="Her işlem %10"/>
      <Stat icon={Wallet} label="Kullanılabilir Nakit" value={(p.availableCash??p.balance??1000).toFixed(2)+" TL"} detail="Yeni fırsatlar için"/>
      <Stat icon={Activity} label="Borsa Verisi" value={(h.exchangesWithData??0)+"/10"} detail="Tarama kapsamı"/>
      <Stat icon={Bot} label="Mod" value="SİMÜLASYON" detail="Gerçek emir yok"/>
    </div>
    <section className="card empty"><ShieldCheck size={24}/><h2>Risk ve işlem kuralları</h2><p>Başlangıç kasa: 1.000 TL · İşlem büyüklüğü: %10 · Kâr hedefi: +%1 · Zarar kes: -%0,8 · Kaldıraç yok · Gerçek emir yok · Günlük işlem sayısı limiti yok.</p></section>
  </>;
}

function AyarlarPage(){
  return <><div className="notice"><AyarlarIcon size={17}/><div><b>Ücretsiz mod.</b> Harici zamanlayıcı + GitHub Actions kullanılıyor; piyasa verileri herkese açık API'lerden geliyor.</div></div><section className="card empty"><AyarlarIcon size={24}/><h2>Sistem Ayarları</h2><p>Tarama: 5 dk · Skor geçmişi: 15 dk · Kâr hedefi: +%1 · Zarar kes: -%0,8 · İşlem büyüklüğü: %10 · Kasa: 1.000 TL · Geçmiş: 30 gün.</p></section></>;
}function Performans({paper,paperİşlemler}){
  const trades=paperİşlemler?.length?paperİşlemler:(paper?.trades||[]);
  const wins=trades.filter(t=>t.netPnl>0).length;
  const gp=trades.filter(t=>t.netPnl>0).reduce((s,t)=>s+t.netPnl,0);
  const gl=Math.abs(trades.filter(t=>t.netPnl<0).reduce((s,t)=>s+t.netPnl,0));
  const pf=gl>0?gp/gl:null;
  return <>
    <div className="stats">
      <Stat icon={Wallet} label="Portföy Değeri" value={(paper?.equity??1000).toFixed(2)+" TL"} detail={(paper?.returnPct??0).toFixed(2)+"% toplam getiri"}/>
      <Stat icon={Target} label="Kazanma Oranı" value={paper?.winRate==null?"—":paper.winRate.toFixed(1)+"%"} detail={(paper?.totalİşlemler??trades.length)+" kapanan işlem"}/>
      <Stat icon={TrendingUp} label="Net Kâr/Zarar" value={(paper?.realizedPnl??0).toFixed(2)+" TL"} detail="Gerçekleşmiş"/>
      <Stat icon={Gauge} label="Kâr Faktörü" value={pf==null?"—":pf.toFixed(2)} detail="Kâr / zarar"/>
      <Stat icon={ShieldCheck} label="Maks. Düşüş" value={(paper?.maxDrawdownPct??0).toFixed(2)+"%"} detail="Simülasyon"/>
    </div>
    <section className="card empty"><BarChart3 size={24}/><h2>Kasa ve performans</h2><p>Başlangıç 1.000 TL. Her işlemde mevcut nakdin %10'u kullanılıyor. Kâr hedefi %1, zarar kesme seviyesi -%0,8. İşlem sayısına günlük limit yok. Komisyon simülasyona dahil.</p></section>
    <section className="card tableCard"><div className="head"><div><small>SON KAPANAN İŞLEMLER</small><h2>İşlem Sonuçları</h2></div><span className="tag">{trades.length} kayıt</span></div><div className="tableWrap"><table><thead><tr><th>PARİTE</th><th>SKOR</th><th>NET K/Z</th><th>GETİRİ</th><th>ÇIKIŞ</th></tr></thead><tbody>{trades.slice(0,50).map(t=><tr key={t.id}><td><b>{t.symbol}</b></td><td><Skor n={t.score}/></td><td className={t.netPnl>0?"positive":"negative"}>{Number(t.netPnl||0).toFixed(3)} TL</td><td>{Number(t.returnPct||0).toFixed(3)}%</td><td>{t.reason==="TP_1PCT"?"Kâr hedefi":"Zarar kes"}</td></tr>)}</tbody></table></div></section>
  </>;
}
