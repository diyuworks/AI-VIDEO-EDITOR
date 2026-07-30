import React, { useRef, useState, useEffect } from "react";

interface Point {
  x: number;
  y: number;
}

interface BoundaryMarkerProps {
  objectName: string;
  onBoundaryConfirmed: (points: Point[]) => void;
}

import { API_BASE_URL } from "../config";

const BoundaryMarker: React.FC<BoundaryMarkerProps> = ({ objectName, onBoundaryConfirmed }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `${API_BASE_URL}/extract-frame/${objectName}?timestamp=0`;
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
      drawCanvas();
    };
  }, [objectName]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, 0, 0);

    if (points.length > 0) {
      ctx.strokeStyle = "#FFEB3B";
      ctx.lineWidth = 4;
      ctx.fillStyle = "rgba(255, 235, 59, 0.35)";

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.forEach((point) => ctx.lineTo(point.x, point.y));
      if (points.length > 2) ctx.closePath();
      ctx.stroke();
      if (points.length > 2) ctx.fill();

      points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 7, 0, 2 * Math.PI);
        ctx.fillStyle = "#FFEB3B";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000000";
        ctx.stroke();
      });
    }
  };

  useEffect(() => {
    drawCanvas();
  }, [points]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setPoints((prev) => [...prev, { x, y }]);
  };

  const handleUndo = () => {
    setPoints((prev) => prev.slice(0, -1));
  };

  const handleReset = () => {
    setPoints([]);
  };

  const handleConfirm = () => {
    if (points.length < 3) {
      alert("Kam se kam 3 points chahiye ek boundary banane ke liye");
      return;
    }
    onBoundaryConfirmed(points);
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="text-center space-y-1">
        <h4 className="text-sm sm:text-base font-black text-[#0D473B] uppercase tracking-wider">
          📍 Click Corners to Mark Land Plot Boundary
        </h4>
        <p className="text-xs sm:text-sm text-slate-600 font-semibold">
          Click corners along the edges of the land plot (minimum 3 points required)
        </p>
      </div>

      {!imageLoaded && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-5 py-3 rounded-2xl animate-pulse">
          <div className="animate-spin h-4 w-4 border-2 border-[#0D473B] border-t-transparent rounded-full" />
          Loading video frame image...
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden border-2 border-[#0D473B]/20 shadow-2xl bg-slate-900 w-full flex justify-center">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="cursor-crosshair max-w-full rounded-xl"
          style={{ maxHeight: "480px" }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          onClick={handleUndo}
          className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-2xl border border-slate-300 transition text-sm flex items-center gap-2 shadow-sm"
        >
          ↩ Undo Point
        </button>
        <button
          onClick={handleReset}
          className="px-5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-2xl border border-rose-200 transition text-sm flex items-center gap-2 shadow-sm"
        >
          🗑 Reset All
        </button>
        <button
          onClick={handleConfirm}
          className="px-7 py-3 bg-[#0D473B] hover:bg-[#09352C] text-white font-black rounded-2xl shadow-xl shadow-[#0D473B]/20 text-sm sm:text-base transition flex items-center gap-2.5"
        >
          ✅ Confirm Boundary ({points.length} Points Marked)
        </button>
      </div>
    </div>
  );
};

export default BoundaryMarker;
