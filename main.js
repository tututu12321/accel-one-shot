// Accel One Shot: motion -> integrate -> plot (no external libs)

const $ = (id) => document.getElementById(id);

const btnStart = $("btnStart");
const btnStop = $("btnStop");
const btnReset = $("btnReset");
const statusEl = $("status");
const dtEl = $("dt");
const aEl = $("a");
const vEl = $("v");
const pEl = $("p");
const axisSel = $("axis");
const windowSel = $("windowSec");

const canvas = $("chart");
const ctx = canvas.getContext("2d");

let running = false;
let lastT = null;

// Data arrays: {t, ax, ay, az, vx, vy, vz, px, py, pz}
let samples = [];

// Integration state
let v = { x: 0, y: 0, z: 0 };
let p = { x: 0, y: 0, z: 0 };
let lastA = { x: 0, y: 0, z: 0 };

// For cases where "acceleration" is null, use simple gravity removal (high-pass)
let gLP = { x: 0, y: 0, z: 0 }; // low-pass gravity estimate

function setStatus(s) {
  statusEl.textContent = s;
}

function fmt(x) {
  if (!isFinite(x)) return "-";
  return x.toFixed(3);
}

function nowSec() {
  return performance.now() * 1e-3;
}

async function requestMotionPermissionIfNeeded() {
  // iOS Safari requires explicit permission
  const DME = window.DeviceMotionEvent;
  if (!DME) return true;

  if (typeof DME.requestPermission === "function") {
    try {
      const res = await DME.requestPermission();
      return res === "granted";
    } catch (e) {
      return false;
    }
  }
  return true;
}

function resetAll() {
  running = false;
  lastT = null;
  samples = [];
  v = { x: 0, y: 0, z: 0 };
  p = { x: 0, y: 0, z: 0 };
  lastA = { x: 0, y: 0, z: 0 };
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

function clampWindow() {
  const w = parseFloat(windowSel.value);
  const tNow = samples.length ? samples[samples.length - 1].t : nowSec();
  const tMin = tNow - w;

  // keep data slightly more than window for stable draw
  while (samples.length && samples[0].t < tMin - 0.5) samples.shift();
}

function handleMotion(e) {
  if (!running) return;

  const t = nowSec();
  if (lastT === null) {
    lastT = t;
    return;
  }
  let dt = t - lastT;
  // avoid huge dt spikes
  if (dt <= 0 || dt > 0.2) {
    lastT = t;
    return;
  }
  lastT = t;

  // Preferred: e.acceleration (gravity removed). If null, approximate from includingGravity.
  let ax = null, ay = null, az = null;

  if (e.acceleration && e.acceleration.x != null) {
    ax = e.acceleration.x;
    ay = e.acceleration.y;
    az = e.acceleration.z;
  } else if (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x != null) {
    // simple low-pass to estimate gravity, then subtract
    const aig = {
      x: e.accelerationIncludingGravity.x,
      y: e.accelerationIncludingGravity.y,
      z: e.accelerationIncludingGravity.z
    };
    const alpha = 0.92; // closer to 1 => slower gravity tracking
    gLP.x = alpha * gLP.x + (1 - alpha) * aig.x;
    gLP.y = alpha * gLP.y + (1 - alpha) * aig.y;
    gLP.z = alpha * gLP.z + (1 - alpha) * aig.z;

    ax = aig.x - gLP.x;
    ay = aig.y - gLP.y;
    az = aig.z - gLP.z;
  } else {
    return;
  }

  // integrate (trapezoidal)
  const a = { x: ax, y: ay, z: az };

  v.x += 0.5 * (lastA.x + a.x) * dt;
  v.y += 0.5 * (lastA.y + a.y) * dt;
  v.z += 0.5 * (lastA.z + a.z) * dt;

  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  lastA = a;

  samples.push({
    t,
    ax: a.x, ay: a.y, az: a.z,
    vx: v.x, vy: v.y, vz: v.z,
    px: p.x, py: p.y, pz: p.z
  });

  clampWindow();

  // UI
  const axis = axisSel.value;
  dtEl.textContent = fmt(dt);
  aEl.textContent = fmt(a[axis]);
  vEl.textContent = fmt(v[axis]);
  pEl.textContent = fmt(p[axis]);

  draw();
}

function drawGrid(x0, y0, w, h, nY) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;

  // border
  ctx.strokeRect(x0, y0, w, h);

  // horizontal lines
  for (let i = 1; i < nY; i++) {
    const y = y0 + (h * i) / nY;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
  }

  ctx.restore();
}

function getSeries(axis) {
  const keyA = "a" + axis;
  const keyV = "v" + axis;
  const keyP = "p" + axis;

  return {
    t: samples.map(s => s.t),
    a: samples.map(s => s[keyA]),
    v: samples.map(s => s[keyV]),
    p: samples.map(s => s[keyP]),
  };
}

function minMax(arr) {
  let mn = Infinity, mx = -Infinity;
  for (const x of arr) {
    if (!isFinite(x)) continue;
    if (x < mn) mn = x;
    if (x > mx) mx = x;
  }
  if (mn === Infinity) return { mn: -1, mx: 1 };
  if (mn === mx) {
    const d = Math.max(1e-3, Math.abs(mn) * 0.1);
    return { mn: mn - d, mx: mx + d };
  }
  return { mn, mx };
}

function plotPanel(x0, y0, w, h, tArr, yArr, label) {
  ctx.save();

  drawGrid(x0, y0, w, h, 4);

  // label
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.font = "12px system-ui";
  ctx.fillText(label, x0 + 8, y0 + 16);

  if (tArr.length < 2) {
    ctx.restore();
    return;
  }

  const t0 = tArr[0];
  const t1 = tArr[tArr.length - 1];
  const { mn, mx } = minMax(yArr);

  // plot
  ctx.strokeStyle = "rgba(90,200,250,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < tArr.length; i++) {
    const tx = (tArr[i] - t0) / Math.max(1e-9, (t1 - t0));
    const yv = (yArr[i] - mn) / Math.max(1e-9, (mx - mn));
    const px = x0 + tx * w;
    const py = y0 + (1 - yv) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // y min/max text
  ctx.fillStyle = "rgba(255,255,255,0.50)";
  ctx.font = "11px system-ui";
  ctx.fillText(mx.toFixed(2), x0 + 8, y0 + 30);
  ctx.fillText(mn.toFixed(2), x0 + 8, y0 + h - 8);

  ctx.restore();
}

function draw() {
  // handle HiDPI
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const wantW = Math.floor(cssW * dpr);
  const wantH = Math.floor(cssH * dpr);
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW;
    canvas.height = wantH;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // panel layout
  const pad = 14 * dpr;
  const W = canvas.width - 2 * pad;
  const H = canvas.height - 2 * pad;

  const panelH = (H - 2 * pad) / 3;
  const x0 = pad;
  let y0 = pad;

  const axis = axisSel.value;
  const s = getSeries(axis);

  plotPanel(x0, y0, W, panelH, s.t, s.a, `Accel (${axis})  m/s^2`);
  y0 += panelH + pad;
  plotPanel(x0, y0, W, panelH, s.t, s.v, `Vel (${axis})  m/s`);
  y0 += panelH + pad;
  plotPanel(x0, y0, W, panelH, s.t, s.p, `Pos (${axis})  m`);
}

btnStart.addEventListener("click", async () => {
  setStatus("permission...");
  const ok = await requestMotionPermissionIfNeeded();
  if (!ok) {
    setStatus("permission denied");
    return;
  }

  // start
  running = true;
  lastT = null;
  setStatus("running");
  btnStart.disabled = true;
  btnStop.disabled = false;

  // attach listener once
  if (!window.__accel_listener_attached) {
    window.addEventListener("devicemotion", handleMotion, { passive: true });
    window.__accel_listener_attached = true;
  }
});

btnStop.addEventListener("click", () => {
  running = false;
  setStatus("stopped");
  btnStart.disabled = false;
  btnStop.disabled = true;
});

btnReset.addEventListener("click", () => {
  resetAll();
});

axisSel.addEventListener("change", draw);
windowSel.addEventListener("change", () => { clampWindow(); draw(); });

resetAll();
