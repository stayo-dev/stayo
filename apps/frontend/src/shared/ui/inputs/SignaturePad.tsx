import React, { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X, RotateCcw, RotateCw, Check, Upload, Loader2 } from "lucide-react";
import {
  SIGNATURE_ACCEPTED_TYPES,
  SIGNATURE_MAX_EDGE,
  applyInkMask,
  fitWithin,
  flattenIllumination,
  isPlausibleSignature,
  luminanceHistogram,
  otsuThreshold,
  toLuminance,
  validateSignatureFile,
} from "./signatureImage";

interface SignaturePadProps {
  onSave: (blob: Blob | null) => void;
  placeholder?: string;
  existingSignatureUrl?: string | null;
  className?: string;
  canvasHeightClass?: string;
  /**
   * Offer "Upload photo" alongside drawing.
   *
   * Off by default, and deliberately so. An owner capturing their own
   * signature once, for their own hostel's template, is a different act from a
   * tenant signing a particular tenancy agreement — drawing at least happens
   * in-session, whereas a photograph weakens what "signed" means on a document
   * someone may later need to rely on. Enabled on the owner's Add Hostel
   * agreement step only. See ADR-140.
   */
  allowUpload?: boolean;
}

export function SignaturePad({
  onSave,
  placeholder = "Draw your signature here",
  existingSignatureUrl,
  className = "space-y-2",
  canvasHeightClass = "h-40",
  allowUpload = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const largeCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rotationCountRef = useRef(0);
  const largeRotationCountRef = useRef(0);

  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [showExisting, setShowExisting] = useState(Boolean(existingSignatureUrl));

  const [isExpanded, setIsExpanded] = useState(false);
  const [isLargeDrawing, setIsLargeDrawing] = useState(false);
  const [largeHasDrawn, setLargeHasDrawn] = useState(false);

  /** Preview of a cleaned upload. Rendered as an image layer rather than
   *  painted into the canvas, so the canvas init effect cannot race it away. */
  const [importedUrl, setImportedUrl] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Sync showExisting with prop changes
  useEffect(() => {
    if (existingSignatureUrl) {
      setShowExisting(true);
    }
  }, [existingSignatureUrl]);

  // An object URL outlives the component unless it is handed back.
  useEffect(() => {
    return () => {
      if (importedUrl) URL.revokeObjectURL(importedUrl);
    };
  }, [importedUrl]);

  const clearImported = useCallback(() => {
    setImportedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImportError(null);
  }, []);

  // Clear signature and canvas
  const handleClear = () => {
    rotationCountRef.current = 0;
    setShowExisting(false);
    clearImported();
    // Notify parent that signature has been cleared (set blob to null)
    // If the parent needs to know that it is cleared/null so it doesn't try to send old signature url
    onSave(null);
    setHasDrawn(false);

    // We delay slightly to let the canvas mount, then clear it
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, 50);
  };

  // Convert canvas to blob and notify parent
  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    canvas.toBlob((blob) => {
      onSave(blob);
    }, "image/png");
  };

  // ── Upload ────────────────────────────────────────────────────────────────

  /**
   * Turns a photograph of a signature on paper into ink on white.
   *
   * Runs entirely here rather than on the server: the signature endpoint caps
   * uploads at 2MB and a phone photo is routinely 3–8MB, so downscaling before
   * upload is what makes the normal case work at all. The arithmetic lives in
   * `signatureImage.ts` and is unit-tested; this function is only the canvas
   * plumbing around it. See ADR-140.
   */
  const importFromFile = useCallback(
    async (file: File) => {
      const check = validateSignatureFile({ type: file.type, size: file.size });
      if (!check.ok) {
        setImportError(check.reason);
        return;
      }

      setImporting(true);
      setImportError(null);

      const sourceUrl = URL.createObjectURL(file);
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("decode failed"));
          img.src = sourceUrl;
        });

        const { width, height } = fitWithin(
          image.naturalWidth || image.width,
          image.naturalHeight || image.height,
          SIGNATURE_MAX_EDGE,
        );

        const work = document.createElement("canvas");
        work.width = width;
        work.height = height;
        const ctx = work.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(image, 0, 0, width, height);

        const frame = ctx.getImageData(0, 0, width, height);
        const lum = toLuminance(frame.data);
        // Divide out uneven lighting first, or a hand shadow across one corner
        // thresholds into a solid black block.
        const flat = flattenIllumination(lum, width, height);
        const threshold = otsuThreshold(luminanceHistogram(flat));
        const { inkPixels, totalPixels } = applyInkMask(frame.data, flat, threshold);

        if (!isPlausibleSignature(inkPixels, totalPixels)) {
          setImportError(
            "We couldn't find a signature in that photo. Try again on a plain sheet in even light.",
          );
          return;
        }

        ctx.putImageData(frame, 0, 0);

        const blob = await new Promise<Blob | null>((resolve) => work.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("encode failed");

        clearImported();
        setImportedUrl(URL.createObjectURL(blob));
        setShowExisting(false);
        setHasDrawn(false);
        rotationCountRef.current = 0;
        onSave(blob);
        setIsExpanded(false);
      } catch {
        setImportError("That photo could not be read. Try a different one.");
      } finally {
        URL.revokeObjectURL(sourceUrl);
        setImporting(false);
      }
    },
    [clearImported, onSave],
  );

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset first, so picking the same file twice still fires a change event.
    e.target.value = "";
    if (file) void importFromFile(file);
  };

  // ── Canvas setup ──────────────────────────────────────────────────────────

  const showsCanvas = !showExisting && !importedUrl;

  // Initialize small inline canvas
  useEffect(() => {
    if (!showsCanvas) return;

    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Set canvas dimensions based on CSS display size (retina resolution)
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      ctx.scale(2, 2);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1e293b"; // Slate-800
      ctx.lineWidth = 2.5;

      // Fill white background by default
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
    }, 100);

    return () => clearTimeout(timer);
  }, [showsCanvas]);

  // Initialize large full-screen canvas when it opens
  useEffect(() => {
    if (!isExpanded) return;

    const timer = setTimeout(() => {
      const canvas = largeCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      ctx.scale(2, 2);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1e293b"; // Slate-800
      ctx.lineWidth = 3; // Slightly thicker for larger canvas

      // Fill white background by default
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      largeRotationCountRef.current = 0;
    }, 100);

    return () => clearTimeout(timer);
  }, [isExpanded]);

  /**
   * While the full-screen surface is open it is the whole viewport, so the page
   * behind it must not scroll under a finger that misses the canvas. Escape
   * closes it, as it is a dialog in every respect except that it fills the
   * screen rather than floating over it.
   */
  useEffect(() => {
    if (!isExpanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isExpanded]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement | null) => {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    if ("touches" in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  // Inline Canvas drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    rotationCountRef.current = 0;
    if (e.cancelable) {
      e.preventDefault();
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const coords = getCoordinates(e, canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    if (e.cancelable) {
      e.preventDefault();
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const coords = getCoordinates(e, canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      saveSignature();
    }
  };

  // Full Screen Canvas drawing handlers
  const startDrawingLarge = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    largeRotationCountRef.current = 0;
    if (e.cancelable) {
      e.preventDefault();
    }
    const canvas = largeCanvasRef.current;
    if (!canvas) return;
    const coords = getCoordinates(e, canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsLargeDrawing(true);
  };

  const drawLarge = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isLargeDrawing) return;
    if (e.cancelable) {
      e.preventDefault();
    }
    const canvas = largeCanvasRef.current;
    if (!canvas) return;
    const coords = getCoordinates(e, canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    setLargeHasDrawn(true);
  };

  const stopDrawingLarge = () => {
    if (isLargeDrawing) {
      setIsLargeDrawing(false);
    }
  };

  const handleRotate = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Save current content to temp canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;
    tempCtx.drawImage(canvas, 0, 0);

    const isOddRotation = (rotationCountRef.current % 2) === 0;
    rotationCountRef.current += 1;

    // Clear and fill white
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Rotate and scale
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((90 * Math.PI) / 180);
    const scaleFactor = Math.min(canvas.width / tempCanvas.height, canvas.height / tempCanvas.width);
    const scale = isOddRotation ? scaleFactor : (1 / scaleFactor);
    ctx.scale(scale, scale);
    ctx.drawImage(tempCanvas, -tempCanvas.width / 2, -tempCanvas.height / 2);
    ctx.restore();

    // Trigger save
    saveSignature();
  };

  const handleRotateLarge = () => {
    const canvas = largeCanvasRef.current;
    if (!canvas || !largeHasDrawn) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Save current content to temp canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;
    tempCtx.drawImage(canvas, 0, 0);

    const isOddRotation = (largeRotationCountRef.current % 2) === 0;
    largeRotationCountRef.current += 1;

    // Clear and fill white
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Rotate and scale
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((90 * Math.PI) / 180);
    const scaleFactor = Math.min(canvas.width / tempCanvas.height, canvas.height / tempCanvas.width);
    const scale = isOddRotation ? scaleFactor : (1 / scaleFactor);
    ctx.scale(scale, scale);
    ctx.drawImage(tempCanvas, -tempCanvas.width / 2, -tempCanvas.height / 2);
    ctx.restore();
  };

  const handleClearLarge = () => {
    largeRotationCountRef.current = 0;
    const canvas = largeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setLargeHasDrawn(false);
  };

  const handleConfirmLarge = () => {
    const largeCanvas = largeCanvasRef.current;
    if (!largeCanvas) {
      setIsExpanded(false);
      return;
    }

    // A signature drawn on the full screen is the real one: keep it at that
    // resolution for the parent, and render it back into the inline pad as a
    // preview image rather than re-rasterising it through the small canvas,
    // which used to be what got uploaded.
    largeCanvas.toBlob((blob) => {
      if (!blob) return;
      clearImported();
      setImportedUrl(URL.createObjectURL(blob));
      setShowExisting(false);
      setHasDrawn(false);
      rotationCountRef.current = 0;
      onSave(blob);
    }, "image/png");

    setIsExpanded(false);
  };

  const hasContent = hasDrawn || showExisting || Boolean(importedUrl);

  const uploadButton = (compact: boolean) =>
    allowUpload ? (
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        className={
          compact
            ? "absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-border bg-card/90 px-2.5 py-1.5 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur-sm transition-all active:scale-95 disabled:opacity-60"
            : "flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted active:scale-95 disabled:opacity-60"
        }
        title="Upload a photo of your signature"
      >
        {importing ? (
          <Loader2 className={compact ? "h-3.5 w-3.5 animate-spin" : "h-4 w-4 animate-spin"} />
        ) : (
          <Upload className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        )}
        <span>{importing ? "Cleaning…" : "Upload photo"}</span>
      </button>
    ) : null;

  return (
    <div className={className}>
      {allowUpload && (
        <input
          ref={fileInputRef}
          type="file"
          accept={SIGNATURE_ACCEPTED_TYPES.join(",")}
          onChange={onFilePicked}
          className="hidden"
        />
      )}

      <div className={`relative rounded-xl border border-border overflow-hidden bg-white shadow-inner group flex flex-col ${canvasHeightClass}`}>
        <div className="flex-1 relative">
          {importedUrl ? (
            <div className="absolute inset-0 bg-white flex items-center justify-center p-2">
              <img src={importedUrl} alt="Your signature" className="max-h-full object-contain select-none" />
            </div>
          ) : showExisting && existingSignatureUrl ? (
            <div className="absolute inset-0 bg-white flex items-center justify-center p-2">
              <img src={existingSignatureUrl} alt="Existing Signature" className="max-h-full object-contain select-none" />
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className="absolute inset-0 w-full h-full bg-white block touch-none cursor-crosshair"
            />
          )}
          {!hasContent && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground text-xs select-none">
              {placeholder}
            </div>
          )}

          {/* Expand + upload, only while there is a canvas to act on. */}
          {showsCanvas && (
            <>
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className={`absolute top-2 ${allowUpload ? "left-2" : "right-2"} flex items-center gap-1 rounded-lg border border-border bg-card/90 px-2.5 py-1.5 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur-sm transition-all active:scale-95`}
                title="Sign in Full Screen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fullscreen</span>
              </button>
              {uploadButton(true)}
            </>
          )}
        </div>

        {/* Action Controls Bar inside the canvas card */}
        <div className="px-3 py-2 bg-muted/40 border-t border-border flex justify-between items-center shrink-0">
          <span className="text-[10px] text-muted-foreground truncate mr-2">
            {importedUrl
              ? "Photo cleaned up and ready"
              : showExisting
                ? "Showing saved signature"
                : allowUpload
                  ? "Sign in the box, go fullscreen, or upload a photo"
                  : "Sign inside the box or expand to fullscreen"}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            {hasDrawn && showsCanvas && (
              <button
                type="button"
                onClick={handleRotate}
                className="text-xs font-semibold text-accent hover:underline active:scale-95 transition-transform flex items-center gap-1"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Rotate</span>
              </button>
            )}
            {hasContent && (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs font-semibold text-destructive hover:underline active:scale-95 transition-transform"
              >
                {showExisting || importedUrl ? "Redraw" : "Clear"}
              </button>
            )}
          </div>
        </div>
      </div>

      {importError && (
        <p role="alert" className="text-[12px] leading-relaxed text-destructive">
          {importError}
        </p>
      )}

      {/*
        A genuinely full-screen surface, not a card floating on a scrim. The
        previous version was a centred `max-w-3xl h-[85vh]` dialog, so on a
        phone — the device an owner actually signs on — the canvas was inset on
        all four sides and smaller than it needed to be. `100dvh` rather than
        `100vh` so mobile browser chrome does not cut the footer off.
      */}
      {isExpanded && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Draw your signature"
          className="fixed inset-0 z-[9999] flex flex-col bg-background animate-in fade-in duration-150"
          style={{ height: "100dvh" }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h3 className="font-display text-[15px] font-extrabold text-foreground">Draw your signature</h3>
              <p className="truncate text-[12px] text-muted-foreground">
                Use your finger or a stylus — the whole screen is yours.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              aria-label="Close"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="relative flex-1 bg-muted/30 p-3">
            <canvas
              ref={largeCanvasRef}
              onMouseDown={startDrawingLarge}
              onMouseMove={drawLarge}
              onMouseUp={stopDrawingLarge}
              onMouseLeave={stopDrawingLarge}
              onTouchStart={startDrawingLarge}
              onTouchMove={drawLarge}
              onTouchEnd={stopDrawingLarge}
              className="block h-full w-full rounded-xl border border-border bg-white touch-none cursor-crosshair"
            />
            {!largeHasDrawn && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground select-none">
                {placeholder}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleClearLarge}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5 active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Clear</span>
              </button>
              {largeHasDrawn && (
                <button
                  type="button"
                  onClick={handleRotateLarge}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/5 active:scale-95"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>Rotate</span>
                </button>
              )}
              {uploadButton(false)}
            </div>
            <button
              type="button"
              onClick={handleConfirmLarge}
              className="flex flex-none items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 font-display text-sm font-bold text-primary-foreground shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              disabled={!largeHasDrawn}
            >
              <Check className="w-4 h-4" />
              <span>Use signature</span>
            </button>
          </div>

          {importError && (
            <p role="alert" className="px-4 pb-3 text-[12px] text-destructive">
              {importError}
            </p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
