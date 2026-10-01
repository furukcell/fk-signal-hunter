import {useEffect,useMemo,useState} from "react";
import {Activity,BarChart3,Bot,Gauge,LayoutDashboard,ListFilter,Menu,RefreshCw,Settings,ShieldCheck,Signal,Target,TrendingUp,Wallet,X} from "lucide-react";

const nav=[
  ["Ana Sayfa",LayoutDashboard],
  ["24 Saatlik Tarama",TrendingUp],
  ["Sinyaller",Signal],
  ["İşlemler",ListFilter],
  ["Performans",BarChart3],
  ["Skor Motoru",Gauge],
  ["Risk",ShieldCheck],
  ["Ayarlar",Settings]
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
  const [tab,setTab]=useState("Ana Sayfa");
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
      <div className="brand"><div className="mark"><Target size={18}/></div><div><b>FK SIGNAL HUNTER</b><span>Piyasa İstihbaratı</span></div><button className="close" onClick={()=>setOpen(false)}><X size={18}/></button></div>
      <nav>{nav.map(([name,Icon])=><button className={tab===name?"active":""} key={name} onClick={()=>{setTab(name);setOpen(false)}}><Icon size={17}/><span>{name}</span></button>)}</nav>
      <div className="bottom"><div className="paper"><i/> <div><b>SİMÜLASYON MODU</b><span>Gerçek para devre dışı</span></div></div><div className="engine"><Bot size={16}/> Motor <b>AKTİF</b></div></div>
    </aside>
    <main>
      <header><button className="menu" onClick={()=>setOpen(true)}><Menu size={20}/></button><div><small>KİŞİSEL PİYASA SİSTEMİ</small><h1>{tab}</h1></div><div className="actions"><span className="market"><i className={connected?"live":""}/> {connected?"5 dakikalık veri aktif":"Veri bağlantısı yok"}</span><button className="start" disabled><Bot size={15}/> Botu Başlat</button></div></header>
      <section className="content">
        {error&&<div className="notice"><RefreshCw size={17}/><div><b>Market data:</b> {error}</div></div>}
        {tab==="Ana Sayfa"&&<Dashboard data={data} market={market} selectMarket={selectMarket}/>}
        {tab==="24 Saatlik Tarama"&&<Scanner analytics={analytics} markets={markets} selectMarket={selectMarket}/>}
        {tab==="Sinyaller"&&<Signals data={data} analytics={analytics}/>}
        {tab==="İşlemler"&&<Trades paper={data?.paper}/>}
        {tab==="Performans"&&<Performance paper={data?.paper}/>}
        {tab==="Skor Motoru"&&<ScoreEngine/>}
        {tab==="Risk"&&<Risk data={data}/>}
        {tab==="Ayarlar"&&<SettingsPage/>}
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
      <Stat icon={Wallet} label="Simülasyon Bakiyesi" value={(data?.paper?.equity??1000).toFixed(2)+" TL"} detail={"Başlangıçtan itibaren"}/>
      <Stat icon={Target} label="24H Fırsat" value={s.totalOpportunities24h??0} detail="Skor ≥ 82"/>
      <Stat icon={TrendingUp} label="30 Dakika Pozitif" value={pct(s.positiveRate30m)} detail={(s.resolved30m??0)+" resolved"}/>
      <Stat icon={TrendingUp} label="1 Saat Pozitif" value={pct(s.positiveRate1h)} detail={(s.resolved1h??0)+" resolved"}/>
      <Stat icon={Gauge} label="2 Saat Ortalaması" value={pct(s.avgReturn2h,3)} detail={(s.resolved2h??0)+" resolved"}/>
    </div>
    <div className="two">
      <section className="card chartCard">
        <div className="head"><div><small>24 SAAT / 15 DK ÖRNEKLEME</small><h2>Skor Geçmişi</h2></div><select value={market?.symbol||""} onChange={e=>selectMarket(e.target.value)}>{(data?.markets||[]).map(m=><option key={m.symbol} value={m.symbol}>{m.symbol.replace("USDT","/USDT")}</option>)}</select></div>
        <ScoreChart points={a?.scorePoints||[]} symbol={market?.symbol}/>
        <div className="chartLegend"><span><i/> {market?.symbol?.replace("USDT","/USDT")||"—"} score</span><span>FIRSAT ≥ 82</span></div>
      </section>
      <section className="card risk">
        <div className="head"><div><small>SEÇİLİ COIN</small><h2>{market?.symbol?.replace("USDT","/USDT")||"—"}</h2></div><Score n={score}/></div>
        <div className="decision"><Score n={score}/><div><b>{score>=82?"FIRSAT":score>=70?"TAKİP":"BEKLE"}</b><span>Bu skor henüz “garantili alım” anlamına gelmez.</span></div></div>
        <Row label="Alıcı baskısı" value={pct(market?.buyPressurePct)} width={market?.buyPressurePct??0}/>
        <Row label="Emir defteri dengesi" value={pct(market?.weightedImbalancePct)} width={Math.min(100,Math.abs(market?.weightedImbalancePct||0)*2.5)}/>
        <Row label="24 saatlik momentum" value={pct(market?.priceChangePct24h)} width={Math.min(100,Math.abs(market?.priceChangePct24h||0)*20)}/>
        <Row label="Alış-satış farkı" value={pct(market?.spreadPct,3)} width={Math.min(100,(market?.spreadPct||0)*500)}/>
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
    <section className="card tableCard"><div className="head"><div><small>İLK 100 COIN / SON 24 SAAT</small><h2>Fırsat Sonuçları</h2></div><span className="tag">5 DK VERİ</span></div><div className="tableWrap"><table><thead><tr><th>COIN</th><th>SKOR</th><th>FIRSAT</th><th>30 DK ORT.</th><th>1 SAAT ORT.</th><th>2 SAAT ORT.</th><th>2 SAAT POZİTİF</th><th>BORSALAR</th></tr></thead><tbody>{rows.map(r=><tr key={r.symbol} onClick={()=>selectMarket(r.symbol)} className="clickRow"><td><b>{r.symbol.replace("USDT","/USDT")}</b></td><td><Score n={r.score}/></td><td>{r.opportunities24h}</td><td>{pct(r.avgReturn30m,3)}</td><td>{pct(r.avgReturn1h,3)}</td><td>{pct(r.avgReturn2h,3)}</td><td>{pct(r.positiveRate2h,1)}</td><td>{marketCount(markets.find(m=>m.symbol===r.symbol))}/10</td></tr>)}</tbody></table></div></section>
  </>;
}

function Signals({data,analytics}){
  const rows=[...(data?.markets||[])].sort((a,b)=>(b.score||0)-(a.score||0));
  const map=new Map((analytics?.markets||[]).map(x=>[x.symbol,x]));
  return <section className="card tableCard"><div className="head"><div><small>GÜNCEL DURUM</small><h2>Sinyal Radarı</h2></div><span className="tag">İLK 100</span></div><div className="tableWrap"><table><thead><tr><th>PARİTE</th><th>SKOR</th><th>ALICI AKIŞI</th><th>EMİR DEFTERİ</th><th>24 SAAT MOM.</th><th>BORSALAR</th><th>24 SAAT FIRSAT</th><th>DURUM</th></tr></thead><tbody>{rows.map(m=>{const h=map.get(m.symbol);return <tr key={m.symbol}><td><b>{m.symbol.replace("USDT","/USDT")}</b></td><td><Score n={m.score}/></td><td>{pct(m.buyPressurePct,1)}</td><td>{pct(m.weightedImbalancePct,1)}</td><td>{pct(m.priceChangePct24h,2)}</td><td>{marketCount(m)}/10</td><td>{h?.opportunities24h??0}</td><td><label className={"tag "+(m.score>=82?"good":"")}>{m.score>=82?"FIRSAT":m.score>=70?"TAKİP":"BEKLE"}</label></td></tr>})}</tbody></table></div></section>;
}

function OpportunityTable({analytics,limit=20}){
  const events=analytics?.events||[];
  return <section className="card tableCard"><div className="head"><div><small>SON FIRSATLAR</small><h2>Fırsat → Sonuç</h2></div><span className="tag">{events.length} kayıt</span></div><div className="tableWrap"><table><thead><tr><th>ZAMAN</th><th>PARİTE</th><th>GİRİŞ SKORU</th><th>30 DK</th><th>1 SAAT</th><th>2 SAAT</th><th>MAKS 2 SAAT</th></tr></thead><tbody>{events.slice(0,limit).map(e=><tr key={e.id}><td>{fmtDate(e.signalAt)}</td><td><b>{e.symbol.replace("USDT","/USDT")}</b></td><td><Score n={e.score}/></td><td className={e.r30m>0?"positive":e.r30m<0?"negative":""}>{pct(e.r30m,3)}</td><td className={e.r1h>0?"positive":e.r1h<0?"negative":""}>{pct(e.r1h,3)}</td><td className={e.r2h>0?"positive":e.r2h<0?"negative":""}>{pct(e.r2h,3)}</td><td>{pct(e.maxReturn2h,3)}</td></tr>)}</tbody></table></div></section>;
}

function ScoreChart({points,symbol}){
  const values=(points||[]).map(p=>({ts:p.ts,v:p.markets?.find(m=>m.s===symbol)?.score})).filter(x=>x.v!=null);
  if(values.length<2) return <div className="chartEmpty">24 saatlik grafik doluyor. Sistem 15 dakikada bir score noktası saklıyor.</div>;
  const w=900,h=220,pad=24,min=0,max=100;
  const xy=(d,i)=>({x:pad+(i/(values.length-1))*(w-pad*2),y:h-pad-(d.v/100)*(h-pad*2)});
  const line=values.map((d,i)=>{const q=xy(d,i);return (i?"L":"M")+q.x.toFixed(1)+" "+q.y.toFixed(1)}).join(" ");
  const area=line+" L "+(w-pad)+" "+(h-pad)+" L "+pad+" "+(h-pad)+" Z";
  return <div className="scoreChart"><svg viewBox={"0 0 "+w+" "+h}><line x1={pad} x2={w-pad} y1={h-pad-(82/100)*(h-pad*2)} y2={h-pad-(82/100)*(h-pad*2)} className="threshold"/><path d={area} className="area"/><path d={line} className="line"/>{values.slice(-1).map((d,i)=>{const q=xy(d,values.length-1);return <circle key={i} cx={q.x} cy={q.y} r="4"/>})}</svg><div className="chartAxis"><span>24s önce</span><span>82 FIRSAT</span><span>Şimdi</span></div></div>;
}

function Row({label,value,width}){return <div className="riskRow"><div><span>{label}</span><b>{value}</b></div><div className="bar"><i style={{width:Math.max(0,Math.min(100,width||0))+"%"}}/></div></div>;}

function Trades({paper}){
  const trades=paper?.trades||[];
  return <>
    <div className="stats">
      <Stat icon={Wallet} label="Güncel Kasa" value={(paper?.equity??1000).toFixed(2)+" TL"} detail={"Başlangıç 1.000 TL"}/>
      <Stat icon={Target} label="Kullanılabilir Nakit" value={(paper?.availableCash??paper?.balance??1000).toFixed(2)+" TL"} detail={(paper?.positionSizePct??10)+"% işlem büyüklüğü"}/>
      <Stat icon={TrendingUp} label="Net Kâr/Zarar" value={(paper?.realizedPnl??0).toFixed(2)+" TL"} detail={(paper?.returnPct??0).toFixed(2)+"%"}/>
      <Stat icon={Activity} label="Toplam İşlem" value={paper?.totalTrades??trades.length} detail={(paper?.winRate==null?"Henüz kapanan işlem yok":paper.winRate.toFixed(1)+"% kazanma")}/>
    </div>
    <div className="notice"><ListFilter size={17}/><div><b>Sanal işlem defteri.</b> Her kapanan işlem ayrı olarak kaydediliyor. Gerçek borsaya hiçbir emir gönderilmiyor.</div></div>
    <section className="card tableCard"><div className="head"><div><small>TÜM KAPANAN İŞLEMLER / SON 200</small><h2>İşlem Geçmişi</h2></div><span className="tag">{paper?.totalTrades??trades.length} toplam işlem</span></div><div className="tableWrap"><table><thead><tr><th>ZAMAN</th><th>PARİTE</th><th>SKOR</th><th>BORSA</th><th>GİRİŞ</th><th>ÇIKIŞ</th><th>NET K/Z</th><th>SÜRE</th><th>SONUÇ</th></tr></thead><tbody>{trades.slice(0,200).map(t=><tr key={t.id}><td>{fmtDate(t.closedAt)}</td><td><b>{t.symbol}</b></td><td><Score n={t.score}/></td><td>{t.exchange}</td><td>{price(t.entryPrice)}</td><td>{price(t.exitPrice)}</td><td className={t.netPnl>0?"positive":"negative"}>{Number(t.netPnl||0).toFixed(3)} TL</td><td>{Number(t.holdingMinutes||0).toFixed(0)} dk</td><td>{t.reason==="TP_1PCT"?"%1 KÂR":"-%0.8 ZARAR"}</td></tr>)}</tbody></table></div></section>
  </>;
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

function SettingsPage(){
  return <><div className="notice"><Settings size={17}/><div><b>Ücretsiz mod.</b> Harici zamanlayıcı + GitHub Actions kullanılıyor; piyasa verileri herkese açık API'lerden geliyor.</div></div><section className="card empty"><Settings size={24}/><h2>Sistem Ayarları</h2><p>Tarama: 5 dk · Skor geçmişi: 15 dk · Kâr hedefi: +%1 · Zarar kes: -%0,8 · İşlem büyüklüğü: %10 · Kasa: 1.000 TL · Geçmiş: 30 gün.</p></section></>;
}function Performance({paper}){
  const trades=paper?.trades||[];
  const wins=trades.filter(t=>t.netPnl>0).length;
  const gp=trades.filter(t=>t.netPnl>0).reduce((s,t)=>s+t.netPnl,0);
  const gl=Math.abs(trades.filter(t=>t.netPnl<0).reduce((s,t)=>s+t.netPnl,0));
  const pf=gl>0?gp/gl:null;
  return <>
    <div className="stats">
      <Stat icon={Wallet} label="Portföy Değeri" value={(paper?.equity??1000).toFixed(2)+" TL"} detail={(paper?.returnPct??0).toFixed(2)+"% toplam getiri"}/>
      <Stat icon={Target} label="Kazanma Oranı" value={paper?.winRate==null?"—":paper.winRate.toFixed(1)+"%"} detail={(paper?.totalTrades??trades.length)+" kapanan işlem"}/>
      <Stat icon={TrendingUp} label="Net Kâr/Zarar" value={(paper?.realizedPnl??0).toFixed(2)+" TL"} detail="Gerçekleşmiş"/>
      <Stat icon={Gauge} label="Kâr Faktörü" value={pf==null?"—":pf.toFixed(2)} detail="Kâr / zarar"/>
      <Stat icon={ShieldCheck} label="Maks. Düşüş" value={(paper?.maxDrawdownPct??0).toFixed(2)+"%"} detail="Simülasyon"/>
    </div>
    <section className="card empty"><BarChart3 size={24}/><h2>Kasa ve performans</h2><p>Başlangıç 1.000 TL. Her işlemde mevcut nakdin %10'u kullanılıyor. Kâr hedefi %1, zarar kesme seviyesi -%0,8. İşlem sayısına günlük limit yok. Komisyon simülasyona dahil.</p></section>
    <section className="card tableCard"><div className="head"><div><small>SON KAPANAN İŞLEMLER</small><h2>İşlem Sonuçları</h2></div><span className="tag">{trades.length} kayıt</span></div><div className="tableWrap"><table><thead><tr><th>PARİTE</th><th>SKOR</th><th>NET K/Z</th><th>GETİRİ</th><th>ÇIKIŞ</th></tr></thead><tbody>{trades.slice(0,50).map(t=><tr key={t.id}><td><b>{t.symbol}</b></td><td><Score n={t.score}/></td><td className={t.netPnl>0?"positive":"negative"}>{Number(t.netPnl||0).toFixed(3)} TL</td><td>{Number(t.returnPct||0).toFixed(3)}%</td><td>{t.reason==="TP_1PCT"?"Kâr hedefi":"Zarar kes"}</td></tr>)}</tbody></table></div></section>
  </>;
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
