// WebGL2 compositor.
// Per output frame we render N sub-frame samples across a 180° shutter, each
// composited in LINEAR light into a half-float accumulation buffer => physically
// plausible motion blur with no 8-bit banding. A final lens pass adds chromatic
// aberration, shake, punch-zoom, flashes and vignette, then encodes to sRGB.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const GLSL_COMMON = `
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;

const OVERLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
${GLSL_COMMON}
void main() {
  vec4 c = texture(uTex, vUv);
  o = vec4(toLin(c.rgb), c.a);
}`;

const ACC_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uW;
void main() { o = vec4(texture(uTex, vUv).rgb * uW, uW); }`;

const POST_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uShake;     // px
uniform float uZoom;     // punch zoom (1 = none)
uniform float uCA;       // chromatic aberration strength
uniform float uBarrel;   // lens distortion
uniform vec4 uFlash;     // rgb (linear), amount
uniform float uVignette;
uniform float uTime;
${GLSL_COMMON}
vec2 lens(vec2 uv, float k) {
  vec2 d = uv - 0.5;
  d.x *= uRes.x / uRes.y;
  float r2 = dot(d, d);
  d *= 1.0 + k * r2;
  d.x /= uRes.x / uRes.y;
  return d + 0.5;
}
void main() {
  vec2 uv = (vUv - 0.5) / uZoom + 0.5 + uShake / uRes;
  vec2 c = uv - 0.5;
  float r = length(c * vec2(uRes.x / uRes.y, 1.0));
  vec2 dir = c * (0.0012 + 0.010 * r * r) * uCA;
  vec3 col;
  col.r = texture(uTex, lens(uv + dir, uBarrel)).r;
  col.g = texture(uTex, lens(uv, uBarrel)).g;
  col.b = texture(uTex, lens(uv - dir, uBarrel)).b;
  col = mix(col, uFlash.rgb, uFlash.a);
  float v = smoothstep(1.25, 0.35, r);
  col *= mix(1.0, v, uVignette);
  // triangular dither (±1 LSB) to kill banding in dark gradients
  vec2 q = gl_FragCoord.xy + fract(uTime * 7.31) * 113.0;
  float n1 = fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
  float n2 = fract(sin(dot(q, vec2(39.3468, 11.135))) * 24634.6345);
  o = vec4(toSrgb(col) + (n1 + n2 - 1.0) / 255.0, 1.0);
}`;

export class Compositor {
  constructor(canvas, W, H) {
    this.W = W;
    this.H = H;
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      antialias: false,
      premultipliedAlpha: false,
      alpha: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('No float render targets');
    this.gl = gl;
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.pOverlay = this.program(OVERLAY_FRAG);
    this.pAcc = this.program(ACC_FRAG);
    this.pPost = this.program(POST_FRAG);

    this.sample = this.target(W, H);
    this.accum = this.target(W, H);
    this.overlayTex = this.texture();
  }

  program(frag) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
        throw new Error('Shader compile error: ' + log + '\n' + lines.slice(0, 20000));
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      p.uniforms[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
    return p;
  }

  texture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  target(w, h) {
    const gl = this.gl;
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  // Upload a texture from a canvas/image (flipped so v=0 is the bottom row).
  upload(tex, source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  setUniforms(p, u) {
    const gl = this.gl;
    let unit = 0;
    for (const k in u) {
      const info = p.uniforms[k];
      if (!info) continue;
      const v = u[k];
      const L = info.loc;
      switch (info.type) {
        case gl.FLOAT: info.size > 1 ? gl.uniform1fv(L, v) : gl.uniform1f(L, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(L, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(L, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(L, v); break;
        case gl.INT: gl.uniform1i(L, v); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(L, false, v); break;
        case gl.SAMPLER_2D:
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, v);
          gl.uniform1i(L, unit);
          unit++;
          break;
        default: break;
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  draw(p, u, target) {
    const gl = this.gl;
    gl.useProgram(p);
    this.setUniforms(p, u);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, this.W, this.H);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  beginFrame() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  beginSample() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sample.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Full-screen shader layer drawn into the current sample. Optional alpha
  // blending and a scissor rect (GL pixel coords) for passes that only touch
  // part of the frame — the cheapest way to skip work on SIMD-masked GPUs.
  sceneLayer(p, u, opts = {}) {
    const gl = this.gl;
    if (opts.blend) { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
    else gl.disable(gl.BLEND);
    if (opts.scissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(...opts.scissor); }
    this.draw(p, u, this.sample);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
  }

  // Composite a 2D canvas over the current sample (alpha "over", linear light).
  canvasLayer(canvas) {
    const gl = this.gl;
    this.upload(this.overlayTex, canvas);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.draw(this.pOverlay, { uTex: this.overlayTex }, this.sample);
    gl.disable(gl.BLEND);
  }

  endSample(weight) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.draw(this.pAcc, { uTex: this.sample.tex, uW: weight }, this.accum);
    gl.disable(gl.BLEND);
  }

  post(params) {
    this.gl.disable(this.gl.BLEND);
    this.draw(this.pPost, {
      uTex: this.accum.tex,
      uRes: [this.W, this.H],
      uShake: params.shake || [0, 0],
      uZoom: params.zoom || 1,
      uCA: params.ca || 0,
      uBarrel: params.barrel || 0,
      uFlash: params.flash || [1, 1, 1, 0],
      uVignette: params.vignette ?? 0.35,
      uTime: params.time || 0,
    }, null);
  }
}
