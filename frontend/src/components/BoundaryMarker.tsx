import React, { useRef, useState, useEffect } from "react";

interface Point {
  x: number;
  y: number;
}

interface BoundaryMarkerProps {
  objectName: string;
  onSaveAndFinish?: (points: Point[]) => void;
  onSaveAndAddAnother?: (points: Point[]) => void;
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
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    setPoints([]);
    setImageLoaded(false);
    setImageError(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `${API_BASE_URL}/extract-frame/${objectName}?timestamp=0`;
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => setImageError(true);
  }, [objectName]);

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
      ctx.shadowColor = "#FFEB3B";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = "#FFEB3B";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw numbered point markers
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

  return (
    <div className="flex flex-col gap-4 w-full mt-4">
      <div className="flex flex-col items-center justify-center text-center gap-1 mb-2">
        <h4 className="text-sm font-black text-[#0D473B] uppercase tracking-widest flex items-center gap-2">
          📍 CLICK CORNERS TO MARK LAND PLOT BOUNDARY
        </h4>
        <p className="text-xs text-slate-500 font-medium">
          Click on the video frame to mark points for the highlight (minimum 3 points required)
        </p>
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
        <div className={`rounded-2xl overflow-auto border-2 border-emerald-100 shadow-inner bg-slate-100/50 w-full h-[50vh] min-h-[300px] flex ${zoomLevel > 1 ? 'items-start justify-center' : 'items-center justify-center'}`}>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="cursor-crosshair block rounded-xl shadow-2xl transition-transform"
            style={{ 
              height: zoomLevel === 1 ? "50vh" : `${zoomLevel * 50}vh`,
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
              onSaveAndAddAnother(points);
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
              onSaveAndFinish(points);
              setPoints([]);
            }}
            disabled={points.length < 1}
            className="flex-[2] px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl shadow-xl shadow-emerald-600/30 text-sm transition flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>🚀 Save & Process Now</span>
            <span className="text-xs font-medium text-emerald-100">({points.length} Points Marked)</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default BoundaryMarker;
