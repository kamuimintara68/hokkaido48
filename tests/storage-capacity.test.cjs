const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const {codec}=require('./storage-codec.cjs');
test('可逆保存: 日本語・絵文字・旧geometry・読み直し・sessionStorage・他キー・容量失敗',()=>{
  const {window,Storage}=codec(), store=window.localStorage;
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/trip-storage.js'),'utf8'),{window,Storage});
  assert.equal(Storage.prototype.getItem,get,'二重読み込みでも多重hookを作らない');
  assert.equal(Storage.prototype.setItem,set);
  const raw=JSON.stringify([{memo:'完走🚗 日本語'.repeat(2000),confirmedPaths:[[[43.123456789,141.987654321]]]}]);
  store.values.set('hokkaido48Trips',raw);
  assert.equal(store.getItem('hokkaido48Trips'),raw);
  assert.equal(store.values.get('hokkaido48Trips'),raw,'読込だけでは移行しない');
  store.setItem('hokkaido48Trips',raw);
  const packed=store.values.get('hokkaido48Trips');
  assert.ok(packed.startsWith('hokkaido48-lz16-v1:'));
  assert.equal(store.getItem('hokkaido48Trips'),raw);
  assert.ok(packed.length<raw.length);
  const different=raw.replace('完走','別の記録');
  store.values.set('hokkaido48Trips',window.Hokkaido48TripStorage.encode(different));
  assert.equal(store.getItem('hokkaido48Trips'),different,'別タブの変更をキャッシュで隠さない');
  store.setItem('otherKey',raw); assert.equal(store.values.get('otherKey'),raw);
  const session=new Storage();session.setItem('hokkaido48Trips',raw);assert.equal(session.values.get('hokkaido48Trips'),raw);
  const before=store.values.get('hokkaido48Trips');store.fail=true;
  assert.throws(()=>store.setItem('hokkaido48Trips',raw),/quota/);
  assert.equal(store.values.get('hokkaido48Trips'),before,'保存失敗は物理データも不変');
  store.fail=false;
  const corrupt=packed.replace(/^hokkaido48-lz16-v1:\d+\//,'hokkaido48-lz16-v1:0/');
  store.values.set('hokkaido48Trips',corrupt);
  assert.throws(()=>store.getItem('hokkaido48Trips'),/整合性/);
  assert.throws(()=>store.setItem('hokkaido48Trips','[]'),/整合性/);
  assert.equal(store.values.get('hokkaido48Trips'),corrupt,'破損を空配列で上書きしない');
});
test('全22入口が通常スクリプトより先に保存codecを読み込む',()=>{
  const entries=fs.readdirSync(root).filter(f=>f.endsWith('.html'));
  assert.equal(entries.length,22);
  for(const entry of entries){
    const text=fs.readFileSync(path.join(root,entry),'utf8');
    assert.match(text,/<script src="js\/trip-storage.js\?v=20261003-finish-capacity-1"><\/script>/,entry);
    assert.ok(text.indexOf('js/trip-storage.js')<text.search(/<script(?! src="js\/trip-storage)/),entry);
  }
});
