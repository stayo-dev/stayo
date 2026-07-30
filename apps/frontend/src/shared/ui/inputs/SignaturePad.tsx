import React, { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X, RotateCcw, RotateCw, Check } from "lucide-react";

interface SignaturePadProps {
  onSave: (blob: Blob | null) => void;
  placeholder?: string;
  existingSignatureUrl?: string | null;
  className?: string;
  canvasHeightClass?: string;
}

export function SignaturePad({
  onSave,
  placeholder = "Draw your signature here",
  existingSignatureUrl,
  className = "space-y-2",
  canvasHeightClass = "h-40",
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const largeCanvasRef = useRef<HTMLCanvasElement>(null);
  const rotationCountRef = useRef(0);
  const largeRotationCountRef = useRef(0);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [showExisting, setShowExisting] = useState(Boolean(existingSignatureUrl));
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLargeDrawing, setIsLargeDrawing] = useState(false);
  const [largeHasDrawn, setLargeHasDrawn] = useState(false);

  // Sync showExisting with prop changes
  useEffect(() => {
    if (existingSignatureUrl) {
      setShowExisting(true);
    }
  }, [existingSignatureUrl]);

  // Clear signature and canvas
  const handleClear = () => {
    rotationCountRef.current = 0;
    setShowExisting(false);
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

  // Initialize small inline canvas
  useEffect(() => {
    if (showExisting) return;
    
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
  }, [showExisting]);

  // Initialize large full-screen canvas when modal opens
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
    const smallCanvas = canvasRef.current;
    if (largeCanvas && smallCanvas) {
      const smallCtx = smallCanvas.getContext("2d");
      if (smallCtx) {
        rotationCountRef.current = 0;
        smallCtx.save();
        // Reset scale to 1:1 for copying pixels directly
        smallCtx.setTransform(1, 0, 0, 1, 0, 0);
        smallCtx.clearRect(0, 0, smallCanvas.width, smallCanvas.height);
        smallCtx.fillStyle = "#ffffff";
        smallCtx.fillRect(0, 0, smallCanvas.width, smallCanvas.height);
        
        smallCtx.drawImage(
          largeCanvas,
          0,
          0,
          largeCanvas.width,
          largeCanvas.height,
          0,
          0,
          smallCanvas.width,
          smallCanvas.height
        );
        smallCtx.restore();
        setHasDrawn(true);
        
        // Save to parent
        largeCanvas.toBlob((blob) => {
          onSave(blob);
        }, "image/png");
      }
    }
    setIsExpanded(false);
  };

  return (
    <div className={className}>
      <div className={`relative rounded-xl border border-border overflow-hidden bg-white shadow-inner group flex flex-col ${canvasHeightClass}`}>
        <div className="flex-1 relative">
          {showExisting && existingSignatureUrl ? (
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
          {!hasDrawn && !showExisting && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground text-xs select-none">
              {placeholder}
            </div>
          )}
          {/* Fullscreen Expand Button - only show if not showing existing preview */}
          {!showExisting && (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="absolute top-2 right-2 px-2.5 py-1.5 rounded-lg bg-slate-900/10 hover:bg-slate-900/20 text-slate-700 active:scale-95 transition-all flex items-center gap-1 font-semibold text-[11px] shadow-sm backdrop-blur-sm"
              title="Sign in Full Screen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Fullscreen</span>
            </button>
          )}
        </div>

        {/* Action Controls Bar inside the canvas card */}
        <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex justify-between items-center shrink-0">
          <span className="text-[10px] text-muted-foreground truncate mr-2">
            {showExisting ? "Showing saved signature" : "Sign inside the box or expand to fullscreen"}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            {hasDrawn && !showExisting && (
              <button
                type="button"
                onClick={handleRotate}
                className="text-xs font-semibold text-accent hover:underline active:scale-95 transition-transform flex items-center gap-1"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Rotate</span>
              </button>
            )}
            {(hasDrawn || showExisting) && (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs font-semibold text-destructive hover:underline active:scale-95 transition-transform"
              >
                {showExisting ? "Redraw" : "Clear"}
              </button>
            )}
          </div>
        </div>
      </div>

      {isExpanded && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-200">
          <div className="w-full max-w-3xl h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="font-semibold text-slate-800 text-base">Draw Signature</h3>
                <p className="text-xs text-muted-foreground">Use your finger, mouse, or stylus to sign on the large canvas</p>
              </div>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="p-1.5 rounded-full hover:bg-slate-200/60 text-slate-500 hover:text-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body (Canvas) */}
            <div className="flex-1 bg-slate-50 p-4 md:p-6 flex items-center justify-center relative">
              <canvas
                ref={largeCanvasRef}
                onMouseDown={startDrawingLarge}
                onMouseMove={drawLarge}
                onMouseUp={stopDrawingLarge}
                onMouseLeave={stopDrawingLarge}
                onTouchStart={startDrawingLarge}
                onTouchMove={drawLarge}
                onTouchEnd={stopDrawingLarge}
                className="w-full h-full bg-white rounded-xl shadow-sm border border-slate-200 touch-none cursor-crosshair block"
              />
              {!largeHasDrawn && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-sm select-none">
                  {placeholder}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearLarge}
                  className="flex items-center gap-1 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/5 rounded-xl transition-colors active:scale-95 flex items-center"
                >
                  <RotateCcw className="w-4 h-4 mr-1" />
                  <span>Clear</span>
                </button>
                {largeHasDrawn && (
                  <button
                    type="button"
                    onClick={handleRotateLarge}
                    className="flex items-center gap-1 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/5 rounded-xl transition-colors active:scale-95 flex items-center"
                  >
                    <RotateCw className="w-4 h-4 mr-1" />
                    <span>Rotate 90°</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200/50 rounded-xl transition-colors active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmLarge}
                  className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                  disabled={!largeHasDrawn}
                >
                  <Check className="w-4 h-4" />
                  <span>Confirm Signature</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
