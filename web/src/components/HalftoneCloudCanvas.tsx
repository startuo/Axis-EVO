/**
 * 原生 WebGL GLSL 实拍版画积云背景（基于用户原图的全景纹理 + 零第三方 3D 库）：
 * - 加载 1440×1024 无缝实拍积云纹理（R=高清晰实拍轮廓与原本版画纹理，G=平滑积云高程，B=云腹大气层次）
 * - 长宽比自适应 cover 构图 + 智能焦距锚点，宽屏/窄屏/竖屏均保持积云正立不拉伸
 * - 2.5D 纵深视差 + 微风呼吸漂移 + 8 节点流体鼠标拨云 + 点击/Logo 涟漪冲击波
 * - Retina 级 ±45° 版画交叉斜线与半调圆点混合网屏，支持黑白双主题自适应切换与后台停帧
 */
import { useEffect, useRef } from 'react';

export interface CloudPulse {
  seq: number;
  /** 归一化画布坐标 0..1（x 从左到右，y 从下到上） */
  x: number;
  y: number;
}

export interface HalftoneCloudCanvasProps {
  theme: 'dark' | 'light';
  intensity: 'hero' | 'ambient';
  pulse?: CloudPulse | null;
}

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_dpr;
uniform float u_time;
uniform float u_themeMix;
uniform float u_intensity;
uniform float u_texReady;
uniform float u_texAspect;
uniform vec2 u_mouse;
uniform vec4 u_trail[8];
uniform float u_trailAge[8];
uniform vec2 u_pulsePos;
uniform float u_pulseAge;
uniform sampler2D u_cloudTex;

// ±45° 交叉斜线与半调点阵混合版画网屏采样
float evalHalftoneScreen(float d, vec2 cell, float aa) {
  float widthA = clamp((d - 0.04) * 0.44, 0.0, 0.34);
  float widthB = clamp((d - 0.24) * 0.42, 0.0, 0.32);
  float strokeA = 1.0 - smoothstep(widthA - aa, widthA + aa, abs(cell.x));
  float strokeB = 1.0 - smoothstep(widthB - aa, widthB + aa, abs(cell.y));
  float dotR = clamp(d * 0.50, 0.0, 0.44);
  float stipple = 1.0 - smoothstep(dotR - aa, dotR + aa, length(cell));
  return max(max(strokeA, strokeB), stipple * 0.72);
}

// 计算鼠标尾流旋涡与点击冲击波在比例空间内的平滑 UV 扰动
vec2 computeFluidShift(vec2 uv01, float viewAspect) {
  vec2 aspectVec = vec2(viewAspect, 1.0);
  vec2 pos = (uv01 - 0.5) * aspectVec;
  vec2 shift = vec2(0.0);

  for (int i = 0; i < 8; i++) {
    float age = u_trailAge[i];
    if (age > 0.005) {
      vec2 tp = (u_trail[i].xy - 0.5) * aspectVec;
      vec2 vel = u_trail[i].zw;
      vec2 d = pos - tp;
      float dist2 = dot(d, d);
      float w = exp(-dist2 * 14.0) * age;
      vec2 perp = vec2(-d.y, d.x);
      shift -= vel * (w * 0.38) + perp * (length(vel) * w * 0.46);
    }
  }

  if (u_pulseAge > 0.0 && u_pulseAge < 1.0) {
    vec2 pp = (u_pulsePos - 0.5) * aspectVec;
    vec2 d = pos - pp;
    float dist = length(d) + 1e-4;
    float radius = u_pulseAge * 1.15;
    float ring = exp(-pow((dist - radius) * 7.8, 2.0)) * (1.0 - u_pulseAge);
    shift -= (d / dist) * ring * 0.036;
  }

  // 限制最大形变振幅，确保积云实拍轮廓柔和回弹不变形
  return clamp(shift, vec2(-0.042), vec2(0.042));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv01 = frag / max(u_resolution, vec2(1.0));
  float viewAspect = u_resolution.x / max(u_resolution.y, 1.0);

  // 长宽比保持 cover 映射 + 1.05 微缩放余量防运动露边
  float widen = viewAspect / max(u_texAspect, 0.1);
  vec2 coverScale = widen > 1.0 ? vec2(1.0, 1.0 / widen) : vec2(widen, 1.0);
  coverScale /= 1.05;

  vec2 focal = vec2(0.50, 0.52);
  vec2 coverUV = clamp(focal + (uv01 - focal) * coverScale, 0.002, 0.998);

  // 先采样平滑高程做 2.5D 纵深视差：亮白近景云峰滑移量大于远景晴空
  float h0 = texture2D(u_cloudTex, coverUV).g;

  vec2 mouseNorm = (u_mouse - 0.5) * vec2(min(viewAspect, 1.8), 1.0);
  vec2 parallaxShift = -mouseNorm * (0.010 + 0.024 * h0);

  // 极柔和大气微风呼吸晃动，保留真实积云雕塑轮廓
  vec2 breeze = vec2(
    sin(u_time * 0.22 + coverUV.y * 4.2) * 0.0036 + sin(u_time * 0.09) * 0.0028,
    cos(u_time * 0.17 + coverUV.x * 3.8) * 0.0026
  ) * (0.45 + 0.85 * h0);

  vec2 fluidShift = computeFluidShift(uv01, viewAspect) * coverScale;
  vec2 sampleUV = clamp(coverUV + parallaxShift + breeze + fluidShift, 0.002, 0.998);

  vec4 tex = texture2D(u_cloudTex, sampleUV);
  float rawPhoto = mix(tex.g, tex.r, 0.34);
  float cloudLum = clamp((rawPhoto * 0.84 + tex.b * 0.16) * u_texReady, 0.0, 1.0);
  cloudLum = pow(smoothstep(0.02, 0.94, cloudLum), 0.86);

  // ---- Retina ±45° Risograph 交叉排线 + 半调圆点混合网屏 ----
  float pitch = clamp(3.3 * u_dpr, 3.0, 4.8);
  float aa = 1.2 / pitch;
  float s = 0.70710678;
  vec2 p45 = vec2(frag.x + frag.y, frag.y - frag.x) * s;
  vec2 cell = fract(p45 / pitch) - 0.5;

  float darkness = clamp(1.0 - cloudLum, 0.0, 1.0);
  float screenPattern = evalHalftoneScreen(darkness, cell, aa);

  // 亮主题：暖象牙宣纸 + 温润暖石 ±45° 版画天空 × 洁白向阳实拍积云 (#FFFFFF)
  vec3 lightPaper = vec3(0.980, 0.976, 0.961);
  vec3 lightCrest = vec3(1.000, 1.000, 1.000);
  vec3 lightInk = vec3(0.555, 0.542, 0.512);
  float peakClean = smoothstep(0.06, 0.24, darkness);
  float lightInkCover = mix(darkness * 0.48, screenPattern, 0.62) * peakClean;
  vec3 lightRendered = mix(lightCrest, lightInk, clamp(lightInkCover * 0.92, 0.0, 1.0));

  // 暗主题：暖黑曜石深空 (#111110) + 细织纹 × 月光银暖版画实拍积云
  vec3 darkBase = vec3(0.067, 0.067, 0.063);
  vec3 darkSkyCross = vec3(0.102, 0.102, 0.094);
  vec3 darkCloudPeak = vec3(0.575, 0.562, 0.534);
  vec3 darkSky = mix(darkBase, darkSkyCross, screenPattern * 0.42);
  float cloudPresence = smoothstep(0.06, 0.92, cloudLum);
  float moonScreen = mix(cloudLum * 0.72, (1.0 - screenPattern) * 0.85, 0.45);
  vec3 darkRendered = mix(darkSky, darkCloudPeak, clamp(cloudPresence * moonScreen * 1.05, 0.0, 0.95));

  vec3 themeBase = mix(darkBase, lightPaper, u_themeMix);
  vec3 themeScene = mix(darkRendered, lightRendered, u_themeMix);
  vec3 finalColor = mix(themeBase, themeScene, u_intensity);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

const TEX_ASPECT = 1920 / 1080;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function HalftoneCloudCanvas({ theme, intensity, pulse }: HalftoneCloudCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeTargetRef = useRef(theme === 'light' ? 1 : 0);
  const intensityTargetRef = useRef(intensity === 'hero' ? 1 : 0.82);
  const pulseStateRef = useRef<{ x: number; y: number; startMs: number; seq: number }>({
    x: 0.5,
    y: 0.62,
    startMs: -1,
    seq: 0,
  });
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    themeTargetRef.current = theme === 'light' ? 1 : 0;
    redrawRef.current?.();
  }, [theme]);

  useEffect(() => {
    intensityTargetRef.current = intensity === 'hero' ? 1 : 0.82;
    redrawRef.current?.();
  }, [intensity]);

  useEffect(() => {
    if (!pulse || pulse.seq === pulseStateRef.current.seq) return;
    pulseStateRef.current = {
      x: Math.min(1, Math.max(0, pulse.x)),
      y: Math.min(1, Math.max(0, pulse.y)),
      startMs: performance.now(),
      seq: pulse.seq,
    };
    redrawRef.current?.();
  }, [pulse]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
      });
    } catch {
      gl = null;
    }
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // 1x1 占位纹理保证解码完成前零告警渲染，加载后即刻上传真云贴图
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uDpr = gl.getUniformLocation(program, 'u_dpr');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uThemeMix = gl.getUniformLocation(program, 'u_themeMix');
    const uIntensity = gl.getUniformLocation(program, 'u_intensity');
    const uTexReady = gl.getUniformLocation(program, 'u_texReady');
    const uTexAspect = gl.getUniformLocation(program, 'u_texAspect');
    const uMouse = gl.getUniformLocation(program, 'u_mouse');
    const uTrail = gl.getUniformLocation(program, 'u_trail');
    const uTrailAge = gl.getUniformLocation(program, 'u_trailAge');
    const uPulsePos = gl.getUniformLocation(program, 'u_pulsePos');
    const uPulseAge = gl.getUniformLocation(program, 'u_pulseAge');
    const uCloudTex = gl.getUniformLocation(program, 'u_cloudTex');
    gl.uniform1i(uCloudTex, 0);

    let alive = true;
    let texTarget = 0;
    let texMix = 0;
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive || !gl || !texture) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      texTarget = 1;
      if (reducedMotion) texMix = 1;
      redrawRef.current?.();
    };
    img.src = '/axis-cloud-map.webp';

    let width = 1;
    let height = 1;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl?.viewport(0, 0, width, height);
    };
    resize();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    let mouseX = 0.5;
    let mouseY = 0.55;
    let targetMouseX = 0.5;
    let targetMouseY = 0.55;
    const trailVec4 = new Float32Array(8 * 4);
    const trailAge = new Float32Array(8);
    let trailHead = 0;
    let lastTrailMove = 0;

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
      const vx = Math.max(-0.08, Math.min(0.08, nx - targetMouseX));
      const vy = Math.max(-0.08, Math.min(0.08, ny - targetMouseY));
      targetMouseX = nx;
      targetMouseY = ny;

      const now = performance.now();
      if (now - lastTrailMove > 26 && Math.abs(vx) + Math.abs(vy) > 0.0015) {
        const base = trailHead * 4;
        trailVec4[base] = nx;
        trailVec4[base + 1] = ny;
        trailVec4[base + 2] = vx;
        trailVec4[base + 3] = vy;
        trailAge[trailHead] = 1.0;
        trailHead = (trailHead + 1) % 8;
        lastTrailMove = now;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('button, input, textarea, select, a, [role="button"], .popover, .composer-dock')) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = 1 - (e.clientY - rect.top) / rect.height;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
      pulseStateRef.current = {
        x: nx,
        y: ny,
        startMs: performance.now(),
        seq: pulseStateRef.current.seq + 1,
      };
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });

    let themeMix = themeTargetRef.current;
    let intensityMix = intensityTargetRef.current;
    const startTime = performance.now();
    let prevNow = startTime;
    let rafId = 0;

    const drawFrame = (now: number) => {
      if (!gl) return;
      const dt = Math.min(0.15, Math.max(0.001, (now - prevNow) * 0.001));
      prevNow = now;
      const elapsed = reducedMotion ? 1.2 : (now - startTime) * 0.001;

      if (reducedMotion) {
        themeMix = themeTargetRef.current;
        intensityMix = intensityTargetRef.current;
        texMix = texTarget;
      } else {
        const fastAlpha = 1 - Math.exp(-dt * 14);
        const mouseAlpha = 1 - Math.exp(-dt * 8);
        themeMix += (themeTargetRef.current - themeMix) * fastAlpha;
        intensityMix += (intensityTargetRef.current - intensityMix) * fastAlpha;
        texMix += (texTarget - texMix) * fastAlpha;
        mouseX += (targetMouseX - mouseX) * mouseAlpha;
        mouseY += (targetMouseY - mouseY) * mouseAlpha;
        const decay = dt * 1.1;
        for (let i = 0; i < 8; i++) {
          if (trailAge[i]! > 0) {
            trailAge[i] = Math.max(0, trailAge[i]! - decay);
          }
        }
      }

      let pulseAge = -1;
      if (pulseStateRef.current.startMs > 0 && !reducedMotion) {
        pulseAge = (now - pulseStateRef.current.startMs) / 1400;
        if (pulseAge > 1) pulseAge = -1;
      }

      gl.uniform2f(uResolution, width, height);
      gl.uniform1f(uDpr, dpr);
      gl.uniform1f(uTime, elapsed);
      gl.uniform1f(uThemeMix, themeMix);
      gl.uniform1f(uIntensity, intensityMix);
      gl.uniform1f(uTexReady, texMix);
      gl.uniform1f(uTexAspect, TEX_ASPECT);
      gl.uniform2f(uMouse, mouseX, mouseY);
      gl.uniform4fv(uTrail, trailVec4);
      gl.uniform1fv(uTrailAge, trailAge);
      gl.uniform2f(uPulsePos, pulseStateRef.current.x, pulseStateRef.current.y);
      gl.uniform1f(uPulseAge, pulseAge);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const tick = (now: number) => {
      drawFrame(now);
      if (!reducedMotion && !document.hidden) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    redrawRef.current = () => {
      if (reducedMotion) drawFrame(performance.now());
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (rafId) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else if (!reducedMotion && !rafId) {
        prevNow = performance.now();
        rafId = window.requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    if (reducedMotion) {
      drawFrame(performance.now());
    } else if (!document.hidden) {
      rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      alive = false;
      img.onload = null;
      redrawRef.current = null;
      if (rafId) window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('visibilitychange', onVisibility);
      gl?.deleteTexture(texture);
      gl?.deleteBuffer(buffer);
      gl?.deleteProgram(program);
      gl?.deleteShader(vs);
      gl?.deleteShader(fs);
    };
  }, []);

  return <canvas ref={canvasRef} className="cloud-bg-canvas" aria-hidden="true" />;
}
