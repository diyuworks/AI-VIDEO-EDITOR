import React, { useState, useEffect } from "react";
import BoundaryMarker from "../components/BoundaryMarker";

const API_BASE_URL = "http://localhost:8000";

interface Point {
  x: number;
  y: number;
}

type MultiClipStage =
  | "idle"
  | "merging_clips"
  | "generating_reel"
  | "done"
  | "error";

type SingleVideoStage =
  | "idle"
  | "marking"
  | "tracking"
  | "rendering_overlay"
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
  polygonPerFrame?: number[][][]; // Cache tracked polygon for fast label updates
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
  // Shared prompt input
  const [prompt, setPrompt] = useState<string>(initialPrompt || "Real estate plot sales reel in Hindi");

  // Multi-Clip States (Always start empty for a clean workspace)
  const [multiClipStage, setMultiClipStage] = useState<MultiClipStage>("idle");
  const [multiClipVideoUrl, setMultiClipVideoUrl] = useState<string | null>(null);
  const [multiClipError, setMultiClipError] = useState<string | null>(null);
  const [uploadedClips, setUploadedClips] = useState<UploadedClip[]>([]);
  const [selectedClips, setSelectedClips] = useState<string[]>([]);
  const [clipHighlights, setClipHighlights] = useState<Record<string, ClipHighlight>>({});
  const [activeMarkingClip, setActiveMarkingClip] = useState<string | null>(null);
  const [activeMarkingLabel, setActiveMarkingLabel] = useState<string>("");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  // Single Video States
  const [singleVideoStage, setSingleVideoStage] = useState<SingleVideoStage>("idle");
  const [singleVideoUrl, setSingleVideoUrl] = useState<string | null>(null);
  const [singleVideoError, setSingleVideoError] = useState<string | null>(null);

  // Fetch uploaded clips on mount (disabled historical database fetch to start clean)
  useEffect(() => {
    // We start with a completely clean workspace, no history loaded
    setUploadedClips([]);
    setSelectedClips([]);
  }, []);

  // Handle uploading multiple raw video files (Max 10 clips limit)
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Strict validation: Max 10 clips check
    if (uploadedClips.length + files.length > 10) {
      alert(`Upload blocked: Maximum 10 raw clips allowed. Currently you have ${uploadedClips.length} clips.`);
      return;
    }

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

  // Discard a clip from the active workspace
  const handleRemoveClip = (clipName: string) => {
    setUploadedClips((prev) => prev.filter((c) => c.object_name !== clipName));
    setSelectedClips((prev) => prev.filter((c) => c !== clipName));
    setClipHighlights((prev) => {
      const next = { ...prev };
      delete next[clipName];
      return next;
    });
  };

  // Helper check: enforce plot highlight for every selected clip
  const areAllSelectedClipsHighlighted = () => {
    if (selectedClips.length === 0) return false;
    return selectedClips.every((clip) => clipHighlights[clip]?.isDone);
  };

  // Handle Multi-Clip Merge & AI Reel Generation
  const handleGenerateMultiClipReel = async () => {
    try {
      setMultiClipError(null);
      
      // Use highlighted clips instead of raw ones
      const clipsToMerge = selectedClips.map((clip) => {
        const highlight = clipHighlights[clip];
        return highlight && highlight.isDone && highlight.highlightedObjectName
          ? highlight.highlightedObjectName
          : clip;
      });

      setMultiClipStage("merging_clips");
      const mergeRes = await fetch(`${API_BASE_URL}/merge-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_object_names: clipsToMerge,
        }),
      });

      if (!mergeRes.ok) throw new Error("Multi-clip merging failed");
      const mergeData = await mergeRes.json();

      setMultiClipStage("generating_reel");
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

      setMultiClipVideoUrl(reelData.url);
      setMultiClipStage("done");
    } catch (err: any) {
      setMultiClipError(err.message || "Something went wrong during reel generation");
      setMultiClipStage("error");
    }
  };

  // Handle Single Video SAM Segmentation
  const handleBoundaryConfirmed = async (points: Point[]) => {
    try {
      setSingleVideoStage("tracking");
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

      setSingleVideoStage("rendering_overlay");
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

      setSingleVideoStage("generating_reel");
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

      setSingleVideoUrl(reelData.url);
      setSingleVideoStage("done");
    } catch (err: any) {
      setSingleVideoError(err.message || "Failed to generate reel");
      setSingleVideoStage("error");
    }
  };

  // Async tracking and rendering for an individual multi-clip
  const handleMultiClipBoundaryConfirmed = async (clipName: string, points: Point[], label: string) => {
    try {
      setClipHighlights((prev) => ({
        ...prev,
        [clipName]: {
          objectName: clipName,
          points,
          label,
          isTracking: true,
          isDone: false,
        },
      }));

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

      setClipHighlights((prev) => ({
        ...prev,
        [clipName]: {
          ...prev[clipName],
          highlightedObjectName: overlayData.output_object_name,
          polygonPerFrame: trackData.polygon_per_frame, // Cache polygon points for quick editing
          isTracking: false,
          isDone: true,
        },
      }));
    } catch (err: any) {
      console.error(`Failed to track/render overlay for ${clipName}:`, err);
      alert(`Failed to track and highlight clip: ${err.message}`);
      setClipHighlights((prev) => ({
        ...prev,
        [clipName]: {
          ...prev[clipName],
          isTracking: false,
          isDone: false,
        },
      }));
    }
  };

  // Re-renders overlay instantly when label changes in a completed clip
  const handleLabelBlur = async (clipName: string, newLabel: string) => {
    const highlight = clipHighlights[clipName];
    if (highlight && highlight.isDone && highlight.polygonPerFrame) {
      try {
        setClipHighlights((prev) => ({
          ...prev,
          [clipName]: {
            ...prev[clipName],
            isTracking: true,
            isDone: false, // temporarily clear done state while updating
          },
        }));

        const overlayRes = await fetch(`${API_BASE_URL}/render-overlay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            object_name: clipName,
            polygon_per_frame: highlight.polygonPerFrame,
            highlight_color: "#FFEB3B",
            border_thickness: 4,
            label: newLabel || undefined,
          }),
        });
        if (!overlayRes.ok) throw new Error("Overlay update failed");
        const overlayData = await overlayRes.json();

        setClipHighlights((prev) => ({
          ...prev,
          [clipName]: {
            ...prev[clipName],
            highlightedObjectName: overlayData.output_object_name,
            isTracking: false,
            isDone: true,
          },
        }));
      }
    } catch (err: any) {
      console.error(`Failed to update label for ${clipName}:`, err);
      alert(`Failed to update plot label: ${err.message}`);
      setClipHighlights((prev) => ({
        ...prev,
        [clipName]: {
          ...prev[clipName],
          isTracking: false,
          isDone: true,
        },
      }));
    }
  };

  const handleDownload = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    // Backend now provides Content-Disposition: attachment header to force download
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 space-y-12">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold text-yellow-400">Jamin 24 AI video HUB</h1>
        <p className="text-gray-400 text-sm mt-1">Stitch and highlight multiple plot clips, or segment and track a single plot video.</p>
      </div>

      {/* 🎬 SECTION 1: MULTI-CLIP REAL ESTATE REEL MERGER */}
      <section className="bg-gray-900/50 border border-gray-800 rounded-3xl p-6 space-y-6">
        <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-yellow-400 flex items-center gap-2">
              🎬 Multi-Clip Reel Merger & Highlight Workflow
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Upload, select, highlight plots, and merge together into a custom reel.</p>
          </div>
          <span className="bg-yellow-400/10 text-yellow-400 text-[10px] font-bold px-2 py-0.5 rounded border border-yellow-400/20">
            MAX 10 CLIPS
          </span>
        </div>

        {multiClipStage === "idle" && (
          <>
            {/* Upload Section */}
            <div className="bg-gray-800/40 border border-gray-800 rounded-xl p-4 flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <h3 className="font-bold text-yellow-300 text-sm">📤 Upload Raw Footage Clips</h3>
                <p className="text-xs text-gray-400 mt-0.5">Upload clips from your computer ({uploadedClips.length}/10 uploaded).</p>
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

            {/* Selection Grid */}
            {uploadedClips.length === 0 ? (
              <div className="border-2 border-dashed border-gray-800 rounded-2xl p-12 text-center text-gray-500 text-sm">
                📁 No raw footage clips uploaded yet. Upload up to 10 clips to start your merge workflow.
              </div>
            ) : (
              <div className="space-y-3">
                <label className="text-xs font-bold text-gray-400">Select Clips and Highlight Each Plot:</label>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {uploadedClips.map((clip) => {
                    const clipName = clip.object_name;
                    const isSelected = selectedClips.includes(clipName);
                    const label = clip.filename;
                    return (
                      <div
                        key={clip.id}
                        className={`p-4 pb-3 rounded-xl border flex flex-col items-center justify-between transition relative min-h-[175px] ${
                          isSelected
                            ? "border-yellow-400 bg-yellow-400/10 shadow-lg"
                            : "border-gray-800 bg-gray-800/40 opacity-60"
                        }`}
                      >
                        {/* Remove clip button */}
                        <button
                          onClick={() => handleRemoveClip(clipName)}
                          className="absolute top-2 right-2 text-gray-500 hover:text-red-400 transition text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/40"
                          title="Remove clip"
                        >
                          ✕
                        </button>

                        <div className="flex flex-col items-center text-center w-full mt-2">
                          <div className="text-xl">📍</div>
                          <span className="font-bold text-xs text-yellow-300 mt-1 truncate w-full" title={label}>
                            {label}
                          </span>
                        </div>

                        {/* Distinct Sibling Action Buttons to prevent click intercept bugs */}
                        <div className="w-full mt-3 pt-2 border-t border-gray-800/50 flex flex-col gap-2">
                          <button
                            onClick={() => {
                              if (isSelected) {
                                setSelectedClips(selectedClips.filter((c) => c !== clipName));
                              } else {
                                setSelectedClips([...selectedClips, clipName]);
                              }
                            }}
                            className={`w-full py-1 text-[10px] font-bold rounded flex items-center justify-center transition border ${
                              isSelected
                                ? "bg-yellow-400 text-black border-yellow-400 hover:bg-yellow-300"
                                : "bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700"
                            }`}
                          >
                            {isSelected ? "✅ Selected" : "⬜ Select Clip"}
                          </button>

                          {isSelected && (
                            <div className="w-full space-y-2">
                              {/* Plot name input directly inside the card */}
                              <div className="flex flex-col text-left gap-0.5">
                                <span className="text-[9px] font-bold text-gray-400">Plot Name:</span>
                                <input
                                  type="text"
                                  value={clipHighlights[clipName]?.label || label.split(".")[0]}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setClipHighlights((prev) => ({
                                      ...prev,
                                      [clipName]: {
                                        ...prev[clipName],
                                        objectName: clipName,
                                        label: val,
                                      },
                                    }));
                                  }}
                                  onBlur={(e) => handleLabelBlur(clipName, e.target.value)}
                                  placeholder="e.g. Plot A"
                                  className="bg-gray-850 border border-gray-750 rounded px-2 py-1 text-white text-[10px] w-full focus:outline-none focus:border-yellow-400"
                                />
                              </div>

                              {clipHighlights[clipName]?.isTracking ? (
                                <span className="text-[10px] text-yellow-400 animate-pulse font-mono flex items-center justify-center py-1">⏳ Tracking AI...</span>
                              ) : clipHighlights[clipName]?.isDone ? (
                                <button
                                  onClick={() => {
                                    setActiveMarkingClip(clipName);
                                    setActiveMarkingLabel(clipHighlights[clipName]?.label || label.split(".")[0]);
                                  }}
                                  className="w-full py-1 px-1 bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-300 text-[10px] font-bold rounded flex items-center justify-center truncate border border-yellow-400/30"
                                  title="Click to edit plot boundary"
                                >
                                  ✏️ Edit Plot: {clipHighlights[clipName]?.label}
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setActiveMarkingClip(clipName);
                                    setActiveMarkingLabel(clipHighlights[clipName]?.label || label.split(".")[0]);
                                  }}
                                  className="w-full py-1 bg-gray-850 hover:bg-gray-800 text-white text-[10px] font-semibold rounded flex items-center justify-center border border-gray-700"
                                >
                                  ✏️ Highlight Plot
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Voiceover Prompt Input */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                🗣️ AI Voiceover Script (Plot Names / Key Info):
              </label>
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Plot A – Road Facing, 200 sq yd"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400"
              />
            </div>

            {/* Merge Action Button with validation constraints */}
            <div className="space-y-2 pt-2">
              {selectedClips.length > 0 && !areAllSelectedClipsHighlighted() && (
                <p className="text-yellow-400 text-xs font-semibold flex items-center gap-1.5 bg-yellow-400/5 p-3 rounded-lg border border-yellow-400/20">
                  ⚠️ Validation Guard: Please mark the plot boundary for all selected clips before merging. ({selectedClips.filter(c => clipHighlights[c]?.isDone).length} of {selectedClips.length} highlighted)
                </p>
              )}
              <button
                onClick={handleGenerateMultiClipReel}
                disabled={selectedClips.length === 0 || !areAllSelectedClipsHighlighted() || isUploading}
                className="w-full py-4 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl text-lg transition shadow-xl disabled:opacity-40"
              >
                🎬 Merge {selectedClips.length} Clips & Download Reel
              </button>
            </div>
          </>
        )}

        {/* Loading display for multi-clip stages */}
        {["merging_clips", "generating_reel"].includes(multiClipStage) && (
          <div className="bg-gray-950 border border-gray-850 rounded-2xl p-12 flex flex-col items-center justify-center space-y-4 text-center">
            <div className="animate-spin h-12 w-12 border-4 border-yellow-400 border-t-transparent rounded-full" />
            <div>
              <h3 className="text-lg font-bold text-white">
                {multiClipStage === "merging_clips" && "🔄 Merging Selected Land Plot Clips..."}
                {multiClipStage === "generating_reel" && "🗣️ Generating AI Voiceover & Timed Captions..."}
              </h3>
              <p className="text-gray-500 text-xs mt-1">
                FFmpeg & Sarvam AI are rendering your brand-watermarked real-estate reel...
              </p>
            </div>
          </div>
        )}

        {/* Done display for multi-clip result */}
        {multiClipStage === "done" && multiClipVideoUrl && (
          <div className="bg-gray-950 border border-gray-850 rounded-2xl p-6 flex flex-col items-center space-y-6 text-white text-center">
            <div>
              <h2 className="text-2xl font-bold text-yellow-400">🎉 Multi-Clip Reel Ready!</h2>
              <p className="text-gray-400 text-xs mt-1">
                Includes merged clips, custom yellow plot boundaries & name tags.
              </p>
            </div>

            <video
              src={multiClipVideoUrl}
              controls
              autoPlay
              className="max-w-xs w-full rounded-2xl shadow-2xl border-2 border-yellow-400/40"
            />

            <div className="flex gap-4">
              <button
                onClick={() => handleDownload(multiClipVideoUrl)}
                className="px-8 py-3 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl transition shadow-lg flex items-center gap-2"
              >
                ⬇️ Download Reel
              </button>
              <button
                onClick={() => {
                  setMultiClipStage("idle");
                  setMultiClipVideoUrl(null);
                }}
                className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl transition"
              >
                🔄 Create Another
              </button>
            </div>
          </div>
        )}

        {/* Error state for multi-clip */}
        {multiClipStage === "error" && (
          <div className="bg-red-950/40 border border-red-900 rounded-xl p-4 text-red-200 flex flex-col items-center gap-3 text-center">
            <p className="font-semibold text-sm">Error: {multiClipError}</p>
            <button
              onClick={() => setMultiClipStage("idle")}
              className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white font-bold rounded-lg text-xs transition"
            >
              Try Again
            </button>
          </div>
        )}
      </section>

      {/* 🎯 SECTION 2: SINGLE VIDEO SAM SEGMENTATION */}
      <section className="bg-gray-900/50 border border-gray-800 rounded-3xl p-6 space-y-6">
        <div className="border-b border-gray-800 pb-3">
          <h2 className="text-xl font-bold text-yellow-400 flex items-center gap-2">
            🎯 Single Video SAM Segmentation
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Outline and track a single plot in your main uploaded video to generate a dedicated promotion.
          </p>
        </div>

        {singleVideoStage === "idle" && (
          <div className="bg-gray-800/20 border border-gray-800 rounded-2xl p-6 flex flex-col items-center gap-4 text-center">
            <div className="text-3xl">🗺️</div>
            <div>
              <h4 className="font-bold text-white text-sm">Active Video: <span className="text-yellow-400 font-mono">{rawVideoObjectName}</span></h4>
              <p className="text-xs text-gray-400 mt-1">Click to mark points directly on the frame to outline the land boundary.</p>
            </div>
            <button
              onClick={() => setSingleVideoStage("marking")}
              className="px-6 py-3 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl text-sm transition shadow-lg"
            >
              🎯 Start Plot Segmentation Canvas
            </button>
          </div>
        )}

        {singleVideoStage === "marking" && (
          <div className="bg-gray-950 p-4 rounded-2xl border border-gray-850 relative">
            <button 
              onClick={() => setSingleVideoStage("idle")}
              className="absolute top-4 right-4 text-gray-400 hover:text-white font-bold text-sm bg-gray-800/80 px-2.5 py-1 rounded-lg"
            >
              Cancel
            </button>
            <h4 className="text-sm font-bold text-yellow-400 mb-4">Click points to draw the land plot boundary:</h4>
            <BoundaryMarker
              objectName={rawVideoObjectName}
              onBoundaryConfirmed={handleBoundaryConfirmed}
            />
          </div>
        )}

        {/* Loading display for single video */}
        {["tracking", "rendering_overlay", "generating_reel"].includes(singleVideoStage) && (
          <div className="bg-gray-950 border border-gray-850 rounded-2xl p-12 flex flex-col items-center justify-center space-y-4 text-center">
            <div className="animate-spin h-12 w-12 border-4 border-yellow-400 border-t-transparent rounded-full" />
            <div>
              <h3 className="text-lg font-bold text-white">
                {singleVideoStage === "tracking" && "🎯 Tracking Plot Boundary with AI..."}
                {singleVideoStage === "rendering_overlay" && "🎨 Rendering Highlight Overlay..."}
                {singleVideoStage === "generating_reel" && "🗣️ Generating AI Voiceover & Timed Captions..."}
              </h3>
              <p className="text-gray-500 text-xs mt-1">
                AI and FFmpeg are processing your single video reel...
              </p>
            </div>
          </div>
        )}

        {/* Done display for single video */}
        {singleVideoStage === "done" && singleVideoUrl && (
          <div className="bg-gray-950 border border-gray-850 rounded-2xl p-6 flex flex-col items-center space-y-6 text-white text-center">
            <div>
              <h2 className="text-2xl font-bold text-yellow-400">🎉 Dedicated Plot Reel Ready!</h2>
              <p className="text-gray-400 text-xs mt-1">
                Includes the outline highlights, voiceover, and brand watermark overlay.
              </p>
            </div>

            <video
              src={singleVideoUrl}
              controls
              autoPlay
              className="max-w-xs w-full rounded-2xl shadow-2xl border-2 border-yellow-400/40"
            />

            <div className="flex gap-4">
              <button
                onClick={() => handleDownload(singleVideoUrl)}
                className="px-8 py-3 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl transition shadow-lg flex items-center gap-2"
              >
                ⬇️ Download Reel
              </button>
              <button
                onClick={() => {
                  setSingleVideoStage("idle");
                  setSingleVideoUrl(null);
                }}
                className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl transition"
              >
                🔄 Create Another
              </button>
            </div>
          </div>
        )}

        {/* Error state for single video */}
        {singleVideoStage === "error" && (
          <div className="bg-red-950/40 border border-red-900 rounded-xl p-4 text-red-200 flex flex-col items-center gap-3 text-center">
            <p className="font-semibold text-sm">Error: {singleVideoError}</p>
            <button
              onClick={() => setSingleVideoStage("idle")}
              className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white font-bold rounded-lg text-xs transition"
            >
              Try Again
            </button>
          </div>
        )}
      </section>

      {/* Multi-clip individual boundary marking modal popup */}
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
            
            <div className="mb-5 flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-300">Plot Label / Name:</label>
              <input
                type="text"
                value={activeMarkingLabel}
                onChange={(e) => setActiveMarkingLabel(e.target.value)}
                placeholder="e.g. Plot A / Road Face"
                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 text-sm w-full max-w-sm"
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
