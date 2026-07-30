import React, { useRef, useState, useEffect } from "react";

interface Point {
  x: number;
  y: number;
}

interface BoundaryMarkerProps {
  objectName: string;
  onBoundaryConfirmed: (points: Point[]) => void;
  onSaveAndFinish?: (points: Point[]) => void;
  confirmButtonText?: string;
}

import { API_BASE_URL } from "../config";

const BoundaryMarker: React.FC<BoundaryMarkerProps> = ({ 
  objectName, 
  onBoundaryConfirmed, 
  onSaveAndFinish,
  confirmButtonText = "➕ Save & Add Another Highlight" 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

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
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.forEach((p) => ctx.lineTo(p.x, p.y));
      if (points.length > 2) ctx.closePath();
      ctx.fillStyle = "rgba(255, 235, 59, 0.22)";
      ctx.fill();
      ctx.shadowColor = "#FFEB3B";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = "#FFEB3B";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.forEach((p) => ctx.lineTo(p.x, p.y));
      if (points.length > 2) ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (points.length > 1) {
        ctx.beginPath();
        ctx.setLineDash([7, 5]);
        ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.lineTo(points[0].x, points[0].y);
        ctx.strokeStyle = "rgba(255,235,59,0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
    if (points.length < 3) {
      alert("Please mark at least 3 corner points to define the plot boundary!");
      return;
    }
    onBoundaryConfirmed(points);
    setPoints([]);
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

      <div className="relative rounded-2xl overflow-hidden border-2 border-slate-200/50 shadow-xl bg-[#0a0f1c] w-full py-6 flex items-center justify-center min-h-[300px]">
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0f1c] z-10 gap-3">
            <div className="animate-spin h-10 w-10 border-4 border-amber-400 border-t-transparent rounded-full" />
            <p className="text-slate-300 text-sm font-semibold">Loading video frame...</p>
          </div>
        )}
        {imageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0f1c] z-10 gap-2 p-6 text-center">
            <p className="text-white text-sm font-bold">Could not load video frame</p>
            <p className="text-slate-400 text-xs">Make sure backend is running and file is uploaded.</p>
          </div>
        )}
        {points.length === 0 && imageLoaded && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
            <div className="bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-4 py-2 rounded-2xl border border-white/20 shadow-xl">
              Click on plot corners to mark boundary
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="cursor-crosshair block rounded-xl shadow-2xl"
          style={{ maxWidth: "100%", maxHeight: "600px", width: "auto", height: "auto" }}
        />
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
        <button
          onClick={handleConfirm}
          disabled={points.length < 3}
          className="flex-[2] px-4 py-3 bg-[#0D473B] hover:bg-[#09352C] text-white font-black rounded-2xl shadow-xl shadow-[#0D473B]/20 text-sm transition flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>{confirmButtonText}</span>
          <span className="text-xs font-medium text-emerald-200">({points.length} Points Marked)</span>
        </button>

        {onSaveAndFinish && (
          <button
            onClick={() => {
              if (points.length < 3) {
                alert("Please mark at least 3 corner points to define the plot boundary!");
                return;
              }
              onSaveAndFinish(points);
              setPoints([]);
            }}
            disabled={points.length < 3}
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
