import { useEffect, useRef } from "react"

/**
 * AuroraBackground — 参考 shadergradient / 21st.dev 的 WebGL 流光渐变背景。
 * 自定义 GLSL 分形噪声（fbm 域扭曲），色板对齐 Aurora 色系。
 *
 * 开销控制（2026-09-15 性能修复，实测依据见 .tmp/perf-diagnosis-20260915）：
 * 该片元着色器每像素约 25 次噪声求值，全屏常驻时在入门级独显上约占满一帧预算
 * （实测首页 60fps → 30fps）。因此：
 * - 限帧到 FRAME_INTERVAL_MS（约 20fps），环境光渐变足够顺滑，开销按帧数摊薄；
 * - 仅在「深色主题且动效开启」时逐帧绘制；关闭动效（用户开关或系统
 *   prefers-reduced-motion）时只画**一帧静帧**，保住观感但不再有每帧开销；
 * - 浅色主题下画布本就不可见，完全不绘制，交给 CSS 渐变底；
 * - 页面隐藏（document.hidden）时跳过绘制；
 * - 0.5 倍渲染分辨率降低填充率；WebGL 不可用时自动回退为 CSS 渐变底。
 * 网格 / 噪点 / 暗角覆盖层保留，明暗主题切换时画布淡入淡出。
 */

const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }"

const FRAG = `
precision highp float;
uniform vec2 u_res; uniform float u_time; uniform float u_speed; uniform float u_scale;
vec2 hash(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1. + 2.*fract(sin(p)*43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.-2.*f);
  return mix(mix(dot(hash(i), f), dot(hash(i+vec2(1.,0.)), f-vec2(1.,0.)), u.x),
             mix(dot(hash(i+vec2(0.,1.)), f-vec2(0.,1.)), dot(hash(i+vec2(1.,1.)), f-vec2(1.,1.)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = 0.55; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i = 0; i < 5; i++){ v += a*noise(p); p = m*p; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (uv - 0.5) * vec2(u_res.x/u_res.y, 1.) * u_scale;
  float t = u_time * u_speed;
  vec2 q = vec2(fbm(p + vec2(0.0, 0.12*t)), fbm(p + vec2(5.2, 1.3) - 0.08*t));
  vec2 r = vec2(fbm(p + 2.4*q + vec2(1.7, 9.2) + 0.15*t), fbm(p + 2.4*q + vec2(8.3, 2.8) - 0.1*t));
  float f = fbm(p + 3.0*r);
  vec3 c1 = vec3(0.016, 0.027, 0.055);
  vec3 teal = vec3(0.08, 0.72, 0.65);
  vec3 sky  = vec3(0.055, 0.65, 0.9);
  vec3 indigo = vec3(0.39, 0.4, 0.95);
  vec3 rose = vec3(0.96, 0.44, 0.37);
  vec3 col = c1;
  col = mix(col, teal,   clamp(length(q)*0.9, 0., 1.) * 0.55);
  col = mix(col, sky,    clamp(r.x*0.9 + 0.15, 0., 1.) * 0.5);
  col = mix(col, indigo, clamp(r.y*0.8, 0., 1.) * 0.45);
  col = mix(col, rose,   clamp(pow(f + 0.35, 3.0), 0., 1.) * 0.35);
  col += (f*f*0.5 + 0.05) * vec3(0.35, 0.6, 0.75);
  col *= 0.85 + 0.3*uv.y;
  gl_FragColor = vec4(col, 1.);
}
`

interface AuroraState {
  /** 深色主题下画布可见（浅色主题由 CSS 渐变底接管） */
  visible: boolean
  /** 需要逐帧动画；关闭动效时只定格一帧 */
  animate: boolean
}

function createShaderGradient(canvas: HTMLCanvasElement, getState: () => AuroraState) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false })
  if (!gl) return null

  function compile(type: number, src: string) {
    const shader = gl!.createShader(type)
    if (!shader) throw new Error("shader compile failed")
    gl!.shaderSource(shader, src)
    gl!.compileShader(shader)
    return shader
  }
  const prog = gl.createProgram()
  if (!prog) throw new Error("program link failed")
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, "p")
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const uRes = gl.getUniformLocation(prog, "u_res")
  const uTime = gl.getUniformLocation(prog, "u_time")
  const uSpeed = gl.getUniformLocation(prog, "u_speed")
  const uScale = gl.getUniformLocation(prog, "u_scale")
  const SPEED = 0.5
  const SCALE = 2.4
  const RESOLUTION = 0.5
  // 环境光渐变不需要 60fps：限到约 20fps（60Hz 显示器上正好每 3 帧绘制一次），
  // 着色器开销按帧数摊薄约 2/3，视觉上仍是连续流动的背景。
  const FRAME_INTERVAL_MS = 1000 / 20

  const start = performance.now()
  let raf = 0
  let lastDrawnAt = Number.NEGATIVE_INFINITY

  function draw(now: number) {
    gl!.uniform2f(uRes, canvas.width, canvas.height)
    gl!.uniform1f(uTime, (now - start) / 1000)
    gl!.uniform1f(uSpeed, SPEED)
    gl!.uniform1f(uScale, SCALE)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
  }

  function paintStatic() {
    if (getState().visible) draw(performance.now())
  }

  function resize() {
    canvas.width = Math.max(1, Math.floor(window.innerWidth * RESOLUTION))
    canvas.height = Math.max(1, Math.floor(window.innerHeight * RESOLUTION))
    gl!.viewport(0, 0, canvas.width, canvas.height)
    // 改动画布尺寸会重置绘制缓冲：让下一帧立即重绘，静止态则当场补一帧，避免出现空白背景。
    lastDrawnAt = Number.NEGATIVE_INFINITY
    if (getState().visible && !getState().animate) paintStatic()
  }
  resize()
  window.addEventListener("resize", resize)

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    if (!getState().animate || document.hidden) return
    if (now - lastDrawnAt < FRAME_INTERVAL_MS) return
    lastDrawnAt = now
    draw(now)
  }
  raf = requestAnimationFrame(frame)

  return {
    destroy() {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    },
    paintStatic,
  }
}

export function AuroraBackground({ enabled = true }: { enabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<AuroraState>({ visible: false, animate: false })
  const rendererRef = useRef<ReturnType<typeof createShaderGradient>>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = createShaderGradient(canvas, () => stateRef.current)
    rendererRef.current = renderer
    return () => {
      rendererRef.current = null
      renderer?.destroy()
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const target = rootRef.current
    const sync = () => {
      // 画布只在深色主题下可见。关闭动效（用户开关或系统 prefers-reduced-motion）时不再逐帧绘制，
      // 改为定格一帧：观感与修复前的静态静帧一致，同时把每帧的着色器开销降为零。
      // 浅色主题下画布本就不可见，直接交给 CSS 渐变底。
      const visible = root.classList.contains("dark")
      const animate = enabled && visible
      stateRef.current = { visible, animate }
      target?.classList.toggle("aurora-dark", visible)
      if (visible && !animate) rendererRef.current?.paintStatic()
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [enabled])

  return (
    <div aria-hidden ref={rootRef} className="aurora">
      <canvas ref={canvasRef} className="aurora-canvas" />
      <div className="aurora-grid" />
      <div className="aurora-noise" />
      <div className="aurora-vignette" />
    </div>
  )
}
