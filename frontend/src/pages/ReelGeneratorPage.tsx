import React, { useState, useEffect } from "react";
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
  referenceObjectName?: string | null;
  prompt?: string;
}

interface ClipHighlight {
  objectName: string;
  points?: Point[];
  label?: string;
  highlightedObjectName?: string;
  isTracking?: boolean;
  isDone?: boolean;
}

interface UploadedClip {
  id: number;
  filename: string;
  object_name: string;
  url: string;
}

const ReelGeneratorPage: React.FC<ReelGeneratorPageProps> = ({
  rawVideoObjectName = "clip_1.mp4",
  referenceObjectName = null,
  prompt: initialPrompt = "",
}) => {
  const [activeTab, setActiveTab] = useState<"multi_clip" | "single_video">("multi_clip");
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [prompt, setPrompt] = useState<string>(initialPrompt || "Real estate plot sales reel in Hindi");
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Custom highlights & labels for each multi-clip
  const [clipHighlights, setClipHighlights] = useState<Record<string, ClipHighlight>>({});
  const [activeMarkingClip, setActiveMarkingClip] = useState<string | null>(null);
  const [activeMarkingLabel, setActiveMarkingLabel] = useState<string>("");

  // Uploaded clips and progress states
  const [uploadedClips, setUploadedClips] = useState<UploadedClip[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  // Selected clips for multi-clip merging
  const [selectedClips, setSelectedClips] = useState<string[]>([]);

  // Fetch uploaded clips on mount
  useEffect(() => {
    fetchUploadedClips();
  }, []);

  const fetchUploadedClips = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/videos`);
      if (res.ok) {
        const data = await res.json();
        setUploadedClips(data);
        // Select first 5 clips by default if any exist
        if (data.length > 0) {
          setSelectedClips(data.slice(0, 5).map((c: UploadedClip) => c.object_name));
        }
      }
    } catch (err) {
      console.error("Failed to fetch clips:", err);
    }
  };

  // Handle uploading multiple raw video files
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const newClips: UploadedClip[] = [];
    const newlySelected: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(`Uploading ${file.name} (${i + 1}/${files.length})...`);

        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`${API_BASE_URL}/upload`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || `Upload failed for ${file.name}`);
        }

        const data = await res.json();
        const clip: UploadedClip = {
          id: data.id,
          filename: data.filename,
          object_name: data.object_name,
          url: data.url,
        };
        newClips.push(clip);
        newlySelected.push(data.object_name);
      }

      setUploadedClips((prev) => [...newClips, ...prev]);
      setSelectedClips((prev) => [...newlySelected, ...prev]);
      setUploadProgress("Upload complete! 🎉");
      setTimeout(() => setUploadProgress(""), 2000);
    } catch (err: any) {
      console.error("Upload error:", err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Handle Multi-Clip Merge & AI Reel Generation
  const handleGenerateMultiClipReel = async () => {
    try {
      setErrorMessage(null);
      
      // Step 1: Use highlighted clips if available, else fallback to raw clips
      const clipsToMerge = selectedClips.map(clip => {
        const highlight = clipHighlights[clip];
        return (highlight && highlight.isDone && highlight.highlightedObjectName) 
          ? highlight.highlightedObjectName 
          : clip;
      });

      setStage("merging_clips");
      const mergeRes = await fetch(`${API_BASE_URL}/merge-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_object_names: clipsToMerge,
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
          reference_object_name: referenceObjectName || null,
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

  // Async tracking and rendering for an individual multi-clip
  const handleMultiClipBoundaryConfirmed = async (clipName: string, points: Point[], label: string) => {
    try {
      setClipHighlights(prev => ({
        ...prev,
        [clipName]: {
          objectName: clipName,
          points,
          label,
          isTracking: true,
          isDone: false,
        }
      }));

      // 1. Call track-boundary
      const trackRes = await fetch(`${API_BASE_URL}/track-boundary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_name: clipName,
          initial_points: points,
        }),
      });
      if (!trackRes.ok) throw new Error("Boundary tracking failed");
      const trackData = await trackRes.json();

      // 2. Call render-overlay (passing the label for the text box overlay)
      const overlayRes = await fetch(`${API_BASE_URL}/render-overlay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_name: clipName,
          polygon_per_frame: trackData.polygon_per_frame,
          highlight_color: "#FFEB3B",
          border_thickness: 4,
          label: label || undefined,
        }),
      });
      if (!overlayRes.ok) throw new Error("Overlay rendering failed");
      const overlayData = await overlayRes.json();

      setClipHighlights(prev => ({
        ...prev,
        [clipName]: {
          ...prev[clipName],
          highlightedObjectName: overlayData.output_object_name,
          isTracking: false,
          isDone: true,
        }
      }));
    } catch (err: any) {
      console.error(`Failed to track/render overlay for ${clipName}:`, err);
      alert(`Failed to track and highlight clip: ${err.message}`);
      setClipHighlights(prev => ({
        ...prev,
        [clipName]: {
          ...prev[clipName],
          isTracking: false,
          isDone: false,
        }
      }));
    }
  };

  const handleDownload = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "Final_Reel.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed:", error);
      window.open(url, "_blank");
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
              Upload raw footage clips, select which ones to stitch together, draw Highlights and name plots for each clip.
            </p>
          </div>

          {/* Upload Section */}
          <div className="bg-gray-800/40 border border-gray-800 rounded-xl p-4 flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
              <h3 className="font-bold text-yellow-300">📤 Upload Raw Footage Clips</h3>
              <p className="text-xs text-gray-400 mt-0.5">Upload one or more .mp4 files from your computer.</p>
            </div>
            <div className="relative">
              <input
                type="file"
                multiple
                accept="video/*"
                onChange={handleFileUpload}
                disabled={isUploading}
                className="hidden"
                id="raw-clip-upload"
              />
              <label
                htmlFor="raw-clip-upload"
                className={`px-6 py-3 font-semibold rounded-xl text-sm transition cursor-pointer flex items-center gap-2 ${
                  isUploading 
                    ? "bg-gray-700 text-gray-500 cursor-not-allowed" 
                    : "bg-yellow-400 hover:bg-yellow-300 text-black shadow-lg"
                }`}
              >
                {isUploading ? "⏳ Uploading..." : "📂 Select Video Files"}
              </label>
            </div>
          </div>

          {uploadProgress && (
            <div className="bg-yellow-400/10 border border-yellow-400/20 text-yellow-300 px-4 py-2 rounded-lg text-xs font-mono animate-pulse">
              {uploadProgress}
            </div>
          )}

          {/* Clip Grid */}
          {uploadedClips.length === 0 ? (
            <div className="border-2 border-dashed border-gray-800 rounded-2xl p-12 text-center text-gray-500 text-sm">
              📁 No raw footages uploaded yet. Use the upload button above to add raw clips.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {uploadedClips.map((clip) => {
                const clipName = clip.object_name;
                const isSelected = selectedClips.includes(clipName);
                const label = clip.filename;
                return (
                  <div
                    key={clip.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedClips(selectedClips.filter((c) => c !== clipName));
                      } else {
                        setSelectedClips([...selectedClips, clipName]);
                      }
                    }}
                    className={`cursor-pointer p-4 pb-3 rounded-xl border flex flex-col items-center justify-between transition relative min-h-[145px] ${
                      isSelected
                        ? "border-yellow-400 bg-yellow-400/10 shadow-lg"
                        : "border-gray-800 bg-gray-800/40 opacity-60"
                    }`}
                  >
                    <div className="flex flex-col items-center text-center w-full">
                      <div className="text-xl">📍</div>
                      <span className="font-bold text-xs text-yellow-300 mt-1 truncate w-full" title={label}>
                        {label}
                      </span>
                      <span className="text-[10px] text-gray-500 truncate w-full mt-0.5">Custom Clip</span>
                    </div>

                    {isSelected && (
                      <div className="w-full mt-2 pt-2 border-t border-gray-800/50 flex flex-col items-center">
                        {clipHighlights[clipName]?.isTracking ? (
                          <span className="text-[10px] text-yellow-400 animate-pulse font-mono">⏳ Tracking AI...</span>
                        ) : clipHighlights[clipName]?.isDone ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMarkingClip(clipName);
                              setActiveMarkingLabel(clipHighlights[clipName]?.label || label.split(".")[0]);
                            }}
                            className="w-full py-1 px-1 bg-yellow-400 hover:bg-yellow-300 text-black text-[10px] font-bold rounded flex items-center justify-center truncate"
                            title="Click to edit plot boundary"
                          >
                            ✅ {clipHighlights[clipName]?.label || "Highlighted"}
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMarkingClip(clipName);
                              setActiveMarkingLabel(label.split(".")[0]);
                            }}
                            className="w-full py-1 bg-gray-800 hover:bg-gray-700 text-white text-[10px] font-semibold rounded flex items-center justify-center"
                          >
                            ✏️ Highlight Plot
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

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
            <button
              onClick={() => handleDownload(finalVideoUrl)}
              className="px-8 py-3 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl transition shadow-lg flex items-center gap-2"
            >
              ⬇️ Download Reel
            </button>
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

      {/* Multi-clip individual boundary marking modal */}
      {activeMarkingClip && (
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-8 overflow-y-auto">
          <div className="w-full max-w-4xl bg-gray-950 p-6 rounded-2xl border border-gray-800 shadow-2xl relative">
            <button 
              onClick={() => setActiveMarkingClip(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white font-bold text-xl px-2 py-1"
            >
              ✕
            </button>
            <h3 className="text-xl font-bold text-yellow-400 mb-2">
              Mark Land Plot Boundary for {activeMarkingClip}
            </h3>
            <p className="text-gray-400 text-xs mb-5">
              Click points along the edges of the plot to define the boundary, and type a plot label/name to display.
            </p>
            
            <div className="mb-5 flex flex-col gap-1.5 text-black">
              <label className="text-xs font-semibold text-gray-300">Plot Label / Name:</label>
              <input
                type="text"
                value={activeMarkingLabel}
                onChange={(e) => setActiveMarkingLabel(e.target.value)}
                placeholder="e.g. Plot A / Road Face"
                className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-black focus:outline-none focus:border-yellow-400 text-sm w-full max-w-sm"
              />
            </div>
            
            <BoundaryMarker
              objectName={activeMarkingClip}
              onBoundaryConfirmed={async (points) => {
                const clipName = activeMarkingClip;
                const label = activeMarkingLabel;
                setActiveMarkingClip(null);
                await handleMultiClipBoundaryConfirmed(clipName, points, label);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ReelGeneratorPage;
