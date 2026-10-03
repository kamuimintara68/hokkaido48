// Capacity envelope, not a prediction of how many journeys the user will take.
// No GPX bodies/photos/audio are stored by the current import flow.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function lines(node, out = []) {
  if (!node) return out;
  if (node.type === 'FeatureCollection') node.features.forEach(n => lines(n, out));
  else if (node.type === 'Feature') lines(node.geometry, out);
  else if (node.type === 'GeometryCollection') node.geometries.forEach(n => lines(n, out));
  else if (node.type === 'LineString') out.push(node.coordinates.map(([lon, lat]) => [lat, lon]));
  else if (node.type === 'MultiLineString') node.coordinates.forEach(p => out.push(p.map(([lon, lat]) => [lat, lon])));
  return out;
}
function encode(paths) {
  return { format: 'delta-base36-e9-v1', scale: 1e9, paths: paths.map(p => {
    let lat = 0, lon = 0;
    return p.map(([a, b], i) => {
      a = Math.round(a * 1e9); b = Math.round(b * 1e9);
      const token = `${(i ? a-lat : a).toString(36)}:${(i ? b-lon : b).toString(36)}`;
      lat = a; lon = b; return token;
    }).join(',');
  }) };
}
function model(backup, repeats = 1, allRoutes = false) {
  const storage = backup.storage;
  const trips = JSON.parse(storage.hokkaido48Trips);
  const statuses = JSON.parse(storage.hokkaido48V5ConfirmedRouteStatus || '{}');
  const routes = JSON.parse(fs.readFileSync(path.join(root, 'data/routes-v50.json')));
  const remaining = routes.filter(r => r.challengeTarget !== false && statuses[r.number]?.status !== '全線走破');
  const included = allRoutes ? routes : remaining;
  let points = 0;
  for (let pass = 0; pass < repeats; pass++) for (const r of included) {
    const paths = lines(JSON.parse(fs.readFileSync(path.join(root, `data/geojson/route_${String(r.number).padStart(3,'0')}.geojson`))));
    const track = paths.flat(); points += track.length;
    const id = `capacity-${r.number}-${pass}`;
    const name = `${id}.gpx`;
    trips.push({ id, tripName: `容量検証 国道${r.number}号 ${pass+1}回目`, startDate:'2026-10-03', planningStatus:'recorded',
      routes: String(r.number), confirmedRouteNumbers: [String(r.number)], memo: '容量検証の追加旅',
      routeSegments: [{ id, routeNumber:String(r.number), source:'v5-gpx-human-confirmed', completionStatus:'一部走破',
        confirmedGeometry:encode(paths), geometrySource:'route-geojson-canonical', fileName:name }],
      materialImports:[{ importedAt:'2026-10-03T00:00:00Z', fileBodiesStored:false, gpx:[{ fileName:name,
        pointCount:track.length, sizeBytes:track.length*100, distanceKm:100, trackFingerprint:`capacity-envelope:${id}`,
        previewTrack:Array.from({length:100},(_,i)=>{ const p=track[Math.floor((track.length-1)*i/99)] || [43,141];
          return {lat:p[0],lng:p[1],time:new Date(Date.UTC(2026,9,3,pass,i)).toISOString()}; }) }] }],
      gpxRouteConfirmations:[{fileName:name, routeNumbers:[String(r.number)], routes:[{routeNumber:String(r.number), completionStatus:'一部走破'}]}]
    });
  }
  return { trips, raw:JSON.stringify(trips), points, remaining:remaining.map(r=>r.number),
    targetCount:routes.filter(r=>r.challengeTarget!==false).length, included:included.length, repeats };
}
module.exports = { model, lines, encode };
if (require.main === module) {
  const vm = require('node:vm');
  class Storage { constructor(){this.data={}} getItem(k){return this.data[k]??null} setItem(k,v){this.data[k]=String(v)} }
  const storage = new Storage(); const window = {localStorage:storage};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/trip-storage.js'),'utf8'), {window,Storage});
  const backup = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname,'private-fixtures/iphone-18.json')));
  const others = Object.entries(backup.storage).filter(([k])=>k!=='hokkaido48Trips').reduce((n,[k,v])=>n+2*(k.length+v.length),0);
  for (const [label,repeat,all] of [['remaining-once',1,false],['remaining-four-times',4,false],['all-48-four-times',4,true]]) {
    const m=model(backup,repeat,all), compressed=window.Hokkaido48TripStorage.encode(m.raw);
    // Extra reserve for status, drafts and metadata outside the supplied backup.
    const reserved=512*1024, physical=2*('hokkaido48Trips'.length+compressed.length)+others;
    console.log(JSON.stringify({label,remaining:m.remaining,targets:m.targetCount,extraTrips:m.included*repeat,totalTrips:m.trips.length,
      addedCanonicalPoints:m.points,plainBytes:2*m.raw.length,compressedTotalBytes:physical,reservedBytes:reserved,
      headroomAfterReserve:5*1024*1024-physical-reserved,exactRoundTrip:window.Hokkaido48TripStorage.decode(compressed)===m.raw}));
  }
}
