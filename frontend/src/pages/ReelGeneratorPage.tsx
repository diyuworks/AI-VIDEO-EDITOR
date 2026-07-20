import React, { useState } from "react";
import BoundaryMarker from "../components/BoundaryMarker";

const API_BASE_URL = "http://localhost:8000";

interface Point {
  x: number;
  y: number;
}

type ProcessingStage =
  | "idle"
  | "marking"
  | "tracking"
  | "rendering_overlay"
  | "generating_reel"
  | "done"
  | "error";

interface ReelGeneratorPageProps {
  rawVideoObjectName: string;
  prompt?: string;
}

const ReelGeneratorPage: React.FC<ReelGeneratorPageProps> = ({
  rawVideoObjectName,
  prompt,
}) => {
  const [stage, setStage] = useState<ProcessingStage>("marking");
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleBoundaryConfirmed = async (points: Point[]) => {
    try {
      // Step A: Track boundary
      setStage("tracking");
      const trackRes = await fetch(`${API_BASE_URL}/track-boundary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_name: rawVideoObjectName,
          initial_points: points,
        }),
      });
      if (!trackRes.ok) throw new Error("Boundary tracking failed");
      const trackData = await trackRes.json();

      // Step B: Render overlay
      setStage("rendering_overlay");
      const overlayRes = await fetch(`${API_BASE_URL}/render-overlay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_name: rawVideoObjectName,
          polygon_per_frame: trackData.polygon_per_frame,
          highlight_color: "#FFEB3B",
          border_thickness: 4,
        }),
      });
      if (!overlayRes.ok) throw new Error("Overlay rendering failed");
      const overlayData = await overlayRes.json();

      // Step C: Generate final reel (script + voiceover + captions + merge)
      setStage("generating_reel");
      const reelRes = await fetch(`${API_BASE_URL}/generate-reel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_video_object_name: rawVideoObjectName,
          highlighted_video_object_name: overlayData.output_object_name,
          prompt: prompt || "",
        }),
      });
      if (!reelRes.ok) throw new Error("Reel generation failed");
      const reelData = await reelRes.json();

      setFinalVideoUrl(reelData.url);
      setStage("done");
    } catch (err: any) {
      setErrorMessage(err.message || "Kuch galat ho gaya");
      setStage("error");
    }
  };

  // ---- Render: Stage ke hisaab se UI dikhao ----

  if (stage === "marking") {
    return (
      <BoundaryMarker
        objectName={rawVideoObjectName}
        onBoundaryConfirmed={handleBoundaryConfirmed}
      />
    );
  }

  if (["tracking", "rendering_overlay", "generating_reel"].includes(stage)) {
    const messages: Record<string, string> = {
      tracking: "Plot boundary ko track kiya ja raha hai...",
      rendering_overlay: "Highlight overlay banaya ja raha hai...",
      generating_reel: "AI voiceover aur captions ke saath final reel ban rahi hai... (thoda time lagega)",
    };
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <div className="animate-spin h-10 w-10 border-4 border-yellow-400 border-t-transparent rounded-full" />
        <p className="text-gray-600">{messages[stage]}</p>
      </div>
    );
  }

  if (stage === "done" && finalVideoUrl) {
    return (
      <div className="flex flex-col items-center gap-4">
        <h2 className="text-xl font-semibold">Reel Ready! 🎉</h2>
        <video
          src={finalVideoUrl}
          controls
          className="max-w-md rounded-lg shadow-lg"
        />
        
        <a
          href={finalVideoUrl}
          download
          className="px-6 py-2 bg-yellow-400 font-semibold rounded-lg"
        >
          Download Reel
        </a>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="text-red-600">
        <p>Error: {errorMessage}</p>
        <button onClick={() => setStage("marking")} className="underline">
          Dobara Try Karo
        </button>
      </div>
    );
  }

  return null;
};

export default ReelGeneratorPage;
