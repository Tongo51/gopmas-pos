'use strict';
// ================= storage =================
var LS = { cfg:'pos.cfg', session:'pos.session', master:'pos.master', roster:'pos.roster',
           lastyear:'pos.lastyear', queue:'pos.queue', theme:'pos.theme', avatars:'pos.avatars',
           nosack:'pos.nosack', day:function(d){return 'pos.day.'+d;} };
function load(k, def){ try { var v = JSON.parse(localStorage.getItem(k)); return v==null?def:v; } catch(e){ return def; } }
function save(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function fmt(n){ return (Number(n)||0).toLocaleString('th-TH'); }
function todayStr(){ var d=new Date(); return d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear(); }
function $(id){ return document.getElementById(id); }
function showEl(id, on){ $(id).classList.toggle('hidden', !on); }
// แจ้งเตือนแบบไม่บล็อก (แทน alert ของเบราว์เซอร์ — พนักงานไม่ต้องกดตกลง)
function toast(msg){
  var t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(function(){ t.classList.remove('show'); }, 2600);
}
// ยืนยันแบบแตะซ้ำ (แทน confirm): แตะแรกเปลี่ยนข้อความปุ่ม แตะซ้ำใน 4 วิ = ยืนยัน
function arm(btn, label, fn){
  if (btn.dataset.armed){ delete btn.dataset.armed; btn.textContent = btn.dataset.orig; clearTimeout(arm._t); fn(); return; }
  btn.dataset.orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
  clearTimeout(arm._t);
  arm._t = setTimeout(function(){ if (btn.dataset.armed){ delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 4000);
}

// URL ค่าตั้งต้น — พนักงานเปิดแอปแล้วล็อกอินได้เลย ไม่ต้องกรอกเอง (เปลี่ยนได้ในหน้าตั้งค่า)
var DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbzI4QLD2rqskgPwq64jxdToU0xvg0qCXiohDIJWiwSCV2FAgUtXN_knRaIdQQTGu35n/exec';
var cfg = load(LS.cfg, { url: DEFAULT_URL });
if (!cfg.url) { cfg.url = DEFAULT_URL; save(LS.cfg, cfg); }
var session = load(LS.session, null);
var master = load(LS.master, { products:[], customers:[], roster:[] });
var roster = load(LS.roster, { employees:[], lines:[] });
var noSackPrefs = load(LS.nosack, {}); // จำต่อลูกค้าในเครื่อง: ลูกค้าที่ซื้อซองเป็นก้อน (ไม่ใช้กระสอบ)
var day = null;
var editKey = null, payMode = 'เงินสด', modalCust = null;
var pendingLogin = null, selectedLine = null, pinBuf = '';

// ================= theme =================
var THEMES = [
  { id:'gold',   name:'ทอง',  accent:'#B08D2E' },
  { id:'blue',   name:'ฟ้า',   accent:'#33699E' },
  { id:'purple', name:'ม่วง',  accent:'#7551A8' },
  { id:'green',  name:'เขียว', accent:'#3B7D53' },
  { id:'orange', name:'ส้ม',   accent:'#C0722A' }
];
function applyTheme(id){
  var t = THEMES.filter(function(x){ return x.id===id; })[0] || THEMES[0];
  if (t.id==='gold') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name=theme-color]').setAttribute('content', t.accent);
  save(LS.theme, t.id);
}
applyTheme(load(LS.theme, 'gold'));
function renderThemePick(){
  var cur = load(LS.theme, 'gold');
  $('themePick').innerHTML = THEMES.map(function(t){
    return '<button onclick="applyTheme(\''+t.id+'\');renderThemePick()" title="'+t.name+'"'
      +' style="width:44px;height:44px;border-radius:99px;cursor:pointer;background:'+t.accent+';'
      +'border:3px solid '+(t.id===cur?'var(--ink)':'transparent')+';outline:2px solid var(--line)"></button>';
  }).join('');
}

// ================= avatars =================
var avatars = load(LS.avatars, {});
function loadAvatars(){
  apiGet('avatars').then(function(j){
    if (j.ok){ avatars = j.avatars||{}; save(LS.avatars, avatars); }
  }).catch(function(){});  // offline ใช้ cache เดิม
}
function avatarHTML(name, cls){
  var n = String(name||'').trim();
  if (avatars[n]) return '<span class="'+cls+'" style="overflow:hidden"><img src="'+avatars[n]+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:99px"></span>';
  return '<span class="'+cls+'">'+(n[0]||'?')+'</span>';
}
function pickAvatar(input){
  var f = input.files && input.files[0]; input.value='';
  if (!f) return;
  $('avMsg').textContent = 'กำลังย่อรูป…';
  var img = new Image(), rd = new FileReader();
  rd.onload = function(){ img.src = rd.result; };
  img.onload = function(){
    var S = 96, c = document.createElement('canvas'); c.width = c.height = S;
    var m = Math.min(img.width, img.height); // ครอปสี่เหลี่ยมจัตุรัสกลางภาพ
    c.getContext('2d').drawImage(img, (img.width-m)/2, (img.height-m)/2, m, m, 0, 0, S, S);
    var data = c.toDataURL('image/jpeg', .72);
    $('avMsg').textContent = 'กำลังบันทึก…';
    apiPost({ action:'saveAvatar', name:session.name, img:data }).then(function(j){
      if (!j.ok) throw j.error;
      avatars[session.name] = data; save(LS.avatars, avatars);
      renderCfgAvatar(); $('avMsg').textContent = '✓ บันทึกแล้ว';
    }).catch(function(e){ $('avMsg').textContent = '✗ บันทึกไม่ได้ ('+e+')'; });
  };
  img.onerror = function(){ $('avMsg').textContent = '✗ อ่านรูปไม่ได้'; };
  rd.readAsDataURL(f);
}
function renderCfgAvatar(){
  var n = session.name;
  $('cfgAv').innerHTML = avatars[n] ? '<img src="'+avatars[n]+'" alt="" style="width:100%;height:100%;object-fit:cover">' : (n[0]||'?');
}

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
  showLoginStage('empPin'); loadRoster(); loadAvatars();
}
function showLoginStage(which){
  $('login').classList.remove('hidden'); $('app').classList.add('hidden');
  ['needCfg','empPin','chooseName','confirmLine','adminBox'].forEach(function(s){ showEl(s, s===which); });
  $('loginTag').textContent = which==='needCfg' ? 'ตั้งค่าการเชื่อมต่อครั้งแรก' : 'ระบบขายหน้ารถ';
}

// ---- first url ----
function saveFirstUrl(){
  cfg.url = $('firstUrl').value.trim(); save(LS.cfg, cfg);
  $('cfgMsg').textContent = 'กำลังเชื่อมต่อ…';
  apiGet('ping').then(function(j){
    if (!j.ok) throw 'ตอบกลับผิดปกติ';
    $('cfgMsg').textContent = '✓ เชื่อมต่อสำเร็จ';
    showLoginStage('empPin'); loadRoster();
  }).catch(function(e){ $('cfgMsg').textContent = '✗ เชื่อมต่อไม่ได้: ' + e; });
}

// ---- roster (ใช้เป็นรายชื่อสาย + รายชื่อพนักงานหน้าปิดวัน) ----
function loadRoster(){
  apiGet('roster').then(function(j){
    if (!j.ok) throw j.error;
    roster = { employees:j.employees||[], lines:j.lines||[] }; save(LS.roster, roster);
  }).catch(function(){});  // offline ใช้ cache เดิม
}

// ---- PIN-first login: ใส่ PIN อย่างเดียว ระบบหาคนให้ ----
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
function backToPin(){ pinBuf=''; renderPinDots(); $('empErr').textContent=''; showLoginStage('empPin'); }
function submitEmpPin(name){
  $('empErr').textContent = 'กำลังตรวจสอบ…';
  var body = { action:'loginEmployee', pin:pinBuf };
  if (name) body.name = name;
  apiPost(body).then(function(j){
    if (j.choose){  // PIN ตรงหลายคน → เลือกชื่อ
      $('candList').innerHTML = j.choose.map(function(n){
        return '<button onclick="submitEmpPin(\''+n.replace(/'/g,"\\'")+'\')">'
          + avatarHTML(n,'av') + '<span class="nm">'+n+'</span></button>';
      }).join('');
      showLoginStage('chooseName'); return;
    }
    if (!j.ok){ $('empErr').textContent = j.error||'PIN ไม่ถูกต้อง'; pinBuf=''; renderPinDots(); showLoginStage('empPin'); return; }
    pendingLogin = { name:j.name, line:j.line||'', token:j.token };
    selectedLine = j.line || (roster.lines[0]||'');
    $('pinAv').innerHTML = avatars[j.name]
      ? '<img src="'+avatars[j.name]+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:99px">'
      : (j.name[0]||'?');
    $('pinName').textContent = j.name;
    updatePinLine();
    showLoginStage('confirmLine');
  }).catch(function(e){ $('empErr').textContent = 'เชื่อมต่อไม่ได้ ('+e+')'; pinBuf=''; renderPinDots(); showLoginStage('empPin'); });
}
function updatePinLine(){ $('pinLine').innerHTML = 'สายวันนี้ · <span class="linechip">❄ '+ (selectedLine||'—') +'</span>'; }
function changeLine(){
  if (!roster.lines.length){ toast('ยังไม่มีรายชื่อสาย — ให้แอดมินเพิ่มสายในชีต lines ก่อน'); return; }
  // แสดงรายชื่อสายทั้งหมดให้แตะเลือก (เดิมใช้วิธีวนสายถัดไป — มีสายเดียวจะเหมือนปุ่มไม่ทำงาน)
  var el = $('linePick');
  el.innerHTML = roster.lines.map(function(l){
    return '<span class="emp-tag '+(l===selectedLine?'on':'')+'" onclick="pickLine(\''+String(l).replace(/'/g,"\\'")+'\')">❄ '+l+'</span>';
  }).join('');
  el.classList.toggle('hidden');
}
function pickLine(l){ selectedLine=l; updatePinLine(); $('linePick').classList.add('hidden'); }
function startWork(){
  if (!pendingLogin) { backToPin(); return; }
  if (!selectedLine){ toast('ยังไม่มีสาย — ให้แอดมินเพิ่มสายก่อน'); return; }
  session = { role:'employee', name:pendingLogin.name, line:selectedLine, token:pendingLogin.token };
  save(LS.session, session); pinBuf=''; renderPinDots(); enterApp();
}

// ---- admin login: บัตร RFID / รหัส ----
function showAdminLogin(){ $('admErr').textContent=''; $('admPin').value=''; showLoginStage('adminBox'); setTimeout(function(){ $('admPin').focus(); }, 100); }
function doAdminLogin(){
  $('admErr').textContent = 'กำลังตรวจสอบ…';
  apiPost({ action:'loginAdmin', pin:$('admPin').value.trim() }).then(function(j){
    if (!j.ok){ $('admErr').textContent = j.error||'ไม่ถูกต้อง'; $('admPin').value=''; return; }
    session = { role:'admin', name:j.name, token:j.token }; save(LS.session, session); enterApp();
  }).catch(function(e){ $('admErr').textContent = 'เชื่อมต่อไม่ได้ ('+e+')'; });
}
function logout(btn){
  arm(btn, 'แตะอีกครั้ง เพื่อออกจากระบบ', function(){
    localStorage.removeItem(LS.session); session=null;
    pinBuf=''; renderPinDots(); pendingLogin=null; $('admPin').value='';  // ล้างสถานะ login ทั้งหมด
    boot();
  });
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
  // คนที่ login = ไปสายนี้วันนี้โดยอัตโนมัติ (เลือกเพิ่ม/เอาออกได้ในหน้าปิดวัน)
  if (session.role==='employee' && day.employees.indexOf(session.name)<0){
    day.employees.push(session.name); save(LS.day(day.date), day);
  }
  $('hSub').textContent = session.role==='admin' ? '· แอดมิน' : '· ' + session.line + ' · ' + session.name;
  // nav
  var navs = NAVS[session.role];
  $('nav').innerHTML = navs.map(function(n,i){
    return '<button class="'+(i===0?'on':'')+'" onclick="go(\''+n[0]+'\',this)"><span class="ic">'+n[1]+'</span>'+n[2]+'</button>';
  }).join('');
  go(navs[0][0], $('nav').children[0]);
  renderChip(load(LS.queue,[]).length);
  loadAvatars();
  if (session.role==='employee'){ ensureMaster(); }
}
function go(id, btn){
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  $('scr-'+id).classList.add('active');
  Array.prototype.forEach.call($('nav').children, function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  if (id==='sell'){ renderChallenge(); renderCustomers(); sendHeartbeat(); }  // sync กับเครื่องบัดดี้ทันทีที่เปิดหน้า
  if (id==='close'){ renderSummary(); loadWithdraw(); loadSackRet(); sendHeartbeat(); loadHistory(); }
  if (id==='monitor') loadMonitor();
  if (id==='products') loadProducts();
  if (id==='lines'){ renderLineProducts(); loadSackDeductAdmin(); }
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
  }).catch(function(e){ if(!silent) toast('โหลดข้อมูลไม่ได้: '+e+' (ใช้ข้อมูลเดิม)'); });
  apiGet('lastyear', { line:session.line }).then(function(j){
    if (j.ok){ save(lyKey(), j); renderChallenge(); }
  }).catch(function(){});
}

// ================= day state =================
// tomb = บิลที่ลบไปแล้ว {ชื่อลูกค้า:เวลา} — ต้องเก็บไว้ ไม่งั้น sync จะดึงบิลที่ลบแล้วกลับมาจากเครื่องบัดดี้
function newDay(){ return { date:todayStr(), entries:{}, tomb:{}, employees:[], withdraw:{}, grokk:{},
  fuel:'', gas:'', sackAdd:'', sackRet:'', sackCarry:0, sackDeductOn:false, sackDeduct:0, sendMethod:'โอนเข้าบัญชี' }; }
function saveDay(){ save(LS.day(day.date), day); scheduleHeartbeat(); }

// ================= sell: challenge =================
// คีย์ต้องมีสาย — เครื่องเดียวเคยล็อกอินหลายสายได้ ถ้าไม่แยกสาย ยอดปีที่แล้วของสายอื่นจะรั่วมาแสดง
function lyKey(){ return LS.lastyear+'.'+session.line+'.'+todayStr(); }
function renderChallenge(){
  var ly = load(lyKey(), null);
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
    var ord = (c && c.order && c.order < 999) ? c.order : (i+1);  // ไม่มีลำดับในชีต → ใช้ลำดับในลิสต์
    var usual = c && c.usual && c.usual.length ? '<div class="usual">'+ c.usual.map(pnameOf).join(' · ') +'</div>' : '';
    var amt = e ? (e.owed>0 ? '<span class="amt o">ค้าง '+fmt(e.owed)+'</span>' : '<span class="amt g">'+fmt(e.paid+e.paidDebt)+'</span>')
                : '';
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
  modalCust = cust;
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
  $('mDebt').value = (e&&e.paidDebt)?e.paidDebt:'';
  // ซองเป็นก้อน (ไม่ใช้กระสอบ): บิลนี้ถ้ามีค่าใช้ค่าบิล ไม่งั้น default จากที่จำไว้ต่อลูกค้าในเครื่อง
  $('mNoSack').checked = (e && typeof e.noSack==='boolean') ? e.noSack : !!noSackPrefs[name];
  updateNoSackRow();
  setPay(e? e.payment : 'เงินสด');  // จ่ายมาจริงคำนวณอัตโนมัติใน renderEntryTotal
  $('modal').classList.add('open');
}
// แสดงแถวเฉพาะเมื่อบิลนี้มีน้ำแข็งซอง หรือถูกตั้งไม่ใช้กระสอบไว้ (จะได้เห็น/ยกเลิกได้)
function updateNoSackRow(){
  var el = $('q-ซอง'); var qty = el ? (Number(el.value)||0) : 0;
  $('mNoSackRow').style.display = (qty>0 || $('mNoSack').checked) ? 'flex' : 'none';
}
function prodRow(id, e, usual){
  var p = productById(id); if (!p) return '';
  var qty = e && e.items[id] ? e.items[id] : 0;
  var price = unitPrice(modalCust, p, qty||1);
  var tierTag = (p.tiers && p.tiers.length) ? ' <span class="tag">ขั้นบันได</span>' : '';
  return '<div class="prod-row"><span class="pn">'+p.name+(usual&&modalCust?' <span class="tag">ประจำ</span>':'')+tierTag
    +'<small id="pl-'+id+'">'+fmt(price)+' บาท</small></span>'
    +'<div class="qty"><button onclick="bump(\''+id+'\',-1)">−</button>'
    +'<input type="number" inputmode="numeric" min="0" id="q-'+id+'" data-pid="'+id+'" value="'+(qty||'')+'" oninput="renderEntryTotal()">'
    +'<button onclick="bump(\''+id+'\',1)">＋</button></div></div>';
}
function showExtra(){ $('mExtra').classList.add('show'); $('mAddBtn').style.display='none'; }
function closeEntry(){ $('modal').classList.remove('open'); }
function bump(id, d){ var el=$('q-'+id); el.value = Math.max(0,(Number(el.value)||0)+d)||''; renderEntryTotal(); }
function setPay(mode){ payMode=mode; Array.prototype.forEach.call($('mPay').children, function(b){ b.classList.toggle('on', b.textContent.indexOf(mode)===0); }); renderEntryTotal(); }
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
  // เงินสด = จ่ายเต็มก้อน · เครดิต = ค้างเต็มก้อน — ไม่ให้แบ่งจ่าย ช่องจ่ายมาจริงแก้ไม่ได้
  var t = entryTotal(), paid = payMode==='เงินสด' ? t : 0;
  $('mPaid').value = paid||'';
  $('mTotal').textContent = fmt(t); $('mOwed').textContent = fmt(Math.max(0, t-paid));
  updateNoSackRow();
}
function collectItems(){ var it={}; document.querySelectorAll('#modal .qty input').forEach(function(el){ var q=Number(el.value)||0; if(q>0) it[el.dataset.pid]=q; }); return it; }
function saveEntry(){
  var name = $('mName').value.trim(); if (!name){ toast('ใส่ชื่อลูกค้าก่อน'); return; }
  var items = collectItems(), total = entryTotal();
  var paid = payMode==='เงินสด' ? total : 0, paidDebt = Number($('mDebt').value)||0;
  if (!total && !paidDebt){ deleteEntry(); return; }
  if (editKey && editKey!==name) delete day.entries[editKey];
  var noSack = $('mNoSack').checked;
  // ts = เวลาที่แก้ล่าสุด ใช้ตัดสินตอน merge กับเครื่องบัดดี้ (ใครแก้ทีหลังชนะ)
  day.entries[name] = { items:items, total:total, paid:paid, paidDebt:paidDebt, owed:Math.max(0,total-paid), payment:payMode, noSack:noSack, ts:Date.now() };
  delete day.tomb[name];
  if (noSack) noSackPrefs[name]=true; else delete noSackPrefs[name];  // จำต่อลูกค้าในเครื่อง
  save(LS.nosack, noSackPrefs);
  saveDay(); closeEntry(); renderCustomers(); renderChallenge();
}
function deleteEntry(){ if (editKey){ day.tomb[editKey]=Date.now(); delete day.entries[editKey]; saveDay(); } closeEntry(); renderCustomers(); renderChallenge(); }

// ================= close / summary =================
function totals(){
  var cash=0, debt=0, owed=0, sold={};
  if (day) Object.keys(day.entries).forEach(function(n){ var e=day.entries[n];
    cash+=e.paid; debt+=e.paidDebt; owed+=e.owed;
    Object.keys(e.items).forEach(function(pid){ sold[pid]=(sold[pid]||0)+e.items[pid]; });
  });
  var fuel=Number(day?day.fuel:0)||0, gas=Number(day?day.gas:0)||0;
  var send = cash+debt-fuel-gas;  // ยอดขาย = ฐานคอม = คอลัมน์ I — ห้ามบวกค่าหักกระสอบเข้าตัวนี้
  // ค่าหักกระสอบเพิ่ม "เงินสดที่ต้องวาง" (deposit) เท่านั้น ไม่เข้า send/คอม/คอลัมน์ I
  var deduct = (day && day.sackDeductOn) ? (Number(day.sackDeduct)||0) : 0;
  return { cash:cash, debt:debt, owed:owed, sold:sold, fuel:fuel, gas:gas,
           send:send, deduct:deduct, deposit:send+deduct };
}
function setSendMethod(m){ day.sendMethod=m; Array.prototype.forEach.call($('paySeg').children,function(b){ b.classList.toggle('on', b.textContent===m); });
  $('payHint').textContent = m==='โอนเข้าบัญชี' ? 'โอนแล้วแนบใบนำฝากมากับใบรายงาน A4' : 'ส่งเงินสดพร้อมใบรายงาน'; saveDay(); }
function setFuelGas(k, v){ day[k]=v; renderSummary(); }  // ต้นเหตุบั๊กเดิม: renderSummary เคยอ่าน input ทับ day ทำให้ค่าหายตอน reload
function renderSummary(){
  var t = totals();
  // กระสอบค้างเพิ่ม: หลอดใหญ่+หลอดเล็ก+โม่ ทุกคน · ซอง×6 เฉพาะลูกค้าที่ใช้กระสอบ (noSack = ซื้อซองเป็นก้อน ตัดซองออก)
  var sackAdd = 0;
  Object.keys(day.entries).forEach(function(n){ var e=day.entries[n];
    sackAdd += (e.items['หลอดใหญ่']||0)+(e.items['หลอดเล็ก']||0)+(e.items['โม่']||0);
    if (!e.noSack) sackAdd += (e.items['ซอง']||0)*6;
  });
  day.sackAdd = sackAdd;
  saveDay();
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
  $('tSend').textContent=fmt(t.send); $('tDeposit').textContent=fmt(t.deposit);
  var n = day.employees.length||1;
  $('tComm').textContent = fmt(Math.round(t.send*0.05/n))+' /คน ('+n+' คน)';
  // หักค่ากระสอบค้างส่ง — แอดมินกำหนดต่อสาย พนักงานแก้ไม่ได้ · โผล่เมื่อมีค่าหัก (>0)
  var dd = Number(day.sackDeduct)||0;
  showEl('sackDeductBox', dd>0);
  if (dd>0) $('sackDeductAmt').textContent = fmt(dd);
  var sackNet = (Number(day.sackAdd)||0)-(Number(day.sackRet)||0);
  $('sackCarry').textContent = fmt(day.sackCarry);
  $('sackNet').textContent = fmt(sackNet);
  $('sackTotal').textContent = fmt((Number(day.sackCarry)||0) + sackNet);
  $('inFuel').value=day.fuel; $('inGas').value=day.gas; $('inSackAdd').value=day.sackAdd; $('inSackRet').value=day.sackRet;
  showEl('amendBtn', !!day.closed);
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
    saveDay(); renderSummary(); $('wdStatus').textContent='✓ ดึงแล้ว '+Object.keys(j.items).length+' รายการ · '+new Date().toLocaleTimeString('th-TH');
  }).catch(function(e){ $('wdStatus').textContent='✗ ดึงไม่ได้ (offline?) จะลองใหม่อัตโนมัติ'; });
}
// กระสอบวันนี้: คืนที่โรงงานรับไว้ (facdata) + ค้างสะสมยกมา — ดึงอัตโนมัติ
function loadSackRet(){
  apiGet('sackret',{ line:session.line }).then(function(j){
    if (!j.ok) throw j.error;
    day.sackRet = j.total; day.sackCarry = j.carry||0;
    // ค่าหักกระสอบ = แอดมินตั้งต่อสาย (พนักงานแก้ไม่ได้) · cap ไม่เกินมูลค่ากระสอบที่ค้างจริง carry×10
    var cap = (Number(j.carry)||0)*10, dd = Math.max(0, Number(j.deduct)||0);
    day.sackDeduct = Math.min(dd, cap); day.sackDeductOn = day.sackDeduct>0;
    saveDay(); renderSummary();
  }).catch(function(){});  // offline ใช้ค่าที่ดึงไว้ล่าสุด
}
// ยอดขายย้อนหลังของสาย (รวมทุกเครื่อง) — ไว้ดูว่าวันก่อนๆ ขายอะไรไปเท่าไร จะได้เอาของขึ้นรถพอดี
function loadHistory(){
  apiGet('daylog',{ line:session.line, days:3 }).then(function(j){
    if (!j.ok) throw j.error;
    if (!j.days.length){ $('histBox').innerHTML='<p class="note">ยังไม่มีข้อมูลย้อนหลัง (เริ่มเก็บตั้งแต่วันนี้)</p>'; return; }
    var rows = '<tr><th>สินค้า</th>'+ j.days.map(function(d){ return '<th>'+d.date+'</th>'; }).join('') +'</tr>';
    master.products.forEach(function(p){
      if (!j.days.some(function(d){ return d.sold[p.id]; })) return;   // สินค้าที่ไม่ได้ขายเลย ไม่ต้องรก
      rows += '<tr><td>'+p.name+'</td>'+ j.days.map(function(d){ return '<td>'+fmt(d.sold[p.id]||0)+'</td>'; }).join('') +'</tr>';
    });
    rows += '<tr><td>ลูกค้า</td>'+ j.days.map(function(d){ return '<td>'+fmt(d.customers)+'</td>'; }).join('') +'</tr>';
    $('histBox').innerHTML = '<table class="mini">'+rows+'</table>';
  }).catch(function(){ $('histBox').innerHTML='<p class="note">ดึงไม่ได้ (ไม่มีสัญญาณ?)</p>'; });
}
// รีเฟรชเบิก+คืนกระสอบทุก 1 นาทีระหว่างเปิดหน้าปิดวัน
setInterval(function(){
  if (session && session.role==='employee' && $('scr-close').classList.contains('active')){ loadWithdraw(); loadSackRet(); }
}, 60000);

// ================= heartbeat + แชร์การขายกับเครื่องบัดดี้ =================
// ส่งรายบิลของเครื่องนี้ขึ้นไป แล้วรับก้อนที่รวมของทั้งสายกลับมา merge — สองเครื่องในสายเดียวกันจึงเห็นเหมือนกัน
var hbTimer = null;
function scheduleHeartbeat(){ if (session && session.role==='employee'){ clearTimeout(hbTimer); hbTimer=setTimeout(sendHeartbeat, 8000); } }
function sendHeartbeat(){
  if (!session || session.role!=='employee' || !navigator.onLine) return;
  var t = totals();
  apiPost({ action:'syncday', date:day.date, line:session.line, employees:day.employees,
    customers:Object.keys(day.entries).length, cash:t.cash, owed:t.owed, moneySent:t.send,
    sold:t.sold, status: day.closed ? 'closed' : 'running',
    entries:day.entries, tomb:day.tomb }).then(applySync).catch(function(){});  // offline = เก็บไว้ในเครื่อง ส่งรอบหน้า
}
// รับก้อนที่ server รวมแล้วมาผสานลงเครื่องนี้ — เทียบ ts รายลูกค้า ของที่แก้ทีหลังชนะ
function applySync(j){
  if (!j || !j.ok || !j.entries) return;
  if ($('modal').classList.contains('open')) return;  // กำลังกรอกบิลอยู่ อย่าเปลี่ยนของใต้มือ (รอบหน้าค่อยผสาน)
  var changed = false;
  Object.keys(j.entries).forEach(function(n){
    var v = j.entries[n], cur = day.entries[n];
    if ((day.tomb[n]||0) > (v.ts||0)) return;                       // เครื่องนี้ลบทีหลัง
    if (!cur || (cur.ts||0) < (v.ts||0)){ day.entries[n]=v; changed=true; }
  });
  Object.keys(j.tomb||{}).forEach(function(n){
    var ts = j.tomb[n]||0;
    if ((day.tomb[n]||0) < ts){ day.tomb[n]=ts; changed=true; }
    if (day.entries[n] && (day.entries[n].ts||0) <= ts){ delete day.entries[n]; changed=true; }
  });
  if (!changed) return;
  save(LS.day(day.date), day);   // ห้ามใช้ saveDay() — จะสั่ง heartbeat ต่อทันทีเป็นวงวน
  renderCustomers(); renderChallenge();
  if ($('scr-close').classList.contains('active')) renderSummary();
}
setInterval(sendHeartbeat, 180000); // ทุก 3 นาที (เปิดหน้าขาย/ปิดวัน หรือบันทึกบิล จะ sync ทันทีอยู่แล้ว)

// ================= submit + queue =================
function buildPayload(){
  var t = totals();
  return { action:'submit',
    date:day.date, line:session.line, employees:day.employees,
    sold:t.sold, moneySent:t.send, fuelTotal:t.fuel+t.gas, cash:t.cash, owed:t.owed, debtPaid:t.debt,
    customers:Object.keys(day.entries).length, sendMethod:day.sendMethod,
    sackAdd:Number(day.sackAdd)||0, sackRet:Number(day.sackRet)||0, sackDeduct:t.deduct };
    // ไม่ส่งรายบิลรายลูกค้า — หนี้บันทึกเป็นยอดรวมสาย/วันฝั่ง server, รายละเอียดอยู่ในใบ A4
}
function submitDay(btn){
  if (!day.employees.length){ toast('เลือกพนักงานที่ไปวันนี้ก่อน'); return; }
  if (!Object.keys(day.entries).length){ toast('ยังไม่มีรายการขาย'); return; }
  if (day.closed){ toast('ปิดวันนี้ส่งไปแล้ว — กด "แก้ไขรายงานที่ส่งแล้ว" ถ้าต้องแก้'); syncQueue(); return; }
  arm(btn, 'แตะอีกครั้ง · ยืนยันส่งเงิน '+fmt(totals().deposit)+' บาท', function(){
    var q = load(LS.queue,[]); q.push(buildPayload()); save(LS.queue,q);
    day.closed = true; save(LS.day(day.date), day);  // heartbeat หลังจากนี้ต้องไม่ทับสถานะ closed
    showEl('amendBtn', true);
    $('submitNote').textContent = 'เข้าคิวส่งแล้ว — ถ้าไม่มีสัญญาณจะส่งเองเมื่อออนไลน์';
    syncQueue();
  });
}
// ส่งแก้ไข: ปลดล็อกให้แก้ตัวเลขแล้วปิดวันใหม่ — server เขียนทับแถวเดิม (วัน+สาย) ไม่เพิ่มแถว
function amendDay(btn){
  arm(btn, 'แตะอีกครั้ง · แก้ไขรายงานที่ส่งไปแล้ว', function(){
    day.closed = false; save(LS.day(day.date), day);
    $('submitNote').textContent = 'แก้ตัวเลขแล้วกดปิดวันอีกครั้ง — ระบบจะเขียนทับรายงานเดิม';
    renderSummary();
  });
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
      if (!j.ok && j.fatal){  // เช่น พนักงานซ้ำสาย — ห้าม retry ให้ผู้ใช้แก้แล้วส่งใหม่
        qq.shift(); save(LS.queue,qq); renderChip(qq.length);
        syncing=false;
        day.closed = false; save(LS.day(day.date), day);  // ให้กดปิดวันใหม่ได้หลังแก้
        $('submitNote').textContent='✗ '+j.error+' — แก้รายชื่อพนักงานแล้วกดปิดวันใหม่';
        toast('ส่งรายงานไม่ผ่าน: '+j.error);
        return;
      }
      if (!j.ok) throw j.error;
      if (j.warn) toast('ส่งสำเร็จ แต่: '+j.warn);
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
    $('monList').innerHTML = j.lines.sort(function(a,b){ return a.line<b.line?-1:1; })
      .map(monCard).join('') || '<p class="note">ยังไม่มีสายที่เริ่มขายวันนี้</p>';
  }).catch(function(e){ $('monStatus').textContent='โหลดไม่ได้ ('+e+')'; });
}
function monCard(l){
  if (l.status==='nodata')
    return '<div class="lineitem idle"><div class="h"><div class="badge">'+l.line+'</div>'
      +'<div class="who2"><b>—</b><small>ยังไม่มีข้อมูลวันนี้</small></div>'
      +'<span class="chip"><span class="dot"></span> ยังไม่เริ่ม</span></div></div>';
  var fresh = l.status==='closed' ? 'offline' : (l.agoMin!=null && l.agoMin<=10 ? 'synced' : 'stale');
  var stt = l.status==='closed' ? 'ปิดวันแล้ว' : (l.agoMin!=null ? l.agoMin+' นาที' : '—');
  var emps = String(l.employees||'').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  var avs = emps.length ? '<span class="avs">'+emps.slice(0,3).map(function(n){ return avatarHTML(n,'av2'); }).join('')+'</span>' : '';
  // progress ลูกค้า: มีตัวหาร (ลูกค้าประจำของสาย) → bar เต็มรูปแบบ
  var prog = '';
  if (l.customers>0 && l.custTotal>0){
    var pc = Math.min(100, Math.round(l.customers*100/l.custTotal));
    prog = '<div class="prog"><div class="pl"><span>ขายแล้ว '+l.customers+'/'+l.custTotal+' ร้าน</span><span>'+pc+'%</span></div>'
      +'<div class="bar"><i style="width:'+pc+'%"></i></div></div>';
  }
  // ยอดขายรายสินค้า: bar เทียบสัดส่วนกับตัวที่ขายมากสุด (โชว์ 4 อันดับแรก)
  var ids = Object.keys(l.sold||{}).filter(function(k){ return l.sold[k]>0; })
    .sort(function(a,b){ return l.sold[b]-l.sold[a]; }).slice(0,4);
  var mx = ids.length ? l.sold[ids[0]] : 0;
  var bars = ids.length ? '<div class="soldbars">'+ids.map(function(k){
    return '<div class="sb"><span class="n">'+k+'</span><span class="t"><i style="width:'
      +Math.max(4, Math.round(l.sold[k]*100/mx))+'%"></i></span><span class="q">'+fmt(l.sold[k])+'</span></div>';
  }).join('')+'</div>' : '';
  // "ปิดผ่านระบบเดิม" ต้องผูกกับ status closed เท่านั้น — สาย running ที่ยังไม่บันทึกลูกค้า (customers=0) ไม่ใช่การปิดวัน
  var small = prog ? '' : (l.status==='closed' ? 'ปิดผ่านระบบเดิม — ไม่มีรายละเอียด'
    : l.customers>0 ? 'ลูกค้าแล้ว '+l.customers+' ราย' : 'ยังไม่บันทึกการขายในแอป');
  return '<div class="lineitem"><div class="h"><div class="badge">'+l.line+'</div>'
    +'<div class="who2"><b>'+(l.employees||'—')+'</b>'+(small?'<small>'+small+'</small>':'')+'</div>'
    +avs
    +'<span class="chip '+(fresh==='synced'?'ok':(fresh==='stale'?'wait':''))+'"><span class="dot"></span> '+stt+'</span></div>'
    +prog+bars
    +'<div class="foot"><span class="'+fresh+'">'+(l.status==='closed'?'ส่งรายงานแล้ว ✓':'ค้างใหม่ '+fmt(l.owed))+'</span>'
    +'<span class="money">'+fmt(l.moneySent)+'</span></div></div>';
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
// หักค่ากระสอบรายสาย (แอดมิน) — พนักงานแก้ไม่ได้ · หักไม่เกินมูลค่ากระสอบที่ค้างจริง (cap ฝั่งพนักงาน)
function loadSackDeductAdmin(){
  $('sackDeductAdmin').innerHTML = '<p class="note">กำลังโหลด…</p>';
  apiGet('sackdeducts').then(function(j){
    if (!j.ok) throw j.error;
    var lines = roster.lines||[];
    if (!lines.length){ $('sackDeductAdmin').innerHTML='<p class="note">ยังไม่มีสาย — เพิ่มสายด้านบนก่อน</p>'; return; }
    $('sackDeductAdmin').innerHTML = lines.map(function(l){
      var v = (j.deducts||{})[l]||0, safe=String(l).replace(/'/g,"\\'");
      return '<div class="row" style="align-items:center;margin-bottom:8px">'
        +'<label style="margin:0;flex:0 0 56px">❄ '+l+'</label>'
        +'<input type="number" min="0" inputmode="numeric" id="sd-'+l+'" value="'+(v||'')+'" placeholder="0 (ไม่หัก)" style="flex:1">'
        +'<button class="emp-tag" style="margin:0" onclick="saveSackDeductAdmin(\''+safe+'\')">บันทึก</button></div>';
    }).join('');
    $('sdMsg').textContent='';
  }).catch(function(e){ $('sackDeductAdmin').innerHTML='<p class="warn">โหลดไม่ได้ ('+e+')</p>'; });
}
function saveSackDeductAdmin(line){
  var amt = Number($('sd-'+line).value)||0;
  $('sdMsg').textContent='กำลังบันทึกสาย '+line+'…';
  apiPost({ action:'saveSackDeduct', line:line, amount:amt }).then(function(j){
    if (!j.ok) throw j.error;
    $('sdMsg').textContent = amt>0 ? ('✓ สาย '+line+' หัก '+fmt(amt)+' บาท/วัน') : ('✓ สาย '+line+' ยกเลิกการหักแล้ว');
  }).catch(function(e){ $('sdMsg').textContent='✗ '+e; });
}
function doAddLine(){
  var code=$('lnCode').value.trim(); if (!code){ toast('ใส่รหัสสาย'); return; }
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
      + '<button class="emp-tag" style="color:var(--red)" onclick="doDeleteProduct(\''+p.id.replace(/'/g,"\\'")+'\',this)">ลบ</button></div>';
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
  var id=$('pId').value.trim(); if(!id){ toast('ใส่รหัสสินค้า'); return; }
  $('pMsg').textContent='กำลังบันทึก…';
  apiPost({ action:'saveProduct', id:id, origId:editingProdId, name:$('pName').value.trim(),
    price:Number($('pPrice').value)||0, col:$('pCol').value.trim(), tiers:$('pTiers').value.trim() })
  .then(function(j){ if(!j.ok) throw j.error; $('pMsg').textContent='✓ บันทึกแล้ว'; clearProdForm(); loadProducts(); refreshMaster(true); })
  .catch(function(e){ $('pMsg').textContent='✗ '+e; });
}
function doDeleteProduct(id, btn){
  arm(btn, 'แตะอีกครั้ง ยืนยันลบ', function(){
    apiPost({ action:'deleteProduct', id:id }).then(function(j){ if(!j.ok) throw j.error; loadProducts(); refreshMaster(true); })
    .catch(function(e){ toast('ลบไม่ได้: '+e); });
  });
}

// ================= settings =================
function renderCfg(){
  $('cfgUser').textContent=session.name; $('cfgRole').textContent = session.role==='admin'?'แอดมิน':'พนักงาน';
  showEl('cfgLineWrap', session.role==='employee'); if (session.role==='employee') $('cfgLine').textContent=session.line;
  $('cfgTarget').textContent = (master.target==='prod'?'ฐานจริง (1zd1)':'ฐานทดสอบ');
  $('cfgDate').textContent=todayStr(); $('cfgCount').textContent=day?Object.keys(day.entries).length:0;
  renderThemePick(); renderCfgAvatar();
}
// ล้างแล้วต้องส่ง tombstone ขึ้นไปด้วย ไม่งั้น sync จะดึงบิลกลับมาจากเครื่องบัดดี้ทันที
// → ผลคือล้างทั้งสาย (ทั้ง 2 เครื่อง) ปุ่มจึงต้องบอกให้ชัด · ยังไม่แตะรายงานที่ส่งเข้าชีตแล้ว
function clearDay(btn){
  arm(btn, 'แตะอีกครั้ง ยืนยันล้าง (ทั้งสาย ทุกเครื่อง)', function(){
    var t = Date.now(), tomb = {};
    Object.keys(day.entries).forEach(function(n){ tomb[n]=t; });
    day=newDay(); day.tomb=tomb; saveDay(); sendHeartbeat();
    toast('ล้างข้อมูลขายวันนี้ของสายแล้ว — รายงานที่ส่งเข้าชีตไปแล้วไม่กระทบ');
    go('sell',$('nav').children[0]);
  });
}

// ================= พิมพ์ A4 (Android-safe: หน้าเอกสารแยก) =================
function reportHTML(){
  var t=totals(), n=day.employees.length||1;
  var ly = load(lyKey(), null);
  var lyRows = (ly && ly.total)
    ? '<tr><td>วันนี้เมื่อปีที่แล้ว ('+(ly.date||'')+')</td><td>'+fmt(ly.total)+'</td></tr>'
      + '<tr><td>เทียบปีที่แล้ว</td><td>'+Math.round(t.send*100/ly.total)+'%</td></tr>'
    : '';
  var sackNet = (Number(day.sackAdd)||0)-(Number(day.sackRet)||0), sackCarry = Number(day.sackCarry)||0;
  var stock = master.products.map(function(p){ var wd=day.withdraw[p.id]||0, s=t.sold[p.id]||0, g=Number(day.grokk[p.id])||0;
    if(!wd&&!s&&!g) return ''; return '<tr><td>'+p.name+'</td><td>'+fmt(wd)+'</td><td>'+fmt(s)+'</td><td>'+fmt(g)+'</td><td>'+fmt(wd-s-g)+'</td></tr>'; }).join('');
  var credit = Object.keys(day.entries).filter(function(k){return day.entries[k].owed>0;})
    .map(function(k){ return '<tr><td>'+k+'</td><td>'+fmt(day.entries[k].owed)+'</td></tr>'; }).join('') || '<tr><td colspan="2">— ไม่มี —</td></tr>';
  var detail = Object.keys(day.entries).map(function(k){ var e=day.entries[k];
    var items = master.products.filter(function(p){return e.items[p.id];}).map(function(p){return p.name+'×'+e.items[p.id]+((p.id==='ซอง'&&e.noSack)?' (ก้อน)':'');}).join(', ');
    return '<tr><td>'+k+'</td><td style="text-align:left">'+items+'</td><td>'+fmt(e.total)+'</td><td>'+fmt(e.paid)+'</td><td>'+fmt(e.paidDebt)+'</td><td>'+fmt(e.owed)+'</td><td>'+(e.payment||'')+'</td></tr>';
  }).join('') || '<tr><td colspan="7">— ไม่มี —</td></tr>';
  return '<h1>รายงานขายประจำวัน — สาย '+session.line+'</h1>'
    + '<div class="sub">วันที่ '+day.date+' · พนักงาน: '+(day.employees.join(', ')||'-')+' · ส่งเงินโดย: '+(day.sendMethod||'-')+'</div>'
    + '<div class="cols"><div>'
    + '<table><tr><th>สินค้า</th><th>เบิก</th><th>ขาย</th><th>กรอก</th><th>คืน</th></tr>'+stock+'</table>'
    + '<table><tr><th colspan="2">ลูกค้าค้างจ่ายวันนี้</th></tr>'+credit+'</table></div><div>'
    + '<table><tr><td>ลูกค้าจ่าย</td><td>'+fmt(t.cash)+'</td></tr><tr><td>เก็บหนี้เก่า</td><td>'+fmt(t.debt)+'</td></tr>'
    + '<tr><td>ค้างใหม่วันนี้</td><td>'+fmt(t.owed)+'</td></tr><tr><td>ค่าน้ำมัน+แก๊ส</td><td>'+fmt(t.fuel+t.gas)+'</td></tr>'
    + '<tr><td>ส่งเงิน (ยอดขาย)</td><td>'+fmt(t.send)+'</td></tr>'
    + (t.deduct ? '<tr><td>หักค่ากระสอบค้างส่ง</td><td>'+fmt(t.deduct)+'</td></tr>' : '')
    + '<tr><th>เงินสดที่ต้องส่ง</th><th>'+fmt(t.deposit)+'</th></tr>'+lyRows
    + '<tr><td>คอมมิชชั่น 5% ÷ '+n+' คน</td><td>'+fmt(Math.round(t.send*0.05/n))+' /คน</td></tr></table>'
    + '<table><tr><th colspan="2">กระสอบ</th></tr><tr><td>ค้างยกมา</td><td>'+fmt(sackCarry)+'</td></tr>'
    + '<tr><td>ค้างเพิ่มวันนี้</td><td>'+fmt(day.sackAdd)+'</td></tr>'
    + '<tr><td>คืนวันนี้</td><td>'+fmt(day.sackRet)+'</td></tr><tr><td>ค้างสุทธิวันนี้</td><td>'+fmt(sackNet)+'</td></tr>'
    + '<tr><th>ค้างสะสมรวม</th><th>'+fmt(sackCarry+sackNet)+'</th></tr></table>'
    + '</div></div>'
    + '<table><tr><th colspan="7">รายละเอียดการซื้อรายลูกค้า</th></tr>'
    + '<tr><th>ลูกค้า</th><th>รายการ</th><th>ยอด</th><th>จ่าย</th><th>ชำระหนี้เก่า</th><th>ค้าง</th><th>การจ่าย</th></tr>'+detail+'</table>'
    + '<div class="sub" style="margin-top:6px">'+(day.sendMethod==='โอนเข้าบัญชี'?'* แนบใบนำฝากธนาคารมากับรายงานนี้':'')+'</div>'
    + '<div class="sign"><div>ลงชื่อพนักงานขาย</div><div>ลงชื่อพนักงานโรงกระสอบ<br>(ยืนยันจำนวนกระสอบคืน)</div><div>ผู้รับเงิน</div></div>';
}
// กลไกพิมพ์เวอร์ชัน 31 กค. — เปิดหน้าเอกสารแยก (popup ก่อน, iframe fallback ถ้าโดนบล็อก)
// เนื้อรายงานใช้ reportHTML() ปัจจุบัน (มีหักค่ากระสอบ + ป้าย (ก้อน) ครบ)
function printDoc(){
  return '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">'
    // 🔴 ขาดบรรทัดนี้ = มือถือเรนเดอร์หน้าที่ความกว้างสมมติ 980px แล้วย่อทั้งหน้าลงพอดีจอ
    //    ตัวหนังสือ 10px เหลือ ~4px ปุ่มพิมพ์ก็จิ๋วตาม (อาการที่พนักงานแจ้ง 4 ส.ค. 2026)
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>รายงานขาย '+session.line+' '+day.date+'</title>'
    + '<style>@page{size:A4;margin:8mm}*{font-family:\'Sarabun\',\'Leelawadee UI\',sans-serif}body{color:#000;font-size:10px}'
    + 'h1{font-size:15px;margin:0}.sub{color:#444;margin-bottom:5px;font-size:10px}table{width:100%;border-collapse:collapse;margin-bottom:5px}'
    + 'th,td{border:1px solid #999;padding:1px 4px;text-align:right;line-height:1.25}th:first-child,td:first-child{text-align:left}'
    + '.cols{display:flex;gap:12px}.cols>div{flex:1}.sign{display:flex;gap:24px;margin-top:14px}'
    + '.sign div{flex:1;border-top:1px dotted #000;text-align:center;padding-top:4px;font-size:11px}.pbtn{margin:8px 0}'
    // อ่านบนจอเท่านั้น — กระดาษที่พิมพ์ออกมาคุมด้วย @page + @media print เหมือนเดิมทุกตัว ห้ามย้ายกฎพวกนี้ออกนอก screen
    + '@media screen{body{font-size:14px;margin:0;padding:10px 12px 40px}table{font-size:13px}th,td{padding:5px 6px}'
    + 'h1{font-size:19px}.sub{font-size:13px}.cols{display:block}'   // จอแคบวางสองคอลัมน์ซ้อนกัน (พิมพ์ยังเป็น flex)
    + '.pbtn{position:sticky;top:0;z-index:2;width:100%;padding:15px;font-size:17px;font-weight:700;'
    + 'color:#fff;background:#B08D2E;border:0;border-radius:12px;margin:0 0 12px}}'
    + '@media print{.pbtn{display:none}body{font-size:9.5px}}</style></head><body>'
    + '<button class="pbtn" onclick="window.print()">🖨 พิมพ์ / บันทึกเป็น PDF</button>'
    + reportHTML() + '</body></html>';
}
function printReport(){
  var w = window.open('', '_blank');
  if (w){ w.document.open(); w.document.write(printDoc()); w.document.close(); }
  else {
    // popup ถูกบล็อก → fallback ในหน้าเดิม (บาง Android)
    var f = document.createElement('iframe'); f.style.position='fixed'; f.style.right='0'; f.style.bottom='0';
    f.style.width='0'; f.style.height='0'; f.style.border='0'; document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(printDoc()); f.contentDocument.close();
    setTimeout(function(){ f.contentWindow.focus(); f.contentWindow.print(); }, 400);
  }
}

// ================= service worker + start =================
// ตัวเลขทุกช่องห้ามติดลบ (capture ก่อน handler อื่นเห็นค่า)
document.addEventListener('input', function(e){
  var t = e.target;
  if (t && t.type==='number' && t.value!=='' && Number(t.value)<0) t.value = 0;
}, true);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
  // มี controller อยู่แล้ว = เคยโหลดผ่าน SW → controllerchange ครั้งถัดไป = SW ใหม่หลัง deploy → reload ให้ได้โค้ดใหม่ทันที (data อยู่ใน localStorage ไม่หาย)
  if (navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener('controllerchange', function(){ location.reload(); });
}
boot();
buildPinPad();
$('admPin').addEventListener('keydown', function(e){ if (e.key==='Enter') doAdminLogin(); }); // เครื่องอ่าน RFID พิมพ์รหัส+Enter
syncQueue();
