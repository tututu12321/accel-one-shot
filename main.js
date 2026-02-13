const $ = (id) => document.getElementById(id);

const btnStart = $("btnStart");
const btnStop  = $("btnStop");
const btnReset = $("btnReset");
const statusEl = $("status");
const dtEl = $("dt");
const aEl  = $("a");
const vEl  = $("v");
const pEl  = $("p");
const windowSel = $("windowSec");

const canvas = $("chart");
const ctx = canvas.getContext("2d");

let running = false;
let lastT = null;

// 1D series: t, amag, v, p
let samples = [];
let v = 0;
let p = 0;
let lastA = 0;

// gravity estimation for fallback
let gLP = { x: 0, y: 0, z: 0 };

function setStatus(s){ statusEl.textContent = s; }
function fmt(x){ return (isFinite(x) ? x.toFixed(3) : "-"); }
function nowSec(){ return performance.now() * 1e-3; }

async function requestMotionPermissionIfNeeded(){
  const DME = window.DeviceMotionEvent;
  if (!DME) return true;

  if (typeof DME.requestPermission === "function"){
    const res = await DME.requestPermission();
    return res === "granted";
  }
  return true;
}

function resetAll(){
  running = false;
  lastT = null;
  samples = [];
  v = 0;
  p = 0;
  lastA = 0;
  gLP = { x: 0, y: 0, z: 0 };

  btnStart.disabled = false;
  btnStop.disabled = true;
  setStatus("idle");

  dtEl.textContent = "-";
  aEl.textContent = "-";
  vEl.textContent = "-";
  pEl.textContent = "-";
  draw();
}

function clampWindow(){
  const w = parseFloat(windowSel.value);
  const tNow = samples.length ? samples[samples.length - 1].t : nowSec();
  const tMin = tNow - w;
  while (samples.length && samples[0].t < tMin - 0.5) samples.shift();
}

function mag3(ax, ay, az){
  return Math.sqrt(ax*ax + ay*ay + az*az);
}

function handleMotion(e){
  if (!running) return;

  const t = nowSec();
  if (lastT === null){ lastT = t; return; }

  let dt = t - lastT;
  if (dt <= 0 || dt > 0.2){ lastT = t; return; }
  lastT = t;

  // Try gravity-removed first
  let ax=null, ay=null, az=null;

  if (e.acceleration && e.acceleration.x != null){
    ax = e.acceleration.x;
    ay = e.acceleration.y;
    az = e.acceleration.z;
  } else if (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x != null){
    const aig = {
      x: e.accelerationIncludingGravity.x,
      y: e.accelerationIncludingGravity.y,
      z: e.accelerationIncludingGravity.z
    };
    const alpha = 0.92;
    gLP.x = alpha*gLP.x + (1-alpha)*aig.x;
    gLP.y = alpha*gLP.y + (1-alpha)*aig.y;
    gLP.z = alpha*gLP.z + (1-alpha)*aig.z;

    ax = aig.x - gLP.x;
    ay = aig.y - gLP.y;
    az = aig.z - gLP.z;
  } else {
    return;
  }

  const aMag = mag3(ax, ay, az); // absolute value (magnitude)

  // integrate (trapezoidal) in 1D magnitude space
  v += 0.5 * (lastA + aMag) * dt;
  p += v * dt;
  lastA = aMag;

  samples.push({ t, a: aMag, v, p });
  clampWindow();

  dtEl.textContent = fmt(dt);
  aEl.textContent  = fmt(aMag);
  vEl.textContent  = fmt(v);
  pEl.textContent  = fmt(p);

  draw();
}

function minMax(arr){
  let mn=Infinity, mx=-Infinity;
  for (const x of arr){
    if (!isFinite(x)) continue;
    if (x < mn) mn = x;
    if (x > mx) mx = x;
  }
  if (mn === Infinity) return { mn: -1, mx: 1 };
  if (mn === mx){
    const d = Math.max(1e-3, Math.abs(mn)*0.1);
    return { mn: mn-d, mx: mx+d };
  }
  return { mn, mx };
}

function drawGrid(x0,y0,w,h){
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x0,y0,w,h);
  for (let i=1;i<4;i++){
    const y = y0 + (h*i)/4;
    ctx.beginPath();
    ctx.moveTo(x0,y);
    ctx.lineTo(x0+w,y);
    ctx.stroke();
  }
  ctx.restore();
}

function plotPanel(x0,y0,w,h,tArr,yArr,label){
  drawGrid(x0,y0,w,h);

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.font = "12px system-ui";
  ctx.fillText(label, x0+8, y0+16);

  if (tArr.length < 2){ ctx.restore(); return; }

  const t0=tArr[0], t1=tArr[tArr.length-1];
  const {mn,mx} = minMax(yArr);

  ctx.strokeStyle = "rgba(0,120,220,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i=0;i<tArr.length;i++){
    const tx = (tArr[i]-t0)/Math.max(1e-9,(t1-t0));
    const yy = (yArr[i]-mn)/Math.max(1e-9,(mx-mn));
    const px = x0 + tx*w;
    const py = y0 + (1-yy)*h;
    if (i===0) ctx.moveTo(px,py);
    else ctx.lineTo(px,py);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.font = "11px system-ui";
  ctx.fillText(mx.toFixed(2), x0+8, y0+30);
  ctx.fillText(mn.toFixed(2), x0+8, y0+h-8);

  ctx.restore();
}

function draw(){
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const wantW = Math.floor(cssW*dpr);
  const wantH = Math.floor(cssH*dpr);
  if (canvas.width !== wantW || canvas.height !== wantH){
    canvas.width = wantW;
    canvas.height = wantH;
  }

  ctx.clearRect(0,0,canvas.width,canvas.height);

  const pad = 14*dpr;
  const W = canvas.width - 2*pad;
  const H = canvas.height - 2*pad;
  const panelH = (H - 2*pad)/3;

  const tArr = samples.map(s=>s.t);
  const aArr = samples.map(s=>s.a);
  const vArr = samples.map(s=>s.v);
  const pArr = samples.map(s=>s.p);

  let y0 = pad;
  plotPanel(pad, y0, W, panelH, tArr, aArr, "|Accel|  (m/s^2)");
  y0 += panelH + pad;
  plotPanel(pad, y0, W, panelH, tArr, vArr, "Vel  (m/s)");
  y0 += panelH + pad;
  plotPanel(pad, y0, W, panelH, tArr, pArr, "Pos  (m)");
}

async function start(){
  setStatus("permission...");
  const ok = await requestMotionPermissionIfNeeded();
  if (!ok){ setStatus("permission denied"); return; }

  running = true;
  lastT = null;
  setStatus("running");
  btnStart.disabled = true;
  btnStop.disabled = false;

  if (!window.__motion_listener_attached){
    window.addEventListener("devicemotion", handleMotion, { passive:true });
    window.__motion_listener_attached = true;
  }
}

function stop(){
  running = false;
  setStatus("stopped");
  btnStart.disabled = false;
  btnStop.disabled = true;
}

// iPhoneで「clickが効かない」ケースのために touchend も付ける
btnStart.addEventListener("click", start);
btnStart.addEventListener("touchend", (ev) => { ev.preventDefault(); start(); }, { passive:false });

btnStop.addEventListener("click", stop);
btnStop.addEventListener("touchend", (ev) => { ev.preventDefault(); stop(); }, { passive:false });

btnReset.addEventListener("click", resetAll);
btnReset.addEventListener("touchend", (ev) => { ev.preventDefault(); resetAll(); }, { passive:false });

windowSel.addEventListener("change", () => { clampWindow(); draw(); });

resetAll();

