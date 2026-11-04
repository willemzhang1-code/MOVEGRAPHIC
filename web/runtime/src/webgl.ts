// WebGL2 renderer for Sinew render output: premultiplied-alpha output,
// two-color tint, blend modes, debug bone overlay.

import { BlendMode, VERTEX_BYTES, type RenderView, type SkeletonData } from './core';

const VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_light;
layout(location = 3) in vec4 a_dark;
uniform mat4 u_proj;
out vec2 v_uv;
out vec4 v_light;
out vec3 v_dark;
void main() {
  v_uv = a_uv;
  v_light = a_light;
  v_dark = a_dark.rgb;
  gl_Position = u_proj * vec4(a_pos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_light;
in vec3 v_dark;
uniform sampler2D u_tex;
uniform float u_pma;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, v_uv);
  if (u_pma < 0.5) t.rgb *= t.a;
  vec3 rgb = t.rgb * v_light.rgb + (t.a - t.rgb) * v_dark;
  o = vec4(rgb * v_light.a, t.a * v_light.a);
}`;

const LINE_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
uniform mat4 u_proj;
out vec4 v_color;
void main() { v_color = a_color; gl_Position = u_proj * vec4(a_pos, 0.0, 1.0); }`;

const LINE_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o;
void main() { o = vec4(v_color.rgb * v_color.a, v_color.a); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  return prog;
}

export interface SinewTexture {
  texture: WebGLTexture;
  pma: boolean;
}

/** Column-major orthographic projection for a y-up world. */
export function ortho(centerX: number, centerY: number, zoom: number, width: number, height: number): Float32Array {
  const sx = (2 * zoom) / width;
  const sy = (2 * zoom) / height;
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, -centerX * sx, -centerY * sy, 0, 1]);
}

export class SinewRenderer {
  private readonly prog: WebGLProgram;
  private readonly lineProg: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  private readonly lineVao: WebGLVertexArrayObject;
  private readonly lineVbo: WebGLBuffer;
  private readonly uProj: WebGLUniformLocation;
  private readonly uPma: WebGLUniformLocation;
  private readonly uLineProj: WebGLUniformLocation;
  private proj: Float32Array = new Float32Array(16);
  drawCalls = 0;

  constructor(readonly gl: WebGL2RenderingContext) {
    this.prog = compile(gl, VS, FS);
    this.lineProg = compile(gl, LINE_VS, LINE_FS);
    this.uProj = gl.getUniformLocation(this.prog, 'u_proj')!;
    this.uPma = gl.getUniformLocation(this.prog, 'u_pma')!;
    this.uLineProj = gl.getUniformLocation(this.lineProg, 'u_proj')!;

    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_BYTES, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, VERTEX_BYTES, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, VERTEX_BYTES, 20);
    gl.bindVertexArray(null);

    this.lineVao = gl.createVertexArray()!;
    this.lineVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);
  }

  createTexture(source: TexImageSource, pma: boolean): SinewTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { texture, pma };
  }

  deleteTexture(t: SinewTexture): void {
    this.gl.deleteTexture(t.texture);
  }

  begin(proj: Float32Array): void {
    this.proj = proj;
    this.drawCalls = 0;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  private setBlend(mode: BlendMode): void {
    const gl = this.gl;
    switch (mode) {
      case BlendMode.Additive:
        gl.blendFunc(gl.ONE, gl.ONE);
        break;
      case BlendMode.Multiply:
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case BlendMode.Screen:
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      default:
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  draw(view: RenderView, pages: SinewTexture[]): void {
    if (!view.batches.length) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uProj, false, this.proj);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, view.vertexBytes, gl.STREAM_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, view.indices, gl.STREAM_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    for (const b of view.batches) {
      const page = pages[b.page] ?? pages[0];
      if (!page) continue;
      gl.bindTexture(gl.TEXTURE_2D, page.texture);
      gl.uniform1f(this.uPma, page.pma ? 1 : 0);
      this.setBlend(b.blend);
      gl.drawElements(gl.TRIANGLES, b.indexCount, gl.UNSIGNED_INT, b.firstIndex * 4);
      this.drawCalls++;
    }
    gl.bindVertexArray(null);
  }

  /** Bone overlay: a line per bone (origin → tip) and a cross at each origin. */
  drawBones(world: Float32Array, data: SkeletonData, pixelsPerUnit: number): void {
    const gl = this.gl;
    const v: number[] = [];
    const push = (x: number, y: number, c: number[]) => v.push(x, y, c[0], c[1], c[2], c[3]);
    const boneColor = [1, 0.55, 0.15, 1];
    const jointColor = [0.25, 0.8, 1, 1];
    const s = 4 / pixelsPerUnit;
    data.bones.forEach((bone, i) => {
      const o = i * 7;
      if (world[o + 6] < 0.5) return;
      const [a, , c, , x, y] = world.subarray(o, o + 6);
      if (bone.length > 0) {
        push(x, y, boneColor);
        push(x + a * bone.length, y + c * bone.length, boneColor);
      }
      push(x - s, y, jointColor);
      push(x + s, y, jointColor);
      push(x, y - s, jointColor);
      push(x, y + s, jointColor);
    });
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(this.uLineProj, false, this.proj);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STREAM_DRAW);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, v.length / 6);
    gl.bindVertexArray(null);
  }
}
