// main.js
(() => {
  "use strict";

  // ============================================================
  // Utilities
  // ============================================================
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const nowSec = () => performance.now() * 1e-3;

  function mean(arr) {
    if (!arr.length) return NaN;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  // ============================================================
  // DOM
  // ============================================================
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

  // ============================================================
  // State
  // ============================================================
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
    t0_wall: 0,  // wall time at motion start
    t_stop: 0,   // t at stop

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

  // ============================================================
  // iOS permission (Motion + Orientation)
  // ============================================================
  async function requestMotionPermissionIfNeeded() {
    const DME = window.DeviceMotionEvent;
    const DOE = window.DeviceOrientationEvent;

    // If neither exists, sensor unsupported
    if (!DME && !DOE) return { ok: false, reason: "Sensor unsupported" };

    // iOS: Orientation permission may be required to show prompt
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const r = await DOE.requestPermission();
        if (r !== "granted") return { ok: false, reason: "Orientation permission denied" };
      } catch (e) {
        return { ok: false, reason: "Orientation permission error" };
      }
    }

    // iOS: Motion permission
    if (DME && typeof DME.requestPermission === "function") {
      try {
        const r = await DME.requestPermission();
        if (r !== "granted") return { ok: false, reason: "Motion permission denied" };
      } catch (e) {
        return { ok: false, reason: "Motion permission error" };
      }
    }

    return { ok: true, reason: "" };
  }

  // ============================================================
  // One-shot capture
  // ============================================================
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

      // ABS value per request
      v = Math.abs(v);

      // sanity clip
      v = clamp(v, 0, 50);

      samples.push(v);

      if (nowSec() - tStart >= tc) {
        stopListeningMotion();

        const a0raw = mean(samples);
        if (!Number.isFinite(a0raw)) {
          sim.a0 = 0;
        } else {
          sim.a0 = gain * a0raw;
        }

        // set initial conditions at capture end
        sim.x0 = 0;
        sim.v0 = 0;
        sim.t0_wall = nowSec();
        sim.t_stop = 0;

        // reset buffers
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

  // ============================================================
  // Motion (analytic)
  // ============================================================
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

  // ============================================================
  // Outputs
  // ============================================================
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
      sim.bufT.shift();
      sim.bufA.shift();
      sim.bufV.shift();
      sim.bufX.shift();
    }

    const tMin = t - sim.winSec;
    while (sim.bufT.length && sim.bufT[0] < tMin) {
      sim.bufT.shift();
      sim.bufA.shift();
      sim.bufV.shift();
      sim.bufX.shift();
    }
  }

  // ============================================================
  // Plot (white background, 3 series: a, v, x)
  // ============================================================
  function drawPlot() {
    const W = el.canvas.width;
    const H = el.canvas.height;

    // white background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const padL = 52, padR = 12, padT = 12, padB = 28;
    const x0p = padL, x1p = W - padR;
    const y0p = padT, y1p = H - padB;

    // grid
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = y0p + (y1p - y0p) * (i / 5);
      ctx.beginPath();
      ctx.moveTo(x0p, y);
      ctx.lineTo(x1p, y);
      ctx.stroke();
    }

    const n = sim.bufT.length;
    if (n < 2) {
      ctx.fillStyle = "#333333";
      ctx.font = "12px system-ui";
      ctx.fillText("a(t), v(t), x(t) plot (last 10 s)", x0p, H - 8);
      return;
    }

    const tMin = sim.bufT[0];
    const tMax = sim.bufT[n - 1];
    const dt = Math.max(1e-9, tMax - tMin);

    let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) {
      ymin = Math.min(ymin, sim.bufA[i], sim.bufV[i], sim.bufX[i]);
      ymax = Math.max(ymax, sim.bufA[i], sim.bufV[i], sim.bufX[i]);
    }
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) return;
    if (Math.abs(ymax - ymin) < 1e-9) {
      ymax += 1;
      ymin -= 1;
    }

    const tx = (t) => x0p + (x1p - x0p) * ((t - tMin) / dt);
    const ty = (y) => y1p - (y1p - y0p) * ((y - ymin) / (ymax - ymin));

    // a(t)
    ctx.strokeStyle = "#d32f2f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx(sim.bufT[0]), ty(sim.bufA[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(tx(sim.bufT[i]), ty(sim.bufA[i]));
    ctx.stroke();

    // v(t)
    ctx.strokeStyle = "#1976d2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx(sim.bufT[0]), ty(sim.bufV[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(tx(sim.bufT[i]), ty(sim.bufV[i]));
    ctx.stroke();

    // x(t)
    ctx.strokeStyle = "#2e7d32";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx(sim.bufT[0]), ty(sim.bufX[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(tx(sim.bufT[i]), ty(sim.bufX[i]));
    ctx.stroke();

    // labels
    ctx.fillStyle = "#111111";
    ctx.font = "12px system-ui";
    ctx.fillText("a(t)", x0p + 4, y0p + 12);
    ctx.fillText("v(t)", x0p + 44, y0p + 12);
    ctx.fillText("x(t)", x0p + 84, y0p + 12);
    ctx.fillText("t", x1p - 10, H - 8);

    // y ticks
    ctx.fillStyle = "#111111";
    ctx.font = "11px system-ui";
    for (let i = 0; i <= 4; i++) {
      const yy = ymin + (ymax - ymin) * (i / 4);
      const py = ty(yy);
      ctx.fillText(yy.toFixed(2), 4, py + 4);
    }
  }

  // ============================================================
  // Control
  // ============================================================
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

  // ============================================================
  // Buttons
  // ============================================================
  el.btnStart.addEventListener("click", async () => {
    // Start = permission -> capture (short) -> run
    stopListeningMotion();

    // reset display
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
      // if permission fails, keep WAIT and show 0s (no manual mode in this version)
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

  // ============================================================
  // Main loop
  // ============================================================
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

  // ============================================================
  // Init
  // ============================================================
  // IMPORTANT: index.html 側で以下のIDを用意すること
  // btnStart, btnStop, btnReset, state
  // axis, gain, tcapture
  // outT, outA, outV, outX
  // plot (canvas)
  resetAll();
  requestAnimationFrame(tick);
})();

