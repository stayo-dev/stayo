import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import '../onboarding.css';

/**
 * The full-screen signature pad from `Stayo Onboarding.dc.html`'s "FULL-SCREEN
 * SIGNATURE PAD" panel — a cream sheet with a white top bar (back tile, title,
 * pencil badge), a name (and, for a guardian, relationship) block, a drawing
 * surface that fills every remaining pixel with a dashed baseline and an "✕"
 * mark, and a Cancel / Apply Signature footer whose primary button stays
 * washed-out (`#D8B3A2`) until both a name and a scribble exist.
 *
 * Replaces the generic slate-themed dialog that previously wrapped
 * `@shared/ui/inputs`'s `SignaturePad` here — that component belongs to the
 * owner-side flows and carries its own chrome (fullscreen/rotate controls, an
 * indigo confirm button), none of which is in this design. Drawing is handled
 * directly with pointer events so the canvas can be the sheet, rather than a
 * fixed-height box inside one.
 */

interface SignatureSheetProps {
  mode: 'tenant' | 'guardian';
  name: string;
  /** Guardian only. */
  relation?: string;
  existingSignatureUrl?: string | null;
  onCancel: () => void;
  onApply: (name: string, relation: string, blob: Blob | null) => void;
}

const RELATIONS = ['Father', 'Mother', 'Guardian'];

const COPY = {
  tenant: {
    title: 'Tenant Signature',
    sub: 'Write your name and draw your signature',
    nameLabel: 'Full Name',
    namePlaceholder: 'Type your official full name',
    canvasHint: 'Draw tenant signature here',
  },
  guardian: {
    title: 'Parent/Guardian Co-Signature',
    sub: 'Provide guardian details and signature',
    nameLabel: 'Full Name',
    namePlaceholder: 'Guardian name',
    canvasHint: 'Draw guardian signature here',
  },
} as const;

export function SignatureSheet({ mode, name: initialName, relation: initialRelation = '', existingSignatureUrl, onCancel, onApply }: SignatureSheetProps) {
  const copy = COPY[mode];
  const [name, setName] = useState(initialName);
  const [relation, setRelation] = useState(initialRelation);
  const [scribbled, setScribbled] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const drawingRef = useRef(false);

  /**
   * Size the backing store to the element's real box at device pixel ratio,
   * re-running on resize (an on-screen keyboard opening changes the height,
   * which would otherwise stretch an already-drawn signature).
   */
  const setupCanvas = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (sizeRef.current.w === rect.width && sizeRef.current.h === rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(rect.width * dpr);
    el.height = Math.round(rect.height * dpr);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#221E1A';
    ctxRef.current = ctx;
    sizeRef.current = { w: rect.width, h: rect.height };
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(setupCanvas);
    window.addEventListener('resize', setupCanvas);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', setupCanvas);
    };
  }, [setupCanvas]);

  const pointAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    drawingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is a nicety — losing it only means strokes stop at the edge.
    }
    const p = pointAt(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (!scribbled) setScribbled(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxRef.current;
    if (!drawingRef.current || !ctx) return;
    const p = pointAt(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const endStroke = () => {
    drawingRef.current = false;
  };

  const clear = () => {
    const ctx = ctxRef.current;
    const { w, h } = sizeRef.current;
    if (ctx) ctx.clearRect(0, 0, w + 4, h + 4);
    setScribbled(false);
  };

  /** Flatten onto white — the agreement PDF composites this over a light page. */
  const exportBlob = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const el = canvasRef.current;
      if (!el || !scribbled) return resolve(null);
      const out = document.createElement('canvas');
      out.width = el.width;
      out.height = el.height;
      const ctx = out.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(el, 0, 0);
      out.toBlob((blob) => resolve(blob), 'image/png');
    });

  const hasSignature = scribbled || Boolean(existingSignatureUrl);
  const canApply = name.trim().length > 0 && hasSignature && (mode === 'tenant' || relation.length > 0);

  const apply = async () => {
    if (!canApply) return;
    onApply(name.trim(), relation, await exportBlob());
  };

  const body = (
    <div className="ob-fade fixed inset-0 z-[100] flex justify-center" style={{ background: '#F6F1EA' }}>
      <div className="flex h-full w-full max-w-md flex-col" style={{ background: '#F6F1EA' }}>
        {/* top bar */}
        <div className="flex flex-none items-center gap-3 border-b bg-white" style={{ padding: '52px 16px 12px', borderColor: '#EAE0D2' }}>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Back"
            className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] border"
            style={{ background: '#F6F1EA', borderColor: '#EDE3D5', color: '#3A342E' }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-extrabold tracking-tight" style={{ color: '#1A1A1A' }}>
              {copy.title}
            </div>
            <div className="mt-px text-[11.5px]" style={{ color: '#8A7F75' }}>
              {copy.sub}
            </div>
          </div>
          <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F3E7E0', color: '#B46A55' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17.5V21h3.5L17 10.5 13.5 7 3 17.5z" />
              <path d="M14.5 6l3.5 3.5" />
            </svg>
          </div>
        </div>

        {/* name + relationship */}
        <div className="flex flex-none flex-col gap-[11px] border-b bg-white" style={{ padding: '14px 16px 12px', borderColor: '#F0E7DA' }}>
          {mode === 'guardian' && (
            <label className="flex items-center gap-[9px]">
              <span className="w-[76px] flex-none text-[10px] font-extrabold uppercase tracking-[.05em]" style={{ color: '#7A6F63' }}>
                Relation
              </span>
              <span className="relative flex-1">
                <select
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                  className="w-full appearance-none rounded-[10px] text-[13px] font-semibold"
                  style={{ border: '1.5px solid #B46A55', padding: '10px 12px', background: 'transparent', color: relation ? '#2A2521' : '#8A7F75' }}
                >
                  <option value="">Select</option>
                  {RELATIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#8A7F75' }}>
                  ⌄
                </span>
              </span>
            </label>
          )}
          <label className="flex items-center gap-[9px]">
            <span className="w-[76px] flex-none text-[10px] font-extrabold uppercase tracking-[.05em]" style={{ color: '#7A6F63' }}>
              {copy.nameLabel}
            </span>
            <span className="flex-1 rounded-[10px] border" style={{ background: '#F6F1EA', borderColor: '#E7DDCE', padding: '0 12px' }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={copy.namePlaceholder}
                className="w-full border-none bg-transparent text-[13.5px] font-semibold outline-none"
                style={{ color: '#2A2521', padding: '10px 0' }}
              />
            </span>
          </label>
        </div>

        {/* drawing surface */}
        <div className="relative flex min-h-0 flex-1 flex-col" style={{ padding: '12px 14px' }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-[.05em]" style={{ color: '#7A6F63' }}>
              Draw your signature
            </span>
            <button
              type="button"
              onClick={clear}
              className="flex items-center gap-[5px] rounded-full border bg-white font-display text-[11.5px] font-bold"
              style={{ borderColor: '#E7DDCE', padding: '6px 12px', color: scribbled ? '#A45D44' : '#B0A493' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
              </svg>
              Clear
            </button>
          </div>

          <div
            className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-white"
            style={{ border: `1.5px solid ${scribbled ? '#B46A55' : '#E7DDCE'}`, boxShadow: 'inset 0 1px 3px rgba(40,30,20,.05)' }}
          >
            {existingSignatureUrl && !scribbled && (
              <img src={existingSignatureUrl} alt="Current signature" className="pointer-events-none absolute inset-0 m-auto max-h-[70%] max-w-[80%] object-contain" />
            )}
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerLeave={endStroke}
              onPointerCancel={endStroke}
              className="absolute inset-0 block h-full w-full cursor-crosshair"
              style={{ touchAction: 'none' }}
            />
            <div
              className="pointer-events-none absolute"
              style={{ left: 26, right: 26, bottom: 52, height: 1.5, background: 'repeating-linear-gradient(90deg,#DBCFBD 0 8px,transparent 8px 16px)' }}
            />
            <div className="pointer-events-none absolute text-[18px] font-bold" style={{ left: 26, bottom: 56, fontFamily: 'Georgia, serif', color: '#C9BBA8' }}>
              ✕
            </div>
            {!hasSignature && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#D6C9B7" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 17.5V21h3.5L17 10.5 13.5 7 3 17.5z" />
                  <path d="M14.5 6l3.5 3.5" />
                </svg>
                <span className="text-[13px] font-medium" style={{ color: '#B0A493' }}>
                  {copy.canvasHint}
                </span>
              </div>
            )}
          </div>
          <div className="mt-2 text-center text-[11px]" style={{ color: '#9A8F84' }}>
            {existingSignatureUrl && !scribbled ? 'A signature is already on file — draw here to replace it' : 'Use your finger or mouse to sign above the line'}
          </div>
        </div>

        {/* footer */}
        <div className="flex flex-none gap-2.5 border-t bg-white" style={{ padding: '12px 16px 30px', borderColor: '#EAE0D2' }}>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border text-center font-display text-[13.5px] font-bold"
            style={{ background: '#F6F1EA', borderColor: '#E7DDCE', color: '#3A342E', padding: '14px 0' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!canApply}
            className="flex items-center justify-center gap-[7px] rounded-xl text-center font-display text-[13.5px] font-bold text-white"
            style={{
              flex: 1.4,
              background: canApply ? '#B46A55' : '#D8B3A2',
              padding: '14px 0',
              boxShadow: canApply ? '0 6px 16px rgba(180,106,85,.32)' : 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 6" />
            </svg>
            Apply Signature
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(body, document.body);
}
