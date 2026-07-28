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
  enableFarmhouse?: boolean;
  enableFountain?: boolean;
  textPosition?: string;
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

  // New Real Estate Reel Effects Controls
  const [enableFarmhouse, setEnableFarmhouse] = useState<boolean>(false);
  const [enableFountain, setEnableFountain] = useState<boolean>(false);
  const [textPosition, setTextPosition] = useState<string>("middle");

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
          enable_farmhouse_overlay: enableFarmhouse,
          enable_fountain_overlay: enableFountain,
          text_position: textPosition,
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
  const handleMultiClipBoundaryConfirmed = async (
    clipName: string,
    points: Point[],
    label: string,
    farmhouse: boolean = false,
    fountain: boolean = false,
    txtPos: string = "middle"
  ) => {
    try {
      setClipHighlights((prev) => ({
        ...prev,
        [clipName]: {
          objectName: clipName,
          points,
          label,
          enableFarmhouse: farmhouse,
          enableFountain: fountain,
          textPosition: txtPos,
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
          enable_farmhouse_overlay: farmhouse,
          enable_fountain_overlay: fountain,
          text_position: txtPos,
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
            enable_farmhouse_overlay: highlight.enableFarmhouse || false,
            enable_fountain_overlay: highlight.enableFountain || false,
            text_position: highlight.textPosition || "middle",
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
    <div className="w-full max-w-5xl mx-auto p-2 sm:p-4 space-y-10 font-sans">
      <div className="border-4 sm:border-[6px] border-[#0D473B] rounded-[28px] sm:rounded-[40px] p-4 sm:p-8 md:p-10 bg-[#f8fcfb] shadow-2xl relative space-y-6 sm:space-y-8 w-full overflow-hidden">
        {/* 🌟 HERO HEADER */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-3 sm:gap-6 text-center md:text-left">
          <img src="/logo.jpg" alt="Jamin24 Logo" className="w-28 sm:w-32 md:w-44 object-contain shrink-0 mix-blend-multiply" />
          <div className="space-y-2 sm:space-y-3">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-[#0D473B] tracking-tight leading-tight">
              Jamin <span className="text-amber-500">24</span> AI video HUB
            </h1>
            <p className="text-slate-600 text-[11px] sm:text-sm font-semibold max-w-2xl px-2 sm:px-0 leading-relaxed">
              JAHAN JAMIN, WAHAN JAMIN24 — Stitch and highlight open land plot clips with AI motion tracking & voiceovers.
            </p>

            {/* Feature Pill Badges */}
            <div className="flex flex-wrap justify-center md:justify-start gap-1.5 sm:gap-2 pt-1 sm:pt-2 text-[9px] sm:text-xs font-bold text-[#0D473B]">
              <span className="bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 sm:px-3.5 sm:py-1 rounded-full flex items-center gap-1 sm:gap-1.5 shadow-sm">
                🧭 360° Virtual Tours
              </span>
              <span className="bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 sm:px-3.5 sm:py-1 rounded-full flex items-center gap-1 sm:gap-1.5 shadow-sm">
                🛡️ Verified Listings
              </span>
              <span className="bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 sm:px-3.5 sm:py-1 rounded-full flex items-center gap-1 sm:gap-1.5 shadow-sm">
                🤝 Trusted Network
              </span>
              <span className="bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 sm:px-3.5 sm:py-1 rounded-full flex items-center gap-1 sm:gap-1.5 shadow-sm">
                ⚡ Smart Match
              </span>
            </div>
          </div>
        </div>


        {/* 🎬 SECTION 1: MULTI-CLIP REAL ESTATE REEL MERGER */}
        <section className="bg-white border border-slate-200 shadow-xl rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 text-slate-800">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center">
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-[#0D473B] flex items-center gap-2.5">
                🎬 Multi-Clip Reel Merger & Highlight Workflow
              </h2>
              <p className="text-xs font-semibold text-slate-500 mt-1">Upload, select, highlight plot boundaries, and merge clips into a custom reel.</p>
            </div>
            <span className="bg-emerald-100 text-[#0D473B] text-[11px] font-extrabold px-3 py-1.5 rounded-full border border-emerald-300 shadow-sm">
              MAX 10 CLIPS
            </span>
          </div>

          {multiClipStage === "idle" && (
            <>
              {/* Upload Section */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                  <h3 className="font-extrabold text-[#0D473B] text-sm">📤 Upload Raw Footage Clips</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Upload clips from your computer ({uploadedClips.length}/10 uploaded).</p>
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
                    className={`px-6 py-3 font-bold rounded-xl text-sm transition cursor-pointer flex items-center gap-2 ${isUploading
                        ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                        : "bg-[#0D473B] hover:bg-[#09352C] text-white shadow-md shadow-emerald-950/20"
                      }`}
                  >
                    {isUploading ? "⏳ Uploading..." : "📂 Select Video Files"}
                  </label>
                </div>
              </div>

              {uploadProgress && (
                <div className="bg-emerald-50 border border-emerald-200 text-[#0D473B] px-4 py-2 rounded-xl text-xs font-mono animate-pulse">
                  {uploadProgress}
                </div>
              )}

              {/* Selection Grid */}
              {uploadedClips.length === 0 ? (
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm bg-slate-50/50">
                  📁 No raw footage clips uploaded yet. Upload up to 10 clips to start your merge workflow.
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select Clips and Highlight Each Plot:</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {uploadedClips.map((clip) => {
                      const clipName = clip.object_name;
                      const isSelected = selectedClips.includes(clipName);
                      const label = clip.filename;
                      return (
                        <div
                          key={clip.id}
                          className={`p-4 pb-3 rounded-2xl border flex flex-col items-center justify-between transition relative min-h-[175px] ${isSelected
                              ? "border-[#0D473B] bg-emerald-50/60 shadow-md ring-2 ring-[#0D473B]/20"
                              : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                        >
                          {/* Remove clip button */}
                          <button
                            onClick={() => handleRemoveClip(clipName)}
                            className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200"
                            title="Remove clip"
                          >
                            ✕
                          </button>

                          <div className="flex flex-col items-center text-center w-full mt-2">
                            <div className="text-xl">📍</div>
                            <span className="font-bold text-xs text-[#0D473B] mt-1 truncate w-full" title={label}>
                              {label}
                            </span>
                          </div>

                          {/* Distinct Sibling Action Buttons */}
                          <div className="w-full mt-3 pt-2 border-t border-slate-200/60 flex flex-col gap-2">
                            <button
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedClips(selectedClips.filter((c) => c !== clipName));
                                } else {
                                  setSelectedClips([...selectedClips, clipName]);
                                }
                              }}
                              className={`w-full py-1.5 text-[10px] font-bold rounded-lg flex items-center justify-center transition border ${isSelected
                                  ? "bg-[#0D473B] text-white border-[#0D473B] hover:bg-[#09352C]"
                                  : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"
                                }`}
                            >
                              {isSelected ? "✅ Selected" : "⬜ Select Clip"}
                            </button>

                            {isSelected && (
                              <div className="w-full space-y-2">
                                {/* Plot name input directly inside the card */}
                                <div className="flex flex-col text-left gap-0.5">
                                  <span className="text-[9px] font-bold text-slate-500">Plot Name:</span>
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
                                    className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 text-[10px] w-full focus:outline-none focus:border-[#0D473B]"
                                  />
                                </div>

                                {clipHighlights[clipName]?.isTracking ? (
                                  <span className="text-[10px] text-[#0D473B] animate-pulse font-mono flex items-center justify-center py-1 font-bold">⏳ Tracking AI...</span>
                                ) : clipHighlights[clipName]?.isDone ? (
                                  <button
                                    onClick={() => {
                                      setActiveMarkingClip(clipName);
                                      setActiveMarkingLabel(clipHighlights[clipName]?.label || label.split(".")[0]);
                                      setEnableFarmhouse(clipHighlights[clipName]?.enableFarmhouse || false);
                                      setEnableFountain(clipHighlights[clipName]?.enableFountain || false);
                                      setTextPosition(clipHighlights[clipName]?.textPosition || "middle");
                                    }}
                                    className="w-full py-1 px-1 bg-emerald-100 hover:bg-emerald-200 text-[#0D473B] text-[10px] font-bold rounded-lg flex items-center justify-center truncate border border-emerald-300"
                                    title="Click to edit plot boundary"
                                  >
                                    ✏️ Edit Plot: {clipHighlights[clipName]?.label}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setActiveMarkingClip(clipName);
                                      setActiveMarkingLabel(clipHighlights[clipName]?.label || label.split(".")[0]);
                                      setEnableFarmhouse(clipHighlights[clipName]?.enableFarmhouse || false);
                                      setEnableFountain(clipHighlights[clipName]?.enableFountain || false);
                                      setTextPosition(clipHighlights[clipName]?.textPosition || "middle");
                                    }}
                                    className="w-full py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[10px] font-semibold rounded-lg flex items-center justify-center border border-slate-200"
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
                <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  🗣️ AI Voiceover Script (Plot Names / Key Info):
                </label>
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Plot A – Road Facing, 200 sq yd"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0D473B] focus:ring-2 focus:ring-[#0D473B]/20 text-sm font-medium"
                />
              </div>

              {/* Merge Action Button */}
              <div className="space-y-2 pt-2">
                {selectedClips.length > 0 && !areAllSelectedClipsHighlighted() && (
                  <p className="text-amber-800 text-xs font-semibold flex items-center gap-1.5 bg-amber-50 p-3.5 rounded-xl border border-amber-200">
                    ⚠️ Validation Guard: Please mark the plot boundary for all selected clips before merging. ({selectedClips.filter(c => clipHighlights[c]?.isDone).length} of {selectedClips.length} highlighted)
                  </p>
                )}
                <button
                  onClick={handleGenerateMultiClipReel}
                  disabled={selectedClips.length === 0 || !areAllSelectedClipsHighlighted() || isUploading}
                  className="w-full py-4 bg-[#0D473B] hover:bg-[#09352C] text-white font-extrabold rounded-2xl text-lg transition shadow-xl shadow-emerald-950/20 disabled:opacity-40"
                >
                  🎬 Merge {selectedClips.length} Clips & Download Reel
                </button>
              </div>
            </>
          )}

          {/* Loading display for multi-clip stages */}
          {["merging_clips", "generating_reel"].includes(multiClipStage) && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-12 flex flex-col items-center justify-center space-y-4 text-center">
              <div className="animate-spin h-12 w-12 border-4 border-[#0D473B] border-t-transparent rounded-full" />
              <div>
                <h3 className="text-lg font-bold text-[#0D473B]">
                  {multiClipStage === "merging_clips" && "🔄 Merging Selected Land Plot Clips..."}
                  {multiClipStage === "generating_reel" && "🗣️ Generating AI Voiceover & Timed Captions..."}
                </h3>
                <p className="text-slate-500 text-xs mt-1">
                  FFmpeg & Sarvam AI are rendering your brand-watermarked real-estate reel...
                </p>
              </div>
            </div>
          )}

          {/* Done display for multi-clip result */}
          {multiClipStage === "done" && multiClipVideoUrl && (
            <div className="bg-emerald-50/50 border border-emerald-200 rounded-3xl p-6 flex flex-col items-center space-y-6 text-slate-800 text-center">
              <div>
                <h2 className="text-2xl font-black text-[#0D473B]">🎉 Multi-Clip Reel Ready!</h2>
                <p className="text-slate-600 text-xs mt-1">
                  Includes merged clips, custom yellow plot boundaries & name tags.
                </p>
              </div>

              <video
                src={multiClipVideoUrl}
                controls
                autoPlay
                className="max-w-xs w-full rounded-2xl shadow-2xl border-2 border-[#0D473B]"
              />

              <div className="flex gap-4">
                <button
                  onClick={() => handleDownload(multiClipVideoUrl)}
                  className="px-8 py-3 bg-[#0D473B] hover:bg-[#09352C] text-white font-bold rounded-xl transition shadow-lg flex items-center gap-2"
                >
                  ⬇️ Download Reel
                </button>
                <button
                  onClick={() => {
                    setMultiClipStage("idle");
                    setMultiClipVideoUrl(null);
                  }}
                  className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-xl transition"
                >
                  🔄 Create Another
                </button>
              </div>
            </div>
          )}

          {/* Error state for multi-clip */}
          {multiClipStage === "error" && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800 flex flex-col items-center gap-3 text-center">
              <p className="font-semibold text-sm">Error: {multiClipError}</p>
              <button
                onClick={() => setMultiClipStage("idle")}
                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white font-bold rounded-lg text-xs transition"
              >
                Try Again
              </button>
            </div>
          )}
        </section>
      </div>

        {/* Single video segmentation section removed as per user request */}

        {/* Multi-clip individual boundary marking modal popup */}
        {activeMarkingClip && (
          <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-8 overflow-y-auto">
            <div className="w-full max-w-4xl bg-slate-950 p-6 rounded-3xl border border-slate-800 shadow-2xl relative text-white">
              <button
                onClick={() => setActiveMarkingClip(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white font-bold text-xl px-2 py-1"
              >
                ✕
              </button>
              <h3 className="text-xl font-bold text-amber-400 mb-2">
                Mark Land Plot Boundary for {activeMarkingClip}
              </h3>
              <p className="text-slate-400 text-xs mb-5">
                Click points along the edges of the plot to define the boundary, and type a plot label/name to display.
              </p>

              <div className="mb-5 flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300">Plot Label / Name:</label>
                <input
                  type="text"
                  value={activeMarkingLabel}
                  onChange={(e) => setActiveMarkingLabel(e.target.value)}
                  placeholder="e.g. Plot A / Road Face"
                  className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-sm w-full max-w-sm"
                />
              </div>

              {/* Per-Plot Visual Effects Controls */}
              <div className="mb-5 bg-slate-900/80 border border-slate-700 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">✨ Plot Visual Effects</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-800 rounded-lg px-3 py-2 border border-slate-700 hover:border-amber-500 transition">
                    <input
                      type="checkbox"
                      checked={enableFarmhouse}
                      onChange={(e) => setEnableFarmhouse(e.target.checked)}
                      className="w-3.5 h-3.5 accent-amber-400"
                    />
                    <span className="text-white font-semibold">🏡 Farmhouse Overlay</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-800 rounded-lg px-3 py-2 border border-slate-700 hover:border-amber-500 transition">
                    <input
                      type="checkbox"
                      checked={enableFountain}
                      onChange={(e) => setEnableFountain(e.target.checked)}
                      className="w-3.5 h-3.5 accent-amber-400"
                    />
                    <span className="text-white font-semibold">🚰 Water Fountain</span>
                  </label>
                  <select
                    value={textPosition}
                    onChange={(e) => setTextPosition(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 font-semibold text-xs focus:ring-1 focus:ring-amber-400 hover:border-amber-500 transition"
                  >
                    <option value="middle">📌 Text: Above Plot</option>
                    <option value="outro">📌 Text: Outro Style</option>
                  </select>
                </div>
              </div>

              <BoundaryMarker
                objectName={activeMarkingClip}
                onBoundaryConfirmed={async (points) => {
                  const clipName = activeMarkingClip;
                  const label = activeMarkingLabel;
                  const fh = enableFarmhouse;
                  const ft = enableFountain;
                  const tp = textPosition;
                  setActiveMarkingClip(null);
                  await handleMultiClipBoundaryConfirmed(clipName, points, label, fh, ft, tp);
                }}
              />
            </div>
          </div>
        )}
      </div>
      );
};

      export default ReelGeneratorPage;
