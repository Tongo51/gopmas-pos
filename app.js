'use strict';
// ================= storage =================
var LS = { cfg:'pos.cfg', session:'pos.session', master:'pos.master', roster:'pos.roster',
           lastyear:'pos.lastyear', queue:'pos.queue', day:function(d){return 'pos.day.'+d;} };
function load(k, def){ try { var v = JSON.parse(localStorage.getItem(k)); return v==null?def:v; } catch(e){ return def; } }
function save(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function fmt(n){ return (Number(n)||0).toLocaleString('th-TH'); }
function todayStr(){ var d=new Date(); return d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear(); }
function $(id){ return document.getElementById(id); }
function showEl(id, on){ $(id).classList.toggle('hidden', !on); }

// URL ค่าตั้งต้น — พนักงานเปิดแอปแล้วล็อกอินได้เลย ไม่ต้องกรอกเอง (เปลี่ยนได้ในหน้าตั้งค่า)
var DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbzI4QLD2rqskgPwq64jxdToU0xvg0qCXiohDIJWiwSCV2FAgUtXN_knRaIdQQTGu35n/exec';
var cfg = load(LS.cfg, { url: DEFAULT_URL });
if (!cfg.url) { cfg.url = DEFAULT_URL; save(LS.cfg, cfg); }
var session = load(LS.session, null);
var master = load(LS.master, { products:[], customers:[], roster:[] });
var roster = load(LS.roster, { employees:[], lines:[] });
var day = null;
var editKey = null, mPaidTouched = false, payMode = 'เงินสด', modalCust = null;
var selectedEmp = null, selectedLine = null, pinBuf = '';

// ================= api =================
function apiGet(action, params){
  var q = '?action=' + encodeURIComponent(action);
  for (var k in (params||{})) q += '&' + k + '=' + encodeURIComponent(params[k]);
  return fetch(cfg.url + q).then(function(r){ return r.json(); });
}
function apiPost(body){
  return fetch(cfg.url, { method:'POST', body: JSON.stringify(body) }).then(function(r){ return r.json(); });
}

// ================= boot =================
function boot(){
  if (!cfg.url){ showLoginStage('needCfg'); return; }
  if (session){ enterApp(); return; }
  showLoginStage('pickEmp'); loadRoster();
}
function showLoginStage(which){
  $('login').classList.remove('hidden'); $('app').classList.add('hidden');
  ['needCfg','pickEmp','empPin','adminBox'].forEach(function(s){ showEl(s, s===which); });
  $('loginTag').textContent = which==='needCfg' ? 'ตั้งค่าการเชื่อมต่อครั้งแรก' : 'ระบบขายหน้ารถ';
}

// ---- first url ----
function saveFirstUrl(){
  cfg.url = $('firstUrl').value.trim(); save(LS.cfg, cfg);
  $('cfgMsg').textContent = 'กำลังเชื่อมต่อ…';
  apiGet('ping').then(function(j){
    if (!j.ok) throw 'ตอบกลับผิดปกติ';
    $('cfgMsg').textContent = '✓ เชื่อมต่อสำเร็จ';
    showLoginStage('pickEmp'); loadRoster();
  }).catch(function(e){ $('cfgMsg').textContent = '✗ เชื่อมต่อไม่ได้: ' + e; });
}

// ---- roster / pick employee ----
function loadRoster(){
  $('rosterList').innerHTML = '<p class="note">กำลังโหลด…</p>';
  apiGet('roster').then(function(j){
    if (!j.ok) throw j.error;
    roster = { employees:j.employees||[], lines:j.lines||[] }; save(LS.roster, roster);
    renderRoster();
  }).catch(function(e){
    if (roster.employees.length) renderRoster();  // ใช้ cache
    else $('rosterList').innerHTML = '<p class="warn">โหลดรายชื่อไม่ได้ ('+e+') ตรวจสัญญาณ/URL</p>';
  });
}
function renderRoster(){
  var q = ($('empSearch').value||'').trim();
  var list = roster.employees.filter(function(e){ return !q || e.name.indexOf(q)>=0; });
  $('rosterList').innerHTML = list.map(function(e){
    return '<button onclick="pickEmp(\''+e.name.replace(/'/g,"\\'")+'\')">'
      + '<span class="av">'+ (e.name[0]||'?') +'</span>'
      + '<span><span class="nm">'+e.name+'</span> <small>'+(e.line?('· '+e.line):'')+(e.spare?' · สแปร์':'')+'</small></span></button>';
  }).join('') || '<p class="note">ไม่พบชื่อ</p>';
}
function pickEmp(name){
  selectedEmp = roster.employees.filter(function(e){ return e.name===name; })[0] || { name:name, line:'' };
  selectedLine = selectedEmp.line || (roster.lines[0]||'');
  pinBuf = '';
  $('pinAv').textContent = name[0]||'?';
  $('pinName').textContent = name;
  updatePinLine();
  renderPinDots();
  $('empErr').textContent = '';
  showLoginStage('empPin');
}
function updatePinLine(){ $('pinLine').innerHTML = 'สายวันนี้ · <span class="linechip">❄ '+ (selectedLine||'—') +'</span>'; }
function changeLine(){
  if (!roster.lines.length){ alert('ยังไม่มีรายชื่อสาย'); return; }
  var i = roster.lines.indexOf(selectedLine);
  selectedLine = roster.lines[(i+1) % roster.lines.length];  // วนเลือกสายถัดไป
  updatePinLine();
}
function backToPick(){ pinBuf=''; showLoginStage('pickEmp'); loadRoster(); }
function renderPinDots(){ var d=$('pinDots').children; for (var i=0;i<4;i++) d[i].classList.toggle('f', i<pinBuf.length); }
function buildPinPad(){
  var keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  $('pinKeys').innerHTML = '';
  keys.forEach(function(k){
    var b = document.createElement('button'); b.textContent = k; if (!k) b.className='blank';
    if (k) b.onclick = function(){
      if (k==='⌫') pinBuf = pinBuf.slice(0,-1);
      else if (pinBuf.length<4) pinBuf += k;
      renderPinDots();
      if (pinBuf.length===4) submitEmpPin();
    };
    $('pinKeys').appendChild(b);
  });
}
function submitEmpPin(){
  $('empErr').textContent = 'กำลังตรวจสอบ…';
  apiPost({ action:'loginEmployee', name:selectedEmp.name, pin:pinBuf }).then(function(j){
    if (!j.ok){ $('empErr').textContent = j.error||'PIN ไม่ถูกต้อง'; pinBuf=''; renderPinDots(); return; }
    session = { role:'employee', name:j.name, line:selectedLine||j.line||'', token:j.token };
    save(LS.session, session); enterApp();
  }).catch(function(e){ $('empErr').textContent = 'เชื่อมต่อไม่ได้ ('+e+')'; pinBuf=''; renderPinDots(); });
}

// ---- admin login ----
function showAdminLogin(){ $('admErr').textContent=''; showLoginStage('adminBox'); }
function doAdminLogin(){
  $('admErr').textContent = 'กำลังตรวจสอบ…';
  apiPost({ action:'loginAdmin', user:$('admUser').value.trim(), pin:$('admPin').value }).then(function(j){
    if (!j.ok){ $('admErr').textContent = j.error||'ไม่ถูกต้อง'; return; }
    session = { role:'admin', name:j.name, token:j.token }; save(LS.session, session); enterApp();
  }).catch(function(e){ $('admErr').textContent = 'เชื่อมต่อไม่ได้ ('+e+')'; });
}
function logout(){
  if (!confirm('ออกจากระบบ?')) return;
  localStorage.removeItem(LS.session); session=null; boot();
}

// ================= enter app =================
var NAVS = {
  employee: [['sell','🛒','ขาย'],['close','📋','ปิดวัน'],['cfg','⚙️','ตั้งค่า']],
  admin:    [['monitor','📡','มอนิเตอร์'],['products','📦','สินค้า'],['lines','🚚','สาย'],['cfg','⚙️','ตั้งค่า']]
};
function enterApp(){
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  var _d = load(LS.day(todayStr()), null);
  day = _d ? Object.assign(newDay(), _d) : newDay();  // เติมฟิลด์ใหม่ให้ day เก่าครบ (backward compatible)
  $('hSub').textContent = session.role==='admin' ? '· แอดมิน' : '· ' + session.line + ' · ' + session.name;
  // nav
  var navs = NAVS[session.role];
  $('nav').innerHTML = navs.map(function(n,i){
    return '<button class="'+(i===0?'on':'')+'" onclick="go(\''+n[0]+'\',this)"><span class="ic">'+n[1]+'</span>'+n[2]+'</button>';
  }).join('');
  go(navs[0][0], $('nav').children[0]);
  renderChip(load(LS.queue,[]).length);
  if (session.role==='employee'){ ensureMaster(); }
}
function go(id, btn){
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  $('scr-'+id).classList.add('active');
  Array.prototype.forEach.call($('nav').children, function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  if (id==='sell'){ renderChallenge(); renderCustomers(); }
  if (id==='close') renderSummary();
  if (id==='monitor') loadMonitor();
  if (id==='products') loadProducts();
  if (id==='lines') renderLineProducts();
  if (id==='cfg') renderCfg();
}

// ================= master =================
function ensureMaster(){
  if (master.products.length && master.line===session.line){ renderChallenge(); renderCustomers(); }
  refreshMaster(true);
}
function refreshMaster(silent){
  if (session.role!=='employee') return;
  apiGet('master', { line:session.line }).then(function(j){
    if (!j.ok) throw j.error;
    master = j; master.line = session.line; save(LS.master, master);
    renderChallenge(); renderCustomers();
  }).catch(function(e){ if(!silent) alert('โหลดข้อมูลไม่ได้: '+e+' (ใช้ข้อมูลเดิม)'); });
  apiGet('lastyear', { line:session.line }).then(function(j){
    if (j.ok){ save(LS.lastyear+'.'+todayStr(), j); renderChallenge(); }
  }).catch(function(){});
}

// ================= day state =================
function newDay(){ return { date:todayStr(), entries:{}, employees:[], withdraw:{}, grokk:{},
  fuel:'', gas:'', sackAdd:'', sackRet:'', sendMethod:'โอนเข้าบัญชี' }; }
function saveDay(){ save(LS.day(day.date), day); scheduleHeartbeat(); }

// ================= sell: challenge =================
function renderChallenge(){
  var ly = load(LS.lastyear+'.'+todayStr(), null);
  var el = $('challenge'); if (!el) return;
  if (!ly || !ly.total){ el.innerHTML=''; return; }
  var now = totals().send, pct = ly.total ? Math.min(100, Math.round(now*100/ly.total)) : 0;
  var pnames = { 'หลอดใหญ่':'หลอดใหญ่','หลอดเล็ก':'หลอดเล็ก','น้ำแข็งโม่':'โม่','ลูก':'ลูก','น้ำโหล':'น้ำโหล','น้ำถ้วย':'น้ำถ้วย' };
  var chips = Object.keys(ly.products||{}).filter(function(k){ return ly.products[k]; })
    .map(function(k){ return '<span>'+pnames[k]+' '+fmt(ly.products[k])+'</span>'; }).join('');
  el.innerHTML = '<div class="challenge"><div class="eb">วันนี้เมื่อปีที่แล้ว</div>'
    + '<div class="amt">'+fmt(ly.total)+' <small>บาท · '+(ly.date||'')+'</small></div>'
    + '<div class="prods">'+chips+'</div>'
    + '<div class="bar"><i style="width:'+pct+'%"></i></div>'
    + '<div class="now"><span>วันนี้ทำได้ '+fmt(now)+'</span><span>'+pct+'% ของปีที่แล้ว'+(pct>=100?' · เยี่ยม! 🎉':' · สู้ๆ!')+'</span></div></div>';
}

// ================= sell: customer list =================
function myCustomers(){ return master.customers.slice().sort(function(a,b){ return a.order-b.order; }); }
function custByName(name){ return master.customers.filter(function(c){ return c.name===name; })[0] || null; }
function productById(id){ return master.products.filter(function(p){ return p.id===id; })[0] || null; }
// ราคา: ดีลรายลูกค้า > ราคาขั้นบันได(ตามจำนวน) > ราคากลาง
function unitPrice(cust, p, qty){
  if (cust && cust.prices && cust.prices[p.id]!=null) return cust.prices[p.id];
  if (p.tiers && p.tiers.length){ qty = qty||0;
    for (var i=0;i<p.tiers.length;i++) if (qty>=p.tiers[i].min) return p.tiers[i].price; // เรียง min มาก→น้อย
  }
  return p.price;
}

function renderCustomers(){
  var q = ($('search').value||'').trim();
  var names = myCustomers().map(function(c){ return c.name; });
  Object.keys(day.entries).forEach(function(n){ if (names.indexOf(n)<0) names.push(n); });
  var html = names.filter(function(n){ return !q || n.indexOf(q)>=0; }).map(function(n, i){
    var c = custByName(n), e = day.entries[n];
    var ord = c ? c.order : '+';
    var usual = c && c.usual && c.usual.length ? '<div class="usual">'+ c.usual.map(pnameOf).join(' · ') +'</div>' : '';
    var amt = e ? (e.owed>0 ? '<span class="amt o">ค้าง '+fmt(e.owed)+'</span>' : '<span class="amt g">'+fmt(e.paid+e.paidDebt)+'</span>')
                : '<span class="amt m">แตะ</span>';
    return '<div class="cust '+(e?'done':'')+'" onclick="openEntry(\''+n.replace(/'/g,"\\'")+'\')">'
      + '<div class="ord">'+ord+'</div><div style="flex:1"><div class="nm">'+n+'</div>'+usual+'</div>'+amt+'</div>';
  }).join('');
  $('custList').innerHTML = html || '<p class="note">ยังไม่มีลูกค้า — โหลดข้อมูลในหน้าตั้งค่า</p>';
}
function pnameOf(id){ var p = master.products.filter(function(x){return x.id===id;})[0]; return p?p.name:id; }

// ================= modal =================
function openEntry(name){
  editKey = name;
  var cust = name ? custByName(name) : null;
  var e = name ? day.entries[name] : null;
  modalCust = cust; mPaidTouched = !!e;
  $('mName').value = name||''; $('mName').readOnly = !!cust;
  var usualIds = cust ? cust.usual.slice() : master.products.map(function(p){return p.id;});
  // สินค้าที่เคยซื้อเพิ่มไว้ในบิลนี้ ให้ถือเป็นของประจำด้วย
  if (e) Object.keys(e.items).forEach(function(pid){ if (usualIds.indexOf(pid)<0) usualIds.push(pid); });
  var extraIds = master.products.map(function(p){return p.id;}).filter(function(id){ return usualIds.indexOf(id)<0; });
  $('mUsual').innerHTML = usualIds.map(function(id){ return prodRow(id, e, true); }).join('');
  $('mExtra').innerHTML = extraIds.map(function(id){ return prodRow(id, e, false); }).join('');
  $('mExtra').classList.remove('show');
  $('mAddBtn').style.display = extraIds.length ? '' : 'none';
  $('mAddBtn').textContent = '＋ เพิ่มสินค้าอื่น ('+ extraIds.map(pnameOf).join(' · ') +')';
  setPay(e? e.payment : 'เงินสด', true);
  $('mPaid').value = e ? e.paid : ''; $('mDebt').value = (e&&e.paidDebt)?e.paidDebt:'';
  renderEntryTotal();
  $('modal').classList.add('open');
}
function prodRow(id, e, usual){
  var p = productById(id); if (!p) return '';
  var qty = e && e.items[id] ? e.items[id] : 0;
  var price = unitPrice(modalCust, p, qty||1);
  var tierTag = (p.tiers && p.tiers.length) ? ' <span class="tag">ขั้นบันได</span>' : '';
  return '<div class="prod-row"><span class="pn">'+p.name+(usual&&modalCust?' <span class="tag">ประจำ</span>':'')+tierTag
    +'<small id="pl-'+id+'">'+fmt(price)+' บาท</small></span>'
    +'<div class="qty"><button onclick="bump(\''+id+'\',-1)">−</button>'
    +'<input type="number" inputmode="numeric" id="q-'+id+'" data-pid="'+id+'" value="'+(qty||'')+'" oninput="renderEntryTotal()">'
    +'<button onclick="bump(\''+id+'\',1)">＋</button></div></div>';
}
function showExtra(){ $('mExtra').classList.add('show'); $('mAddBtn').style.display='none'; }
function closeEntry(){ $('modal').classList.remove('open'); }
function bump(id, d){ var el=$('q-'+id); el.value = Math.max(0,(Number(el.value)||0)+d)||''; renderEntryTotal(); }
function setPay(mode, silent){ payMode=mode; Array.prototype.forEach.call($('mPay').children, function(b){ b.classList.toggle('on', b.textContent.indexOf(mode)===0); }); if(!silent){ mPaidTouched=false; renderEntryTotal(); } }
function entryTotal(){
  var t=0;
  document.querySelectorAll('#modal .qty input').forEach(function(el){
    var q=Number(el.value)||0; if(!q) return;
    t += q * unitPrice(modalCust, productById(el.dataset.pid), q);
  });
  return t;
}
function renderEntryTotal(){
  // อัปเดตราคาต่อหน่วยตามจำนวน (ราคาขั้นบันไดเปลี่ยนตามจำนวนที่ซื้อ)
  document.querySelectorAll('#modal .qty input').forEach(function(el){
    var q=Number(el.value)||0, p=productById(el.dataset.pid), lbl=$('pl-'+el.dataset.pid);
    if (lbl && p) lbl.textContent = fmt(unitPrice(modalCust, p, q||1)) + ' บาท';
  });
  var t = entryTotal();
  if (!mPaidTouched) $('mPaid').value = payMode==='เงินสด' ? (t||'') : 0;
  var paid = Number($('mPaid').value)||0;
  $('mTotal').textContent = fmt(t); $('mOwed').textContent = fmt(Math.max(0, t-paid));
}
function collectItems(){ var it={}; document.querySelectorAll('#modal .qty input').forEach(function(el){ var q=Number(el.value)||0; if(q>0) it[el.dataset.pid]=q; }); return it; }
function saveEntry(){
  var name = $('mName').value.trim(); if (!name){ alert('ใส่ชื่อลูกค้าก่อน'); return; }
  var items = collectItems(), total = entryTotal();
  var paid = Number($('mPaid').value)||0, paidDebt = Number($('mDebt').value)||0;
  if (!total && !paidDebt){ deleteEntry(); return; }
  if (editKey && editKey!==name) delete day.entries[editKey];
  day.entries[name] = { items:items, total:total, paid:paid, paidDebt:paidDebt, owed:Math.max(0,total-paid), payment:payMode };
  saveDay(); closeEntry(); renderCustomers(); renderChallenge();
}
function deleteEntry(){ if (editKey){ delete day.entries[editKey]; saveDay(); } closeEntry(); renderCustomers(); renderChallenge(); }

// ================= close / summary =================
function totals(){
  var cash=0, debt=0, owed=0, sold={};
  if (day) Object.keys(day.entries).forEach(function(n){ var e=day.entries[n];
    cash+=e.paid; debt+=e.paidDebt; owed+=e.owed;
    Object.keys(e.items).forEach(function(pid){ sold[pid]=(sold[pid]||0)+e.items[pid]; });
  });
  var fuel=Number(day?day.fuel:0)||0, gas=Number(day?day.gas:0)||0;
  return { cash:cash, debt:debt, owed:owed, sold:sold, fuel:fuel, gas:gas, send:cash+debt-fuel-gas };
}
function setSendMethod(m){ day.sendMethod=m; Array.prototype.forEach.call($('paySeg').children,function(b){ b.classList.toggle('on', b.textContent===m); });
  $('payHint').textContent = m==='โอนเข้าบัญชี' ? 'โอนแล้วแนบใบนำฝากมากับใบรายงาน A4' : 'ส่งเงินสดพร้อมใบรายงาน'; saveDay(); }
function renderSummary(){
  ['inFuel:fuel','inGas:gas','inSackAdd:sackAdd','inSackRet:sackRet'].forEach(function(m){ var a=m.split(':'); day[a[1]]=$(a[0]).value; });
  saveDay();
  var t = totals();
  // พนักงาน
  var emps = roster.employees.slice().sort(function(a,b){ return (a.line===session.line?0:1)-(b.line===session.line?0:1); });
  $('empPick').innerHTML = emps.map(function(e){
    return '<span class="emp-tag '+(day.employees.indexOf(e.name)>=0?'on':'')+'" onclick="toggleEmp(\''+e.name.replace(/'/g,"\\'")+'\')">'+e.name+(e.spare?' (สแปร์)':'')+'</span>';
  }).join('') || '<span class="note">ไม่มีรายชื่อพนักงาน</span>';
  // ตาราง เบิก/ขาย/กรอก/คืน
  var rows = '<tr><th>สินค้า</th><th>เบิก</th><th>ขาย</th><th>กรอก</th><th>คืน</th></tr>';
  master.products.forEach(function(p){
    var wd = day.withdraw[p.id]||0, s = t.sold[p.id]||0, g = Number(day.grokk[p.id])||0;
    if (!wd && !s && !g) return;
    var ret = wd - s - g;
    rows += '<tr><td>'+p.name+'</td><td>'+fmt(wd)+'</td><td>'+fmt(s)+'</td>'
      + '<td><input type="number" inputmode="numeric" value="'+(g||'')+'" style="width:44px;text-align:right;padding:3px 4px;font-size:13px" oninput="setGrokk(\''+p.id+'\',this.value)"></td>'
      + '<td'+(ret<0?' style="color:var(--red)"':'')+'>'+fmt(ret)+'</td></tr>';
  });
  $('stockTbl').innerHTML = rows;
  $('tCash').textContent=fmt(t.cash); $('tDebt').textContent=fmt(t.debt); $('tOwed').textContent=fmt(t.owed);
  $('tSend').textContent=fmt(t.send);
  var n = day.employees.length||1;
  $('tComm').textContent = fmt(Math.round(t.send*0.05/n))+' /คน ('+n+' คน)';
  $('sackNet').textContent = fmt((Number(day.sackAdd)||0)-(Number(day.sackRet)||0));
  $('inFuel').value=day.fuel; $('inGas').value=day.gas; $('inSackAdd').value=day.sackAdd; $('inSackRet').value=day.sackRet;
  setSendMethod(day.sendMethod||'โอนเข้าบัญชี');
}
function setGrokk(pid, v){ day.grokk[pid]=v; saveDay(); }
function toggleEmp(name){ var i=day.employees.indexOf(name); if(i>=0)day.employees.splice(i,1); else day.employees.push(name); saveDay(); renderSummary(); }
function loadWithdraw(){
  $('wdStatus').textContent='กำลังดึง…';
  apiGet('withdraw',{ line:session.line }).then(function(j){
    if (!j.ok) throw j.error;
    day.withdraw={}; Object.keys(j.items).forEach(function(nm){
      var p = master.products.filter(function(x){ return x.name===nm||x.id===nm; })[0];
      if (p) day.withdraw[p.id]=j.items[nm];
    });
    saveDay(); renderSummary(); $('wdStatus').textContent='✓ ดึงแล้ว '+Object.keys(j.items).length+' รายการ';
  }).catch(function(e){ $('wdStatus').textContent='✗ ดึงไม่ได้ (offline?) ใส่มือได้'; });
}

// ================= heartbeat (near-real-time) =================
var hbTimer = null;
function scheduleHeartbeat(){ if (session && session.role==='employee'){ clearTimeout(hbTimer); hbTimer=setTimeout(sendHeartbeat, 8000); } }
function sendHeartbeat(){
  if (!session || session.role!=='employee' || !navigator.onLine) return;
  var t = totals();
  apiPost({ action:'heartbeat', line:session.line, employees:day.employees,
    customers:Object.keys(day.entries).length, cash:t.cash, owed:t.owed, moneySent:t.send,
    sold:t.sold, status:'running' }).catch(function(){});
}
setInterval(sendHeartbeat, 180000); // ทุก 3 นาที

// ================= submit + queue =================
function buildPayload(){
  var t = totals();
  return { action:'submit',
    txId:'TX'+day.date.replace(/\//g,'')+'-'+session.line+'-'+Date.now(),
    date:day.date, line:session.line, employees:day.employees,
    sold:t.sold, moneySent:t.send, fuelTotal:t.fuel+t.gas, cash:t.cash, owed:t.owed,
    customers:Object.keys(day.entries).length, sendMethod:day.sendMethod,
    sackAdd:Number(day.sackAdd)||0, sackRet:Number(day.sackRet)||0,
    details:Object.keys(day.entries).map(function(name){ var e=day.entries[name];
      return { customer:name, payment:e.payment,
        items:master.products.filter(function(p){return e.items[p.id];}).map(function(p){return p.id+'×'+e.items[p.id];}).join(', '),
        total:e.total, paid:e.paid, owed:e.owed, paidDebt:e.paidDebt };
    }) };
}
function submitDay(){
  if (!day.employees.length){ alert('เลือกพนักงานที่ไปวันนี้ก่อน'); return; }
  if (!Object.keys(day.entries).length){ alert('ยังไม่มีรายการขาย'); return; }
  if (!confirm('ยืนยันปิดวัน ส่งเงิน '+fmt(totals().send)+' บาท?')) return;
  var q = load(LS.queue,[]); q.push(buildPayload()); save(LS.queue,q);
  $('submitNote').textContent = 'เข้าคิวส่งแล้ว — ถ้าไม่มีสัญญาณจะส่งเองเมื่อออนไลน์';
  syncQueue();
}
var syncing=false;
function syncQueue(){
  if (syncing) return Promise.resolve();
  var q = load(LS.queue,[]); renderChip(q.length);
  if (!q.length || !navigator.onLine || !cfg.url) return Promise.resolve();
  syncing=true;
  return (function next(){
    var qq = load(LS.queue,[]);
    if (!qq.length){ syncing=false; $('submitNote').textContent='✓ ส่งรายงานเข้าชีตแล้ว'; renderChip(0); return; }
    return apiPost(qq[0]).then(function(j){
      if (!j.ok) throw j.error;
      if (j.warn) alert('ส่งสำเร็จ แต่: '+j.warn);
      qq.shift(); save(LS.queue,qq); renderChip(qq.length); return next();
    }).catch(function(e){ syncing=false; $('submitNote').textContent='ยังส่งไม่สำเร็จ จะลองใหม่ ('+e+')'; });
  })();
}
function renderChip(n){
  var c=$('syncChip');
  if (n>0){ c.textContent='⏳ รอส่ง '+n; c.className='chip wait'; }
  else if (!navigator.onLine){ c.textContent='⚡ offline'; c.className='chip'; }
  else { c.textContent='✓ พร้อม'; c.className='chip ok'; }
}
window.addEventListener('online', function(){ syncQueue(); sendHeartbeat(); });
window.addEventListener('offline', function(){ renderChip(load(LS.queue,[]).length); });
setInterval(syncQueue, 60000);

// ================= admin: monitor =================
function loadMonitor(){
  $('monStatus').textContent='กำลังโหลด…';
  apiGet('monitor').then(function(j){
    if (!j.ok) throw j.error;
    $('monTotal').textContent = fmt(j.total);
    $('monRunning').textContent = j.running+' / '+j.count;
    $('monStatus').textContent = 'อัปเดต '+ new Date().toLocaleTimeString('th-TH');
    $('monList').innerHTML = j.lines.sort(function(a,b){ return a.line<b.line?-1:1; }).map(function(l){
      var fresh = l.status==='closed' ? 'offline' : (l.agoMin!=null && l.agoMin<=10 ? 'synced' : 'stale');
      var stt = l.status==='closed' ? 'ปิดวันแล้ว' : (l.agoMin!=null ? l.agoMin+' นาที' : '—');
      return '<div class="lineitem"><div class="h"><div class="badge">'+l.line+'</div>'
        +'<div class="who2"><b>'+(l.employees||'—')+'</b><small>ลูกค้าแล้ว '+l.customers+' ราย</small></div>'
        +'<span class="chip '+(fresh==='synced'?'ok':(fresh==='stale'?'wait':''))+'"><span class="dot"></span> '+stt+'</span></div>'
        +'<div class="foot"><span class="'+fresh+'">'+(l.status==='closed'?'ส่งรายงานแล้ว ✓':'ค้างใหม่ '+fmt(l.owed))+'</span>'
        +'<span class="money">'+fmt(l.moneySent)+'</span></div></div>';
    }).join('') || '<p class="note">ยังไม่มีสายที่เริ่มขายวันนี้</p>';
  }).catch(function(e){ $('monStatus').textContent='โหลดไม่ได้ ('+e+')'; });
}
setInterval(function(){ if ($('scr-monitor').classList.contains('active')) loadMonitor(); }, 60000);

// ================= admin: add line =================
var lineProdSel = {};
function renderLineProducts(){
  var prods = master.products.length ? master.products : [
    {id:'หลอดใหญ่',name:'หลอดใหญ่'},{id:'หลอดเล็ก',name:'หลอดเล็ก'},{id:'โม่',name:'น้ำแข็งโม่'},
    {id:'ลูก',name:'น้ำแข็งลูก'},{id:'น้ำโหล',name:'น้ำโหล'},{id:'น้ำถ้วย',name:'น้ำถ้วย'},{id:'ซอง',name:'น้ำแข็งซอง'}];
  $('lnProds').innerHTML = prods.map(function(p){
    return '<span class="emp-tag '+(lineProdSel[p.id]?'on':'')+'" onclick="toggleLineProd(\''+p.id+'\')">'+p.name+'</span>';
  }).join('');
}
function toggleLineProd(id){ lineProdSel[id]=!lineProdSel[id]; renderLineProducts(); }
function doAddLine(){
  var code=$('lnCode').value.trim(); if (!code){ alert('ใส่รหัสสาย'); return; }
  var prods = Object.keys(lineProdSel).filter(function(k){ return lineProdSel[k]; });
  $('lnMsg').textContent='กำลังสร้าง…';
  apiPost({ action:'addLine', line:code, zone:$('lnZone').value.trim(),
    employees:$('lnEmps').value.split(',').map(function(s){return s.trim();}).filter(Boolean), products:prods
  }).then(function(j){
    if (!j.ok) throw j.error;
    $('lnMsg').textContent='✓ สร้างสาย '+code+' แล้ว'; $('lnCode').value=''; $('lnZone').value=''; $('lnEmps').value=''; lineProdSel={}; renderLineProducts();
  }).catch(function(e){ $('lnMsg').textContent='✗ '+e; });
}

// ================= admin: จัดการสินค้า =================
var allProds = [], editingProdId = null;
function loadProducts(){
  $('prodList').innerHTML = '<p class="note">กำลังโหลด…</p>';
  apiGet('allproducts').then(function(j){
    if (!j.ok) throw j.error;
    allProds = j.products; renderProducts();
  }).catch(function(e){ $('prodList').innerHTML = '<p class="warn">โหลดไม่ได้ ('+e+')</p>'; });
}
function renderProducts(){
  $('prodList').innerHTML = allProds.map(function(p){
    var priceTxt = p.tiers ? ('ขั้นบันได '+p.tiers) : (fmt(p.price)+' บาท');
    return '<div class="cust" style="cursor:default">'
      + '<div style="flex:1"><div class="nm">'+p.name+(p.active?'':' <span style="color:var(--muted)">(ปิด)</span>')+'</div>'
      + '<div class="usual">'+priceTxt+(p.col?(' · คอลัมน์ '+p.col):'')+'</div></div>'
      + '<button class="emp-tag" onclick="editProduct(\''+p.id.replace(/'/g,"\\'")+'\')">แก้ไข</button>'
      + '<button class="emp-tag" style="color:var(--red)" onclick="doDeleteProduct(\''+p.id.replace(/'/g,"\\'")+'\')">ลบ</button></div>';
  }).join('') || '<p class="note">ยังไม่มีสินค้า</p>';
}
function editProduct(id){
  var p = allProds.filter(function(x){return x.id===id;})[0]; if(!p) return;
  editingProdId = id;
  $('pFormTitle').textContent = 'แก้ไข: '+p.name;
  $('pId').value=p.id; $('pName').value=p.name; $('pPrice').value=p.price; $('pCol').value=p.col; $('pTiers').value=p.tiers||'';
  $('pMsg').textContent=''; window.scrollTo(0,0);
}
function clearProdForm(){
  editingProdId=null; $('pFormTitle').textContent='เพิ่มสินค้าใหม่';
  ['pId','pName','pPrice','pCol','pTiers'].forEach(function(i){ $(i).value=''; }); $('pMsg').textContent='';
}
function doSaveProduct(){
  var id=$('pId').value.trim(); if(!id){ alert('ใส่รหัสสินค้า'); return; }
  $('pMsg').textContent='กำลังบันทึก…';
  apiPost({ action:'saveProduct', id:id, origId:editingProdId, name:$('pName').value.trim(),
    price:Number($('pPrice').value)||0, col:$('pCol').value.trim(), tiers:$('pTiers').value.trim() })
  .then(function(j){ if(!j.ok) throw j.error; $('pMsg').textContent='✓ บันทึกแล้ว'; clearProdForm(); loadProducts(); refreshMaster(true); })
  .catch(function(e){ $('pMsg').textContent='✗ '+e; });
}
function doDeleteProduct(id){
  if(!confirm('ลบสินค้า '+id+'?')) return;
  apiPost({ action:'deleteProduct', id:id }).then(function(j){ if(!j.ok) throw j.error; loadProducts(); refreshMaster(true); })
  .catch(function(e){ alert('ลบไม่ได้: '+e); });
}

// ================= settings =================
function renderCfg(){
  $('cfgUser').textContent=session.name; $('cfgRole').textContent = session.role==='admin'?'แอดมิน':'พนักงาน';
  showEl('cfgLineWrap', session.role==='employee'); if (session.role==='employee') $('cfgLine').textContent=session.line;
  $('cfgTarget').textContent = (master.target==='prod'?'ฐานจริง (1zd1)':'ฐานทดสอบ');
  $('cfgDate').textContent=todayStr(); $('cfgCount').textContent=day?Object.keys(day.entries).length:0;
}
function clearDay(){ if(!confirm('ล้างข้อมูลขายวันนี้?'))return; day=newDay(); saveDay(); go('sell',$('nav').children[0]); }

// ================= พิมพ์ A4 (Android-safe: หน้าเอกสารแยก) =================
function reportHTML(){
  var t=totals(), n=day.employees.length||1;
  var stock = master.products.map(function(p){ var wd=day.withdraw[p.id]||0, s=t.sold[p.id]||0, g=Number(day.grokk[p.id])||0;
    if(!wd&&!s&&!g) return ''; return '<tr><td>'+p.name+'</td><td>'+fmt(wd)+'</td><td>'+fmt(s)+'</td><td>'+fmt(g)+'</td><td>'+fmt(wd-s-g)+'</td></tr>'; }).join('');
  var credit = Object.keys(day.entries).filter(function(k){return day.entries[k].owed>0;})
    .map(function(k){ return '<tr><td>'+k+'</td><td>'+fmt(day.entries[k].owed)+'</td></tr>'; }).join('') || '<tr><td colspan="2">— ไม่มี —</td></tr>';
  return '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>รายงานขาย '+session.line+' '+day.date+'</title>'
    + '<style>@page{size:A4;margin:12mm}*{font-family:\'Sarabun\',\'Leelawadee UI\',sans-serif}body{color:#000;font-size:13px}'
    + 'h1{font-size:18px;margin:0 0 2px}.sub{color:#444;margin-bottom:10px}table{width:100%;border-collapse:collapse;margin-bottom:10px}'
    + 'th,td{border:1px solid #999;padding:4px 6px;text-align:right}th:first-child,td:first-child{text-align:left}'
    + '.cols{display:flex;gap:16px}.cols>div{flex:1}.sign{display:flex;gap:24px;margin-top:30px}'
    + '.sign div{flex:1;border-top:1px dotted #000;text-align:center;padding-top:4px;font-size:12px}.pbtn{margin:10px 0}'
    + '@media print{.pbtn{display:none}}</style></head><body>'
    + '<button class="pbtn" onclick="window.print()">🖨 พิมพ์ / บันทึกเป็น PDF</button>'
    + '<h1>รายงานขายประจำวัน — สาย '+session.line+'</h1>'
    + '<div class="sub">วันที่ '+day.date+' · พนักงาน: '+(day.employees.join(', ')||'-')+' · ส่งเงินโดย: '+(day.sendMethod||'-')+'</div>'
    + '<div class="cols"><div>'
    + '<table><tr><th>สินค้า</th><th>เบิก</th><th>ขาย</th><th>กรอก</th><th>คืน</th></tr>'+stock+'</table>'
    + '<table><tr><th colspan="2">ลูกค้าค้างจ่ายวันนี้</th></tr>'+credit+'</table></div><div>'
    + '<table><tr><td>ลูกค้าจ่าย</td><td>'+fmt(t.cash)+'</td></tr><tr><td>เก็บหนี้เก่า</td><td>'+fmt(t.debt)+'</td></tr>'
    + '<tr><td>ค้างใหม่วันนี้</td><td>'+fmt(t.owed)+'</td></tr><tr><td>ค่าน้ำมัน+แก๊ส</td><td>'+fmt(t.fuel+t.gas)+'</td></tr>'
    + '<tr><th>ส่งเงินทั้งหมด</th><th>'+fmt(t.send)+'</th></tr><tr><td>คอมมิชชั่น 5% ÷ '+n+' คน</td><td>'+fmt(Math.round(t.send*0.05/n))+' /คน</td></tr></table>'
    + '<table><tr><th colspan="2">กระสอบ</th></tr><tr><td>ค้างเพิ่ม</td><td>'+fmt(day.sackAdd)+'</td></tr>'
    + '<tr><td>คืน</td><td>'+fmt(day.sackRet)+'</td></tr><tr><td>ค้างสุทธิ</td><td>'+fmt((Number(day.sackAdd)||0)-(Number(day.sackRet)||0))+'</td></tr></table>'
    + '</div></div>'
    + '<div class="sub" style="margin-top:6px">'+(day.sendMethod==='โอนเข้าบัญชี'?'* แนบใบนำฝากธนาคารมากับรายงานนี้':'')+'</div>'
    + '<div class="sign"><div>ลงชื่อพนักงานขาย</div><div>ลงชื่อพนักงานโรงกระสอบ<br>(ยืนยันจำนวนกระสอบคืน)</div><div>ผู้รับเงิน</div></div>'
    + '</body></html>';
}
function printReport(){
  var w = window.open('', '_blank');
  if (w){ w.document.open(); w.document.write(reportHTML()); w.document.close(); }
  else {
    // popup ถูกบล็อก → fallback ในหน้าเดิม (บาง Android)
    var f = document.createElement('iframe'); f.style.position='fixed'; f.style.right='0'; f.style.bottom='0';
    f.style.width='0'; f.style.height='0'; f.style.border='0'; document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(reportHTML()); f.contentDocument.close();
    setTimeout(function(){ f.contentWindow.focus(); f.contentWindow.print(); }, 400);
  }
}

// ================= service worker + start =================
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
boot();
buildPinPad();
syncQueue();
