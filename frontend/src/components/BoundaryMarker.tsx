import React, { useRef, useState, useEffect } from "react";

interface Point {
  x: number;
  y: number;
}

interface BoundaryMarkerProps {
  objectName: string;
  onBoundaryConfirmed: (points: Point[]) => void;
}

const API_BASE_URL = "http://localhost:8000"; // baad mein .env se lenge

const BoundaryMarker: React.FC<BoundaryMarkerProps> = ({ objectName, onBoundaryConfirmed }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Step A: Backend se frame image load karo
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

  // Step B: Canvas pe image + points draw karo
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Image draw karo
    ctx.drawImage(img, 0, 0);

    // Points aur connecting lines draw karo
    if (points.length > 0) {
      ctx.strokeStyle = "#FFEB3B"; // yellow, jaisa reference video mein tha
      ctx.lineWidth = 4;
      ctx.fillStyle = "rgba(255, 235, 59, 0.3)"; // semi-transparent fill

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.forEach((point) => ctx.lineTo(point.x, point.y));
      if (points.length > 2) ctx.closePath();
      ctx.stroke();
      if (points.length > 2) ctx.fill();

      // Har point pe ek chhota circle dikhao
      points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = "#FFEB3B";
        ctx.fill();
      });
    }
  };

  useEffect(() => {
    drawCanvas();
  }, [points]);

  // Step C: Click handler — naya point add karo
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Scale factor, kyunki canvas display size aur actual image size alag ho sakti hai
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setPoints((prev) => [...prev, { x, y }]);
  };

  // Step D: Last point undo karo
  const handleUndo = () => {
    setPoints((prev) => prev.slice(0, -1));
  };

  // Step E: Sab clear karo
  const handleReset = () => {
    setPoints([]);
  };

  // Step F: Confirm karo aur parent ko bhejo
  const handleConfirm = () => {
    if (points.length < 3) {
      alert("Kam se kam 3 points chahiye ek boundary banane ke liye");
      return;
    }
    onBoundaryConfirmed(points);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <h2 className="text-lg font-semibold">Plot ki Boundary Mark Karo</h2>
      <p className="text-sm text-gray-500">
        Image pe click karke plot ke corners mark karo (kam se kam 3 points)
      </p>

      {!imageLoaded && <p>Frame load ho raha hai...</p>}

      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="border rounded-lg cursor-crosshair max-w-full"
        style={{ maxHeight: "600px" }}
      />

      <div className="flex gap-3">
        <button onClick={handleUndo} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg border border-gray-600 transition">
          ↩ Undo
        </button>
        <button onClick={handleReset} className="px-4 py-2 bg-red-900/60 hover:bg-red-800 text-red-300 font-semibold rounded-lg border border-red-700/50 transition">
          🗑 Reset
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 bg-yellow-400 font-semibold rounded-lg"
        >
          Confirm Boundary ({points.length} points)
        </button>
      </div>
    </div>
  );
};

export default BoundaryMarker;
