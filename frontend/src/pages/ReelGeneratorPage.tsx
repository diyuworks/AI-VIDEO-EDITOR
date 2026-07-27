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
  | "merging_clips"
  | "generating_reel"
  | "done"
  | "error";

interface ReelGeneratorPageProps {
  rawVideoObjectName?: string;
  prompt?: string;
}

const ReelGeneratorPage: React.FC<ReelGeneratorPageProps> = ({
  rawVideoObjectName = "clip_1.mp4",
  prompt: initialPrompt = "",
}) => {
  const [activeTab, setActiveTab] = useState<"multi_clip" | "single_video">("multi_clip");
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [prompt, setPrompt] = useState<string>(initialPrompt || "Real estate plot sales reel in Hindi");
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Selected clips for multi-clip demo
  const [selectedClips, setSelectedClips] = useState<string[]>([
    "clip_1.mp4",
    "clip_2.mp4",
    "clip_3.mp4",
    "clip_4.mp4",
    "clip_5.mp4",
  ]);

  // Handle Multi-Clip Merge & AI Reel Generation
  const handleGenerateMultiClipReel = async () => {
    try {
      setErrorMessage(null);
      
      // Step 1: Merge multi-clips into single stream
      setStage("merging_clips");
      const mergeRes = await fetch(`${API_BASE_URL}/merge-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_object_names: selectedClips,
        }),
      });

      if (!mergeRes.ok) throw new Error("Multi-clip merging failed");
      const mergeData = await mergeRes.json();

      // Step 2: Generate AI Script, Voiceover, Captions & Merge Audio/Video
      setStage("generating_reel");
      const reelRes = await fetch(`${API_BASE_URL}/generate-reel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_video_object_name: mergeData.merged_object_name,
          highlighted_video_object_name: mergeData.merged_object_name,
          prompt: prompt,
        }),
      });

      if (!reelRes.ok) throw new Error("AI Reel generation failed");
      const reelData = await reelRes.json();

      setFinalVideoUrl(reelData.url);
      setStage("done");
    } catch (err: any) {
      setErrorMessage(err.message || "Something went wrong during reel generation");
      setStage("error");
    }
  };

  const handleBoundaryConfirmed = async (points: Point[]) => {
    try {
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
      setErrorMessage(err.message || "Failed to generate reel");
      setStage("error");
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Navigation Tabs */}
      <div className="flex justify-center border-b border-gray-700 pb-3 gap-6">
        <button
          onClick={() => {
            setActiveTab("multi_clip");
            setStage("idle");
          }}
          className={`px-5 py-2 font-semibold rounded-lg transition ${
            activeTab === "multi_clip"
              ? "bg-yellow-400 text-black shadow-lg"
              : "text-gray-400 hover:text-white"
          }`}
        >
          🎬 Multi-Clip Real Estate Reel Merger
        </button>
        <button
          onClick={() => {
            setActiveTab("single_video");
            setStage("marking");
          }}
          className={`px-5 py-2 font-semibold rounded-lg transition ${
            activeTab === "single_video"
              ? "bg-yellow-400 text-black shadow-lg"
              : "text-gray-400 hover:text-white"
          }`}
        >
          🎯 Single Video SAM Segmentation
        </button>
      </div>

      {/* MULTI-CLIP DEMO MODE */}
      {activeTab === "multi_clip" && (stage === "idle" || stage === "error") && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-white space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-yellow-400">
              Real Estate Multi-Clip Reel Generator
            </h2>
            <p className="text-gray-400 text-sm mt-1">
              Select land plot clips to stitch together into a seamless 9:16 vertical Reel with AI voiceover and captions.
            </p>
          </div>

          {/* Clip Grid */}
          <div className="grid grid-cols-5 gap-3">
            {["PLOT A", "PLOT B", "PLOT C", "PLOT D", "PLOT E"].map((label, idx) => {
              const clipName = `clip_${idx + 1}.mp4`;
              const isSelected = selectedClips.includes(clipName);
              return (
                <div
                  key={clipName}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedClips(selectedClips.filter((c) => c !== clipName));
                    } else {
                      setSelectedClips([...selectedClips, clipName]);
                    }
                  }}
                  className={`cursor-pointer p-4 rounded-xl border flex flex-col items-center justify-center transition ${
                    isSelected
                      ? "border-yellow-400 bg-yellow-400/10 shadow-lg"
                      : "border-gray-800 bg-gray-800/40 opacity-60"
                  }`}
                >
                  <div className="text-xl">📍</div>
                  <span className="font-bold text-sm text-yellow-300 mt-1">{label}</span>
                  <span className="text-xs text-gray-400 mt-1">4 Sec Clip</span>
                </div>
              );
            })}
          </div>

          {/* Prompt Input */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">
              AI Voiceover Prompt & Theme:
            </label>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. High energy Hindi real-estate plot sales pitch"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-400"
            />
          </div>

          {/* Action Button */}
          <button
            onClick={handleGenerateMultiClipReel}
            disabled={selectedClips.length === 0}
            className="w-full py-4 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl text-lg transition shadow-xl disabled:opacity-50"
          >
            🚀 Merge {selectedClips.length} Clips & Generate AI Voiceover Reel
          </button>
        </div>
      )}

      {/* SINGLE VIDEO MODE */}
      {activeTab === "single_video" && stage === "marking" && (
        <BoundaryMarker
          objectName={rawVideoObjectName}
          onBoundaryConfirmed={handleBoundaryConfirmed}
        />
      )}

      {/* LOADING STAGE DISPLAY */}
      {["merging_clips", "tracking", "rendering_overlay", "generating_reel"].includes(stage) && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 flex flex-col items-center justify-center space-y-4 text-center">
          <div className="animate-spin h-12 w-12 border-4 border-yellow-400 border-t-transparent rounded-full" />
          <div>
            <h3 className="text-xl font-bold text-white">
              {stage === "merging_clips" && "🔄 Merging Selected Land Plot Clips..."}
              {stage === "tracking" && "🎯 Tracking Plot Boundary with AI..."}
              {stage === "rendering_overlay" && "🎨 Rendering Highlight Overlay..."}
              {stage === "generating_reel" && "🗣️ Generating AI Voiceover & Timed Captions..."}
            </h3>
            <p className="text-gray-400 text-sm mt-1">
              FFmpeg & Sarvam AI are processing your real-estate promotional reel...
            </p>
          </div>
        </div>
      )}

      {/* DONE STAGE - SHOW FINAL REEL */}
      {stage === "done" && finalVideoUrl && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col items-center space-y-6 text-white">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-yellow-400">🎉 Your Real Estate Reel is Ready!</h2>
            <p className="text-gray-400 text-sm mt-1">
              Includes merged landmark clips, yellow plot highlights, AI Voiceover & timed captions.
            </p>
          </div>

          <video
            src={finalVideoUrl}
            controls
            autoPlay
            className="max-w-md w-full rounded-2xl shadow-2xl border-2 border-yellow-400/40"
          />

          <div className="flex gap-4">
            <a
              href={finalVideoUrl}
              download="Real_Estate_Reel.mp4"
              className="px-8 py-3 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl transition shadow-lg flex items-center gap-2"
            >
              ⬇️ Download Reel
            </a>
            <button
              onClick={() => {
                setStage("idle");
                setFinalVideoUrl(null);
              }}
              className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl transition"
            >
              🔄 Create Another
            </button>
          </div>
        </div>
      )}

      {/* ERROR STAGE */}
      {stage === "error" && (
        <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 text-red-200 flex flex-col items-center gap-3 text-center">
          <p className="font-semibold">Error: {errorMessage}</p>
          <button
            onClick={() => setStage("idle")}
            className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white font-bold rounded-lg text-sm transition"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
};

export default ReelGeneratorPage;
