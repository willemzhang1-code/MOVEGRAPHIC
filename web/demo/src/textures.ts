// Draws the demo character's parts procedurally and packs them into one
// atlas page, producing the same text atlas format a texture packer would.

export interface PartSpec {
  w: number;
  h: number;
  shape: string;
  fill?: string;
  stroke?: string;
}

const PAD = 2;
const LINE = 3;

function shade(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawPart(ctx: CanvasRenderingContext2D, p: PartSpec) {
  const { w, h } = p;
  const i = LINE / 2 + 1;
  ctx.lineWidth = LINE;
  ctx.lineJoin = 'round';
  ctx.fillStyle = p.fill ?? '#fff';
  ctx.strokeStyle = p.stroke ?? '#222';
  switch (p.shape) {
    case 'capsule':
      roundRect(ctx, i, i, w - 2 * i, h - 2 * i, (h - 2 * i) / 2);
      ctx.fill();
      shade(ctx, w, h);
      ctx.stroke();
      break;
    case 'circle':
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2 - i, h / 2 - i, 0, 0, Math.PI * 2);
      ctx.fill();
      shade(ctx, w, h);
      ctx.stroke();
      break;
    case 'foot':
      ctx.beginPath();
      ctx.moveTo(i + 4, h - i);
      ctx.lineTo(w - i - 2, h - i);
      ctx.quadraticCurveTo(w - i, i + 4, w * 0.55, i + 2);
      ctx.lineTo(i + 6, i + 2);
      ctx.quadraticCurveTo(i, h / 2, i + 4, h - i);
      ctx.closePath();
      ctx.fill();
      shade(ctx, w, h);
      ctx.stroke();
      break;
    case 'body': {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2 - i, h / 2 - i, 0, 0, Math.PI * 2);
      ctx.fill();
      shade(ctx, w, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(w * 0.6, h * 0.58, w * 0.24, h * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,240,0.45)';
      ctx.fill();
      break;
    }
    case 'head': {
      ctx.beginPath();
      ctx.moveTo(w * 0.18, h - i);
      ctx.bezierCurveTo(i, h * 0.7, i, h * 0.15, w * 0.42, i);
      ctx.bezierCurveTo(w * 0.75, i, w * 0.86, h * 0.25, w * 0.88, h * 0.42);
      ctx.bezierCurveTo(w - i, h * 0.48, w - i, h * 0.78, w * 0.82, h * 0.82);
      ctx.bezierCurveTo(w * 0.6, h - i, w * 0.35, h - i, w * 0.18, h - i);
      ctx.closePath();
      ctx.fill();
      shade(ctx, w, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w * 0.66, h * 0.72);
      ctx.quadraticCurveTo(w * 0.78, h * 0.8, w * 0.9, h * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(w * 0.58, h * 0.62, 7, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,110,110,0.45)';
      ctx.fill();
      break;
    }
    case 'eye_open':
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#222';
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(w * 0.62, h * 0.52, 4.5, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#1b1b1f';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w * 0.68, h * 0.4, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      break;
    case 'eye_closed':
      ctx.beginPath();
      ctx.moveTo(3, h * 0.55);
      ctx.quadraticCurveTo(w / 2, h * 0.8, w - 3, h * 0.55);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1b1b1f';
      ctx.stroke();
      break;
    case 'tail': {
      // Matches the mesh: base at y=155 (width 30), tip at y=10 (width 6).
      const cx = w / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 15, 155);
      ctx.lineTo(cx - 3, 10);
      ctx.quadraticCurveTo(cx, 3, cx + 3, 10);
      ctx.lineTo(cx + 15, 155);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(90,50,20,0.35)';
      for (let y = 30; y < 150; y += 26) ctx.fillRect(0, y, w, 9);
      ctx.restore();
      ctx.stroke();
      break;
    }
  }
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  text: string;
}

/** Shelf-packs all parts into a single page. */
export function buildAtlas(parts: Record<string, PartSpec>, pageName = 'critter.png', pageWidth = 512): Atlas {
  const entries = Object.entries(parts).sort((a, b) => b[1].h - a[1].h);
  const placed: { name: string; x: number; y: number; p: PartSpec }[] = [];
  let x = PAD;
  let y = PAD;
  let shelf = 0;
  for (const [name, p] of entries) {
    if (x + p.w + PAD > pageWidth) {
      x = PAD;
      y += shelf + PAD;
      shelf = 0;
    }
    placed.push({ name, x, y, p });
    x += p.w + PAD;
    shelf = Math.max(shelf, p.h);
  }
  const height = 2 ** Math.ceil(Math.log2(y + shelf + PAD));
  const canvas = document.createElement('canvas');
  canvas.width = pageWidth;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  let text = `${pageName}\nsize: ${pageWidth}, ${height}\nfilter: Linear, Linear\npma: false\n`;
  for (const { name, x, y, p } of placed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, p.w, p.h);
    ctx.clip();
    drawPart(ctx, p);
    ctx.restore();
    text += `${name}\n  bounds: ${x}, ${y}, ${p.w}, ${p.h}\n`;
  }
  return { canvas, text };
}
