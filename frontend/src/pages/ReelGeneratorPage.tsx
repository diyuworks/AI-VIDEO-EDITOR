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
  price?: string;
  size?: string;
  roadInfo?: string;
  highlightColor?: string;
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

interface PastReel {
  id: string;
  filename: string;
  title: string;
  clean_name: string;
  url: string;
  size_mb: number;
  created_at: string;
}

const ReelGeneratorPage: React.FC<ReelGeneratorPageProps> = ({
  rawVideoObjectName = "clip_1.mp4",
  referenceObjectName = null,
  prompt: initialPrompt = "",
}) => {
  // Shared prompt input
  const [prompt, setPrompt] = useState<string>(initialPrompt || "Real estate plot sales reel in Hindi");

  // Multi-Clip States (Always start empty for a clean workspace)
  const [multiClipStage, setMultiClipStage] = useState<"idle" | "merging_clips" | "generating_reel" | "done" | "error">("idle");
  const [multiClipVideoUrl, setMultiClipVideoUrl] = useState<string | null>(null);
  const [multiClipError, setMultiClipError] = useState<string | null>(null);

  // Real-time progress tracking state
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>("Initializing job...");
  const [progressStage, setProgressStage] = useState<string>("idle");
  const [uploadedClips, setUploadedClips] = useState<UploadedClip[]>([]);
  const [selectedClips, setSelectedClips] = useState<string[]>([]);
  const [clipHighlights, setClipHighlights] = useState<Record<string, ClipHighlight>>({});
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  // Past Reels Gallery State
  const [pastReels, setPastReels] = useState<PastReel[]>([]);
  const [isLoadingPastReels, setIsLoadingPastReels] = useState<boolean>(false);
  const [isPastReelsOpen, setIsPastReelsOpen] = useState<boolean>(false);

  // Single Video States
  const [singleVideoStage, setSingleVideoStage] = useState<SingleVideoStage>("idle");
  const [singleVideoUrl, setSingleVideoUrl] = useState<string | null>(null);
  const [singleVideoError, setSingleVideoError] = useState<string | null>(null);

  // Multi-clip boundary marking modal state
  const [activeMarkingClip, setActiveMarkingClip] = useState<string | null>(null);
  const [activeMarkingLabel, setActiveMarkingLabel] = useState<string>("");
  const [plotPrice, setPlotPrice] = useState<string>("");
  const [plotSize, setPlotSize] = useState<string>("");
  const [roadInfo, setRoadInfo] = useState<string>("");
  const [highlightColor, setHighlightColor] = useState<string>("#FFEB3B");
  const [enableFarmhouse, setEnableFarmhouse] = useState<boolean>(false);
  const [enableFountain, setEnableFountain] = useState<boolean>(false);
  const [textPosition, setTextPosition] = useState<string>("middle");

  // Fetch past reels on mount
  useEffect(() => {
    setUploadedClips([]);
    setSelectedClips([]);
    fetchPastReels();
  }, []);

  const fetchPastReels = async () => {
    setIsLoadingPastReels(true);
    try {
      const res = await fetch(`${API_BASE_URL}/past-reels`);
      if (res.ok) {
        const data = await res.json();
        setPastReels(data);
      }
    } catch (err) {
      console.error("Failed to fetch past reels:", err);
    } finally {
      setIsLoadingPastReels(false);
    }
  };

  // Handle uploading multiple raw video files (Max 10 clips limit)
  const moveClipUp = (index: number) => {
    if (index <= 0) return;
    const updated = [...uploadedClips];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    setUploadedClips(updated);
  };

  const moveClipDown = (index: number) => {
    if (index >= uploadedClips.length - 1) return;
    const updated = [...uploadedClips];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    setUploadedClips(updated);
  };

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
      // Preserve the exact order in which the user selected the clips
      const clipsToMerge = selectedClips.map((clip) => {
        const highlight = clipHighlights[clip];
        return highlight && highlight.isDone && highlight.highlightedObjectName
          ? highlight.highlightedObjectName
          : clip;
      });

      const jobId = `job_${Date.now()}`;
      setProgressPercent(5);
      setProgressMessage("Starting multi-clip reel pipeline...");
      setMultiClipStage("merging_clips");
      
      console.log("=== MERGE DEBUG ===");
      console.log("selectedClips:", selectedClips);
      console.log("clipHighlights:", clipHighlights);
      console.log("clipsToMerge:", clipsToMerge);
      console.log("===================");
      
      // Build clip_info with metadata for context-aware voiceover
      const clipInfoForMerge = selectedClips.map((clip) => {
        const highlight = clipHighlights[clip];
        return {
          object_name: clip,
          label: highlight?.label || "",
          has_farmhouse: highlight?.enableFarmhouse || false,
          has_fountain: highlight?.enableFountain || false,
          price: highlight?.price || "",
          size: highlight?.size || "",
          road_info: highlight?.roadInfo || "",
        };
      });

      // Polling for progress
      const progressInterval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/job-progress/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.progress !== undefined) {
              setProgressPercent(data.progress);
              if (data.message) setProgressMessage(data.message);
              if (data.stage) setProgressStage(data.stage);
            }
          }
        } catch (e) {
          // silent catch
        }
      }, 400);
      
      const mergeRes = await fetch(`${API_BASE_URL}/merge-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_object_names: clipsToMerge,
          clip_info: clipInfoForMerge,
          job_id: jobId,
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
          clip_metadata: mergeData.clip_metadata || null,
          job_id: jobId,
        }),
      });

      if (!reelRes.ok) throw new Error("AI Reel generation failed");
      const reelData = await reelRes.json();

      clearInterval(progressInterval);
      setProgressPercent(100);
      setProgressMessage("Reel generation complete!");
      const finalUrl = reelData.video_url || reelData.url;
      setMultiClipVideoUrl(finalUrl);
      setMultiClipStage("done");
      fetchPastReels();
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
    txtPos: string = "middle",
    priceVal: string = "",
    sizeVal: string = "",
    roadVal: string = "",
    colorVal: string = "#FFEB3B"
  ) => {
    try {
      setClipHighlights((prev) => ({
        ...prev,
        [clipName]: {
          objectName: clipName,
          points,
          label,
          price: priceVal,
          size: sizeVal,
          roadInfo: roadVal,
          highlightColor: colorVal,
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
          highlight_color: colorVal || "#FFEB3B",
          border_thickness: 4,
          label: label || undefined,
          enable_farmhouse_overlay: farmhouse,
          enable_fountain_overlay: fountain,
          text_position: txtPos,
          price: priceVal || undefined,
          size: sizeVal || undefined,
          road_info: roadVal || undefined,
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
            <p className="text-slate-600 text-sm sm:text-base font-semibold max-w-2xl px-2 sm:px-0 leading-relaxed">
              JAHAN JAMIN, WAHAN JAMIN24 — Stitch and highlight open land plot clips with AI motion tracking & voiceovers.
            </p>

            {/* Feature Pill Badges */}
            <div className="flex flex-wrap justify-center md:justify-start gap-2 pt-1 sm:pt-2 text-xs sm:text-sm font-bold text-[#0D473B]">
              <span className="bg-emerald-50 border border-emerald-200/80 px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm">
                🧭 360° Virtual Tours
              </span>
              <span className="bg-emerald-50 border border-emerald-200/80 px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm">
                🛡️ Verified Listings
              </span>
              <span className="bg-emerald-50 border border-emerald-200/80 px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm">
                🤝 Trusted Network
              </span>
              <span className="bg-emerald-50 border border-emerald-200/80 px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm">
                ⚡ Smart Match
              </span>
            </div>
          </div>
        </div>


        {/* 🎬 SECTION 1: MULTI-CLIP REAL ESTATE REEL MERGER */}
        <section className="bg-white border border-slate-200 shadow-xl rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 text-slate-800">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center flex-wrap gap-2">
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-[#0D473B] flex items-center gap-2.5">
                🎬 Multi-Clip Reel Merger & Highlight Workflow
              </h2>
              <p className="text-sm font-semibold text-slate-500 mt-1">Upload, select, highlight plot boundaries, and merge clips into a custom reel.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPastReelsOpen(true)}
                className="bg-emerald-50 hover:bg-emerald-100 text-[#0D473B] text-xs font-bold px-3.5 py-1.5 rounded-full border border-emerald-300 shadow-sm flex items-center gap-1.5 transition"
              >
                📊 Past Generated Reels <span className="bg-[#0D473B] text-white px-2 py-0.5 rounded-full font-mono text-[11px] font-bold">{pastReels.length}</span>
              </button>
              <span className="bg-emerald-100 text-[#0D473B] text-xs font-extrabold px-3.5 py-1.5 rounded-full border border-emerald-300 shadow-sm">
                MAX 10 CLIPS
              </span>
            </div>
          </div>

          {multiClipStage === "idle" && (
            <>
              {/* Upload Section */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                  <h3 className="font-extrabold text-[#0D473B] text-base">📤 Upload Raw Footage Clips</h3>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Upload clips from your computer ({uploadedClips.length}/10 uploaded).</p>
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
                    className={`px-6 py-3.5 font-bold rounded-2xl text-sm transition cursor-pointer flex items-center gap-2 shadow-md ${isUploading
                        ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                        : "bg-[#0D473B] hover:bg-[#09352C] text-white shadow-emerald-950/20"
                      }`}
                  >
                    {isUploading ? "⏳ Uploading..." : "📂 Select Video Files"}
                  </label>
                </div>
              </div>

              {uploadProgress && (
                <div className="bg-emerald-50 border border-emerald-200 text-[#0D473B] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-mono animate-pulse">
                  {uploadProgress}
                </div>
              )}

              {/* Selection Grid */}
              {uploadedClips.length === 0 ? (
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-500 font-semibold text-sm sm:text-base bg-slate-50/50">
                  📁 No raw footage clips uploaded yet. Upload up to 10 clips to start your merge workflow.
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="text-xs sm:text-sm font-bold text-slate-600 uppercase tracking-wider">Select Clips and Highlight Each Plot:</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {uploadedClips.map((clip, clipIndex) => {
                      const clipName = clip.object_name;
                      const isSelected = selectedClips.includes(clipName);
                      const label = clip.filename;
                      return (
                        <div
                          key={clip.id}
                          className={`p-4 pb-4 rounded-2xl border flex flex-col items-center justify-between transition relative min-h-[190px] ${isSelected
                              ? "border-[#0D473B] bg-emerald-50/60 shadow-md ring-2 ring-[#0D473B]/20"
                              : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                        >
                          {/* Re-order & Remove buttons */}
                          <div className="flex items-center gap-1.5 absolute top-2.5 left-2.5">
                            <button
                              onClick={() => moveClipUp(clipIndex)}
                              disabled={clipIndex === 0}
                              className="text-slate-600 hover:text-[#0D473B] text-xs font-bold px-1.5 py-0.5 rounded-lg bg-slate-100 border disabled:opacity-30"
                              title="Move clip up in sequence"
                            >
                              ⬆️
                            </button>
                            <button
                              onClick={() => moveClipDown(clipIndex)}
                              disabled={clipIndex === uploadedClips.length - 1}
                              className="text-slate-600 hover:text-[#0D473B] text-xs font-bold px-1.5 py-0.5 rounded-lg bg-slate-100 border disabled:opacity-30"
                              title="Move clip down in sequence"
                            >
                              ⬇️
                            </button>
                          </div>
                          <button
                            onClick={() => handleRemoveClip(clipName)}
                            className="absolute top-2.5 right-2.5 text-slate-400 hover:text-red-500 transition text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200"
                            title="Remove clip"
                          >
                            ✕
                          </button>

                          <div className="flex flex-col items-center text-center w-full mt-4">
                            <div className="text-2xl">📍</div>
                            <span className="font-bold text-sm text-[#0D473B] mt-1.5 truncate w-full" title={label}>
                              {label}
                            </span>
                          </div>

                          {/* Distinct Sibling Action Buttons */}
                          <div className="w-full mt-4 pt-3 border-t border-slate-200/80 flex flex-col gap-2.5">
                            <button
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedClips(selectedClips.filter((c) => c !== clipName));
                                } else {
                                  setSelectedClips([...selectedClips, clipName]);
                                }
                              }}
                              className={`w-full py-2 text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center transition border ${isSelected
                                  ? "bg-[#0D473B] text-white border-[#0D473B] hover:bg-[#09352C]"
                                  : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200"
                                }`}
                            >
                              {isSelected ? "✅ Selected" : "⬜ Select Clip"}
                            </button>

                            {isSelected && (
                              <div className="w-full space-y-2">
                                {/* Plot name input directly inside the card */}
                                <div className="flex flex-col text-left gap-1">
                                  <span className="text-xs font-bold text-slate-600">Plot Name:</span>
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
                                    className="bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-slate-800 text-xs sm:text-sm font-semibold w-full focus:outline-none focus:border-[#0D473B]"
                                  />
                                </div>

                                {clipHighlights[clipName]?.isTracking ? (
                                  <span className="text-xs text-[#0D473B] animate-pulse font-mono flex items-center justify-center py-1.5 font-bold">⏳ Tracking AI...</span>
                                ) : clipHighlights[clipName]?.isDone ? (
                                  <button
                                    onClick={() => {
                                      setActiveMarkingClip(clipName);
                                      setActiveMarkingLabel(clipHighlights[clipName]?.label || label.split(".")[0]);
                                      setPlotPrice(clipHighlights[clipName]?.price || "");
                                      setPlotSize(clipHighlights[clipName]?.size || "");
                                      setRoadInfo(clipHighlights[clipName]?.roadInfo || "");
                                      setHighlightColor(clipHighlights[clipName]?.highlightColor || "#FFEB3B");
                                      setEnableFarmhouse(clipHighlights[clipName]?.enableFarmhouse || false);
                                      setEnableFountain(clipHighlights[clipName]?.enableFountain || false);
                                      setTextPosition(clipHighlights[clipName]?.textPosition || "middle");
                                    }}
                                    className="w-full py-1.5 px-2 bg-emerald-100 hover:bg-emerald-200 text-[#0D473B] text-xs font-bold rounded-xl flex items-center justify-center truncate border border-emerald-300"
                                    title="Click to edit plot boundary"
                                  >
                                    ✏️ Edit Plot: {clipHighlights[clipName]?.label}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setActiveMarkingClip(clipName);
                                      setActiveMarkingLabel(clipHighlights[clipName]?.label || label.split(".")[0]);
                                      setPlotPrice(clipHighlights[clipName]?.price || "");
                                      setPlotSize(clipHighlights[clipName]?.size || "");
                                      setRoadInfo(clipHighlights[clipName]?.roadInfo || "");
                                      setHighlightColor(clipHighlights[clipName]?.highlightColor || "#FFEB3B");
                                      setEnableFarmhouse(clipHighlights[clipName]?.enableFarmhouse || false);
                                      setEnableFountain(clipHighlights[clipName]?.enableFountain || false);
                                      setTextPosition(clipHighlights[clipName]?.textPosition || "middle");
                                    }}
                                    className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl flex items-center justify-center border border-slate-200"
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

              {/* Voiceover Prompt / Editable Script Input */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="text-sm sm:text-base font-bold text-slate-800 flex items-center gap-2">
                    🗣️ AI Voiceover Script & Custom Text (Editable):
                  </label>
                  <span className="text-xs sm:text-sm text-emerald-800 font-bold bg-emerald-50 border border-emerald-200/80 px-3 py-1 rounded-full shadow-sm">
                    ⚡ Audio auto-fades at end of footage (5s logo silent)
                  </span>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder="e.g. 1.5 Vigha luxury plot with 3D Water Fountain and Farmhouse layout."
                  className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0D473B] focus:ring-2 focus:ring-[#0D473B]/20 text-sm sm:text-base font-medium resize-y shadow-sm"
                />
              </div>

              {/* Merge Action Button */}
              <div className="space-y-3 pt-2">
                {selectedClips.length > 0 && !areAllSelectedClipsHighlighted() && (
                  <p className="text-amber-900 text-sm font-bold flex items-center gap-2 bg-amber-50 p-4 rounded-2xl border border-amber-200 shadow-sm">
                    ⚠️ Validation Guard: Please mark the plot boundary for all selected clips before merging. ({selectedClips.filter(c => clipHighlights[c]?.isDone).length} of {selectedClips.length} highlighted)
                  </p>
                )}
                <button
                  onClick={handleGenerateMultiClipReel}
                  disabled={selectedClips.length === 0 || !areAllSelectedClipsHighlighted() || isUploading}
                  className="w-full py-4 bg-[#0D473B] hover:bg-[#09352C] text-white font-black rounded-2xl text-lg sm:text-xl transition shadow-xl shadow-emerald-950/20 disabled:opacity-40"
                >
                  🎬 Merge {selectedClips.length} Clips & Download Reel
                </button>
              </div>
            </>
          )}

          {/* Real-Time Percentage Progress Bar Card */}
          {["merging_clips", "generating_reel"].includes(multiClipStage) && (
            <div className="bg-[#f0f9f6] border-2 border-[#0D473B]/20 rounded-3xl p-8 sm:p-12 flex flex-col items-center justify-center space-y-6 text-center shadow-xl relative overflow-hidden">
              <div className="flex items-center gap-3">
                <div className="animate-spin h-8 w-8 border-4 border-[#0D473B] border-t-transparent rounded-full" />
                <h3 className="text-2xl sm:text-3xl font-black text-[#0D473B]">
                  Rendering Real-Estate Reel... <span className="font-mono text-emerald-700">{progressPercent}%</span>
                </h3>
              </div>

              {/* Progress Bar Track */}
              <div className="w-full max-w-xl bg-slate-200 rounded-full h-5 p-1 shadow-inner relative overflow-hidden">
                <div
                  className="bg-gradient-to-r from-[#0D473B] via-emerald-500 to-amber-400 h-full rounded-full transition-all duration-500 ease-out shadow-md"
                  style={{ width: `${Math.max(5, progressPercent)}%` }}
                />
              </div>

              {/* Real-Time Step Message */}
              <p className="text-slate-700 text-xs sm:text-sm font-bold bg-white px-5 py-2 rounded-full border border-emerald-200/80 shadow-sm animate-pulse">
                ⚡ {progressMessage}
              </p>
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

        {/* 📊 PAST GENERATED REELS GALLERY POPUP MODAL */}
        {isPastReelsOpen && (
          <div className="fixed inset-0 z-50 bg-[#0D473B]/50 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
            <div className="w-full max-w-5xl bg-white p-6 sm:p-8 md:p-10 rounded-3xl border border-emerald-100 shadow-2xl relative text-slate-800 my-auto space-y-6 max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex justify-between items-center border-b border-slate-100 pb-4 pr-10 flex-wrap gap-2">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-black text-[#0D473B] flex items-center gap-2.5">
                    📊 Past Generated Reels Gallery
                  </h3>
                  <p className="text-sm font-semibold text-slate-500 mt-1">
                    Browse, preview & re-download all previously generated property reels ({pastReels.length} reels).
                  </p>
                </div>
                <button
                  onClick={fetchPastReels}
                  disabled={isLoadingPastReels}
                  className="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-[#0D473B] font-bold rounded-2xl text-xs sm:text-sm border border-emerald-200 transition flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  {isLoadingPastReels ? "⏳ Refreshing..." : "🔄 Refresh"}
                </button>
              </div>

              <button
                onClick={() => setIsPastReelsOpen(false)}
                className="absolute top-5 right-5 text-slate-400 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg transition"
                title="Close gallery"
              >
                ✕
              </button>

              {/* Gallery Grid Container */}
              <div className="overflow-y-auto pr-1 space-y-4 max-h-[65vh]">
                {pastReels.length === 0 ? (
                  <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-500 font-semibold text-sm sm:text-base bg-slate-50/50">
                    📹 No past generated reels found yet. Merge your first clip to see your generated reels here!
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {pastReels.map((reel) => (
                      <div
                        key={reel.id}
                        className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 flex flex-col justify-between space-y-4 hover:border-[#0D473B]/50 transition shadow-sm hover:shadow-md"
                      >
                        <div className="space-y-3">
                          <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-200 aspect-video flex items-center justify-center">
                            <video
                              src={reel.url}
                              controls
                              preload="metadata"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="pt-1">
                            <h4 className="font-extrabold text-[#0D473B] text-base truncate" title={reel.title}>
                              {reel.title}
                            </h4>
                            <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mt-1">
                              <span>📅 {reel.created_at}</span>
                              <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-mono font-bold">{reel.size_mb} MB</span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDownload(reel.url)}
                          className="w-full py-3 bg-[#0D473B] hover:bg-[#09352C] text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-sm flex items-center justify-center gap-2"
                        >
                          ⬇️ Download Reel
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Single video segmentation section removed as per user request */}

        {/* Multi-clip individual boundary marking modal popup */}
        {activeMarkingClip && (
          <div className="fixed inset-0 z-50 bg-[#0D473B]/50 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
            <div className="w-full max-w-4xl bg-white p-6 sm:p-8 md:p-10 rounded-3xl border border-emerald-100 shadow-2xl relative text-slate-800 my-auto space-y-6">
              <button
                onClick={() => setActiveMarkingClip(null)}
                className="absolute top-5 right-5 text-slate-400 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg transition"
                title="Close modal"
              >
                ✕
              </button>
              <div>
                <h3 className="text-2xl sm:text-3xl font-black text-[#0D473B] mb-1.5 flex flex-wrap items-center gap-2">
                  🎯 Mark Land Plot Boundary for <span className="text-emerald-700 font-mono text-lg sm:text-xl font-bold bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200">{activeMarkingClip}</span>
                </h3>
                <p className="text-slate-600 text-sm font-semibold">
                  Click points along the edges of the plot to define the boundary, and set plot prices, badges & visual effects.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-slate-800">Plot Label / Name:</label>
                  <input
                    type="text"
                    value={activeMarkingLabel}
                    onChange={(e) => setActiveMarkingLabel(e.target.value)}
                    placeholder="e.g. Plot A / Corner"
                    className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0D473B] text-sm sm:text-base font-semibold w-full shadow-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-slate-800">💰 Plot Price (Optional):</label>
                  <input
                    type="text"
                    value={plotPrice}
                    onChange={(e) => setPlotPrice(e.target.value)}
                    placeholder="e.g. ₹25 Lakhs"
                    className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-amber-700 placeholder-slate-400 focus:outline-none focus:border-[#0D473B] text-sm sm:text-base font-bold w-full shadow-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-slate-800">📐 Plot Size / Area (Optional):</label>
                  <input
                    type="text"
                    value={plotSize}
                    onChange={(e) => setPlotSize(e.target.value)}
                    placeholder="e.g. 2000 SqFt / 1.5 Vigha"
                    className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-emerald-700 placeholder-slate-400 focus:outline-none focus:border-[#0D473B] text-sm sm:text-base font-bold w-full shadow-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-bold text-slate-800">🛣️ Road / Highway Distance Badge:</label>
                  <input
                    type="text"
                    value={roadInfo}
                    onChange={(e) => setRoadInfo(e.target.value)}
                    placeholder="e.g. 60FT Highway | 100m"
                    className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-cyan-800 placeholder-slate-400 focus:outline-none focus:border-[#0D473B] text-sm sm:text-base font-semibold w-full shadow-sm"
                  />
                </div>
              </div>

              {/* Per-Plot Visual Effects Controls */}
              <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-5 space-y-3 shadow-sm">
                <p className="text-sm font-black text-[#0D473B] uppercase tracking-wider">✨ Plot Visual Effects</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 cursor-pointer bg-white rounded-2xl px-4 py-3 border border-slate-200 hover:border-[#0D473B] transition shadow-sm">
                    <input
                      type="checkbox"
                      checked={enableFarmhouse}
                      onChange={(e) => setEnableFarmhouse(e.target.checked)}
                      className="w-5 h-5 accent-[#0D473B]"
                    />
                    <span className="text-slate-800 font-bold text-sm sm:text-base">🏡 Farmhouse Overlay</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer bg-white rounded-2xl px-4 py-3 border border-slate-200 hover:border-[#0D473B] transition shadow-sm">
                    <input
                      type="checkbox"
                      checked={enableFountain}
                      onChange={(e) => setEnableFountain(e.target.checked)}
                      className="w-5 h-5 accent-[#0D473B]"
                    />
                    <span className="text-slate-800 font-bold text-sm sm:text-base">🚰 Water Fountain</span>
                  </label>
                </div>
              </div>

              <BoundaryMarker
                objectName={activeMarkingClip}
                onBoundaryConfirmed={async (points) => {
                  const clipName = activeMarkingClip;
                  const label = activeMarkingLabel;
                  const pr = plotPrice;
                  const sz = plotSize;
                  const rd = roadInfo;
                  const clr = "#FFEB3B"; // Default Electric Yellow
                  const fh = enableFarmhouse;
                  const ft = enableFountain;
                  const tp = "middle"; // Default Above Plot
                  setActiveMarkingClip(null);
                  await handleMultiClipBoundaryConfirmed(clipName, points, label, fh, ft, tp, pr, sz, rd, clr);
                }}
              />
            </div>
          </div>
        )}
      </div>
      );
};

      export default ReelGeneratorPage;
