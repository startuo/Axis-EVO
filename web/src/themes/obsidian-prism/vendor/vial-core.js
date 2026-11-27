(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.__agVialCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const WAVE_NODES = 24;
  const TUBE_X = 34; // 96px 画布内，流体舱居中在 x=34（宽 ~43.2 => x:12.4..55.6，右侧绘制 3.5px 激光微刻标尺）
  const TUBE_OUT_R = 21.6;
  const TUBE_IN_R = 19.6;
  const LIP_Y = 18.5;
  const TOP_OUT = 18.5;
  const TOP_IN = 20.5;
  const RC_TOP_OUT = 14.5;
  const RC_TOP_IN = 12.5;
  const HEM_Y = 175.0; // 液位基准（沿用 HEM_Y + 14 作为腔底液位映射参考）
  // 一体封闭式修长圆角高硼硅/暗曜石纯透晶舱（极简 2.0px 薄晶壁 + 顶底对称精密圆角）
  const FLOOR_OUT = 198.0;
  const FLOOR_IN = 195.0;
  const RC_OUT = 14.5;
  const RC_IN = 12.5;
  const FIXED_DT = 1 / 120; // 固定物理子步：60Hz / 144Hz 刷新率下演化一致
  const MAX_FRAME_DT = 0.05; // 真实帧间隔上限
  const MAX_SUBSTEPS = 8;
  const GRAVITY = 460.0; // 像素级重力加速度 px/s²
  const SETTLE_MIN_AGE_SEC = 1.1; // 入场至少 1.1s 且液位/波能收敛后才进入 0fps 物理休眠

  const clampFillVal = (v) => Math.max(0.06, Math.min(0.95, Number.isFinite(+v) ? +v : 0.46));

  /**
   * 创建高阻尼精密光学水平仪流体舱物理模拟器
   * （24节点硅油阻尼浅水波 + 高阻尼重力摆 + 内壁润湿 + 显式液滴激波 + 流式星尘缓升 + 静止收敛检测）
   */
  function createWaterVialPhysics(initialOptions = {}) {
    const waveH = new Float32Array(WAVE_NODES);
    const waveV = new Float32Array(WAVE_NODES);

    let fill = clampFillVal(initialOptions.fill ?? 0.46);
    let targetFill = fill;
    let streaming = initialOptions.streaming !== false;

    // 倾角与水平仪阻尼动力学（最大 ±0.48 rad）
    let tiltAngle = 0;
    let tiltVel = 0;

    // 内壁挂水润湿高度（归一化在液体上方延伸长度 0..0.42）
    let wetLeft = 0;
    let wetRight = 0;

    // 显式下落光滴与星尘微泡（活动列表 + 对象池，稳态零分配）
    let pendantProgress = 0;
    let dropCooldown = 0;
    let streamClock = 0;
    let dustCooldown = 0.42;
    let accumulator = 0;
    let tiltAcc = 0;
    const fallingDrops = [];
    const bubbles = [];
    const dropPool = [];
    const bubblePool = [];

    const getSurfaceYNormalized = () => 1 - fill;

    const getSurfacePixelY = () => {
      const top = LIP_Y + 8;
      const bot = HEM_Y + 14;
      return bot - fill * (bot - top);
    };

    const sampleWaveAt = (normX) => {
      const t = Math.max(0, Math.min(1, (normX + 1) * 0.5)) * (WAVE_NODES - 1);
      const i0 = Math.min(WAVE_NODES - 2, Math.floor(t));
      const f = t - i0;
      return waveH[i0] * (1 - f) + waveH[i0 + 1] * f;
    };

    const localSurfaceY = (xPx) => getSurfacePixelY() + Math.tan(tiltAngle) * xPx + sampleWaveAt(xPx / TUBE_IN_R);

    const boreHalfWidthAt = (yPx) => {
      if (yPx <= TOP_IN || yPx >= FLOOR_IN) return 0;
      const cyTop = TOP_IN + RC_TOP_IN;
      if (yPx < cyTop) {
        const dt = cyTop - yPx;
        return TUBE_IN_R - RC_TOP_IN + Math.sqrt(Math.max(0, RC_TOP_IN * RC_TOP_IN - dt * dt));
      }
      const cyBot = FLOOR_IN - RC_IN;
      const db = yPx - cyBot;
      if (db <= 0) return TUBE_IN_R;
      return db >= RC_IN ? TUBE_IN_R - RC_IN : TUBE_IN_R - RC_IN + Math.sqrt(Math.max(0, RC_IN * RC_IN - db * db));
    };

    const spawnSplashBubbles = (normX, count, gentle = false) => {
      const surfY = getSurfacePixelY();
      for (let i = 0; i < count; i++) {
        if (bubbles.length >= 10) bubblePool.push(bubbles.shift());
        const b = bubblePool.pop() || {};
        const jitterX = (Math.random() - 0.5) * 8.0;
        b.y = gentle
          ? Math.min(HEM_Y + 10, Math.max(surfY + 14, FLOOR_IN - 12 - Math.random() * 18))
          : Math.min(HEM_Y + 11, surfY + 5 + Math.random() * 14);
        b.r = gentle ? 0.95 + Math.random() * 0.65 : 1.3 + Math.random() * 1.45;
        const maxX = Math.max(2, boreHalfWidthAt(b.y) - b.r - 1.2);
        b.x = Math.max(-maxX, Math.min(maxX, normX * (TUBE_IN_R - 4) + jitterX));
        b.vx = (Math.random() - 0.5) * (gentle ? 3.5 : 9.0);
        b.vy = gentle ? -(14 + Math.random() * 9) : -(22 + Math.random() * 24);
        b.phase = Math.random() * Math.PI * 2;
        b.aspect = 1.0;
        b.alpha = gentle ? 0.72 : 0.92;
        b.gentle = gentle;
        bubbles.push(b);
      }
    };

    const injectWaveRange = (centerNorm, widthNodes, ampVel) => {
      const idxF = Math.max(0, Math.min(WAVE_NODES - 1, ((centerNorm + 1) * 0.5) * (WAVE_NODES - 1)));
      for (let i = 0; i < WAVE_NODES; i++) {
        const d = Math.abs(i - idxF);
        if (d <= widthNodes) {
          const w = 0.5 * (1 + Math.cos((d / Math.max(1, widthNodes)) * Math.PI));
          waveV[i] = Math.max(-65, Math.min(65, waveV[i] + ampVel * w));
        }
      }
    };

    const injectSlosh = (impulse = 1.6) => {
      const s = Math.max(-3.8, Math.min(3.8, Number(impulse) || 0));
      tiltVel += s * 1.85;
      for (let i = 0; i < WAVE_NODES; i++) {
        const norm = (i / (WAVE_NODES - 1)) * 2 - 1;
        waveV[i] += norm * s * 18.0 + Math.sin(norm * 4.2) * Math.abs(s) * 4.2;
      }
      if (Math.abs(s) > 0.85) {
        spawnSplashBubbles(s > 0 ? 0.25 : -0.25, 2, false);
      }
    };

    const injectTilt = (angleOrImpulse = 0.18) => {
      const s = Math.max(-1.6, Math.min(1.6, Number(angleOrImpulse) || 0));
      tiltAngle = Math.max(-0.48, Math.min(0.48, tiltAngle + s * 0.45));
      tiltVel += s * 2.2;
      for (let i = 0; i < WAVE_NODES; i++) {
        const norm = (i / (WAVE_NODES - 1)) * 2 - 1;
        waveV[i] += norm * s * 12.0;
      }
    };

    const injectFingerPoke = (normX = 0, normY = 0.5, vx = 0, vy = 0) => {
      const nx = Math.max(-1, Math.min(1, normX));
      const surfNorm = getSurfaceYNormalized();
      const nearSurface = Math.abs(normY - surfNorm) < 0.22;
      const pushX = Math.max(-2.6, Math.min(2.6, vx * 0.14));
      if (nearSurface) {
        injectWaveRange(nx, 4.5, -24 + vy * 1.4);
        tiltVel += pushX * 0.62;
        if (nx < -0.35) wetLeft = Math.min(0.42, wetLeft + 0.16);
        if (nx > 0.35) wetRight = Math.min(0.42, wetRight + 0.16);
        spawnSplashBubbles(nx * 0.7, 2, false);
      } else {
        injectWaveRange(nx, 3.2, -11.5);
        tiltVel += (pushX !== 0 ? pushX : nx * 0.4) * 0.44;
      }
    };

    const spawnDropletNow = () => {
      if (fallingDrops.length >= 4) return;
      pendantProgress = 0;
      dropCooldown = 0.72;
      const d = dropPool.pop() || {};
      d.x = (Math.random() - 0.5) * 1.8;
      d.y = LIP_Y + 5.0;
      d.vx = 0;
      d.vy = 38.0;
      d.r = 2.55;
      fallingDrops.push(d);
    };

    const computeEnergy = () => {
      let energy = 0;
      for (let i = 0; i < WAVE_NODES; i++) energy += Math.abs(waveH[i]) + Math.abs(waveV[i]) * 0.05;
      return energy;
    };

    const subStep = (dt) => {
      const diffFill = targetFill - fill;
      if (Math.abs(diffFill) < 0.00018) {
        fill = targetFill;
      } else {
        fill += diffFill * Math.min(1, dt * 6.0);
      }

      // 1. 精密水平仪高阻尼重力摆
      const omegaT = 7.2;
      const zetaT = 0.40;
      let streamTorque = 0;
      if (streaming) {
        streamClock += dt;
        streamTorque = Math.sin(streamClock * 1.55) * 0.22 + Math.sin(streamClock * 2.7 + 1.1) * 0.09;
      }
      const accT = -2 * zetaT * omegaT * tiltVel - omegaT * omegaT * tiltAngle + streamTorque;
      tiltAcc = accT;
      tiltVel += accT * dt;
      tiltAngle = Math.max(-0.48, Math.min(0.48, tiltAngle + tiltVel * dt));
      if (!streaming && Math.abs(tiltAngle) < 0.00035 && Math.abs(tiltVel) < 0.0012) {
        tiltAngle = 0;
        tiltVel = 0;
        tiltAcc = 0;
      }
      const sinT = Math.sin(tiltAngle);
      const cosT = Math.cos(tiltAngle);

      if (tiltAngle < -0.11) wetLeft = Math.max(wetLeft, Math.min(0.42, (-tiltAngle - 0.08) * 1.15));
      if (tiltAngle > 0.11) wetRight = Math.max(wetRight, Math.min(0.42, (tiltAngle - 0.08) * 1.15));

      // 2. 24 节点 1D 阻尼浅水波
      const c2 = 380.0;
      const damp = 2.65;
      const restore = 26.0;
      const tiltPump = -tiltAcc * 0.30;
      for (let i = 0; i < WAVE_NODES; i++) {
        const hL = i > 0 ? waveH[i - 1] : waveH[0];
        const hR = i < WAVE_NODES - 1 ? waveH[i + 1] : waveH[WAVE_NODES - 1];
        const lap = hL + hR - 2 * waveH[i];
        const norm = (i / (WAVE_NODES - 1)) * 2 - 1;
        const acc = c2 * lap - damp * waveV[i] - restore * waveH[i] + tiltPump * norm;
        waveV[i] += acc * dt;
      }
      let sumH = 0;
      for (let i = 0; i < WAVE_NODES; i++) {
        waveH[i] = Math.max(-10, Math.min(10, waveH[i] + waveV[i] * dt));
        sumH += waveH[i];
      }
      const meanFix = (sumH / WAVE_NODES) * 0.025;
      let restEnergy = 0;
      for (let i = 0; i < WAVE_NODES; i++) {
        waveH[i] -= meanFix;
        restEnergy += Math.abs(waveH[i]) + Math.abs(waveV[i]) * 0.05;
      }
      if (!streaming && tiltAngle === 0 && tiltVel === 0 && restEnergy < 0.05) {
        waveH.fill(0);
        waveV.fill(0);
      }

      const runL = -waveH[0] - 1.2;
      const runR = -waveH[WAVE_NODES - 1] - 1.2;
      if (runL > 0) wetLeft = Math.max(wetLeft, Math.min(0.42, runL * 0.035));
      if (runR > 0) wetRight = Math.max(wetRight, Math.min(0.42, runR * 0.035));
      wetLeft = Math.max(0, wetLeft - dt * 0.14);
      wetRight = Math.max(0, wetRight - dt * 0.14);

      // 3. 流式态舱底 3D 星尘微粒缓升
      pendantProgress = Math.max(0, pendantProgress - dt * 2.0);
      if (dropCooldown > 0) dropCooldown = Math.max(0, dropCooldown - dt);
      if (streaming && fill > 0.14 && fallingDrops.length === 0) {
        dustCooldown -= dt;
        if (dustCooldown <= 0 && bubbles.length < 4) {
          dustCooldown = 0.62 + Math.random() * 0.45;
          spawnSplashBubbles((Math.random() - 0.5) * 1.1, 1, true);
        }
      }

      // 下坠液滴物理与落水激波
      for (let i = fallingDrops.length - 1; i >= 0; i--) {
        const d = fallingDrops[i];
        d.vx += -GRAVITY * sinT * dt;
        d.vy += GRAVITY * cosT * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        const limD = Math.max(0, boreHalfWidthAt(d.y) - d.r - 0.6);
        if (d.x < -limD) {
          d.x = -limD;
          d.vx = Math.abs(d.vx) * 0.12;
          wetLeft = Math.max(wetLeft, 0.12);
        } else if (d.x > limD) {
          d.x = limD;
          d.vx = -Math.abs(d.vx) * 0.12;
          wetRight = Math.max(wetRight, 0.12);
        }
        if (d.y >= localSurfaceY(d.x) - 1.5) {
          const normDropX = d.x / TUBE_IN_R;
          injectWaveRange(normDropX, 4.2, -32.0);
          spawnSplashBubbles(normDropX, 3, false);
          dropPool.push(d);
          fallingDrops.splice(i, 1);
        }
      }

      // 4. 舱内星尘微泡缓升
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.phase += dt * (b.gentle ? 3.8 : 5.8 + 2.0 / b.r);
        const rise = b.gentle ? 16 + b.r * 5 : 25 + b.r * 8;
        const relax = Math.min(1, dt * 3.0);
        b.vx += (sinT * rise - b.vx) * relax;
        b.vy += (-cosT * rise - b.vy) * relax;
        const wob = Math.sin(b.phase) * (b.gentle ? 3.2 : 5.6 + b.r * 2.2);
        b.x += (b.vx + cosT * wob) * dt;
        b.y += (b.vy + sinT * wob) * dt;
        b.aspect = 1 + (b.gentle ? 0.10 : 0.18) * Math.sin(b.phase * 2 + 0.6);
        const limB = Math.max(0, boreHalfWidthAt(b.y) - b.r - 1.0);
        b.x = Math.max(-limB, Math.min(limB, b.x));
        b.y = Math.min(HEM_Y + 11, b.y);
        if (b.y <= localSurfaceY(b.x) + 2.5) {
          injectWaveRange(b.x / TUBE_IN_R, 2.0, b.gentle ? -0.6 : -4.4);
          bubblePool.push(b);
          bubbles.splice(i, 1);
        }
      }
    };

    const step = (dtRaw) => {
      const dt = Math.max(0.001, Math.min(MAX_FRAME_DT, Number(dtRaw || 0.016)));
      accumulator += dt;
      let n = 0;
      while (accumulator >= FIXED_DT && n < MAX_SUBSTEPS) {
        subStep(FIXED_DT);
        accumulator -= FIXED_DT;
        n++;
      }
      if (n >= MAX_SUBSTEPS) accumulator = 0;
    };

    const isSettled = () => {
      if (streaming) return false;
      if (fallingDrops.length > 0 || bubbles.length > 0) return false;
      if (Math.abs(targetFill - fill) >= 0.001) return false;
      if (Math.abs(tiltAngle) >= 0.005 || Math.abs(tiltVel) >= 0.015) return false;
      if (computeEnergy() >= 0.24) return false;
      if (wetLeft >= 0.06 || wetRight >= 0.06) return false;
      return true;
    };

    const readSnapshotInto = (out) => {
      out.fill = fill;
      out.targetFill = targetFill;
      out.fillError = Math.abs(targetFill - fill);
      out.tiltAngle = tiltAngle;
      out.tiltVel = tiltVel;
      out.waveEnergy = computeEnergy();
      out.pendantSize = pendantProgress;
      out.fallingCount = fallingDrops.length;
      out.bubbleCount = bubbles.length;
      out.wetLeft = wetLeft;
      out.wetRight = wetRight;
      out.streaming = streaming;
      return out;
    };

    const getSnapshot = () => {
      const snap = readSnapshotInto({});
      snap.waveEnergy = Number(snap.waveEnergy.toFixed(3));
      return snap;
    };

    return {
      waveH,
      fallingDrops,
      bubbles,
      readSnapshotInto,
      setTargetFill(next) {
        targetFill = clampFillVal(next ?? 0.46);
      },
      snapFillNow(next) {
        targetFill = clampFillVal(next ?? targetFill);
        fill = targetFill;
      },
      setStreaming(on) {
        streaming = Boolean(on);
      },
      injectSlosh,
      injectTilt,
      injectFingerPoke,
      spawnDropletNow,
      getSurfacePixelY,
      isSettled,
      step,
      getSnapshot,
    };
  }

  // ── WebGL2 Antigravity Prism 512K 光学水试管 Shader（深空电离 + 白昼高硼硅晴空蓝实验室玻璃） ──
  const VERT_SRC = `#version 300 es
    in vec2 a_pos;
    out vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out vec4 outColor;

    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_dark;
    uniform float u_fill;
    uniform float u_tilt;
    uniform vec3 u_tint;
    uniform float u_camp;
    uniform float u_accent;
    uniform float u_critical;
    uniform float u_pendant;
    uniform float u_wetL;
    uniform float u_wetR;
    uniform float u_hoverSlice;
    uniform float u_wave[24];
    uniform vec4 u_drops[4];
    uniform vec4 u_bubbles[8];
    uniform vec2 u_bubShape[8];
    uniform float u_raySlope[24];
    uniform vec3 u_ratios;

    const float CX = 34.0;
    const float R_OUT = 21.6;
    const float R_IN = 19.6;
    const float TOP_OUT = 18.5;
    const float TOP_IN = 20.5;
    const float LIP_Y = 18.5;
    const float HEM_Y = 175.0;
    const float FLOOR_OUT = 198.0;
    const float FLOOR_IN = 195.0;
    const float RC_OUT = 14.5;
    const float RC_IN = 12.5;
    const float H_BOX_OUT = 89.75;
    const float Y_MID_OUT = 108.25;
    const float H_BOX_IN = 87.25;
    const float Y_MID_IN = 107.75;

    // 深色深空连续电离色阶：#0F173A -> #1B49B2 -> #3186FF -> #5CC6FC
    const vec3 ION_DEEP = vec3(0.059, 0.090, 0.227);
    const vec3 ION_SYS = vec3(0.106, 0.286, 0.698);
    const vec3 ION_CONV = vec3(0.192, 0.525, 1.000);
    const vec3 ION_TOOL = vec3(0.361, 0.776, 0.988);
    const vec3 ION_HAZE = vec3(0.690, 0.875, 1.000);

    // 白昼高硼硅实验室玻璃 & 皇家钴蓝至晴空蔚蓝电离光谱
    const vec3 DAY_AIR = vec3(0.880, 0.920, 0.980);       // 清透冰川淡蓝灰管腔底衬
    const vec3 DAY_RIM_REF = vec3(0.118, 0.251, 0.686);   // rgba(30, 64, 175, 0.28) 玻璃折射暗边
    const vec3 DAY_ROYAL = vec3(0.114, 0.306, 0.847);     // #1D4ED8 深邃皇家钴蓝
    const vec3 DAY_COBALT = vec3(0.145, 0.388, 0.922);    // #2563EB 鲜亮宝石钴蓝
    const vec3 DAY_SKY = vec3(0.008, 0.518, 0.780);       // #0284C7 浓郁晴空蔚蓝
    const vec3 DAY_CROWN = vec3(0.055, 0.600, 0.885);     // 晴空折射顶冠
    const vec3 DAY_MENISCUS = vec3(0.016, 0.275, 0.635);  // 高对比度靛青弯月面刀锋
    const vec3 DAY_VIOLET = vec3(0.486, 0.227, 0.929);    // #7C3AED 高负载浓郁紫晶
    const vec3 DAY_AMBER_RED = vec3(0.918, 0.345, 0.047); // #EA580C 临界琥珀红

    // 阵营色偏参考常量 & 深色临界态琥珀熔金色阶
    const vec3 CLD_CONV = vec3(0.820, 0.490, 0.280);
    const vec3 CAMP_INDIGO = vec3(0.165, 0.275, 0.725);
    const vec3 CAMP_ASTRAL = vec3(0.395, 0.545, 0.980);
    const vec3 CRIT_DEEP = vec3(0.360, 0.145, 0.035);
    const vec3 CRIT_SYS = vec3(0.740, 0.330, 0.075);
    const vec3 CRIT_CONV = vec3(0.945, 0.600, 0.070);
    const vec3 CRIT_TOOL = vec3(0.995, 0.835, 0.310);

    void layerOver(inout vec3 col, inout float alpha, vec3 srcCol, float srcA) {
      float a = clamp(srcA, 0.0, 1.0);
      if (a <= 1e-4) return;
      float outA = a + alpha * (1.0 - a);
      col = (srcCol * a + col * alpha * (1.0 - a)) / max(outA, 1e-4);
      alpha = outA;
    }

    float roundedBoxSdf(vec2 p, vec2 halfExt, float r) {
      vec2 d = abs(p) - (halfExt - vec2(r));
      return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
    }

    float sampleWave(float uNorm) {
      float t = clamp((uNorm + 1.0) * 0.5, 0.0, 1.0) * 23.0;
      int i1 = int(clamp(floor(t), 0.0, 22.0));
      float f = t - float(i1);
      float p0 = u_wave[max(i1 - 1, 0)];
      float p1 = u_wave[i1];
      float p2 = u_wave[i1 + 1];
      float p3 = u_wave[min(i1 + 2, 23)];
      return 0.5 * (2.0 * p1 + (-p0 + p2) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f * f + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * f * f * f);
    }

    float waveCurvature(float uNorm) {
      float du = 0.10;
      return sampleWave(uNorm - du) + sampleWave(uNorm + du) - 2.0 * sampleWave(uNorm);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float vNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
                 mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    float fbm3(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) {
        v += a * vNoise(p);
        p = p * 2.04 + vec2(11.3, 7.9);
        a *= 0.5;
      }
      return v;
    }

    float capsuleHalfWidth(float yPx, float topY, float botY, float rSide, float rc) {
      if (yPx < topY || yPx > botY) return 0.0;
      float cyT = topY + rc;
      if (yPx < cyT) {
        float dt = cyT - yPx;
        return rSide - rc + sqrt(max(0.0, rc * rc - dt * dt));
      }
      float cyB = botY - rc;
      if (yPx > cyB) {
        float db = yPx - cyB;
        return rSide - rc + sqrt(max(0.0, rc * rc - db * db));
      }
      return rSide;
    }

    // 连续电离能量渐变采样：深色深海靛青 vs 白昼皇家钴蓝-晴空蔚蓝（支持 cobalt / iris / amber / mono 四档强调色）
    vec3 evalHorizonSpectrum(float hFrac) {
      float h = clamp(hFrac, 0.0, 1.0);
      if (u_dark > 0.5) {
        vec3 crit = mix(CRIT_DEEP, CRIT_SYS, smoothstep(0.0, 0.36, h));
        crit = mix(crit, CRIT_CONV, smoothstep(0.30, 0.76, h));
        crit = mix(crit, CRIT_TOOL, smoothstep(0.68, 1.00, h));
        if (u_accent > 2.5) {
          vec3 monoSea = mix(vec3(0.110, 0.115, 0.128), vec3(0.310, 0.320, 0.345), smoothstep(0.0, 0.40, h));
          monoSea = mix(monoSea, vec3(0.580, 0.595, 0.625), smoothstep(0.34, 0.78, h));
          monoSea = mix(monoSea, vec3(0.865, 0.875, 0.895), smoothstep(0.70, 1.00, h));
          return mix(monoSea, crit, u_critical);
        }
        if (u_accent > 1.5) {
          vec3 ambSea = mix(vec3(0.215, 0.095, 0.025), vec3(0.580, 0.270, 0.055), smoothstep(0.0, 0.40, h));
          ambSea = mix(ambSea, vec3(0.851, 0.467, 0.024), smoothstep(0.34, 0.78, h));
          ambSea = mix(ambSea, vec3(0.984, 0.749, 0.141), smoothstep(0.70, 1.00, h));
          return mix(ambSea, crit, u_critical);
        }
        if (u_accent > 0.5) {
          vec3 irisSea = mix(vec3(0.110, 0.055, 0.255), vec3(0.310, 0.165, 0.720), smoothstep(0.0, 0.40, h));
          irisSea = mix(irisSea, vec3(0.545, 0.361, 0.965), smoothstep(0.34, 0.78, h));
          irisSea = mix(irisSea, vec3(0.768, 0.620, 0.992), smoothstep(0.70, 1.00, h));
          return mix(irisSea, crit, u_critical);
        }
        vec3 sea = mix(ION_DEEP, ION_SYS, smoothstep(0.0, 0.38, h));
        sea = mix(sea, ION_CONV, smoothstep(0.30, 0.78, h));
        sea = mix(sea, ION_TOOL, smoothstep(0.68, 1.00, h));
        vec3 darkCamp = mix(CAMP_INDIGO, CAMP_ASTRAL, smoothstep(0.22, 0.96, h));
        vec3 campTinted = mix(sea, darkCamp, u_camp * 0.22);
        return mix(campTinted, crit, u_critical);
      }

      vec3 dayCrit = mix(DAY_VIOLET * 0.86, DAY_VIOLET, smoothstep(0.0, 0.34, h));
      dayCrit = mix(dayCrit, DAY_AMBER_RED, smoothstep(0.28, 0.80, h));
      dayCrit = mix(dayCrit, vec3(0.960, 0.560, 0.065), smoothstep(0.76, 1.00, h));
      if (u_accent > 2.5) {
        vec3 dayMono = mix(vec3(0.153, 0.153, 0.165), vec3(0.322, 0.322, 0.357), smoothstep(0.0, 0.50, h));
        dayMono = mix(dayMono, vec3(0.455, 0.455, 0.490), smoothstep(0.45, 1.00, h));
        return mix(dayMono, dayCrit, u_critical);
      }
      if (u_accent > 1.5) {
        vec3 dayAmb = mix(vec3(0.706, 0.325, 0.035), vec3(0.851, 0.467, 0.024), smoothstep(0.0, 0.50, h));
        dayAmb = mix(dayAmb, vec3(0.961, 0.620, 0.043), smoothstep(0.45, 1.00, h));
        return mix(dayAmb, dayCrit, u_critical);
      }
      if (u_accent > 0.5) {
        vec3 dayIris = mix(vec3(0.357, 0.129, 0.714), vec3(0.486, 0.227, 0.929), smoothstep(0.0, 0.50, h));
        dayIris = mix(dayIris, vec3(0.659, 0.333, 0.969), smoothstep(0.45, 1.00, h));
        return mix(dayIris, dayCrit, u_critical);
      }

      // 白昼高对比晴空蔚蓝 -> 皇家钴蓝光谱（#1D4ED8 -> #2563EB -> #0284C7）
      vec3 daySea = mix(DAY_ROYAL, DAY_COBALT, smoothstep(0.0, 0.48, h));
      daySea = mix(daySea, DAY_SKY, smoothstep(0.42, 0.88, h));
      daySea = mix(daySea, DAY_CROWN, smoothstep(0.82, 1.00, h));
      daySea = mix(daySea, mix(DAY_VIOLET, CLD_CONV, 0.32 * h), u_camp * 0.20);

      // 高负载预警：平滑融入浓郁紫晶 #7C3AED -> 临界琥珀红 #EA580C
      float warnShift = smoothstep(0.68, 0.85, u_fill);
      vec3 warnSpec = mix(DAY_ROYAL, DAY_VIOLET, smoothstep(0.10, 0.78, h));
      daySea = mix(daySea, warnSpec, warnShift * 0.68);
      return mix(daySea, dayCrit, u_critical);
    }

    void drawIonDroplet(inout vec3 col, inout float alpha, vec2 px, vec2 center, float rad, vec3 dropCol, float darkMode) {
      vec2 p = px - center;
      if (dot(p, p) > (rad * 2.2 + 2.0) * (rad * 2.2 + 2.0)) return;
      vec2 q = vec2(p.x * 1.15, (p.y + 0.35 * rad) * 0.68);
      float rn = length(q) / max(0.7, rad);
      float halo = exp(-rn * rn * 2.4);
      float coreDist = length(vec2(p.x * 1.05, p.y * 0.92)) / max(0.6, rad);
      float core = 1.0 - smoothstep(0.35, 0.88, coreDist);
      vec3 bodyTint = darkMode > 0.5 ? mix(dropCol, ION_HAZE, 0.45) : mix(DAY_ROYAL, DAY_SKY, 0.55);
      layerOver(col, alpha, bodyTint, halo * mix(0.68, 0.62, darkMode));
      if (darkMode <= 0.5) {
        float rim = (1.0 - smoothstep(0.62, 1.02, coreDist)) * smoothstep(0.32, 0.68, coreDist);
        layerOver(col, alpha, DAY_MENISCUS, rim * 0.82);
      }
      layerOver(col, alpha, mix(vec3(0.96, 0.99, 1.0), dropCol, 0.28), core * 0.92);
    }

    void main() {
      vec2 px = vec2(v_uv.x * 96.0, (1.0 - v_uv.y) * 220.0);
      float dx = px.x - CX;

      // 1. 一体封闭式修长圆角高硼硅/暗曜石纯透晶舱精确 SDF
      float sdfOut = roundedBoxSdf(vec2(dx, px.y - Y_MID_OUT), vec2(R_OUT, H_BOX_OUT), RC_OUT);
      float distOut = -sdfOut;
      if (distOut <= -0.8) {
        outColor = vec4(0.0);
        return;
      }

      float sdfIn = roundedBoxSdf(vec2(dx, px.y - Y_MID_IN), vec2(R_IN, H_BOX_IN), RC_IN);
      float distIn = -sdfIn;
      float rOutAtY = capsuleHalfWidth(px.y, TOP_OUT, FLOOR_OUT, R_OUT, RC_OUT);
      float rInAtY = capsuleHalfWidth(px.y, TOP_IN, FLOOR_IN, R_IN, RC_IN);
      bool inInnerBore = distIn > -0.6;

      vec3 col = vec3(0.0);
      float alpha = 0.0;

      // 2. 实时 3D 液位与电离激光弯月面坐标
      float topChamber = LIP_Y + 8.0;
      float botChamber = HEM_Y + 14.0;
      float baseSurfY = botChamber - u_fill * (botChamber - topChamber);
      float uIn = (rInAtY > 0.5) ? clamp(dx / rInAtY, -1.0, 1.0) : clamp(dx / R_IN, -1.0, 1.0);
      float au = abs(uIn);
      float slopeTilt = tan(u_tilt) * dx;
      float waveDisp = sampleWave(uIn);
      float capillary = -1.55 * pow(au, 3.0);

      float surfCenterY = baseSurfY + slopeTilt + waveDisp + capillary;
      float perspAmp = (rInAtY > 0.0) ? (0.205 * rInAtY * sqrt(max(0.0, 1.0 - uIn * uIn))) : 0.0;
      float surfBackY = surfCenterY - perspAmp;
      float surfFrontY = surfCenterY + perspAmp;

      float sumR = max(1e-3, u_ratios.x + u_ratios.y + u_ratios.z);
      float colH = max(12.0, FLOOR_IN - baseSurfY);
      float hFrac = clamp((FLOOR_IN - (px.y - slopeTilt * 0.72 - waveDisp * 0.45)) / colH, 0.0, 1.0);
      vec3 ionBase = evalHorizonSpectrum(hFrac);
      vec3 surfTint = evalHorizonSpectrum(0.96);

      // 3. 玻璃舱空气底衬与白昼高硼硅深蓝折射侧壁
      float bodyAA = smoothstep(-0.55, 0.45, distOut);
      float uOut = clamp(dx / max(1.0, rOutAtY), -1.0, 1.0);
      float lensCurve = pow(abs(uOut), 2.6);
      vec3 airBackCol = u_dark > 0.5 ? vec3(0.045, 0.068, 0.125) : DAY_AIR;
      float airBackA = u_dark > 0.5
        ? 0.11 * (0.30 + 0.70 * pow(abs(uOut), 3.4))
        : mix(0.26, 0.42, lensCurve);
      layerOver(col, alpha, airBackCol, airBackA * bodyAA);

      // 白昼高硼硅玻璃壁左右深色折射暗边 (Refraction Rim: rgba(30, 64, 175, 0.28)) 与管口/管底厚壁折光
      if (u_dark <= 0.5) {
        float wallBand = smoothstep(3.4, 0.8, distOut) * bodyAA;
        float sideRefract = smoothstep(0.66, 0.98, abs(uOut)) * bodyAA;
        float capArc = (smoothstep(TOP_OUT + 6.5, TOP_OUT + 1.2, px.y) + smoothstep(FLOOR_OUT - 7.5, FLOOR_OUT - 1.2, px.y)) * bodyAA;
        float refractMask = clamp(max(wallBand * 0.85, sideRefract * 0.92) + capArc * 0.42, 0.0, 1.0);
        layerOver(col, alpha, DAY_RIM_REF, refractMask * 0.28);
      }

      // 顶部圆弧玻璃肩部微米冷折光
      if (px.y < TOP_OUT + RC_OUT) {
        float domeGlow = exp(-pow((px.y - (TOP_OUT + 2.8)) / 2.2, 2.0) - pow((dx + 5.0) / 10.5, 2.0)) * bodyAA;
        vec3 domeCol = u_dark > 0.5 ? mix(ION_HAZE, vec3(1.0), 0.5) : mix(DAY_COBALT, DAY_SKY, 0.45);
        layerOver(col, alpha, domeCol, domeGlow * mix(0.26, 0.32, u_dark));
      }

      // 4. 连续电离能量柱 + 微米星尘缓升
      if (inInnerBore && px.y >= surfBackY - 0.6) {
        float boreMask = smoothstep(-0.45, 0.55, distIn) * smoothstep(-0.5, 0.5, px.y - surfBackY);
        float depthPx = max(0.0, px.y - surfCenterY);
        float nz = sqrt(max(0.0, 1.0 - uIn * uIn));

        vec2 flowUv = vec2(dx / 25.0, (px.y + u_time * 10.5) / 38.0);
        float plasma = fbm3(flowUv + vec2(sin(u_time * 0.38) * 0.22, 0.0));
        float field = smoothstep(0.18, 0.84, plasma) * (0.42 + 0.58 * nz);

        vec3 ionBody;
        if (u_dark > 0.5) {
          vec3 darkEdgeTint = mix(ION_DEEP * 0.84, CRIT_DEEP, u_critical);
          vec3 deepBody = mix(darkEdgeTint, ionBase, 0.28 + 0.66 * nz);
          ionBody = deepBody * (0.72 + 0.26 * nz) * (0.88 + 0.18 * field);
          float horizonCrown = exp(-depthPx / 7.5) * (0.35 + 0.65 * nz);
          ionBody += surfTint * horizonCrown * 0.15;
          float subRim = smoothstep(2.4, 0.35, distIn) * smoothstep(-0.2, 0.5, distIn);
          ionBody = mix(ionBody, mix(surfTint, ION_HAZE, 0.30), subRim * 0.38);
          float botScatter = exp(-pow(dx / 11.0, 2.0) - pow((px.y - (FLOOR_IN - 3.0)) / 3.6, 2.0));
          ionBody += mix(ION_CONV, CRIT_CONV, u_critical) * botScatter * 0.16;
        } else {
          // 白昼饱满蓝宝石圆柱体积折射：边缘深邃皇家蓝，中心通透晴空蔚蓝，绝不泛白寡淡
          vec3 lightEdge = mix(DAY_ROYAL * 0.72, DAY_VIOLET * 0.68, u_critical);
          vec3 richBody = mix(lightEdge, ionBase, 0.32 + 0.68 * nz);
          ionBody = richBody * (0.88 + 0.16 * nz) * (0.92 + 0.14 * field);
          float horizonCrown = exp(-depthPx / 8.5) * (0.40 + 0.60 * nz);
          ionBody = mix(ionBody, mix(surfTint, vec3(0.75, 0.92, 1.0), 0.36), horizonCrown * 0.28);
          float subRim = smoothstep(2.6, 0.35, distIn) * smoothstep(-0.2, 0.5, distIn);
          ionBody = mix(ionBody, mix(DAY_RIM_REF, DAY_MENISCUS, 0.45), subRim * 0.42);
          float botScatter = exp(-pow(dx / 11.5, 2.0) - pow((px.y - (FLOOR_IN - 3.2)) / 3.8, 2.0));
          ionBody += mix(DAY_COBALT, DAY_AMBER_RED, u_critical) * botScatter * 0.18;
        }

        layerOver(col, alpha, clamp(ionBody, 0.0, 1.0), boreMask * mix(0.93, 0.91, u_dark));

        // 4b. 失重微米星尘半调点阵
        if (depthPx > 1.8) {
          float arcX = asin(clamp(uIn, -0.96, 0.96)) * R_IN;
          float waveSyncY = slopeTilt * 0.85 + waveDisp * 0.75;
          float pTime = px.y - waveSyncY + u_time * 6.2;
          vec2 stardustUv = vec2(arcX / 6.0, pTime / 6.0);
          vec2 cellId = floor(stardustUv);
          vec2 cellF = fract(stardustUv) - 0.5;
          float rnd = hash12(cellId + vec2(3.7, 9.1));
          float jitter = (rnd - 0.5) * 0.28;
          vec2 starOff = cellF - vec2(jitter, sin(rnd * 6.283 + u_time * 1.2) * 0.12);
          float dotRad = mix(0.09, 0.20, smoothstep(0.18, 0.95, rnd));
          float dotMask = (1.0 - smoothstep(dotRad - 0.07, dotRad + 0.03, length(starOff)));
          float upperBoost = 0.32 + 0.68 * exp(-depthPx / 54.0);
          float twinkle = 0.65 + 0.35 * sin(u_time * 2.1 + rnd * 12.566);
          float stardustVis = dotMask * step(0.36, rnd) * upperBoost * twinkle * nz * smoothstep(0.6, 2.5, distIn) * boreMask;
          vec3 baseStar = u_dark > 0.5 ? mix(ION_TOOL, ION_HAZE, 0.62) : vec3(0.92, 0.98, 1.0);
          vec3 campStar = mix(baseStar, vec3(0.68, 0.75, 1.0), u_camp * 0.42);
          vec3 starCol = mix(campStar, CRIT_TOOL, u_critical);
          layerOver(col, alpha, min(starCol * 1.22, 1.0), stardustVis * mix(0.62, 0.70, u_dark));
        }

        // 4c. 缓升 3D 星尘微粒与晶莹气泡描边 (u_bubbles)
        for (int i = 0; i < 8; i++) {
          vec4 b = u_bubbles[i];
          if (b.w <= 0.0 || px.y < surfCenterY + 1.0) continue;
          float bRad = b.z;
          vec2 bp0 = px - vec2(CX + b.x, b.y);
          if (dot(bp0, bp0) > (bRad * 2.2 + 1.4) * (bRad * 2.2 + 1.4)) continue;
          float ca = cos(u_bubShape[i].y);
          float sa = sin(u_bubShape[i].y);
          vec2 bpr = vec2(ca * bp0.x + sa * bp0.y, -sa * bp0.x + ca * bp0.y);
          float asp = max(0.65, u_bubShape[i].x);
          vec2 bp = bpr / vec2(asp, 1.0 / asp);
          float bd = length(bp) / max(0.6, bRad);
          float halo = exp(-bd * bd * 1.55) * b.w * boreMask;
          float sparkCore = (1.0 - smoothstep(0.22, 0.76, bd)) * b.w * boreMask;
          layerOver(col, alpha, mix(surfTint, ION_HAZE, 0.45), halo * 0.40);
          if (u_dark <= 0.5) {
            float bubRim = (1.0 - smoothstep(0.72, 1.08, bd)) * smoothstep(0.42, 0.76, bd) * b.w * boreMask;
            layerOver(col, alpha, mix(DAY_MENISCUS, DAY_VIOLET, u_critical), bubRim * 0.85);
          }
          layerOver(col, alpha, vec3(0.95, 0.99, 1.0), sparkCore * 0.88);
        }
      }

      // 5. 3D 折光椭圆液面 + 高对比度弯月面刀锋
      if (inInnerBore) {
        float boreMask = smoothstep(-0.35, 0.55, distIn);

        if (px.y >= surfBackY - 0.5 && px.y <= surfFrontY + 0.5) {
          float discV = clamp((px.y - surfBackY) / max(0.8, surfFrontY - surfBackY), 0.0, 1.0);
          float wSlope = sampleWave(min(1.0, uIn + 0.06)) - sampleWave(max(-1.0, uIn - 0.06));
          float excite = smoothstep(0.08, 0.40, abs(wSlope) + abs(waveCurvature(uIn)) * 0.5 + abs(u_tilt) * 0.6);
          vec3 discCol = u_dark > 0.5
            ? mix(surfTint * 0.78, mix(surfTint, ION_HAZE, 0.42), 0.32 + 0.68 * discV)
            : mix(mix(DAY_ROYAL, DAY_SKY, 0.58), mix(DAY_SKY, vec3(0.76, 0.93, 1.0), 0.52), 0.28 + 0.72 * discV);
          discCol = mix(discCol, vec3(0.90, 0.96, 1.0), excite * 0.28);
          float discMask = smoothstep(-0.45, 0.45, px.y - surfBackY) * smoothstep(-0.45, 0.45, surfFrontY - px.y) * boreMask;
          layerOver(col, alpha, discCol, discMask * mix(0.68, 0.54, u_dark));
        }

        // 后接触弧
        float dBack = abs(px.y - surfBackY);
        float backArc = (1.0 - smoothstep(0.18, 0.82, dBack)) * boreMask;
        vec3 backCol = u_dark > 0.5 ? mix(surfTint, ION_HAZE, 0.55) : mix(DAY_MENISCUS, DAY_SKY, 0.45);
        layerOver(col, alpha, backCol, backArc * mix(0.64, 0.50, u_dark));

        // 前接触弧下缘深海折影
        float dUnder = abs(px.y - (surfFrontY + 1.2));
        float underShadow = (1.0 - smoothstep(0.2, 0.92, dUnder)) * boreMask * step(px.y, FLOOR_IN - 0.5);
        layerOver(col, alpha, u_dark > 0.5 ? ION_DEEP : DAY_ROYAL * 0.58, underShadow * mix(0.52, 0.46, u_dark));

        // 1.15px 锋利弯月面折射刀锋（浅色采用高对比靛青刀锋，深色采用冰青激光刃）
        float dFront = abs(px.y - surfFrontY);
        float laserHalo = exp(-pow(dFront / 2.1, 2.0)) * boreMask;
        float laserBlade = (1.0 - smoothstep(0.32, 0.95, dFront)) * boreMask;
        if (u_dark > 0.5) {
          float wSlope = abs(sampleWave(min(1.0, uIn + 0.06)) - sampleWave(max(-1.0, uIn - 0.06)));
          float prismShift = smoothstep(0.05, 0.32, wSlope + abs(u_tilt) * 0.7);
          vec3 coldBlade = mix(ION_TOOL, ION_HAZE, 0.68);
          vec3 baseBladeCol = mix(coldBlade, vec3(0.74, 0.82, 1.0), u_camp * 0.24);
          vec3 prismBladeCol = mix(ION_CONV, mix(CAMP_ASTRAL, ION_TOOL, 0.5 + 0.5 * uIn), clamp((uIn + 1.0) * 0.5, 0.0, 1.0));
          vec3 laserCol = mix(baseBladeCol, prismBladeCol, prismShift * (1.0 - u_critical) * 0.58);
          if (u_critical > 0.5) laserCol = mix(CRIT_TOOL, vec3(1.0, 0.97, 0.86), 0.48);
          layerOver(col, alpha, laserCol, laserHalo * 0.36);
          layerOver(col, alpha, mix(laserCol, vec3(0.97, 0.99, 1.0), 0.44), laserBlade * 0.92);
        } else {
          vec3 dayBlade = u_critical > 0.5
            ? mix(vec3(0.76, 0.25, 0.04), DAY_AMBER_RED, 0.5)
            : DAY_MENISCUS;
          layerOver(col, alpha, dayBlade, laserHalo * 0.38);
          layerOver(col, alpha, dayBlade, laserBlade * 0.95);
          float specLine = (1.0 - smoothstep(0.15, 0.58, abs(px.y - (surfFrontY - 0.55)))) * boreMask * (1.0 - 0.45 * au);
          layerOver(col, alpha, vec3(0.94, 0.99, 1.0), specLine * 0.72);
        }
      }

      // 6. 空气段内壁残留电离润湿细丝 & 显式下落光滴
      if (inInnerBore && px.y < surfCenterY) {
        float wetSpan = 54.0;
        vec3 wetCol = u_dark > 0.5 ? mix(surfTint, ION_HAZE, 0.48) : mix(DAY_COBALT, DAY_SKY, 0.5);
        if (dx < 0.0 && u_wetL > 0.01 && px.y > surfCenterY - u_wetL * wetSpan) {
          float wRatio = 1.0 - clamp((surfCenterY - px.y) / (u_wetL * wetSpan), 0.0, 1.0);
          float wallMask = smoothstep(2.0, 0.3, distIn) * smoothstep(-0.2, 0.3, distIn);
          layerOver(col, alpha, wetCol, wallMask * wRatio * 0.56);
        }
        if (dx > 0.0 && u_wetR > 0.01 && px.y > surfCenterY - u_wetR * wetSpan) {
          float wRatio = 1.0 - clamp((surfCenterY - px.y) / (u_wetR * wetSpan), 0.0, 1.0);
          float wallMask = smoothstep(2.0, 0.3, distIn) * smoothstep(-0.2, 0.3, distIn);
          layerOver(col, alpha, wetCol, wallMask * wRatio * 0.56);
        }
      }

      for (int i = 0; i < 4; i++) {
        vec4 dr = u_drops[i];
        if (dr.w <= 0.0) continue;
        drawIonDroplet(col, alpha, px, vec2(CX + dr.x, dr.y), dr.z, surfTint, u_dark);
      }

      // 7. 垂直玻璃折射丝（白昼空气段采用冷蓝折射丝，液柱段采用纯白晶丝，彻底告别白底画白线！）
      if (px.y > TOP_OUT + 9.0 && px.y < FLOOR_OUT - 9.0) {
        bool submerged = px.y >= surfCenterY;
        float snellShift = submerged ? 1.0 : 0.0;
        float fineAxisX = CX - R_OUT * 0.72 + snellShift;
        float fineThread = (1.0 - smoothstep(0.18, 0.85, abs(px.x - fineAxisX)))
          * smoothstep(TOP_OUT + 9.0, TOP_OUT + 22.0, px.y)
          * (1.0 - smoothstep(FLOOR_OUT - 22.0, FLOOR_OUT - 9.0, px.y))
          * smoothstep(0.8, 1.8, distOut);
        vec3 threadCol = u_dark > 0.5
          ? vec3(0.78, 0.89, 1.0)
          : (submerged ? vec3(0.95, 0.99, 1.0) : mix(DAY_RIM_REF, DAY_COBALT, 0.42));
        float threadAlpha = u_dark > 0.5 ? 0.32 : (submerged ? 0.56 : 0.34);
        layerOver(col, alpha, threadCol, fineThread * threadAlpha);
      }

      // 悬停切片图例时的 1px 光学聚焦环
      if (u_hoverSlice >= -0.5) {
        float midFrac = u_hoverSlice < 0.5
          ? (u_ratios.x * 0.5) / sumR
          : (u_hoverSlice < 1.5 ? (u_ratios.x + u_ratios.y * 0.5) / sumR : (u_ratios.x + u_ratios.y + u_ratios.z * 0.5) / sumR);
        float sliceY = FLOOR_IN - colH * midFrac;
        float sDist = abs(px.y - (sliceY + 0.14 * max(0.0, rOutAtY - abs(dx))));
        float hRing = (1.0 - smoothstep(0.25, 1.15, sDist)) * bodyAA;
        layerOver(col, alpha, u_dark > 0.5 ? ION_HAZE : vec3(1.0), hRing * 0.84);
      }

      // 1.1px 精密高硼硅/冷晶微棱镜胶囊外轮廓
      float rimMask = smoothstep(1.65, 0.95, distOut) * smoothstep(-0.35, 0.35, distOut);
      float prismGrad = 0.5 + 0.5 * sin(px.y * 0.032 - u_time * 0.40 + dx * 0.04);
      vec3 darkRimLeft = mix(vec3(0.72, 0.85, 0.98), mix(vec3(0.22, 0.48, 0.92), vec3(0.48, 0.56, 0.92), prismGrad), 0.30);
      vec3 darkRimRight = vec3(0.20, 0.30, 0.46);
      vec3 lightRim = mix(DAY_RIM_REF, vec3(0.118, 0.161, 0.231), 0.52 + 0.25 * smoothstep(-0.6, 0.7, uOut));
      vec3 rimCol = u_dark > 0.5
        ? mix(darkRimLeft, darkRimRight, smoothstep(-0.6, 0.7, uOut))
        : lightRim;
      layerOver(col, alpha, rimCol, rimMask * mix(0.82, 0.84, u_dark));

      // 8. Mono 钛银单色纯化（消除蓝光/彩虹折射残留）+ 动态微米抖动防 8-bit 梯度色带
      if (u_accent > 2.5 && u_critical < 0.5) {
        float monoLum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(monoLum * 0.99, monoLum, monoLum * 1.01), 0.94);
      } else if (u_accent > 0.5 && u_dark <= 0.5 && u_critical < 0.5) {
        // 白昼 iris / amber 模式下同步玻璃侧沿与液面刀锋色相
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 toneTint = u_accent > 1.5 ? vec3(lum * 1.24, lum * 0.88, lum * 0.52) : vec3(lum * 0.96, lum * 0.78, lum * 1.28);
        col = mix(col, clamp(toneTint, 0.0, 1.0), 0.24 * (1.0 - step(surfBackY, px.y)));
      }
      float n1 = hash12(gl_FragCoord.xy + fract(u_time * 7.0) * 31.0);
      float n2 = hash12(gl_FragCoord.xy + vec2(17.31, 41.7));
      float dither = (n1 + n2 - 1.0) / 255.0;
      outColor = vec4(clamp(col + vec3(dither), 0.0, 1.0), clamp(alpha + dither * step(0.01, alpha), 0.0, 1.0));
    }
  `;

  function compileProgram(gl, vSrc, fSrc) {
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || 'shader error';
        gl.deleteShader(sh);
        throw new Error(log);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || 'link error');
    }
    return prog;
  }

  function traceClosedCapsule(ctx, cx, rSide, topY, botY, rTop, rBot) {
    const rt = Math.max(0, Math.min(rTop, rSide));
    const rb = Math.max(0, Math.min(rBot, rSide));
    const leftX = cx - rSide;
    const rightX = cx + rSide;
    ctx.beginPath();
    ctx.moveTo(leftX + rt, topY);
    ctx.lineTo(rightX - rt, topY);
    ctx.arcTo(rightX, topY, rightX, topY + rt, rt);
    ctx.lineTo(rightX, botY - rb);
    ctx.arcTo(rightX, botY, rightX - rb, botY, rb);
    ctx.lineTo(leftX + rb, botY);
    ctx.arcTo(leftX, botY, leftX, botY - rb, rb);
    ctx.lineTo(leftX, topY + rt);
    ctx.arcTo(leftX, topY, leftX + rt, topY, rt);
    ctx.closePath();
  }

  function traceCapsuleColumn(ctx, cx, rSide, topLeftY, topRightY, floorY, rCorner) {
    const rc = Math.max(0, Math.min(rCorner, rSide));
    const leftX = cx - rSide;
    const rightX = cx + rSide;
    const cornerStartL = Math.max(topLeftY, floorY - rc);
    const cornerStartR = Math.max(topRightY, floorY - rc);
    ctx.beginPath();
    ctx.moveTo(leftX, topLeftY);
    ctx.lineTo(leftX, cornerStartL);
    ctx.arcTo(leftX, floorY, leftX + rc, floorY, rc);
    ctx.lineTo(rightX - rc, floorY);
    ctx.arcTo(rightX, floorY, rightX, cornerStartR, rc);
    ctx.lineTo(rightX, topRightY);
    ctx.closePath();
  }

  function formatTickTokens(v) {
    if (v >= 1e6) {
      const m = v / 1e6;
      return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (v >= 1e3) {
      const k = Math.round(v / 100) / 10;
      return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
    }
    return String(Math.round(v));
  }

  /**
   * 挂载 1:1 物理反重力 512K 光学水试管渲染器到指定 <canvas>
   */
  function mountPhysicalWaterVial(canvas, options = {}) {
    const cssW = 96;
    const cssH = 220;
    const reduceMotion = Boolean(options.reduceMotion);
    const ctx2d = canvas.getContext('2d');
    let manualFill = clampFillVal(options.fill ?? 0.46);
    let useManualFill = false;
    let manualDark = options.isDark !== undefined ? Boolean(options.isDark) : true;
    let manualStreaming = options.streaming !== undefined ? Boolean(options.streaming) : false;

    const phys = createWaterVialPhysics({
      fill: manualFill,
      streaming: manualStreaming,
    });

    const userGetState = typeof options.getState === 'function' ? options.getState : null;
    const readExternalState = () =>
      userGetState
        ? userGetState()
        : {
            isDark: manualDark,
            camp: 'gemini',
            critical: manualFill >= 0.85,
            fill: manualFill,
            maxTokens: Number(options.maxTokens) > 0 ? Number(options.maxTokens) : 512000,
            hoveredSlice: -1,
            streaming: manualStreaming,
          };

    let lastExtFill = clampFillVal(readExternalState().fill ?? manualFill);
    const resolveEffectiveState = () => {
      const raw = readExternalState() || {};
      const extFill = clampFillVal(raw.fill ?? manualFill);
      if (Math.abs(extFill - lastExtFill) > 1e-6) {
        lastExtFill = extFill;
        useManualFill = false;
      }
      const effFill = useManualFill ? manualFill : extFill;
      const docEl = typeof document !== 'undefined' ? document.documentElement : null;
      const rawTone = raw.accentTone || docEl?.getAttribute?.('data-ag-cs-accent') || 'follow';
      const rawPal = raw.palette || docEl?.getAttribute?.('data-ag-cs-palette') || 'obsidian';
      const effTone =
        rawTone === 'iris' || rawTone === 'amber' || rawTone === 'mono' || rawTone === 'cobalt'
          ? rawTone
          : rawPal === 'warm'
            ? 'amber'
            : 'cobalt';
      return {
        isDark: raw.isDark !== undefined ? Boolean(raw.isDark) : manualDark,
        lightPreset: raw.lightPreset || 'crystal',
        accentTone: effTone,
        camp: raw.camp === 'claude' ? 'claude' : 'gemini',
        critical: raw.critical !== undefined ? Boolean(raw.critical) : effFill >= 0.85,
        fill: effFill,
        maxTokens: Number(raw.maxTokens) > 0 ? Number(raw.maxTokens) : 512000,
        hoveredSlice: typeof raw.hoveredSlice === 'number' ? raw.hoveredSlice : -1,
        streaming: raw.streaming !== undefined ? Boolean(raw.streaming) : manualStreaming,
        ratios: Array.isArray(raw.ratios) ? raw.ratios : [0.08, 0.27, 0.12],
      };
    };

    let glState = null;
    let glCanvas = null;
    let glContextLost = false;

    const buildGlState = (gl) => {
      const prog = compileProgram(gl, VERT_SRC, FRAG_SRC);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const locPos = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
      return {
        gl,
        prog,
        buf,
        u: {
          res: gl.getUniformLocation(prog, 'u_res'),
          time: gl.getUniformLocation(prog, 'u_time'),
          dark: gl.getUniformLocation(prog, 'u_dark'),
          fill: gl.getUniformLocation(prog, 'u_fill'),
          tilt: gl.getUniformLocation(prog, 'u_tilt'),
          tint: gl.getUniformLocation(prog, 'u_tint'),
          camp: gl.getUniformLocation(prog, 'u_camp'),
          accent: gl.getUniformLocation(prog, 'u_accent'),
          critical: gl.getUniformLocation(prog, 'u_critical'),
          pendant: gl.getUniformLocation(prog, 'u_pendant'),
          wetL: gl.getUniformLocation(prog, 'u_wetL'),
          wetR: gl.getUniformLocation(prog, 'u_wetR'),
          hoverSlice: gl.getUniformLocation(prog, 'u_hoverSlice'),
          wave: gl.getUniformLocation(prog, 'u_wave[0]'),
          drops: gl.getUniformLocation(prog, 'u_drops[0]'),
          bubbles: gl.getUniformLocation(prog, 'u_bubbles[0]'),
          bubShape: gl.getUniformLocation(prog, 'u_bubShape[0]'),
          raySlope: gl.getUniformLocation(prog, 'u_raySlope[0]'),
          ratios: gl.getUniformLocation(prog, 'u_ratios'),
        },
      };
    };

    const onGlLost = (ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      glContextLost = true;
      glState = null;
      dirtyRender = true;
      if (typeof options.onWake === 'function') {
        try { options.onWake(); } catch {}
      }
    };

    const onGlRestored = () => {
      if (!glCanvas) return;
      try {
        const gl = glCanvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false });
        if (gl) {
          glState = buildGlState(gl);
          glContextLost = false;
          dirtyRender = true;
          if (typeof options.onWake === 'function') {
            try { options.onWake(); } catch {}
          }
        }
      } catch {
        glState = null;
      }
    };

    if (typeof document !== 'undefined' && ctx2d) {
      try {
        glCanvas = document.createElement('canvas');
        if (glCanvas && typeof glCanvas.addEventListener === 'function') {
          glCanvas.addEventListener('webglcontextlost', onGlLost);
          glCanvas.addEventListener('webglcontextrestored', onGlRestored);
        }
        const gl = glCanvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false });
        if (gl) {
          glState = buildGlState(gl);
        }
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[vial-core] WebGL2 不可用，降级 2D：', err && err.message);
        glState = null;
      }
    }

    const getRendererMode = () => (glState && !glContextLost ? 'webgl2' : '2d');
    let lastPointer = null;
    let elapsedTime = 0;
    let settleClock = 0;
    let dirtyRender = false;
    let renderedSig = '';

    const TINT_HORIZON = new Float32Array([0.192, 0.525, 1.0]);
    const TINT_ASTRAL = new Float32Array([0.325, 0.515, 0.98]);
    const TINT_CRITICAL = new Float32Array([0.96, 0.62, 0.07]);
    const dropArr = new Float32Array(16);
    const bubArr = new Float32Array(32);
    const bubShapeArr = new Float32Array(16);
    const raySlopeArr = new Float32Array(WAVE_NODES);
    const snapBuf = {};

    const buildVisualSig = (st) =>
      `${st.isDark ? 1 : 0}|${st.lightPreset}|${st.camp}|${st.critical ? 1 : 0}|${st.hoveredSlice}|${st.maxTokens}|${st.fill.toFixed(4)}|${st.accentTone}`;

    const notifyWake = () => {
      dirtyRender = true;
      if (typeof options.onWake === 'function') {
        try {
          options.onWake();
        } catch {}
      }
    };

    const crWave = (wave, uNorm) => {
      const t = Math.max(0, Math.min(1, (uNorm + 1) * 0.5)) * (WAVE_NODES - 1);
      const i1 = Math.max(0, Math.min(WAVE_NODES - 2, Math.floor(t)));
      const f = t - i1;
      const p0 = wave[Math.max(i1 - 1, 0)];
      const p1 = wave[i1];
      const p2 = wave[i1 + 1];
      const p3 = wave[Math.min(i1 + 2, WAVE_NODES - 1)];
      return (
        0.5 *
        (2 * p1 +
          (-p0 + p2) * f +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
          (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
      );
    };

    const updateRaySlopes = (tilt, t) => {
      const tanT = Math.tan(tilt);
      const du = 0.045;
      for (let j = 0; j < WAVE_NODES; j++) {
        const u = -1 + (j + 0.5) / 12;
        const waveSlope = (crWave(phys.waveH, u + du) - crWave(phys.waveH, u - du)) / (2 * du * TUBE_IN_R);
        const micro =
          (0.03 * 9 * Math.cos(u * 9 + t * 2.1) + 0.018 * 15 * Math.cos(u * 15 - t * 2.8 + 1.3)) / TUBE_IN_R;
        raySlopeArr[j] = waveSlope + tanT * 0.35 + micro;
      }
    };

    let cachedCanvasRect = null;
    let cachedCanvasRectAt = 0;
    const readCanvasRect = (force = false) => {
      const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (!force && cachedCanvasRect && now - cachedCanvasRectAt < 250) {
        return cachedCanvasRect;
      }
      cachedCanvasRect = canvas.getBoundingClientRect();
      cachedCanvasRectAt = now;
      return cachedCanvasRect;
    };

    const onPointerMove = (evt) => {
      const rect = readCanvasRect(false);
      if (!rect || !rect.width || !rect.height) return;
      const rx = evt.clientX - rect.left;
      const ry = evt.clientY - rect.top;
      if (lastPointer) {
        const vx = Math.max(-24, Math.min(24, evt.clientX - lastPointer.cx));
        const vy = Math.max(-24, Math.min(24, evt.clientY - lastPointer.cy));
        const normX = (rx - TUBE_X) / TUBE_IN_R;
        const normY = (ry - (LIP_Y + 8)) / (HEM_Y - LIP_Y + 6);
        phys.injectFingerPoke(normX, normY, vx, vy);
        notifyWake();
      }
      lastPointer = { x: rx, y: ry, cx: evt.clientX, cy: evt.clientY };
    };
    const onPointerDown = (evt) => {
      const rect = readCanvasRect(true);
      if (!rect || !rect.width || !rect.height) return;
      const rx = evt.clientX - rect.left;
      const ry = evt.clientY - rect.top;
      const normX = (rx - TUBE_X) / TUBE_IN_R;
      const normY = (ry - (LIP_Y + 8)) / (HEM_Y - LIP_Y + 6);
      phys.injectFingerPoke(normX, normY, (Math.random() - 0.5) * 8, -4);
      phys.injectSlosh(normX >= 0 ? 1.25 : -1.25);
      notifyWake();
    };
    const onPointerLeave = () => {
      lastPointer = null;
      cachedCanvasRect = null;
      cachedCanvasRectAt = 0;
    };

    if (canvas && canvas.addEventListener) {
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointerleave', onPointerLeave);
    }

    // 右侧 512K 动态激光微刻标尺（浅色加深为清晰石板蓝灰 rgba(30, 41, 59, 0.62)）
    const drawScaleMarks = (ctx, st, curFill) => {
      const isDark = Boolean(st.isDark);
      const maxTok = Number(st.maxTokens) > 0 ? Number(st.maxTokens) : 512000;
      const tickX = TUBE_X + TUBE_OUT_R + 2.4;
      const topChamber = LIP_Y + 8;
      const botChamber = HEM_Y + 14;
      const hChamber = botChamber - topChamber;

      ctx.save();
      ctx.font = '500 9px "JetBrains Mono", "Google Sans Mono", ui-monospace, SFMono-Regular, monospace';
      ctx.textBaseline = 'middle';

      for (const subFrac of [0.125, 0.375, 0.625, 0.875]) {
        const sy = Math.round(botChamber - subFrac * hChamber);
        ctx.fillStyle = isDark ? 'rgba(168, 190, 224, 0.18)' : 'rgba(30, 41, 59, 0.24)';
        ctx.fillRect(tickX, sy - 0.4, 2.0, 0.85);
      }

      const tone = st.accentTone || 'cobalt';
      const activeCols =
        tone === 'mono'
          ? isDark ? ['#71717A', '#A1A1AA', '#E4E4E7'] : ['#3F3F46', '#52525B', '#71717A']
          : tone === 'amber'
            ? isDark ? ['#B45309', '#D97706', '#FBBF24'] : ['#92400E', '#B45309', '#D97706']
            : tone === 'iris'
              ? isDark ? ['#6D28D9', '#8B5CF6', '#C4B5FD'] : ['#5B21B6', '#7C3AED', '#9333EA']
              : [isDark ? '#2A6EE8' : '#1D4ED8', isDark ? '#3186FF' : '#2563EB', isDark ? '#5CC6FC' : '#0284C7'];
      const majorSpecs = [
        { frac: 0.25, label: formatTickTokens(maxTok * 0.25), activeCol: activeCols[0] },
        { frac: 0.5, label: formatTickTokens(maxTok * 0.5), activeCol: activeCols[1] },
        { frac: 0.75, label: formatTickTokens(maxTok * 0.75), activeCol: activeCols[2] },
      ];
      for (const item of majorSpecs) {
        const ty = Math.round(botChamber - item.frac * hChamber);
        const reached = curFill >= item.frac - 0.012;
        const lineCol = reached
          ? st.critical
            ? isDark ? '#F59E0B' : '#EA580C'
            : item.activeCol
          : isDark
            ? 'rgba(172, 194, 228, 0.28)'
            : 'rgba(30, 41, 59, 0.38)';

        if (reached) {
          ctx.fillStyle = st.critical
            ? 'rgba(234, 88, 12, 0.20)'
            : tone === 'mono'
              ? 'rgba(161, 161, 170, 0.20)'
              : tone === 'amber'
                ? 'rgba(217, 119, 6, 0.18)'
                : tone === 'iris'
                  ? 'rgba(139, 92, 246, 0.18)'
                  : isDark
                    ? 'rgba(92, 198, 252, 0.18)'
                    : 'rgba(37, 99, 235, 0.16)';
          ctx.fillRect(tickX - 0.5, ty - 1.1, 4.5, 2.2);
        }
        ctx.fillStyle = lineCol;
        ctx.fillRect(tickX, ty - 0.5, 3.5, 1.0);

        ctx.fillStyle = reached
          ? isDark
            ? 'rgba(222, 236, 252, 0.88)'
            : 'rgba(15, 23, 42, 0.90)'
          : isDark
            ? 'rgba(140, 154, 178, 0.58)'
            : 'rgba(30, 41, 59, 0.62)';
        ctx.fillText(item.label, tickX + 5.6, ty + 0.3);
      }
      ctx.restore();
    };

    // 2D 降级保底：与 WebGL2 视觉一致的白昼高硼硅折射侧壁 + 皇家钴蓝至晴空蔚蓝液柱
    const gradCache = new Map();
    const getIonCylGrad = (ctx, isDark, tone = 'cobalt') => {
      const key = `${isDark ? 'd' : 'l'}:${tone}`;
      let g = gradCache.get(key);
      if (g) return g;
      g = ctx.createLinearGradient(TUBE_X - TUBE_IN_R, 0, TUBE_X + TUBE_IN_R, 0);
      const edgeL =
        tone === 'mono'
          ? 'rgba(63, 63, 70, 0.30)'
          : tone === 'amber'
            ? 'rgba(146, 64, 14, 0.30)'
            : tone === 'iris'
              ? 'rgba(91, 33, 182, 0.30)'
              : 'rgba(30, 64, 175, 0.32)';
      const edgeD = tone === 'mono' ? 'rgba(24, 24, 27, 0.58)' : 'rgba(15, 23, 58, 0.58)';
      g.addColorStop(0.0, isDark ? edgeD : edgeL);
      g.addColorStop(0.24, 'rgba(255, 255, 255, 0.08)');
      g.addColorStop(0.5, isDark ? (tone === 'mono' ? 'rgba(228, 228, 231, 0.14)' : 'rgba(168, 220, 255, 0.14)') : 'rgba(255, 255, 255, 0.22)');
      g.addColorStop(0.82, isDark ? (tone === 'mono' ? 'rgba(24, 24, 27, 0.38)' : 'rgba(15, 23, 58, 0.38)') : (tone === 'cobalt' ? 'rgba(30, 64, 175, 0.20)' : edgeL));
      g.addColorStop(1.0, isDark ? (tone === 'mono' ? 'rgba(24, 24, 27, 0.64)' : 'rgba(15, 23, 58, 0.64)') : (tone === 'cobalt' ? 'rgba(30, 64, 175, 0.34)' : edgeL));
      gradCache.set(key, g);
      return g;
    };

    const getAirGlassGrad2D = (ctx, tone = 'cobalt') => {
      const key = `airL:${tone}`;
      let g = gradCache.get(key);
      if (g) return g;
      g = ctx.createLinearGradient(TUBE_X - TUBE_OUT_R, 0, TUBE_X + TUBE_OUT_R, 0);
      const rim =
        tone === 'mono'
          ? 'rgba(82, 82, 91, 0.28)'
          : tone === 'amber'
            ? 'rgba(146, 64, 14, 0.26)'
            : tone === 'iris'
              ? 'rgba(91, 33, 182, 0.26)'
              : 'rgba(30, 64, 175, 0.28)';
      const mid = tone === 'mono' ? 'rgba(244, 244, 245, 0.34)' : tone === 'amber' ? 'rgba(254, 243, 199, 0.32)' : 'rgba(224, 235, 250, 0.36)';
      g.addColorStop(0.0, rim);
      g.addColorStop(0.14, mid);
      g.addColorStop(0.5, tone === 'mono' ? 'rgba(244, 244, 245, 0.26)' : 'rgba(224, 235, 250, 0.28)');
      g.addColorStop(0.86, mid);
      g.addColorStop(1.0, rim);
      gradCache.set(key, g);
      return g;
    };

    const drawFallback2D = (ctx, st) => {
      const isDark = Boolean(st.isDark);
      const tone = st.accentTone || 'cobalt';
      const snap = phys.readSnapshotInto(snapBuf);
      const surfY = phys.getSurfacePixelY();
      const tilt = snap.tiltAngle;
      const slope = Math.tan(tilt) * TUBE_IN_R;
      const isClaude = st.camp === 'claude';
      const isCrit = Boolean(st.critical);
      const bladeCol = isCrit
        ? isDark
          ? 'rgba(255, 236, 168, 0.94)'
          : 'rgba(234, 88, 12, 0.96)'
        : tone === 'mono'
          ? isDark ? 'rgba(244, 244, 245, 0.94)' : 'rgba(39, 39, 42, 0.96)'
          : tone === 'amber'
            ? isDark ? 'rgba(253, 224, 71, 0.94)' : 'rgba(180, 83, 9, 0.96)'
            : tone === 'iris'
              ? isDark ? 'rgba(221, 214, 254, 0.94)' : 'rgba(109, 40, 217, 0.96)'
              : isDark
                ? 'rgba(176, 224, 255, 0.94)'
                : 'rgba(3, 105, 161, 0.96)';

      ctx.save();

      // 1. 高硼硅/暗曜石对称胶囊空气腔背衬与折射侧壁
      traceClosedCapsule(ctx, TUBE_X, TUBE_OUT_R, TOP_OUT, FLOOR_OUT, RC_OUT, RC_OUT);
      ctx.fillStyle = isDark ? (tone === 'mono' ? 'rgba(24, 24, 27, 0.14)' : 'rgba(11, 16, 30, 0.12)') : getAirGlassGrad2D(ctx, tone);
      ctx.fill();

      // 2. 连续电离能量柱
      if (surfY < FLOOR_IN - 0.5) {
        const liqGrad = ctx.createLinearGradient(TUBE_X, FLOOR_IN, TUBE_X, Math.min(FLOOR_IN - 6, surfY));
        if (isCrit) {
          if (isDark) {
            liqGrad.addColorStop(0.0, 'rgba(92, 37, 9, 0.92)');
            liqGrad.addColorStop(0.38, 'rgba(189, 84, 19, 0.90)');
            liqGrad.addColorStop(0.75, 'rgba(241, 153, 18, 0.90)');
            liqGrad.addColorStop(1.0, 'rgba(254, 213, 79, 0.90)');
          } else {
            liqGrad.addColorStop(0.0, 'rgba(124, 58, 237, 0.94)');
            liqGrad.addColorStop(0.52, 'rgba(234, 88, 12, 0.93)');
            liqGrad.addColorStop(1.0, 'rgba(245, 158, 11, 0.94)');
          }
        } else if (tone === 'mono') {
          if (isDark) {
            liqGrad.addColorStop(0.0, 'rgba(24, 24, 27, 0.92)');
            liqGrad.addColorStop(0.45, 'rgba(82, 82, 91, 0.90)');
            liqGrad.addColorStop(1.0, 'rgba(212, 212, 216, 0.90)');
          } else {
            liqGrad.addColorStop(0.0, 'rgba(39, 39, 42, 0.94)');
            liqGrad.addColorStop(0.52, 'rgba(82, 82, 91, 0.93)');
            liqGrad.addColorStop(1.0, 'rgba(113, 113, 122, 0.94)');
          }
        } else if (tone === 'amber') {
          if (isDark) {
            liqGrad.addColorStop(0.0, 'rgba(69, 26, 3, 0.92)');
            liqGrad.addColorStop(0.45, 'rgba(180, 83, 9, 0.90)');
            liqGrad.addColorStop(1.0, 'rgba(251, 191, 36, 0.90)');
          } else {
            liqGrad.addColorStop(0.0, 'rgba(146, 64, 14, 0.94)');
            liqGrad.addColorStop(0.52, 'rgba(217, 119, 6, 0.93)');
            liqGrad.addColorStop(1.0, 'rgba(245, 158, 11, 0.94)');
          }
        } else if (tone === 'iris') {
          if (isDark) {
            liqGrad.addColorStop(0.0, 'rgba(46, 16, 101, 0.92)');
            liqGrad.addColorStop(0.45, 'rgba(109, 40, 217, 0.90)');
            liqGrad.addColorStop(1.0, 'rgba(196, 181, 253, 0.90)');
          } else {
            liqGrad.addColorStop(0.0, 'rgba(91, 33, 182, 0.94)');
            liqGrad.addColorStop(0.52, 'rgba(124, 58, 237, 0.93)');
            liqGrad.addColorStop(1.0, 'rgba(168, 85, 247, 0.94)');
          }
        } else if (isDark) {
          liqGrad.addColorStop(0.0, 'rgba(15, 23, 58, 0.92)');
          liqGrad.addColorStop(0.36, isClaude ? 'rgba(32, 72, 180, 0.90)' : 'rgba(27, 73, 178, 0.90)');
          liqGrad.addColorStop(0.74, isClaude ? 'rgba(64, 132, 252, 0.90)' : 'rgba(49, 134, 255, 0.90)');
          liqGrad.addColorStop(1.0, 'rgba(92, 198, 252, 0.90)');
        } else if (snap.fill >= 0.72) {
          liqGrad.addColorStop(0.0, '#1D4ED8');
          liqGrad.addColorStop(0.55, '#4F46E5');
          liqGrad.addColorStop(1.0, '#7C3AED');
        } else {
          liqGrad.addColorStop(0.0, 'rgba(29, 78, 216, 0.94)');
          liqGrad.addColorStop(0.52, isClaude ? 'rgba(59, 102, 228, 0.93)' : 'rgba(37, 99, 235, 0.93)');
          liqGrad.addColorStop(1.0, 'rgba(2, 132, 199, 0.94)');
        }
        traceCapsuleColumn(ctx, TUBE_X, TUBE_IN_R, surfY - slope, surfY + slope, FLOOR_IN, RC_IN);
        ctx.fillStyle = liqGrad;
        ctx.fill();

        traceCapsuleColumn(ctx, TUBE_X, TUBE_IN_R, surfY - slope, surfY + slope, FLOOR_IN, RC_IN);
        ctx.fillStyle = getIonCylGrad(ctx, isDark, tone);
        ctx.fill();
      }

      // 3. 失重微米星尘点阵与晶莹气泡描边
      ctx.fillStyle = isDark
        ? isClaude
          ? 'rgba(182, 198, 255, 0.50)'
          : 'rgba(176, 224, 255, 0.50)'
        : 'rgba(255, 255, 255, 0.68)';
      for (let sy = surfY + 7; sy < FLOOR_IN - 6; sy += 7.5) {
        const half = Math.max(4, Math.min(TUBE_IN_R - 4, TUBE_IN_R - 3));
        for (let sx = -half + 3; sx <= half - 3; sx += 6.2) {
          if (((Math.round(sx + sy) * 37) & 3) === 0) continue;
          ctx.beginPath();
          ctx.ellipse(TUBE_X + sx, sy, 0.7, 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (let i = 0; i < Math.min(8, phys.bubbles.length); i++) {
        const b = phys.bubbles[i];
        if (b.y <= surfY + 2) continue;
        const br = Math.max(0.85, b.r * 0.7);
        ctx.fillStyle = isDark ? 'rgba(220, 242, 255, 0.84)' : 'rgba(240, 249, 255, 0.92)';
        ctx.beginPath();
        ctx.ellipse(TUBE_X + b.x, b.y, br, br, 0, 0, Math.PI * 2);
        ctx.fill();
        if (!isDark) {
          ctx.strokeStyle = isCrit
            ? 'rgba(194, 65, 12, 0.72)'
            : tone === 'mono'
              ? 'rgba(63, 63, 70, 0.68)'
              : tone === 'amber'
                ? 'rgba(180, 83, 9, 0.68)'
                : tone === 'iris'
                  ? 'rgba(109, 40, 217, 0.68)'
                  : 'rgba(29, 78, 216, 0.68)';
          ctx.lineWidth = 0.65;
          ctx.stroke();
        }
      }
      for (let i = 0; i < Math.min(4, phys.fallingDrops.length); i++) {
        const d = phys.fallingDrops[i];
        ctx.fillStyle = bladeCol;
        ctx.beginPath();
        ctx.ellipse(TUBE_X + d.x, d.y, d.r * 0.75, d.r * 1.15, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. 3D 弯月面与色调一致的折射刀锋
      ctx.save();
      ctx.translate(TUBE_X, surfY);
      ctx.rotate(tilt);
      ctx.fillStyle = isCrit
        ? 'rgba(234, 88, 12, 0.44)'
        : tone === 'mono'
          ? isDark ? 'rgba(212, 212, 216, 0.32)' : 'rgba(82, 82, 91, 0.48)'
          : tone === 'amber'
            ? isDark ? 'rgba(251, 191, 36, 0.36)' : 'rgba(217, 119, 6, 0.50)'
            : tone === 'iris'
              ? isDark ? 'rgba(196, 181, 253, 0.36)' : 'rgba(124, 58, 237, 0.50)'
              : isDark
                ? 'rgba(92, 198, 252, 0.36)'
                : 'rgba(2, 132, 199, 0.56)';
      ctx.beginPath();
      ctx.ellipse(0, 0, TUBE_IN_R - 0.3, 4.0, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle =
        tone === 'mono'
          ? isDark ? 'rgba(228, 228, 231, 0.42)' : 'rgba(63, 63, 70, 0.56)'
          : tone === 'amber'
            ? isDark ? 'rgba(253, 224, 71, 0.42)' : 'rgba(180, 83, 9, 0.56)'
            : tone === 'iris'
              ? isDark ? 'rgba(221, 214, 254, 0.44)' : 'rgba(109, 40, 217, 0.56)'
              : isDark ? 'rgba(176, 224, 255, 0.44)' : 'rgba(29, 78, 216, 0.58)';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.ellipse(0, 0, TUBE_IN_R - 0.3, 4.0, 0, Math.PI, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = bladeCol;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.ellipse(0, 0, TUBE_IN_R - 0.3, 4.0, 0, 0, Math.PI);
      ctx.stroke();
      ctx.restore();

      // 4b. 悬停切片图例时的 1px 光学聚焦环（2D 保底与 WebGL2 一致）
      if (typeof st.hoveredSlice === 'number' && st.hoveredSlice >= 0 && surfY < FLOOR_IN - 2) {
        const rt = Array.isArray(st.ratios) ? st.ratios : [0.08, 0.27, 0.12];
        const sumR = Math.max(1e-3, (Number(rt[0]) || 0) + (Number(rt[1]) || 0) + (Number(rt[2]) || 0));
        const midFrac =
          st.hoveredSlice < 0.5
            ? ((Number(rt[0]) || 0) * 0.5) / sumR
            : st.hoveredSlice < 1.5
              ? ((Number(rt[0]) || 0) + (Number(rt[1]) || 0) * 0.5) / sumR
              : ((Number(rt[0]) || 0) + (Number(rt[1]) || 0) + (Number(rt[2]) || 0) * 0.5) / sumR;
        const colH = Math.max(12, FLOOR_IN - surfY);
        const sliceY = FLOOR_IN - colH * midFrac;
        ctx.save();
        ctx.strokeStyle = isDark ? 'rgba(176, 224, 255, 0.85)' : 'rgba(255, 255, 255, 0.92)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(TUBE_X, sliceY, TUBE_IN_R - 0.8, 2.8, 0, 0, Math.PI);
        ctx.stroke();
        ctx.restore();
      }

      // 5. 垂直折射丝（浅色空气段冷蓝折射丝 + 水柱段晶白高光丝）与外轮廓描边
      const threadX = TUBE_X - TUBE_OUT_R * 0.72;
      const topThreadY = TOP_OUT + 16;
      const botThreadY = FLOOR_OUT - 16;
      if (isDark) {
        ctx.fillStyle = 'rgba(200, 226, 255, 0.32)';
        ctx.fillRect(threadX, topThreadY, 0.8, botThreadY - topThreadY);
      } else {
        const splitY = Math.max(topThreadY, Math.min(botThreadY, surfY));
        if (splitY > topThreadY) {
          ctx.fillStyle =
            tone === 'mono'
              ? 'rgba(82, 82, 91, 0.34)'
              : tone === 'amber'
                ? 'rgba(180, 83, 9, 0.32)'
                : tone === 'iris'
                  ? 'rgba(109, 40, 217, 0.32)'
                  : 'rgba(30, 64, 175, 0.34)';
          ctx.fillRect(threadX, topThreadY, 0.85, splitY - topThreadY);
        }
        if (botThreadY > splitY) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
          ctx.fillRect(threadX + 1.0, splitY, 0.85, botThreadY - splitY);
        }
      }

      traceClosedCapsule(ctx, TUBE_X, TUBE_OUT_R, TOP_OUT, FLOOR_OUT, RC_OUT, RC_OUT);
      ctx.strokeStyle =
        tone === 'mono'
          ? isDark ? 'rgba(212, 212, 216, 0.68)' : 'rgba(82, 82, 91, 0.68)'
          : tone === 'amber'
            ? isDark ? 'rgba(251, 191, 36, 0.62)' : 'rgba(146, 64, 14, 0.68)'
            : tone === 'iris'
              ? isDark ? 'rgba(196, 181, 253, 0.64)' : 'rgba(91, 33, 182, 0.68)'
              : isDark ? 'rgba(172, 204, 248, 0.68)' : 'rgba(30, 64, 175, 0.68)';
      ctx.lineWidth = isDark ? 1.0 : 1.15;
      ctx.stroke();

      ctx.restore();
    };

    const stepInternal = (dtSec, isInitBoot) => {
      if (!ctx2d) return;
      const dt = Math.max(0.001, Math.min(MAX_FRAME_DT, Number(dtSec || 0.016)));
      const st = resolveEffectiveState();
      phys.setStreaming(Boolean(st.streaming));
      if (reduceMotion) {
        phys.snapFillNow(st.fill);
      } else {
        phys.setTargetFill(st.fill);
        if (!isInitBoot) {
          elapsedTime += dt;
          settleClock += dt;
          phys.step(dt);
        }
      }

      const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, cssW, cssH);

      const snap = phys.readSnapshotInto(snapBuf);

      const glAlive =
        Boolean(glState && glCanvas && !glContextLost) &&
        (typeof glState.gl.isContextLost !== 'function' || !glState.gl.isContextLost());
      if (glState && !glAlive) {
        glContextLost = true;
        glState = null;
      }

      if (glAlive && glState && glCanvas) {
        const { gl, prog, u } = glState;
        if (glCanvas.width !== targetW || glCanvas.height !== targetH) {
          glCanvas.width = targetW;
          glCanvas.height = targetH;
        }
        gl.viewport(0, 0, targetW, targetH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);

        const tintVec = st.critical ? TINT_CRITICAL : st.camp === 'claude' ? TINT_ASTRAL : TINT_HORIZON;

        dropArr.fill(0);
        for (let i = 0; i < Math.min(4, phys.fallingDrops.length); i++) {
          const d = phys.fallingDrops[i];
          dropArr[i * 4 + 0] = d.x;
          dropArr[i * 4 + 1] = d.y;
          dropArr[i * 4 + 2] = d.r;
          dropArr[i * 4 + 3] = 1.0;
        }
        bubArr.fill(0);
        for (let i = 0; i < Math.min(8, phys.bubbles.length); i++) {
          const b = phys.bubbles[i];
          bubArr[i * 4 + 0] = b.x;
          bubArr[i * 4 + 1] = b.y;
          bubArr[i * 4 + 2] = b.r;
          bubArr[i * 4 + 3] = b.alpha;
          bubShapeArr[i * 2 + 0] = b.aspect || 1.0;
          bubShapeArr[i * 2 + 1] = snap.tiltAngle;
        }
        updateRaySlopes(snap.tiltAngle, elapsedTime);

        gl.uniform2f(u.res, targetW, targetH);
        gl.uniform1f(u.time, elapsedTime);
        gl.uniform1f(u.dark, st.isDark ? 1.0 : 0.0);
        gl.uniform1f(u.fill, snap.fill);
        gl.uniform1f(u.tilt, snap.tiltAngle);
        gl.uniform3fv(u.tint, tintVec);
        gl.uniform1f(u.camp, st.camp === 'claude' ? 1.0 : 0.0);
        const accentNum = st.accentTone === 'mono' ? 3.0 : st.accentTone === 'amber' ? 2.0 : st.accentTone === 'iris' ? 1.0 : 0.0;
        if (u.accent !== null && u.accent !== undefined) gl.uniform1f(u.accent, accentNum);
        gl.uniform1f(u.critical, st.critical ? 1.0 : 0.0);
        gl.uniform1f(u.pendant, snap.streaming ? snap.pendantSize : 0.0);
        const rt = st.ratios;
        gl.uniform3f(u.ratios, Number(rt[0]) || 0, Number(rt[1]) || 0, Number(rt[2]) || 0);
        gl.uniform1f(u.wetL, snap.wetLeft);
        gl.uniform1f(u.wetR, snap.wetRight);
        gl.uniform1f(u.hoverSlice, st.hoveredSlice);
        gl.uniform1fv(u.wave, phys.waveH);
        gl.uniform4fv(u.drops, dropArr);
        gl.uniform4fv(u.bubbles, bubArr);
        gl.uniform2fv(u.bubShape, bubShapeArr);
        gl.uniform1fv(u.raySlope, raySlopeArr);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        ctx2d.drawImage(glCanvas, 0, 0, cssW, cssH);
      } else {
        drawFallback2D(ctx2d, st);
      }

      drawScaleMarks(ctx2d, st, snap.fill);
      renderedSig = buildVisualSig(st);
      dirtyRender = false;
    };

    const step = (dtSec) => stepInternal(dtSec, false);

    const isSettled = () => {
      if (dirtyRender) return false;
      const st = resolveEffectiveState();
      if (buildVisualSig(st) !== renderedSig) return false;
      if (reduceMotion) return true;
      if (st.streaming) return false;
      if (settleClock < SETTLE_MIN_AGE_SEC) return false;
      const snap = phys.readSnapshotInto(snapBuf);
      if (Math.abs(st.fill - snap.fill) >= 0.001) return false;
      return phys.isSettled();
    };

    stepInternal(0.016, true);

    return {
      step,
      isSettled,
      setLevel(nextFill) {
        manualFill = clampFillVal(nextFill);
        useManualFill = true;
        phys.setTargetFill(manualFill);
        notifyWake();
      },
      agitate(strength = 1.6) {
        phys.injectSlosh(strength);
        notifyWake();
      },
      impulse(strength = 1.6) {
        phys.injectSlosh(strength);
        notifyWake();
      },
      tilt(angleOrImpulse = 0.18) {
        phys.injectTilt(angleOrImpulse);
        notifyWake();
      },
      setTheme(isDark) {
        manualDark = Boolean(isDark);
        notifyWake();
      },
      wake() {
        notifyWake();
      },
      spawnDroplet() {
        phys.spawnDropletNow();
        notifyWake();
      },
      getDebugState() {
        return {
          rendererMode: getRendererMode(),
          settled: isSettled(),
          settleClock: Number(settleClock.toFixed(3)),
          ...phys.getSnapshot(),
        };
      },
      dispose() {
        if (canvas && canvas.removeEventListener) {
          canvas.removeEventListener('pointermove', onPointerMove);
          canvas.removeEventListener('pointerdown', onPointerDown);
          canvas.removeEventListener('pointerleave', onPointerLeave);
        }
        if (glCanvas && typeof glCanvas.removeEventListener === 'function') {
          glCanvas.removeEventListener('webglcontextlost', onGlLost);
          glCanvas.removeEventListener('webglcontextrestored', onGlRestored);
        }
        if (glState) {
          const { gl, prog, buf } = glState;
          try {
            gl.deleteProgram(prog);
            gl.deleteBuffer(buf);
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
          } catch {}
          glState = null;
        }
        glCanvas = null;
      },
    };
  }

  return {
    WAVE_NODES,
    RC_OUT,
    RC_IN,
    SETTLE_MIN_AGE_SEC,
    createWaterVialPhysics,
    mountPhysicalWaterVial,
  };
});
