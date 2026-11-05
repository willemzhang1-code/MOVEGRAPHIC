import { useRef, useState } from 'react';
import type { AnimDoc, Ease } from './doc';

interface Props {
  anim: AnimDoc;
  time: number;
  playing: boolean;
  selectedBone: string | null;
  onSeek(t: number): void;
  onTogglePlay(): void;
  onSelectBone(name: string): void;
  onDeleteKey(channel: number, key: number): void;
  onDuration(d: number): void;
  onLoop(loop: boolean): void;
  onEase(channel: number, key: number, ease: Ease): void;
}

const PROP_LABEL: Record<string, string> = { rotate: 'rot', translate: 'move', scale: 'scale', color: 'color' };

export function Timeline(p: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [selKey, setSelKey] = useState<[number, number] | null>(null);
  const d = Math.max(0.01, p.anim.duration);

  const seekFromEvent = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    p.onSeek(Math.max(0, Math.min(d, ((e.clientX - r.left) / r.width) * d)));
  };

  const rows = p.anim.channels
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.target.localeCompare(b.c.target) || a.c.prop.localeCompare(b.c.prop));

  const ticks: number[] = [];
  const step = d > 2 ? 0.5 : d > 1 ? 0.25 : 0.1;
  for (let t = 0; t <= d + 1e-6; t += step) ticks.push(Math.round(t * 1000) / 1000);

  return (
    <div
      className="timeline"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selKey) {
          p.onDeleteKey(...selKey);
          setSelKey(null);
          e.preventDefault();
        }
      }}
    >
      <div className="tl-bar">
        <button className="icon" onClick={p.onTogglePlay} title="Play / pause (space)">
          {p.playing ? '❚❚' : '▶'}
        </button>
        <span className="tl-time">
          {p.time.toFixed(2)}s / {d.toFixed(2)}s
        </span>
        <label className="tl-field">
          length
          <input type="number" min={0.1} step={0.1} value={Number(d.toFixed(2))} onChange={(e) => p.onDuration(Math.max(0.1, Number(e.target.value) || 0.1))} />
        </label>
        <label className="tl-field">
          <input type="checkbox" checked={p.anim.loop} onChange={(e) => p.onLoop(e.target.checked)} /> loop
        </label>
        {selKey && p.anim.channels[selKey[0]]?.keys[selKey[1]] && (
          <span className="tl-field">
            ease
            {(['linear', 'smooth', 'stepped'] as Ease[]).map((e) => (
              <button
                key={e}
                className={(p.anim.channels[selKey[0]].keys[selKey[1]].ease ?? 'linear') === e ? 'on' : ''}
                onClick={() => p.onEase(selKey[0], selKey[1], e)}
              >
                {e}
              </button>
            ))}
          </span>
        )}
        <span className="tl-hint">Drag a bone in the view to set a key · select a key and press Delete</span>
      </div>
      <div className="tl-grid">
        <div className="tl-names">
          <div className="tl-ruler-label" />
          {rows.map(({ c, i }) => (
            <div key={i} className={`tl-name ${c.target === p.selectedBone ? 'on' : ''}`} onClick={() => p.onSelectBone(c.target)}>
              {c.target} <span>{PROP_LABEL[c.prop]}</span>
            </div>
          ))}
        </div>
        <div className="tl-tracks" ref={track} onPointerDown={(e) => {
          if ((e.target as HTMLElement).classList.contains('tl-key')) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }} onPointerMove={(e) => e.buttons & 1 && !(e.target as HTMLElement).classList.contains('tl-key') && seekFromEvent(e)}>
          <div className="tl-ruler">
            {ticks.map((t) => (
              <span key={t} style={{ left: `${(t / d) * 100}%` }}>
                {t}
              </span>
            ))}
          </div>
          {rows.map(({ c, i }) => (
            <div key={i} className={`tl-row ${c.target === p.selectedBone ? 'on' : ''}`}>
              {c.keys.map((k, ki) => (
                <span
                  key={ki}
                  className={`tl-key ${selKey && selKey[0] === i && selKey[1] === ki ? 'sel' : ''}`}
                  style={{ left: `${(k.t / d) * 100}%` }}
                  title={`${k.t.toFixed(2)}s  ${k.v.map((v) => v.toFixed(2)).join(', ')}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelKey([i, ki]);
                    p.onSeek(k.t);
                    p.onSelectBone(c.target);
                  }}
                />
              ))}
            </div>
          ))}
          <div className="tl-head" style={{ left: `${(Math.min(p.time, d) / d) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
