// main.js
(() => {
  "use strict";

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const nowSec = () => performance.now() * 1e-3;

  function mean(arr) {
    if (!arr.length) return NaN;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  const el = {
    btnStart: document.getElementById("btnStart"),
    btnStop: document.getElementById("btnStop"),
    btnReset: document.getElementById("btnReset"),
    state: document.getElementById("state"),

    axis: document.getElementById("axis"),
    gain: document.getElementById("gain"),
    tcapture: document.getElementById("tcapture"),

    outT: document.getElementById("outT"),
    outA: document.getElementById("outA"),
    outV: document.getElementById("outV"),
    outX: document.getElementById("outX"),

    canvas: document.getElementById("plot"),
  };

  const ctx = el.canvas.getContext("2d");

  const State = Object.freeze({
    WAIT: "WAIT",
    CAPTURING: "CAPTURING",
    RUNNING: "RUNNING",
    STOPPED: "STOPPED",
  });

  const sim = {
    state: State.WAIT,

    // captured accel (ABS value, m/s^2)
    a0: 0,

    // initial conditions at t=0 (after capture)
    x0: 0,
    v0: 0,

    // time base
    t0_wall: 0, // wall time at motion start
    t_stop: 0,  // t at stop

    // plot buffers (last 10 sec)
    winSec: 10,
    maxPts: 600,

    bufT: [],
    bufA: [],
    bufV: [],
    bufX: [],
  };

  function setState(s) {
    sim.state = s;
    el.state.value = s;

    el.btnStart.disabled = !(s === State.WAIT || s === State.STOPPED);
    el.btnStop.disabled = !(s === State.RUNNING || s === State.CAPTURING);
  }

  async function requestMotionPermissionIfNeeded() {
    const DME = window.DeviceMotionEvent;
    const DOE = window.DeviceOrientationEvent;

    if (!DME && !DOE) return { ok: false, reason: "Sensor unsupported" };

    // iOS: orientation permission first (some versions need this to show prompt properly)
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const r = await DOE.requestPermission();
        if (r !== "granted") return { ok: false, reason: "Orientation denied" };
      } catch {
        return { ok: false, reason: "Orientation error" };
      }
    }

    // iOS: motion permission
    if (DME && typeof DME.requestPermission === "function") {
      try {
        const r = await DME.requestPermission();
        if (r !== "granted") return { ok: false, reason: "Motion denied" };
      } catch {
        return { ok: false, reason: "Motion error" };
      }
    }

    return { ok: true, reason: "" };
  }

  // One-shot capture
  let motionHandler = null;

  function stopListeningMotion() {
    if (motionHandler) {
      window.removeEventListener("devicemotion", motionHandler);
      motionHandler = null;
    }
  }

  function captureOnceThenRun() {
    const axis = el.axis.value; // x/y/z
    const gain = Number(el.gain.value) || 1.0;
    const tc = clamp(Number(el.tcapture.value) || 0.2, 0.05, 0.5);

    const samples = [];
    const tStart = nowSec();

    motionHandler = (ev) => {
      const a = ev.accelerationIncludingGravity || ev.acceleration;
      if (!a) return;

      let v = 0;
      if (axis === "x") v = a.x ?? 0;
      if (axis === "y") v = a.y ?? 0;
      if (axis === "z") v = a.z ?? 0;

      // ABS + safety clip
      v = Math.abs(v);
      v = clamp(v, 0, 50);
      samples.push(v);

      if (nowSec() - tStart >= tc) {
        stopListeningMotion();

        const a0raw = mean(samples);
        sim.a0 = Number.isFinite(a0raw) ? gain * a0raw : 0;

        sim.x0 = 0;
        sim.v0 = 0;

        sim.t0_wall = nowSec();
        sim.t_stop = 0;

        sim.bufT = [];
        sim.bufA = [];
        sim.bufV = [];
        sim.bufX = [];

        setState(State.RUNNING);
      }
    };

    window.addEventListener("devicemotion", motionHandler, { passive: true });
    setState(State.CAPTURING);
  }

  // Analytic motion
  function kinematics(t, a0, x0, v0) {
    const v = v0 + a0 * t;
    const x = x0 + v0 * t + 0.5 * a0 * t * t;
    return { x, v };
  }

  function getSimTime() {
    if (sim.state === State.RUNNING) return nowSec() - sim.t0_wall;
    if (sim.state === State.STOPPED) return sim.t_stop;
    return 0;
  }

  function updateOutputs(t, a, v, x) {
    el.outT.textContent = t.toFixed(3);
    el.outA.textContent = a.toFixed(3);
    el.outV.textContent = v.toFixed(3);
    el.outX.textContent = x.toFixed(3);
  }

  function pushBuffer(t, a, v, x) {
    sim.bufT.push(t);
    sim.bufA.push(a);
    sim.bufV.push(v);
    sim.bufX.push(x);

    if (sim.bufT.length > sim.maxPts) {
      sim.bufT.shift(); sim.bufA.shift(); sim.bufV.shift(); sim.bufX.shift();
    }

    const tMin = t - sim.winSec;
    while (sim.bufT.length && sim.bufT[0] < tMin) {
      sim.bufT.shift(); sim.bufA.shift(); sim.bufV.shift(); sim.bufX.shift();
    }
  }

  // Plot: 3 rows (a, v, x), white background
  function drawPlot() {
    const W = el.canvas.width;
    const H = el.canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const padL = 52, padR = 12, padT = 12, padB = 22;
    const x0p = padL, x1p = W - padR;
    const y0p = padT, y1p = H - padB;

    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const y = y0p + (y1p - y0p) * (i / 6);
      ctx.beginPath();
      ctx.moveTo(x0p, y);
      ctx.lineTo(x1p, y);
      ctx.stroke();
    }

    const n = sim.bufT.length;
    if (n < 2) {
      ctx.fillStyle = "#333333";
      ctx.font = "12px system-ui";
      ctx.fillText("a(t), v(t), x(t) (last 10 s)", x0p, H - 8);
      return;
    }

    const tMin = sim.bufT[0];
    const tMax = sim.bufT[n - 1];
    const dt = Math.max(1e-9, tMax - tMin);

    const tx = (t) => x0p + (x1p - x0p) * ((t - tMin) / dt);

    // split into 3 bands
    const bandH = (y1p - y0p) / 3;
    const bands = [
      { name: "a", arr: sim.bufA, yTop: y0p + 0 * bandH, yBot: y0p + 1 * bandH },
      { name: "v", arr: sim.bufV, yTop: y0p + 1 * bandH, yBot: y0p + 2 * bandH },
      { name: "x", arr: sim.bufX, yTop: y0p + 2 * bandH, yBot: y0p + 3 * bandH },
    ];

    function drawSeries(band, stroke, label) {
      let ymin = Infinity, ymax = -Infinity;
      for (let i = 0; i < n; i++) {
        ymin = Math.min(ymin, band.arr[i]);
        ymax = Math.max(ymax, band.arr[i]);
      }
      if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) return;
      if (Math.abs(ymax - ymin) < 1e-9) { ymax += 1; ymin -= 1; }

      const ty = (y) => band.yBot - (band.yBot - band.yTop) * ((y - ymin) / (ymax - ymin));

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx(sim.bufT[0]), ty(band.arr[0]));
      for (let i = 1; i < n; i++) ctx.lineTo(tx(sim.bufT[i]), ty(band.arr[i]));
      ctx.stroke();

      ctx.fillStyle = "#111111";
      ctx.font = "12px system-ui";
      ctx.fillText(label, x0p + 4, band.yTop + 12);

      ctx.fillStyle = "#111111";
      ctx.font = "11px system-ui";
      ctx.fillText(ymax.toFixed(2), 4, band.yTop + 12);
      ctx.fillText(ymin.toFixed(2), 4, band.yBot - 4);
    }

    drawSeries(bands[0], "#d32f2f", "|a|");
    drawSeries(bands[1], "#1976d2", "v");
    drawSeries(bands[2], "#2e7d32", "x");

    ctx.fillStyle = "#111111";
    ctx.font = "12px system-ui";
    ctx.fillText("t", x1p - 10, H - 8);
  }

  function resetAll() {
    stopListeningMotion();
    sim.a0 = 0;
    sim.x0 = 0;
    sim.v0 = 0;
    sim.t0_wall = 0;
    sim.t_stop = 0;
    sim.bufT = [];
    sim.bufA = [];
    sim.bufV = [];
    sim.bufX = [];
    updateOutputs(0, 0, 0, 0);
    setState(State.WAIT);
    drawPlot();
  }

  // Buttons
  el.btnStart.addEventListener("click", async () => {
    stopListeningMotion();

    sim.t0_wall = 0;
    sim.t_stop = 0;
    sim.bufT = [];
    sim.bufA = [];
    sim.bufV = [];
    sim.bufX = [];
    updateOutputs(0, sim.a0, sim.v0, sim.x0);
    drawPlot();

    const perm = await requestMotionPermissionIfNeeded();
    if (!perm.ok) {
      // 権限が出ない/未対応なら、この版は 0 のまま停止
      setState(State.WAIT);
      return;
    }

    captureOnceThenRun();
  });

  el.btnStop.addEventListener("click", () => {
    if (sim.state === State.CAPTURING) {
      stopListeningMotion();
      setState(State.STOPPED);
      return;
    }
    if (sim.state !== State.RUNNING) return;
    sim.t_stop = nowSec() - sim.t0_wall;
    setState(State.STOPPED);
  });

  el.btnReset.addEventListener("click", () => resetAll());

  // Main loop
  function tick() {
    if (sim.state === State.RUNNING) {
      const t = getSimTime();
      const { x, v } = kinematics(t, sim.a0, sim.x0, sim.v0);
      const a = sim.a0;

      updateOutputs(t, a, v, x);
      pushBuffer(t, a, v, x);
      drawPlot();
    }
    requestAnimationFrame(tick);
  }

  resetAll();
  requestAnimationFrame(tick);
})();
