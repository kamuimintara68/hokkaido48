const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function codec() {
  class Storage {
    constructor(){ this.values=new Map(); this.fail=false; }
    getItem(k){return this.values.get(String(k))??null}
    setItem(k,v){if(this.fail)throw new Error('quota');this.values.set(String(k),String(v))}
  }
  const window={localStorage:new Storage()};
  const document={readyState:'loading', addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/trip-storage.js'),'utf8'),{window,Storage,document});
  return {window,Storage};
}
module.exports={codec};
