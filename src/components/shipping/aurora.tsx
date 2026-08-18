import { useEffect, useRef } from "react"

/**
 * AuroraBackground — 参考 shadergradient / 21st.dev 的 WebGL 流光渐变背景。
 * 自定义 GLSL 分形噪声（fbm 域扭曲），色板对齐 Aurora 色系；
 * 0.5 倍渲染分辨率降低 GPU 开销，页面隐藏时暂停，
 * prefers-reduced-motion 时定格静帧；WebGL 不可用时自动回退为 CSS 渐变底。
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

function createShaderGradient(canvas: HTMLCanvasElement) {
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

  function resize() {
    canvas.width = Math.max(1, Math.floor(window.innerWidth * RESOLUTION))
    canvas.height = Math.max(1, Math.floor(window.innerHeight * RESOLUTION))
    gl!.viewport(0, 0, canvas.width, canvas.height)
  }
  resize()
  window.addEventListener("resize", resize)

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const start = performance.now()
  let raf = 0
  function frame(now: number) {
    if (!document.hidden) {
      gl!.uniform2f(uRes, canvas.width, canvas.height)
      gl!.uniform1f(uTime, (now - start) / 1000)
      gl!.uniform1f(uSpeed, SPEED)
      gl!.uniform1f(uScale, SCALE)
      gl!.drawArrays(gl!.TRIANGLES, 0, 3)
    }
    raf = requestAnimationFrame(frame)
  }
  if (reduced) {
    gl.uniform2f(uRes, canvas.width, canvas.height)
    gl.uniform1f(uTime, 4)
    gl.uniform1f(uSpeed, 0)
    gl.uniform1f(uScale, SCALE)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  } else {
    raf = requestAnimationFrame(frame)
  }

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener("resize", resize)
  }
}

export function AuroraBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const destroy = createShaderGradient(canvas)
    return () => destroy?.()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const target = rootRef.current
    const sync = () => target?.classList.toggle("aurora-dark", root.classList.contains("dark"))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return (
    <div aria-hidden ref={rootRef} className="aurora">
      <canvas ref={canvasRef} className="aurora-canvas" />
      <div className="aurora-grid" />
      <div className="aurora-noise" />
      <div className="aurora-vignette" />
    </div>
  )
}
