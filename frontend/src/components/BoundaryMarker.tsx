import React, { useRef, useState, useEffect } from "react";

interface Point {
  x: number;
  y: number;
}

interface BoundaryMarkerProps {
  objectName: string;
  onSaveAndFinish?: (points: Point[], frameTime?: number) => void;
  onSaveAndAddAnother?: (points: Point[], frameTime?: number) => void;
}

import { API_BASE_URL } from "../config";

const BoundaryMarker: React.FC<BoundaryMarkerProps> = ({
  objectName,
  onSaveAndFinish,
  onSaveAndAddAnother,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [frameTime, setFrameTime] = useState<number>(0.0);
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    setPoints([]);
    setImageLoaded(false);
    setImageError(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `${API_BASE_URL}/extract-frame/${objectName}?timestamp=${frameTime}`;
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => setImageError(true);
  }, [objectName, frameTime]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    if (points.length > 0) {
      // Draw solid lines SEQUENTIALLY: 1→2→3→4 (NO closePath — no line back to start)
      ctx.shadowColor = "rgb(246, 250, 0)";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = "rgb(246, 250, 0)";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw numbered point markers in sequential order
      points.forEach((pt, idx) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 13, 0, 2 * Math.PI);
        ctx.fillStyle = idx === 0 ? "rgba(255,87,34,0.2)" : "rgba(255,235,59,0.2)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, 2 * Math.PI);
        const grad = ctx.createRadialGradient(pt.x - 2, pt.y - 2, 1, pt.x, pt.y, 8);
        grad.addColorStop(0, idx === 0 ? "#FF7043" : "#FFF176");
        grad.addColorStop(1, idx === 0 ? "#BF360C" : "#F9A825");
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#1a1a1a";
        ctx.stroke();
        ctx.font = "bold 10px Arial";
        ctx.fillStyle = "#000";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${idx + 1}`, pt.x, pt.y);
      });
    }
  };

  useEffect(() => {
    if (imageLoaded) drawCanvas();
  }, [points, imageLoaded]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    setPoints((prev) => [
      ...prev,
      { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY },
    ]);
  };

  const handleConfirm = () => {
    // Legacy generic confirm handler - removed
  };

  const statusColor =
    points.length === 0
      ? "bg-slate-100 border-slate-200 text-slate-500"
      : points.length < 3
      ? "bg-amber-50 border-amber-300 text-amber-700"
      : "bg-emerald-50 border-emerald-300 text-emerald-700";

  const statusText =
    points.length === 0
      ? "Click on the plot to start"
      : points.length < 3
      ? `${points.length} pt${points.length > 1 ? "s" : ""} - need ${3 - points.length} more`
      : `${points.length} points - Ready to confirm`;

  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {/* Header section with Zoom controls and Preview button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-50 p-4 rounded-2xl border border-emerald-100">
        <div className="space-y-1">
          <h4 className="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2">
            📍 Mark Highlight Boundaries
            <button 
              onClick={() => setShowPreview(true)}
              className="ml-2 px-3 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs font-bold rounded-full transition-colors flex items-center gap-1"
            >
              ▶️ Preview Video
            </button>
          </h4>
          <p className="text-xs text-slate-500 font-medium">
            Click on the video frame to mark points for the highlight (minimum 1 point required)
          </p>
        </div>
      </div>

      {/* Video Frame Scrubber Control Bar */}
      <div className="flex flex-col gap-2 p-3 bg-slate-50 border border-slate-200 rounded-2xl shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            🎬 Select Video Frame Position: <span className="text-[#0D473B] font-black">{frameTime.toFixed(1)}s</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFrameTime((t) => Math.max(0, +(t - 0.5).toFixed(1)))}
              className="px-2.5 py-1 text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg shadow-sm"
              title="Step Back 0.5s"
            >
              ⏮️ -0.5s
            </button>
            <button
              type="button"
              onClick={() => setFrameTime((t) => +(t + 0.5).toFixed(1))}
              className="px-2.5 py-1 text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg shadow-sm"
              title="Step Forward 0.5s"
            >
              ⏭️ +0.5s
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={frameTime}
            onChange={(e) => setFrameTime(parseFloat(e.target.value))}
            className="w-full accent-[#0D473B] cursor-pointer"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 pt-1 border-t border-slate-200/60">
          <span>Quick Presets:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[0.0, 1.0, 2.0, 3.0, 4.0, 5.0].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setFrameTime(preset)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition border ${
                  frameTime === preset
                    ? "bg-[#0D473B] text-white border-[#0D473B]"
                    : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100"
                }`}
              >
                {preset === 3.0 ? "🛣️ 3.0s (Full Road)" : `${preset}s`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative w-full">
        {/* Zoom Controls Overlay */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-1 bg-white/95 backdrop-blur-sm p-1.5 rounded-xl shadow-lg border border-slate-200">
          <button 
            onClick={() => setZoomLevel((z) => Math.min(4, z + 0.5))} 
            className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-[#0D473B] hover:text-white rounded-lg font-bold text-lg text-slate-700 transition"
            title="Zoom In"
          >
            +
          </button>
          <div className="text-[10px] font-black text-center text-slate-500 py-1">{Math.round(zoomLevel * 100)}%</div>
          <button 
            onClick={() => setZoomLevel((z) => Math.max(1, z - 0.5))} 
            className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-[#0D473B] hover:text-white rounded-lg font-bold text-lg text-slate-700 transition"
            title="Zoom Out"
          >
            −
          </button>
        </div>

        {/* Loading / Help Overlays (Sticky) */}
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-10 gap-3 rounded-2xl border-2 border-emerald-100">
            <div className="animate-spin h-10 w-10 border-4 border-[#0D473B] border-t-transparent rounded-full" />
            <p className="text-[#0D473B] text-sm font-semibold">Loading video frame...</p>
          </div>
        )}
        {imageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-rose-50 z-10 gap-2 p-6 text-center rounded-2xl border-2 border-rose-200">
            <p className="text-rose-700 text-sm font-bold">Could not load video frame</p>
            <p className="text-rose-500 text-xs">Make sure backend is running and file is uploaded.</p>
          </div>
        )}
        {points.length === 0 && imageLoaded && zoomLevel === 1 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
            <div className="bg-black/70 backdrop-blur-sm text-white text-xs font-bold px-4 py-2 rounded-2xl border border-white/20 shadow-xl">
              Click on plot corners to mark boundary
            </div>
          </div>
        )}
        {/* Scrollable Canvas Container */}
        <div className={`rounded-2xl overflow-auto border-2 border-emerald-100 shadow-inner bg-slate-100/50 w-full h-[75vh] min-h-[600px] flex ${zoomLevel > 1 ? 'items-start justify-center' : 'items-center justify-center'}`}>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="cursor-crosshair block rounded-xl shadow-2xl transition-transform"
            style={{ 
              height: zoomLevel === 1 ? "100%" : `${zoomLevel * 100}%`,
              width: "auto",
              maxWidth: "none",
              maxHeight: "none",
              transformOrigin: "center center"
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap sm:flex-nowrap gap-3 w-full">
        <button
          onClick={() => setPoints((p) => p.slice(0, -1))}
          disabled={points.length === 0}
          className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl border border-slate-200 transition text-sm flex items-center justify-center shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Undo
        </button>
        <button
          onClick={() => setPoints([])}
          disabled={points.length === 0}
          className="flex-1 py-3 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-xl border border-rose-200 transition text-sm flex items-center justify-center shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset
        </button>
        {onSaveAndAddAnother && (
          <button
            onClick={() => {
              if (points.length < 1) {
                alert("Please mark at least 1 point!");
                return;
              }
              onSaveAndAddAnother(points, frameTime);
              setPoints([]);
            }}
            disabled={points.length < 1}
            className="flex-[2] px-4 py-3 bg-slate-600 hover:bg-slate-700 text-white font-black rounded-2xl shadow-xl shadow-slate-600/30 text-sm transition flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>+ Save & Add Another Highlight</span>
            <span className="text-xs font-medium text-slate-200">({points.length} Points Marked)</span>
          </button>
        )}

        {onSaveAndFinish && (
          <button
            onClick={() => {
              if (points.length < 1) {
                alert("Please mark at least 1 point!");
                return;
              }
              onSaveAndFinish(points, frameTime);
              setPoints([]);
            }}
            disabled={points.length < 1}
            className="flex-[2] px-4 py-3 bg-[#0D473B] hover:bg-[#09332a] text-white font-black rounded-2xl shadow-xl shadow-emerald-900/30 text-sm transition flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>✓ Confirm & Start AI Tracking</span>
            <span className="text-xs font-medium text-emerald-200">({points.length} Points Marked)</span>
          </button>
        )}
      </div>

      {/* Video Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-[60] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl overflow-hidden shadow-2xl max-w-4xl w-full relative">
            <button 
              onClick={() => setShowPreview(false)}
              className="absolute top-4 right-4 z-10 w-10 h-10 bg-black/50 hover:bg-rose-500 text-white rounded-full flex items-center justify-center transition-colors"
            >
              ✕
            </button>
            <div className="p-4 bg-slate-100 border-b border-slate-200">
              <h3 className="font-bold text-slate-800">Video Preview</h3>
              <p className="text-xs text-slate-500">Watch the video to see camera motion before drawing your boundaries on the first frame.</p>
            </div>
            <video 
              src={`${API_BASE_URL}/demo-videos/${objectName}`} 
              controls 
              autoPlay 
              className="w-full max-h-[70vh] bg-black"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default BoundaryMarker;
