"use strict";
(function () {
  const TRIPS_KEY = "hokkaido48Trips";
  const ROUTE_URL = "data/routes-v50.json";
  const GEOJSON_PATH = number => `data/geojson/route_${String(number).padStart(3,"0")}.geojson`;
  const MANUAL_STATUS_KEY = "hokkaido48V5ManualRouteStatus";
  const CONFIRMED_STATUS_KEY = "hokkaido48V5ConfirmedRouteStatus";
  const BACKUP_KEY = "hokkaido48V5DataManagerBackups";
  const $ = id => document.getElementById(id);
  const tripSelect=$("rsTripSelect"), tripSummary=$("rsTripSummary"), listEl=$("rsRouteList"), countEl=$("rsCount"), saveBtn=$("rsSave"), messageEl=$("rsMessage"), fitBtn=$("rsFit"), mapMessage=$("rsMapMessage");
  let trips=[], routes=[], map, routeGroup, actualGroup, labelGroup, currentBounds=null, evidenceByNumber=new Map();

  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  function readJson(key,fallback){try{const x=JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));return x??fallback;}catch{return fallback;}}
  function loadTrips(){const x=readJson(TRIPS_KEY,[]);return Array.isArray(x)?x:[];}
  function normalizeConfirmedPath(path){
    if(!Array.isArray(path))return[];
    return path.map(pt=>[Number(pt?.[0]),Number(pt?.[1])]).filter(pt=>Number.isFinite(pt[0])&&Number.isFinite(pt[1]));
  }
  function segmentConfirmedPaths(seg){
    const out=[];
    if(Array.isArray(seg?.confirmedPaths))seg.confirmedPaths.forEach(path=>{const p=normalizeConfirmedPath(path);if(p.length>1)out.push(p);});
    if(!out.length&&Array.isArray(seg?.confirmedPath)){const p=normalizeConfirmedPath(seg.confirmedPath);if(p.length>1)out.push(p);}
    return out;
  }
  function confirmationPaths(t,number){
    const out=[];
    const confirmations=Array.isArray(t?.gpxRouteConfirmations)?t.gpxRouteConfirmations:[];
    confirmations.forEach(c=>(Array.isArray(c?.routes)?c.routes:[]).forEach(item=>{
      if(String(item?.routeNumber??item?.number??"")!==String(number))return;
      (Array.isArray(item?.confirmedPaths)?item.confirmedPaths:[]).forEach(path=>{const p=normalizeConfirmedPath(path);if(p.length>1)out.push(p);});
    }));
    return out;
  }
  function routeNumbersFromTrip(t){
    if(!t)return[];
    const evidence=new Set();
    (Array.isArray(t.confirmedRouteNumbers)?t.confirmedRouteNumbers:[]).forEach(n=>{if(String(n))evidence.add(String(n));});
    (Array.isArray(t.gpxRouteConfirmations)?t.gpxRouteConfirmations:[]).forEach(c=>{
      (Array.isArray(c?.routeNumbers)?c.routeNumbers:[]).forEach(n=>{if(String(n))evidence.add(String(n));});
      (Array.isArray(c?.routes)?c.routes:[]).forEach(item=>{const n=String(item?.routeNumber??item?.number??"");if(n)evidence.add(n);});
    });
    (Array.isArray(t.routeSegments)?t.routeSegments:[]).forEach(seg=>{
      const n=String(seg?.routeNumber||"");
      if(n&&segmentConfirmedPaths(seg).length)evidence.add(n);
    });
    if(evidence.size)return[...evidence];
    // 出発前計画だけのTripは走破状態確定の候補へ出さない。
    if(String(t.planningStatus||"")==="planned")return[];
    const fallback=new Set();
    (Array.isArray(t.routeSegments)?t.routeSegments:[]).forEach(seg=>{const n=String(seg?.routeNumber||"");if(n)fallback.add(n);});
    if(fallback.size)return[...fallback];
    return[...new Set(String(t.routes||"").split(/[,、\s→/]+/).map(x=>x.replace(/\D/g,"")).filter(Boolean))];
  }
  function confirmedPathsForRoute(number){
    const out=[];
    trips.forEach(t=>{
      let foundInSegments=false;
      (Array.isArray(t?.routeSegments)?t.routeSegments:[]).forEach(seg=>{
        if(String(seg?.routeNumber||"")!==String(number))return;
        const paths=segmentConfirmedPaths(seg);
        if(paths.length)foundInSegments=true;
        out.push(...paths);
      });
      // V5確認情報はrouteSegmentsと重複するため、segment側に線が無いときだけ補完する。
      if(!foundInSegments)out.push(...confirmationPaths(t,number));
    });
    return out;
  }
  function hav(a,b){const R=6371008.8,rad=Math.PI/180;const p1=a[0]*rad,p2=b[0]*rad,dp=(b[0]-a[0])*rad,dl=(b[1]-a[1])*rad;const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));}
  function lineLength(line){let m=0;for(let i=1;i<line.length;i++)m+=hav(line[i-1],line[i]);return m;}
  function collectLines(node,out=[]){
    if(!node||typeof node!=="object")return out;
    if(node.type==="FeatureCollection")node.features?.forEach(x=>collectLines(x,out));
    else if(node.type==="Feature")collectLines(node.geometry,out);
    else if(node.type==="LineString"&&Array.isArray(node.coordinates))out.push(node.coordinates.map(p=>[Number(p[1]),Number(p[0])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])));
    else if(node.type==="MultiLineString"&&Array.isArray(node.coordinates))node.coordinates.forEach(line=>out.push(line.map(p=>[Number(p[1]),Number(p[0])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]))));
    return out;
  }
  function interpolate(a,b,r){return[a[0]+(b[0]-a[0])*r,a[1]+(b[1]-a[1])*r];}
  function sampleLines(lines,step=700){const pts=[];lines.forEach(line=>{for(let i=1;i<line.length;i++){const d=hav(line[i-1],line[i]);const n=Math.max(1,Math.ceil(d/step));for(let k=0;k<n;k++)pts.push(interpolate(line[i-1],line[i],k/n));}if(line.length)pts.push(line[line.length-1]);});return pts;}
  function flattenPathPoints(paths,step=250){const out=[];paths.forEach(line=>{for(let i=1;i<line.length;i++){const d=hav(line[i-1],line[i]);const n=Math.max(1,Math.ceil(d/step));for(let k=0;k<n;k++)out.push(interpolate(line[i-1],line[i],k/n));}if(line.length)out.push(line[line.length-1]);});return out;}
  function minDistanceToPoints(p,pts){let best=Infinity;for(const q of pts){const d=hav(p,q);if(d<best)best=d;if(best<20)break;}return best;}
  function longestMainLine(lines){return lines.slice().sort((a,b)=>lineLength(b)-lineLength(a))[0]||[];}
  function midpointOnLine(line){
    if(!Array.isArray(line)||!line.length)return null;
    if(line.length===1)return line[0];
    const total=lineLength(line);
    if(!total)return line[Math.floor(line.length/2)];
    const half=total/2;let acc=0;
    for(let i=1;i<line.length;i++){
      const seg=hav(line[i-1],line[i]);
      if(acc+seg>=half)return interpolate(line[i-1],line[i],(half-acc)/Math.max(seg,1));
      acc+=seg;
    }
    return line[line.length-1];
  }
  async function buildEvidence(route){
    const resp=await fetch(GEOJSON_PATH(route.number),{cache:"no-store"});if(!resp.ok)throw new Error(`国道${route.number}号の地図を読めません`);const geo=await resp.json();
    const lines=collectLines(geo).filter(x=>x.length>1), routeSamples=sampleLines(lines,700), paths=confirmedPathsForRoute(route.number), actualPts=flattenPathPoints(paths,250);
    let matched=0;routeSamples.forEach(p=>{if(minDistanceToPoints(p,actualPts)<=180)matched++;});
    const ratio=routeSamples.length?matched/routeSamples.length:0;
    const main=longestMainLine(lines), start=main[0], end=main[main.length-1];
    const startDist=actualPts.length&&start?minDistanceToPoints(start,actualPts):Infinity, endDist=actualPts.length&&end?minDistanceToPoints(end,actualPts):Infinity;
    const cityRule=route.completionRule?.type==="city-arrival-accepted";
    const endThreshold=cityRule?12000:3000;
    const startReached=startDist<=endThreshold, endReached=endDist<=endThreshold;
    let suggestion="一部走破";
    if(paths.length && ratio>=0.88 && startReached && endReached)suggestion="全線走破";
    else if(paths.length && cityRule && ratio>=0.82 && (startReached||endReached))suggestion="全線走破";
    const totalKm=lines.reduce((s,l)=>s+lineLength(l),0)/1000;
    const confirmedKm=paths.reduce((s,l)=>s+lineLength(l),0)/1000;
    return{route,geo,lines,paths,ratio,totalKm,confirmedKm,startDist,endDist,startReached,endReached,cityRule,suggestion};
  }
  function initMap(){map=L.map("rsMap",{zoomControl:true,preferCanvas:true}).setView([43.5,142.4],6);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"&copy; OpenStreetMap contributors"}).addTo(map);routeGroup=L.layerGroup().addTo(map);actualGroup=L.layerGroup().addTo(map);labelGroup=L.layerGroup().addTo(map);setTimeout(()=>map.invalidateSize(),80);}
  function drawEvidence(ev){routeGroup.clearLayers();actualGroup.clearLayers();labelGroup.clearLayers();currentBounds=null;
    document.querySelectorAll('.route-status-row.is-map-active').forEach(el=>el.classList.remove('is-map-active'));
    document.querySelector(`.route-status-row[data-route="${CSS.escape(String(ev.route.number))}"]`)?.classList.add('is-map-active');
    const layer=L.geoJSON(ev.geo,{style:{color:"#64748b",weight:5,opacity:.7}}).addTo(routeGroup);currentBounds=layer.getBounds();
    ev.paths.forEach(path=>{const l=L.polyline(path,{color:"#0f766e",weight:7,opacity:.95}).addTo(actualGroup);const b=l.getBounds();if(b.isValid())currentBounds=currentBounds&&currentBounds.isValid()?currentBounds.extend(b):b;});
    const labelLine=longestMainLine(ev.paths.length?ev.paths:ev.lines), labelPos=midpointOnLine(labelLine);
    if(labelPos){
      L.marker(labelPos,{interactive:false,icon:L.divIcon({className:'route-status-route-label-wrap',html:`<span class="route-status-route-label">国道${esc(ev.route.number)}号</span>`})}).addTo(labelGroup);
    }
    if(currentBounds&&currentBounds.isValid())map.fitBounds(currentBounds,{padding:[32,32],maxZoom:10});
    mapMessage.textContent=`国道${ev.route.number}号：走破率目安 ${Math.round(ev.ratio*100)}%。灰＝国道全体、緑＝これまでに確定した実走区間。`;
  }
  function currentStatus(number){
    const manual=readJson(MANUAL_STATUS_KEY,{}), confirmed=readJson(CONFIRMED_STATUS_KEY,{}), route=routes.find(r=>String(r.number)===String(number));
    if(["未走破","一部走破","全線走破"].includes(manual[String(number)]))return{status:manual[String(number)],source:"手動"};
    const e=confirmed[String(number)], st=typeof e==="string"?e:e?.status;if(["未走破","一部走破","全線走破"].includes(st))return{status:st,source:"V5確定"};
    if(confirmedPathsForRoute(number).length)return{status:"一部走破",source:"Trip実走線"};
    return{status:route?.displayStatusPreview||route?.status||"未走破",source:"既存"};
  }
  function distanceText(m){return Number.isFinite(m)?`${(m/1000).toFixed(1)}km`:'不明';}
  function reviewReason(ev,cur){
    if(!ev||!cur)return'';
    // GPX画面で人間確認済みの実走線があるだけなら「一部走破」は再確認しない。
    // 追加確認が必要なのは、全線走破候補か、実走事実と現在状態が矛盾する場合だけ。
    if(ev.suggestion==='全線走破'&&cur.status!=='全線走破')return'累積実走が全線走破候補';
    if(Array.isArray(ev.paths)&&ev.paths.length&&cur.status==='未走破')return'実走記録あり／現在状態が未走破';
    return'';
  }
  async function renderTrip(){
    evidenceByNumber.clear();listEl.innerHTML='<div class="empty-box">走破状況を計算しています…</div>';saveBtn.disabled=true;messageEl.textContent="";
    const idx=Number(tripSelect.value), trip=Number.isInteger(idx)?trips[idx]:null;if(!trip){listEl.innerHTML='<div class="empty-box">旅を選択してください。</div>';countEl.textContent='0路線';return;}
    const nums=routeNumbersFromTrip(trip), targetRoutes=nums.map(n=>routes.find(r=>String(r.number)===String(n))).filter(Boolean);
    tripSummary.innerHTML=`<strong>${esc(trip.startDate||trip.date||'日付未登録')}｜${esc(trip.tripName||'名称未登録')}</strong><p>確定走行国道：${targetRoutes.length?targetRoutes.map(r=>`国道${r.number}号`).join('・'):'なし'}</p>`;
    const evs=[];for(const r of targetRoutes){try{evs.push(await buildEvidence(r));}catch(e){console.warn(e);}}
    listEl.innerHTML='';
    if(!evs.length){
      countEl.textContent='0路線';
      listEl.innerHTML='<div class="empty-box">GPXで確定した国道がありません。</div>';
      routeGroup.clearLayers();actualGroup.clearLayers();labelGroup.clearLayers();
      mapMessage.textContent='この旅には追加確認の対象がありません。';
      return;
    }
    const reviews=evs.map(ev=>{const cur=currentStatus(ev.route.number);return{ev,cur,reason:reviewReason(ev,cur)};}).filter(item=>item.reason);
    countEl.textContent=reviews.length?`${reviews.length}路線 要確認`:'確認不要';
    if(!reviews.length){
      listEl.innerHTML='<div class="empty-box"><strong>追加確認はありません。</strong><br>GPX画面で確認・保存した実走区間は、一部走破としてすでに走破記録へ反映されています。通常はこのままで完了です。</div>';
      routeGroup.clearLayers();actualGroup.clearLayers();labelGroup.clearLayers();currentBounds=null;
      mapMessage.textContent='全線走破候補や状態の矛盾は検出されませんでした。';
      saveBtn.disabled=true;
      return;
    }
    reviews.forEach(({ev,cur,reason},i)=>{
      evidenceByNumber.set(String(ev.route.number),ev);let suggested=ev.suggestion;if(cur.status==='全線走破')suggested='全線走破';
      const protectedFull=cur.source==='手動'&&cur.status==='全線走破';
      const row=document.createElement('article');row.className='route-status-row';row.dataset.route=String(ev.route.number);
      const city=ev.cityRule?'<span class="route-status-tag city">市内到達ルール</span>':'';
      const protect=protectedFull?'<span class="route-status-tag protect">手動全線走破を保護</span>':'';
      const reasonTag=`<span class="route-status-tag protect">要確認：${esc(reason)}</span>`;
      row.innerHTML=`<div class="route-status-main"><button class="route-status-map-button" type="button">国道${esc(ev.route.number)}号</button><div><strong>${esc(ev.route.start)} → ${esc(ev.route.end)}</strong><span>走破率目安 ${Math.round(ev.ratio*100)}% ／ 国道全体 約${ev.totalKm.toFixed(1)}km ／ 確定実走線 約${ev.confirmedKm.toFixed(1)}km</span><span>端点目安：起点 ${distanceText(ev.startDist)} ／ 終点 ${distanceText(ev.endDist)}</span>${reasonTag}${city}${protect}</div></div><div class="route-status-choice"><span>現在：${esc(cur.status)}（${esc(cur.source)}）</span><label>今回の確定<select data-route="${esc(ev.route.number)}" ${protectedFull?'disabled':''}><option value="一部走破" ${suggested==='一部走破'?'selected':''}>一部走破</option><option value="全線走破" ${suggested==='全線走破'?'selected':''}>全線走破</option></select></label><small>自動候補：${esc(ev.suggestion)}</small></div>`;
      row.querySelector('.route-status-map-button').addEventListener('click',()=>drawEvidence(ev));
      row.querySelector('.route-status-main').addEventListener('click',e=>{if(e.target.closest('select'))return;drawEvidence(ev);});
      listEl.appendChild(row);if(i===0)drawEvidence(ev);
    });
    saveBtn.disabled=false;
  }
  function saveBackup(reason){const arr=readJson(BACKUP_KEY,[]);arr.push({id:`backup-${Date.now()}`,savedAt:new Date().toISOString(),reason,trips:loadTrips(),manualStatuses:readJson(MANUAL_STATUS_KEY,{}),confirmedStatuses:readJson(CONFIRMED_STATUS_KEY,{})});while(arr.length>20)arr.shift();localStorage.setItem(BACKUP_KEY,JSON.stringify(arr));}
  function saveStatuses(){
    const idx=Number(tripSelect.value),trip=Number.isInteger(idx)?trips[idx]:null;if(!trip)return;const selects=[...listEl.querySelectorAll('select[data-route]')];if(!selects.length)return;
    const manual=readJson(MANUAL_STATUS_KEY,{}), confirmed=readJson(CONFIRMED_STATUS_KEY,{}), changes=[];
    selects.forEach(sel=>{const n=String(sel.dataset.route),requested=sel.value;if(manual[n]==="全線走破"&&requested!=="全線走破")return;changes.push([n,requested]);});
    if(!changes.length){messageEl.textContent='変更対象がありません。';return;}
    const text=changes.map(([n,s])=>`国道${n}号：${s}`).join('\n');if(!confirm(`Routeへ次の状態を反映します。\n\n${text}\n\nよろしいですか？`))return;
    saveBackup(`走破状態確定：${trip.tripName||'名称未登録'}`);const now=new Date().toISOString();
    changes.forEach(([n,status])=>{const ev=evidenceByNumber.get(n);confirmed[n]={status,source:'v5-route-status-human-confirmed',confirmedAt:now,tripId:trip.id||'',evidence:ev?{coverageRatio:Number(ev.ratio.toFixed(3)),routeKm:Number(ev.totalKm.toFixed(1)),confirmedPathKm:Number(ev.confirmedKm.toFixed(1)),startDistanceKm:Number.isFinite(ev.startDist)?Number((ev.startDist/1000).toFixed(1)):null,endDistanceKm:Number.isFinite(ev.endDist)?Number((ev.endDist/1000).toFixed(1)):null,cityArrivalRule:Boolean(ev.cityRule)}:{}};});
    localStorage.setItem(CONFIRMED_STATUS_KEY,JSON.stringify(confirmed));messageEl.textContent=`${changes.length}路線の例外状態を反映しました。通常の一部走破はGPX確認時点で反映済みです。`;
    renderTrip();
  }
  function populateTrips(){trips=loadTrips();tripSelect.innerHTML='<option value="">実走した旅を選択</option>';trips.forEach((t,i)=>{const nums=routeNumbersFromTrip(t);if(!nums.length)return;const o=document.createElement('option');o.value=String(i);o.textContent=`${t.startDate||t.date||'日付未登録'}｜${t.tripName||'名称未登録'}（${nums.length}路線）`;tripSelect.appendChild(o);});const q=new URLSearchParams(location.search).get('trip');if(q!==null&&tripSelect.querySelector(`option[value="${CSS.escape(q)}"]`))tripSelect.value=q;renderTrip();}
  tripSelect.addEventListener('change',renderTrip);saveBtn.addEventListener('click',saveStatuses);fitBtn.addEventListener('click',()=>{if(currentBounds&&currentBounds.isValid())map.fitBounds(currentBounds,{padding:[24,24],maxZoom:10});});
  initMap();fetch(ROUTE_URL,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('routes read failed');return r.json();}).then(data=>{routes=Array.isArray(data)?data:[];populateTrips();}).catch(e=>{console.error(e);listEl.innerHTML='<div class="empty-box">路線データを読み込めませんでした。</div>';});
})();
