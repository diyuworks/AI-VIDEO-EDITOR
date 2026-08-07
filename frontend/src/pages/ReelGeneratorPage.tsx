import React, { useState, useEffect } from "react";
import BoundaryMarker from "../components/BoundaryMarker";
import { API_BASE_URL } from "../config";
import { locationData } from "../locationData";

const TypewriterText = ({ text }: { text: string }) => {
  const [typedText, setTypedText] = useState("");
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setTypedText(text.slice(0, i));
      i++;
      if (i > text.length) clearInterval(interval);
    }, 40);
    return () => clearInterval(interval);
  }, [text]);
  return <>{typedText}</>;
};

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
  onOpenTimeline?: (videoUrl?: string, objectName?: string, items?: any[], audioFile?: File, audioSegments?: any[]) => void;
}

export interface ClipHighlightItem {
  points: Point[];
  frameTime?: number;
  label?: string;
  price?: string;
  size?: string;
  roadInfo?: string;
  highlightColor?: string;
  enableFarmhouse?: boolean;
  enableFountain?: boolean;
  enablePetrolPump?: boolean;
  textPosition?: string;
}

export interface ClipState {
  highlights: ClipHighlightItem[];
  isDone: boolean;
  isTracking?: boolean;
  trackingProgress?: number;
  highlightedObjectName?: string;
}

// deprecated, remove later
export interface ClipHighlight {
  points: Point[];
  label?: string;
  price?: string;
  size?: string;
  roadInfo?: string;
  highlightColor?: string;
  enableFarmhouse?: boolean;
  enableFountain?: boolean;
  enablePetrolPump?: boolean;
  textPosition?: string;
  isDone: boolean;
  isTracking?: boolean;
  highlightedObjectName?: string;
}

interface UploadedClip {
  id: number;
  filename: string;
  object_name: string;
  url: string;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 1000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (i === retries - 1) return response;
    } catch (err) {
      if (i === retries - 1) throw err;
    }
    await new Promise((res) => setTimeout(res, delay));
  }
  return fetch(url, options);
}

const ReelGeneratorPage: React.FC<ReelGeneratorPageProps> = ({
  rawVideoObjectName = "clip_1.mp4",
  referenceObjectName = null,
  prompt: initialPrompt = "",
  onOpenTimeline,
}) => {
  // Shared prompt input
  const [prompt, setPrompt] = useState<string>(initialPrompt || "");
  const [customAudioObjectName, setCustomAudioObjectName] = useState<string | null>(null);
  const [customAudioFile, setCustomAudioFile] = useState<File | null>(null);

  // Location Selection State
  const [selectedDistrict, setSelectedDistrict] = useState<string>("");
  const [selectedTaluka, setSelectedTaluka] = useState<string>("");
  const [selectedVillage, setSelectedVillage] = useState<string>("");
  const [useExactScript, setUseExactScript] = useState<boolean>(false);
  const [maxClipDuration, setMaxClipDuration] = useState<number | null>(null); // Default null = Full duration for all merged clips

  // Multi-Clip States (Always start empty for a clean workspace)
  const [multiClipStage, setMultiClipStage] = useState<"idle" | "merging_clips" | "generating_reel" | "done" | "error">("idle");
  const [multiClipVideoUrl, setMultiClipVideoUrl] = useState<string | null>(null);
  const [multiClipError, setMultiClipError] = useState<string | null>(null);

  // Real-time progress tracking state
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [audioProgressPercent, setAudioProgressPercent] = useState<number>(0);
  const [audioProgressMessage, setAudioProgressMessage] = useState<string>("");
  const [audioSegments, setAudioSegments] = useState<any[]>([]);
  const [progressMessage, setProgressMessage] = useState<string>("Initializing job...");
  const [progressStage, setProgressStage] = useState<string>("idle");
  const [uploadedClips, setUploadedClips] = useState<UploadedClip[]>([]);
  const [selectedClips, setSelectedClips] = useState<string[]>([]);
  const [clipHighlights, setClipHighlights] = useState<Record<string, ClipState>>({});
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);

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
  const [enablePetrolPump, setEnablePetrolPump] = useState<boolean>(false);
  const [textPosition, setTextPosition] = useState<string>("middle");

  // Simulated progress for clip tracking (Smart Smoother)
  useEffect(() => {
    const interval = setInterval(() => {
      setClipHighlights(prev => {
        let changed = false;
        const next = { ...prev };
        for (const clip in next) {
          if (next[clip].isTracking) {
            const currentProg = next[clip].trackingProgress || 0;
            if (currentProg < 99) {
              // Slow down progress after 80% to make it feel realistic
              const increment = currentProg > 80 ? (Math.random() > 0.5 ? 1 : 0) : 1;
              next[clip] = { ...next[clip], trackingProgress: currentProg + increment };
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    }, 600);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Automatically load clips sequentially to avoid hitting MinIO limits
    if (uploadedClips.length > 0) {
      setSelectedClips([uploadedClips[0].object_name]);
    } else {
      setSelectedClips([]);
    }
  }, []);

  // Handle Chrome Native Browser Back Button (←) to return to main page when marking plot
  useEffect(() => {
    const handlePopState = () => {
      if (activeMarkingClip) {
        setActiveMarkingClip(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [activeMarkingClip]);

  // Fetch past reels on mount
  useEffect(() => {
    setUploadedClips([]);
    setSelectedClips([]);
  }, []);

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

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsTranscribing(true);
    setAudioProgressPercent(10);
    setAudioProgressMessage("Uploading custom audio file...");
    setCustomAudioObjectName(null);
    setCustomAudioFile(file);

    try {
      const uploadFormData = new FormData();
      uploadFormData.append("file", file);
      
      const ext = file.name.includes('.') ? file.name.split('.').pop() || 'mp3' : 'mp3';
      let uploadObjName = `custom_audio_${Date.now()}.${ext}`;
      try {
        const uploadRes = await fetchWithRetry(`${API_BASE_URL}/upload`, {
          method: "POST",
          body: uploadFormData,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData.object_name) {
            uploadObjName = uploadData.object_name;
          }
        }
      } catch (e) {
        console.warn("Backend upload warning, storing audio locally:", e);
      }

      setCustomAudioObjectName(uploadObjName);
      setAudioProgressPercent(40);
      setAudioProgressMessage("Processing audio for Gujarati speech...");

      const progressInterval = setInterval(() => {
        setAudioProgressPercent((prev) => (prev < 90 ? prev + 8 : prev));
      }, 400);

      try {
        const transcribeFormData = new FormData();
        transcribeFormData.append("file", file);
        const transcribeRes = await fetchWithRetry(`${API_BASE_URL}/transcribe-audio`, {
          method: "POST",
          body: transcribeFormData,
        });

        clearInterval(progressInterval);

        if (transcribeRes.ok) {
          const transcribeData = await transcribeRes.json();
          if (transcribeData.success && transcribeData.full_transcript) {
            setPrompt(transcribeData.full_transcript);
            setUseExactScript(true);
            if (transcribeData.segments) {
              setAudioSegments(transcribeData.segments);
            }
          }
        }
      } catch (errTranscribe) {
        clearInterval(progressInterval);
        console.warn("Transcription warning, using custom audio file directly:", errTranscribe);
      }

      setAudioProgressPercent(100);
      setAudioProgressMessage("Custom Audio Ready ✅");
    } catch (err) {
      console.warn("Audio upload handled locally:", err);
      setCustomAudioObjectName(`audio_${Date.now()}.mp3`);
      setAudioProgressPercent(100);
      setAudioProgressMessage("Custom Audio Ready ✅");
    } finally {
      setIsTranscribing(false);
      setTimeout(() => {
        setAudioProgressPercent(0);
        setAudioProgressMessage("");
      }, 4000);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleRemoveAudio = () => {
    setCustomAudioObjectName(null);
    setUseExactScript(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (uploadedClips.length + files.length > 10) {
      alert(`Upload blocked: Maximum 10 raw clips allowed. Currently you have ${uploadedClips.length} clips.`);
      return;
    }

    setIsUploading(true);
    const newClips: UploadedClip[] = [];
    const newlySelected: string[] = [];

    try {
      const fileList = Array.from(files);

      const uploadPromises = fileList.map(async (file, index) => {
        const formData = new FormData();
        formData.append("file", file);
        
        const res = await fetch(`${API_BASE_URL}/upload`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          let errMsg = `Upload failed for ${file.name}`;
          try {
            const errData = await res.json();
            errMsg = errData.detail || errMsg;
          } catch {
            const text = await res.text();
            errMsg = text || errMsg;
          }
          throw new Error(errMsg);
        }

        const data = await res.json();
        return {
          clip: {
            id: data.id,
            filename: data.filename,
            object_name: data.object_name,
            url: data.url,
          },
          object_name: data.object_name,
        };
      });

      setUploadProgress(`Uploading ${fileList.length} clips concurrently...`);
      const results = await Promise.all(uploadPromises);

      const newClips = results.map(r => r.clip);
      const newlySelected = results.map(r => r.object_name);

      setUploadedClips((prev) => [...newClips, ...prev]);
      setSelectedClips((prev) => [...newlySelected, ...prev]);
      setUploadProgress("Upload complete! 🎉");
      setTimeout(() => setUploadProgress(""), 2000);
    } catch (err: any) {
      console.error("Upload error:", err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleLoadDemoClips = async () => {
    try {
      setIsUploading(true);
      setUploadProgress("Loading Demo Clips 1 to 5...");
      const res = await fetch(`${API_BASE_URL}/available-clips`);
      if (!res.ok) throw new Error("Could not fetch available clips");
      const data = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        const demoClips: UploadedClip[] = data.map((c: any) => ({
          id: c.id,
          filename: c.filename,
          object_name: c.object_name,
          url: c.url,
        }));
        setUploadedClips(demoClips);
        setSelectedClips(demoClips.map((c) => c.object_name));
        setUploadProgress("Loaded 5 Demo Clips successfully! 🎉");
        setTimeout(() => setUploadProgress(""), 2000);
      }
    } catch (err: any) {
      console.error(err);
      alert("Failed to load demo clips.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveClip = (clipName: string) => {
    setUploadedClips((prev) => prev.filter((c) => c.object_name !== clipName));
    setSelectedClips((prev) => prev.filter((c) => c !== clipName));
    setClipHighlights((prev) => {
      const next = { ...prev };
      delete next[clipName];
      return next;
    });
  };

  const areAllSelectedClipsHighlighted = () => {
    if (selectedClips.length === 0) return false;
    return true;
  };

  const handleGenerateMultiClipReel = async () => {
    let isPolling = false;
    try {
      setMultiClipError(null);

      const orderedSelectedClips = uploadedClips
        .map(c => c.object_name)
        .filter(clip => selectedClips.includes(clip));

      // Wait for any background tracking to finish first
      setMultiClipStage("merging_clips");
      setProgressPercent(2);
      setProgressMessage("Checking clip tracking status...");

      let isStillTracking = true;
      let checkAttempts = 0;
      while (isStillTracking && checkAttempts < 60) {
        let trackingFound = false;
        for (const clip of orderedSelectedClips) {
          if (clipHighlights[clip]?.isTracking) {
            trackingFound = true;
            setProgressMessage(`Waiting for boundary tracking to finish on ${clip}...`);
            break;
          }
        }
        if (!trackingFound) {
          isStillTracking = false;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500));
          checkAttempts++;
        }
      }

      const clipsToMerge = orderedSelectedClips.map((clip) => {
        const highlight = clipHighlights[clip];
        return highlight && highlight.isDone && highlight.highlightedObjectName
          ? highlight.highlightedObjectName
          : clip;
      });

      const jobId = `job_${Date.now()}`;
      setProgressPercent(5);
      setProgressMessage("Starting multi-clip reel pipeline...");
      setMultiClipStage("merging_clips");

      const clipInfoForMerge = orderedSelectedClips.map((clip) => {
        const state = clipHighlights[clip];
        const hArr = state?.highlights || [];

        const combinedLabel = hArr.map(h => h.label).filter(Boolean).join(" and ") || "";
        const combinedPrice = hArr.map(h => h.price).filter(Boolean).join(" and ") || "";
        const combinedSize = hArr.map(h => h.size).filter(Boolean).join(" and ") || "";
        const combinedRoad = hArr.map(h => h.roadInfo).filter(Boolean).join(" and ") || "";
        const hasFh = hArr.some(h => h.enableFarmhouse);
        const hasFt = hArr.some(h => h.enableFountain);
        const hasPp = hArr.some(h => h.enablePetrolPump);

        return {
          object_name: clip,
          label: combinedLabel,
          has_farmhouse: hasFh,
          has_fountain: hasFt,
          has_petrol_pump: hasPp,
          price: combinedPrice,
          size: combinedSize,
          road_info: combinedRoad,
        };
      });

      isPolling = true;
      let lastBackendProgress = 0;

      const pollProgress = async () => {
        if (!isPolling) return;
        try {
          const res = await fetch(`${API_BASE_URL}/progress/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.progress !== undefined) {
              lastBackendProgress = data.progress;

              setProgressPercent((prev) => {
                // If backend actually moved ahead of our simulated progress, use it
                if (data.progress > prev) return data.progress;

                // Smart Progress Smoother (Zeno's Paradox): 
                // Always move forward slowly towards 99% while backend is busy
                if (prev < 99) {
                  if (Math.random() > 0.3) {
                    const remaining = 99 - prev;
                    // Step is larger when far from 99, and slows down to 1% as it gets closer
                    const step = Math.max(1, Math.floor(remaining * 0.05));
                    return prev + step;
                  }
                }
                return prev;
              });

              if (data.message) setProgressMessage(data.message);
              if (data.stage) setProgressStage(data.stage);
            }
          }
        } catch (e) { }
        if (isPolling) {
          setTimeout(pollProgress, 1000); // 1-second delay between requests
        }
      };
      pollProgress();

      const mergeRes = await fetch(`${API_BASE_URL}/merge-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_object_names: clipsToMerge,
          clip_info: clipInfoForMerge,
          max_clip_duration: maxClipDuration,
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
          use_exact_script: useExactScript,
          clip_metadata: mergeData.clip_metadata || null,
          custom_audio_object_name: customAudioObjectName,
          max_clip_duration: maxClipDuration,
          include_outro: true,
          job_id: jobId,
        }),
      });

      if (!reelRes.ok) throw new Error("AI Reel generation failed");
      const reelData = await reelRes.json();

      isPolling = false;
      setProgressPercent(100);
      const finalUrl = reelData?.video_url || reelData?.url || reelData?.download_url || (reelData?.merged_object_name ? `${API_BASE_URL}/demo-videos/${reelData.merged_object_name}` : null);
      if (!finalUrl) {
        throw new Error("No video URL returned from reel generator");
      }
      setMultiClipVideoUrl(finalUrl);
      setMultiClipStage("done");

    } catch (err: any) {
      isPolling = false;
      setMultiClipError(err.message || "Something went wrong during reel generation");
      setMultiClipStage("error");
    }
  };

  const handleMultiClipBoundaryConfirmed = async (
    clipName: string,
    points: Point[],
    label: string,
    fh: boolean,
    ft: boolean,
    pp: boolean,
    tp: string,
    pr: string,
    sz: string,
    rd: string,
    clr: string,
    frameTime?: number
  ) => {
    const newItem: ClipHighlightItem = {
      points, frameTime, label, enableFarmhouse: fh, enableFountain: ft, enablePetrolPump: pp, textPosition: tp, price: pr, size: sz, roadInfo: rd, highlightColor: clr
    };

    // Add to state
    setClipHighlights((prev) => {
      const existing = prev[clipName]?.highlights || [];
      const updatedHighlights = [...existing, newItem];

      // Fire and forget the async tracking
      processMultiClipHighlight(clipName, updatedHighlights).then(outputName => {
        setClipHighlights((p) => ({
          ...p,
          [clipName]: { ...p[clipName], highlightedObjectName: outputName, isDone: true, isTracking: false }
        }));
      }).catch(err => {
        setMultiClipError("Failed to track boundaries for clip");
        setClipHighlights((p) => ({ ...p, [clipName]: { ...p[clipName], isDone: false, isTracking: false } }));
      });

      return {
        ...prev,
        [clipName]: {
          highlights: updatedHighlights,
          isDone: false,
          isTracking: true,
          trackingProgress: 0
        }
      };
    });
  };

  const handleAddAnotherHighlight = (
    clipName: string,
    points: Point[],
    label: string,
    fh: boolean,
    ft: boolean,
    pp: boolean,
    tp: string,
    pr: string,
    sz: string,
    rd: string,
    clr: string,
    frameTime?: number
  ) => {
    const newItem: ClipHighlightItem = {
      points, frameTime, label, enableFarmhouse: fh, enableFountain: ft, enablePetrolPump: pp, textPosition: tp, price: pr, size: sz, roadInfo: rd, highlightColor: clr
    };
    setClipHighlights((prev) => {
      const existing = prev[clipName]?.highlights || [];
      return {
        ...prev,
        [clipName]: {
          ...prev[clipName],
          highlights: [...existing, newItem],
          isDone: false,
          trackingProgress: 0
        }
      };
    });
    // Reset inputs for next highlight
    setActiveMarkingLabel("");
    setPlotPrice("");
    setPlotSize("");
    setRoadInfo("");
  };

  const processMultiClipHighlight = async (clipName: string, highlights: ClipHighlightItem[]) => {
    try {
      if (!highlights || highlights.length === 0) return;

      const trackingPayloads = highlights.map(h => ({
        initial_points: h.points,
        start_timestamp: h.frameTime || 0.0
      }));

      // Step 1: Track the boundaries using /track-boundary
      const trackingRes = await fetchWithRetry(`${API_BASE_URL}/track-boundary-multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_name: clipName,
          highlights: trackingPayloads,
        }),
      });
      if (!trackingRes.ok) {
        const errText = await trackingRes.text();
        throw new Error(`Tracking failed: ${errText}`);
      }
      const trackingData = await trackingRes.json();

      // Formulate render payload array matching backend expectation
      const renderHighlights = highlights.map((h, i) => {
        let autoColor = h.highlightColor || "#FFEB3B";
        if (h.points.length === 2) {
          autoColor = "#FFEB3B"; // Yellow for roads/lines
        } else if (h.points.length >= 3) {
          autoColor = "#FFEB3B"; // Yellow for plots as requested
        }

        return {
          polygon_per_frame: trackingData.polygons_per_frame[i],
          highlight_color: autoColor,
          border_thickness: 8,
          label: h.label || undefined,
          price: h.price || undefined,
          size: h.size || undefined,
          road_info: h.roadInfo || undefined,
          enable_farmhouse_overlay: h.enableFarmhouse || false,
          enable_fountain_overlay: h.enableFountain || false,
          enable_petrol_pump_overlay: h.enablePetrolPump || false,
          text_position: h.textPosition || "middle",
        };
      });

      // Step 2: Render overlay using /render-overlay
      const renderRes = await fetchWithRetry(`${API_BASE_URL}/render-overlay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_name: clipName,
          regions: renderHighlights
        }),
      });
      if (!renderRes.ok) {
        const errText = await renderRes.text();
        throw new Error(`Rendering failed: ${errText}`);
      }
      const renderData = await renderRes.json();

      return renderData.output_object_name;
    } catch (err) {
      console.error(`Error processing clip ${clipName}:`, err);
      throw err;
    }
  };


  const handleDownload = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };


  if (activeMarkingClip) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col p-2 sm:p-4 lg:p-6 overflow-y-auto pb-20">
        <div className="w-full max-w-[1600px] mx-auto bg-white p-4 sm:p-6 md:p-8 rounded-[32px] border border-emerald-100 shadow-xl relative text-slate-800 animate-in fade-in zoom-in duration-300">

          {/* Close Button */}
          <button
            onClick={() => {
              setActiveMarkingClip(null);
              window.history.back(); // Clean up the pushState
            }}
            className="absolute top-6 right-6 text-slate-400 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg transition shadow-sm z-10"
            title="Close modal"
          >
            ✕
          </button>

          {/* Header Section */}
          <div className="mb-6">
            <h3 className="text-2xl sm:text-3xl font-black text-[#0D473B] mb-2 flex flex-wrap items-center gap-3">
              <span className="bg-gradient-to-br from-amber-400 to-orange-500 text-white w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-md">🎯</span>
              Mark Plot Details & Boundary
            </h3>
            <p className="text-slate-500 font-medium flex items-center gap-2">
              Currently editing:
              <span className="text-emerald-700 font-mono text-sm font-bold bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">
                {activeMarkingClip}
              </span>
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
            {/* LEFT COLUMN: Form Details */}
            <div className="w-full lg:w-[35%] xl:w-[30%] flex flex-col gap-6 lg:gap-8">

              <div className="flex flex-col gap-7 flex-1">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="text-lg">🏷️</span> Plot Label / Name
                  </label>
                  <textarea
                    value={activeMarkingLabel}
                    onChange={(e) => setActiveMarkingLabel(e.target.value)}
                    placeholder="e.g. Premium Corner Plot\n(Shift+Enter for new line)"
                    rows={2}
                    className="bg-white border border-slate-300 rounded-xl px-5 py-3.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0D473B] focus:ring-2 focus:ring-[#0D473B]/20 text-base font-bold w-full transition shadow-sm resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="text-lg">💰</span> Price <span className="text-slate-400 font-medium normal-case">(Opt)</span>
                    </label>
                    <input
                      type="text"
                      value={plotPrice}
                      onChange={(e) => setPlotPrice(e.target.value)}
                      placeholder="e.g. ₹25 Lakhs"
                      className="bg-white border border-slate-300 rounded-xl px-5 py-3.5 text-amber-700 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 text-base font-bold w-full transition shadow-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="text-lg">📐</span> Area <span className="text-slate-400 font-medium normal-case">(Opt)</span>
                    </label>
                    <input
                      type="text"
                      value={plotSize}
                      onChange={(e) => setPlotSize(e.target.value)}
                      placeholder="e.g. 1.5 Vigha"
                      className="bg-white border border-slate-300 rounded-xl px-5 py-3.5 text-emerald-700 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-base font-bold w-full transition shadow-sm"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="text-lg">🛣️</span> Road / Highway Distance
                  </label>
                  <input
                    type="text"
                    value={roadInfo}
                    onChange={(e) => setRoadInfo(e.target.value)}
                    placeholder="e.g. 60FT Highway | 100m"
                    className="bg-white border border-slate-300 rounded-xl px-5 py-3.5 text-cyan-700 placeholder-slate-400 focus:outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20 text-base font-bold w-full transition shadow-sm"
                  />
                </div>

                {/* Visual Effects */}
                <div className="bg-emerald-50/50 p-5 rounded-2xl border border-emerald-100 shadow-sm flex flex-col gap-4 mt-2">
                  <p className="text-sm font-black text-[#0D473B] uppercase tracking-wider flex items-center gap-1.5">
                    <span className="text-lg">✨</span> 3D Visual Effects
                  </p>
                  <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full">
                    <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer rounded-xl px-4 py-4 border transition shadow-sm select-none ${enableFarmhouse ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-slate-200 text-slate-600 hover:border-[#0D473B]'}`}>
                      <input
                        type="checkbox"
                        checked={enableFarmhouse}
                        onChange={(e) => setEnableFarmhouse(e.target.checked)}
                        className="w-5 h-5 accent-[#0D473B]"
                      />
                      <span className="font-bold text-base">🏡 Farmhouse</span>
                    </label>
                    <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer rounded-xl px-4 py-4 border transition shadow-sm select-none ${enableFountain ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-slate-200 text-slate-600 hover:border-[#0D473B]'}`}>
                      <input
                        type="checkbox"
                        checked={enableFountain}
                        onChange={(e) => setEnableFountain(e.target.checked)}
                        className="w-5 h-5 accent-[#0D473B]"
                      />
                      <span className="font-bold text-base">🚰 Fountain</span>
                    </label>
                    <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer rounded-xl px-4 py-4 border transition shadow-sm select-none ${enablePetrolPump ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-slate-200 text-slate-600 hover:border-[#0D473B]'}`}>
                      <input
                        type="checkbox"
                        checked={enablePetrolPump}
                        onChange={(e) => setEnablePetrolPump(e.target.checked)}
                        className="w-5 h-5 accent-[#0D473B]"
                      />
                      <span className="font-bold text-base">⛽ Petrol Pump</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Instructions Box to fill space perfectly */}
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border border-amber-200/50 shadow-inner flex flex-col justify-center mt-auto">
                <h4 className="text-base font-black text-amber-800 uppercase tracking-widest flex items-center gap-2 mb-4">
                  💡 Expert Tips for Best Results
                </h4>
                <ul className="text-sm text-amber-900/80 space-y-3 font-medium">
                  <li className="flex items-start gap-2.5">
                    <span className="text-amber-500 text-lg">✅</span> Mark 4-8 corner points by clicking exactly on the plot edges on the video frame.
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-amber-500 text-lg">✅</span> AI will automatically track these boundary points throughout the entire drone video!
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-amber-500 text-lg">✅</span> 3D Models (Farmhouse/Fountain/Petrol Pump) will be perspectively locked to your custom marked boundary.
                  </li>
                </ul>
              </div>
            </div>

            {/* RIGHT COLUMN: BoundaryMarker Canvas Component */}
            <div className="w-full lg:w-[65%] xl:w-[70%] flex flex-col bg-slate-50 rounded-2xl p-2 border border-slate-200 shadow-inner min-h-[600px]">
              <BoundaryMarker
                objectName={activeMarkingClip}
                onSaveAndAddAnother={(points, frameTime) => {
                  const clipName = activeMarkingClip;
                  const label = activeMarkingLabel;
                  const pr = plotPrice;
                  const sz = plotSize;
                  const rd = roadInfo;
                  const clr = highlightColor;
                  const fh = enableFarmhouse;
                  const ft = enableFountain;
                  const pp = enablePetrolPump;
                  const tp = textPosition || "middle";

                  if (!clipName) return;
                  handleAddAnotherHighlight(clipName, points, label, fh, ft, pp, tp, pr, sz, rd, clr, frameTime);
                }}
                onSaveAndFinish={async (points, frameTime) => {
                  const clipName = activeMarkingClip;
                  const label = activeMarkingLabel;
                  const pr = plotPrice;
                  const sz = plotSize;
                  const rd = roadInfo;
                  const clr = highlightColor;
                  const fh = enableFarmhouse;
                  const ft = enableFountain;
                  const pp = enablePetrolPump;
                  const tp = textPosition || "middle";

                  if (!clipName) return;
                  setActiveMarkingClip(null);
                  await handleMultiClipBoundaryConfirmed(clipName, points, label, fh, ft, pp, tp, pr, sz, rd, clr, frameTime);
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="w-full max-w-5xl mx-auto p-2 sm:p-4 space-y-10 font-sans">
      <div className="border-[3px] sm:border-[4px] border-[#0D473B] rounded-[24px] sm:rounded-[32px] p-4 sm:p-6 md:p-8 bg-[#f8fcfb] shadow-2xl relative space-y-5 sm:space-y-6 w-full overflow-hidden">
        <div className="relative overflow-hidden rounded-xl sm:rounded-2xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] p-5 sm:p-6 md:p-8 border border-emerald-50 mb-6 group">
          <div className="absolute top-[-50%] left-[-10%] w-96 h-96 bg-gradient-to-br from-emerald-100/50 to-transparent rounded-full blur-3xl group-hover:translate-x-8 transition-transform duration-1000 ease-in-out"></div>
          <div className="absolute bottom-[-50%] right-[-10%] w-96 h-96 bg-gradient-to-tl from-amber-100/40 to-transparent rounded-full blur-3xl group-hover:-translate-x-8 transition-transform duration-1000 ease-in-out"></div>
          <div className="relative z-10 flex flex-col md:flex-row items-center justify-center gap-6 md:gap-10">
            <div className="relative group/logo animate-float">
              <div className="absolute -inset-4 bg-gradient-to-r from-emerald-200/40 to-amber-200/40 rounded-full blur-xl opacity-0 group-hover/logo:opacity-100 transition duration-700"></div>
              <img src="/logo.jpg" alt="Jamin24 Logo" className="relative w-24 sm:w-28 md:w-32 object-contain shrink-0 mix-blend-multiply transform transition-all duration-500 group-hover/logo:scale-105" />
            </div>
            <div className="text-center md:text-left space-y-2 flex flex-col items-center md:items-start">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-100/80 rounded-full text-emerald-800 text-[10px] sm:text-xs font-black tracking-widest uppercase mb-1 shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Next-Gen Video AI
              </div>
              <h1 className="text-3xl sm:text-4xl md:text-[42px] font-black text-[#0D473B] tracking-tight leading-tight animate-pop-in">
                Jamin <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-500 animate-gradient-x drop-shadow-sm">24</span> AI Hub
              </h1>
              <p className="text-slate-500 text-sm md:text-base font-semibold tracking-wide max-w-lg min-h-[24px]">
                <TypewriterText text="Automated Plot Highlighting & Professional Reel Generation" />
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-emerald-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-2xl sm:rounded-3xl p-4 sm:p-6 mb-8">
          <h2 className="text-lg sm:text-xl font-black text-[#0D473B] mb-4 flex items-center gap-2">
            📍 Location Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="relative group">
              <label className="block text-xs sm:text-sm font-bold text-emerald-800 mb-1.5 ml-1">District</label>
              <div className="relative">
                <select
                  value={selectedDistrict}
                  onChange={(e) => {
                    setSelectedDistrict(e.target.value);
                    setSelectedTaluka("");
                    setSelectedVillage("");
                  }}
                  className="w-full bg-white border border-emerald-200 hover:border-emerald-300 rounded-xl pl-4 pr-10 py-3 text-[15px] font-medium text-slate-800 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm cursor-pointer appearance-none"
                >
                  <option value="" disabled>Select District</option>
                  {locationData.map(loc => (
                    <option key={loc.district} value={loc.district}>{loc.district}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-emerald-500 group-hover:text-emerald-700 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>
            </div>
            <div className="relative group">
              <label className="block text-xs sm:text-sm font-bold text-emerald-800 mb-1.5 ml-1">Taluka</label>
              <div className="relative">
                <select
                  value={selectedTaluka}
                  onChange={(e) => {
                    setSelectedTaluka(e.target.value);
                    setSelectedVillage("");
                  }}
                  disabled={!selectedDistrict}
                  className="w-full bg-white border border-emerald-200 hover:border-emerald-300 rounded-xl pl-4 pr-10 py-3 text-[15px] font-medium text-slate-800 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm cursor-pointer appearance-none disabled:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="" disabled>Select Taluka</option>
                  {locationData.find(l => l.district === selectedDistrict)?.talukas.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-emerald-500 group-hover:text-emerald-700 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>
            </div>
            <div className="relative group">
              <label className="block text-xs sm:text-sm font-bold text-emerald-800 mb-1.5 ml-1">Village</label>
              <div className="relative">
                <select
                  value={selectedVillage}
                  onChange={(e) => setSelectedVillage(e.target.value)}
                  disabled={!selectedTaluka}
                  className="w-full bg-white border border-emerald-200 hover:border-emerald-300 rounded-xl pl-4 pr-10 py-3 text-[15px] font-medium text-slate-800 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all shadow-sm cursor-pointer appearance-none disabled:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="" disabled>Select Village</option>
                  {locationData.find(l => l.district === selectedDistrict)?.villages.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-emerald-500 group-hover:text-emerald-700 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="bg-white border border-slate-200 shadow-xl rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 text-slate-800">
          <div className="border-b border-slate-100 pb-4 flex justify-between items-center flex-wrap gap-2">
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-[#0D473B] flex items-center gap-2.5">
                🎬 Multi-Clip Reel Merger & Highlight Workflow
              </h2>
              <p className="text-sm font-semibold text-slate-500 mt-1">Upload, select, highlight plot boundaries, and merge clips into a custom reel.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-emerald-100 text-[#0D473B] text-xs font-extrabold px-3.5 py-1.5 rounded-full border border-emerald-300 shadow-sm">
                MAX 10 CLIPS
              </span>
            </div>
          </div>

          {multiClipStage === "idle" && (
            <>
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                  <h3 className="font-extrabold text-[#0D473B] text-base">📤 Upload Raw Footage Clips</h3>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Upload clips from your computer ({uploadedClips.length}/10 uploaded).</p>
                </div>
                <div className="relative">
                  <input type="file" multiple accept="video/*" onChange={handleFileUpload} disabled={isUploading} className="hidden" id="raw-clip-upload" />
                  <label htmlFor="raw-clip-upload" className={`px-6 py-3.5 font-bold rounded-2xl text-sm transition cursor-pointer flex items-center gap-2 shadow-md ${isUploading ? "bg-slate-300 text-slate-500 cursor-not-allowed" : "bg-[#0D473B] hover:bg-[#09352C] text-white shadow-emerald-950/20"}`}>
                    {isUploading ? "⏳ Uploading..." : "📂 Select Video Files"}
                  </label>
                </div>
              </div>

              {uploadProgress && (
                <div className="bg-emerald-50 border border-emerald-200 text-[#0D473B] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-mono animate-pulse">
                  {uploadProgress}
                </div>
              )}

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
                      const isDone = clipHighlights[clipName]?.isDone;
                      return (
                        <div key={clip.id} className={`p-4 pb-4 rounded-2xl border flex flex-col items-center justify-between transition relative min-h-[190px] ${isSelected ? "border-[#0D473B] bg-emerald-50/60 shadow-md ring-2 ring-[#0D473B]/20" : "border-slate-200 bg-white hover:border-slate-300"}`}>

                          <div className="flex items-center gap-1.5 absolute top-2.5 left-2.5">
                            <button onClick={() => moveClipUp(clipIndex)} disabled={clipIndex === 0} className="text-slate-600 hover:text-[#0D473B] text-xs font-bold px-1.5 py-0.5 rounded-lg bg-slate-100 border disabled:opacity-30">◀</button>
                            <button onClick={() => moveClipDown(clipIndex)} disabled={clipIndex === uploadedClips.length - 1} className="text-slate-600 hover:text-[#0D473B] text-xs font-bold px-1.5 py-0.5 rounded-lg bg-slate-100 border disabled:opacity-30">▶</button>
                          </div>
                          <button onClick={() => handleRemoveClip(clipName)} className="absolute top-2.5 right-2.5 text-slate-400 hover:text-red-500 transition text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200">✕</button>
                          <div className="flex flex-col items-center text-center w-full mt-4">
                            <div className="text-2xl">📍</div>
                            <span className="font-bold text-sm text-[#0D473B] mt-1.5 truncate w-full" title={clip.filename}>{clip.filename}</span>

                            {/* Plot Highlight Summary Info Badges */}
                            {clipHighlights[clipName] && (
                              <div className="w-full mt-2 space-y-1 text-left bg-emerald-50/90 p-2 rounded-xl border border-emerald-200/80 text-[11px]">
                                {clipHighlights[clipName]?.isTracking && (
                                  <div className="text-[#0D473B] font-bold flex flex-col items-center justify-center gap-1 py-1">
                                    <div className="flex items-center gap-1 animate-pulse">
                                      <span className="animate-spin">⏳</span> AI Tracking & Rendering... {clipHighlights[clipName]?.trackingProgress || 0}%
                                    </div>
                                    <div className="w-full bg-emerald-200/50 rounded-full h-1.5 mt-1 overflow-hidden">
                                      <div className="bg-[#0D473B] h-1.5 rounded-full transition-all duration-500 ease-out" style={{ width: `${clipHighlights[clipName]?.trackingProgress || 0}%` }}></div>
                                    </div>
                                  </div>
                                )}
                                {clipHighlights[clipName]?.isDone && (
                                  <div className="text-emerald-800 font-bold flex items-center gap-1 text-[11px] border-b border-emerald-200/60 pb-1 mb-1">
                                    <span>✅</span> AI Tracked & Highlighted
                                  </div>
                                )}
                                {clipHighlights[clipName]?.highlights && clipHighlights[clipName]?.highlights.length > 0 && (
                                  <div className="font-bold text-slate-800">
                                    🏷️ <span className="text-[#0D473B]">{clipHighlights[clipName].highlights.length} Highlight(s) Added</span>
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-1 mt-1 text-[10px]">
                                  {clipHighlights[clipName]?.highlights?.some(h => h.enableFarmhouse) && <span className="bg-emerald-200 text-emerald-950 px-1.5 py-0.5 rounded font-bold">🏡 Farmhouse</span>}
                                  {clipHighlights[clipName]?.highlights?.some(h => h.enableFountain) && <span className="bg-cyan-100 text-cyan-900 px-1.5 py-0.5 rounded font-bold">🚰 Fountain</span>}
                                  {clipHighlights[clipName]?.highlights?.some(h => h.enablePetrolPump) && <span className="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-bold">⛽ Petrol Pump</span>}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="w-full mt-4 pt-3 border-t border-slate-200/80 flex flex-col gap-2.5">
                            <button onClick={() => isSelected ? setSelectedClips(selectedClips.filter((c) => c !== clipName)) : setSelectedClips([...selectedClips, clipName])} className={`w-full py-2 text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center transition border ${isSelected ? "bg-[#0D473B] text-white border-[#0D473B] hover:bg-[#09352C]" : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200"}`}>
                              {isSelected ? "✅ Selected" : "⬜ Select Clip"}
                            </button>
                            {isSelected && (
                              <div className="w-full space-y-2">
                                <button onClick={() => {
                                  const state = clipHighlights[clipName];
                                  const firstHighlight = state?.highlights?.[0];
                                  setActiveMarkingClip(clipName);
                                  setActiveMarkingLabel(firstHighlight?.label || clip.filename.split(".")[0]);
                                  setPlotPrice(firstHighlight?.price || "");
                                  setPlotSize(firstHighlight?.size || "");
                                  setRoadInfo(firstHighlight?.roadInfo || "");
                                  setHighlightColor(firstHighlight?.highlightColor || "#FFEB3B");
                                  setEnableFarmhouse(firstHighlight?.enableFarmhouse || false);
                                  setEnableFountain(firstHighlight?.enableFountain || false);
                                  setEnablePetrolPump(firstHighlight?.enablePetrolPump || false);

                                  // Push state to allow native browser back button (←) to close the view
                                  window.history.pushState({ view: "boundary-marker" }, "", "#mark-boundary");
                                }} className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl flex items-center justify-center border border-slate-200">
                                  {clipHighlights[clipName]?.isDone ? "✏️ Edit Highlights" : "✏️ Highlight Plot"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
                <div className="text-sm flex-1">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    🎙️ Upload Custom Voiceover <span className="text-slate-400 font-normal">(Optional)</span>
                  </span>
                  <p className="text-slate-500 text-xs mt-1">Upload an MP3/WAV file. We will use this audio instead of AI voiceover.</p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2 sm:w-auto w-full">
                  {(isTranscribing || (audioProgressPercent > 0 && audioProgressPercent < 100)) ? (
                    <div className="w-full sm:w-56 bg-white p-2.5 rounded-xl border border-emerald-200 shadow-sm">
                      <div className="flex justify-between items-center mb-1.5">
                        <div className="font-bold text-emerald-700 text-[10px] flex items-center gap-1.5">
                          ⏳ {audioProgressMessage || "Processing Audio..."}
                        </div>
                        <div className="text-[9px] font-bold text-emerald-700">
                          {audioProgressPercent}%
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-emerald-400 to-emerald-600 h-full rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${Math.max(5, audioProgressPercent)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <input type="file" accept="audio/*" onChange={handleAudioUpload} className="hidden" id="audio-upload" />
                      <label htmlFor="audio-upload" className={`px-5 py-2.5 font-bold rounded-2xl text-sm transition cursor-pointer flex items-center justify-center gap-2 shadow-md whitespace-nowrap w-full sm:w-auto ${customAudioObjectName ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-900/20" : "bg-[#0D473B] hover:bg-[#09352C] text-white shadow-emerald-950/20"}`}>
                        {customAudioObjectName ? "✅ Selected Audio" : "🎙️ Upload Audio File"}
                      </label>
                      {customAudioObjectName && (
                        <button type="button" onClick={handleRemoveAudio} className="px-3.5 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-2xl text-xs transition shadow-md whitespace-nowrap w-full sm:w-auto">
                          ❌ Remove
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-2 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleGenerateMultiClipReel}
                  disabled={selectedClips.length === 0 || isUploading || selectedClips.some(clip => !clipHighlights[clip]?.isDone)}
                  className="flex-1 py-4 bg-[#0D473B] hover:bg-[#09352C] text-white font-black rounded-2xl text-lg sm:text-xl transition shadow-xl shadow-emerald-950/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  🎬 Merge {selectedClips.length} Clips & Download Reel
                </button>
                {onOpenTimeline && (
                  <button
                    type="button"
                    disabled={selectedClips.length === 0 || isUploading || selectedClips.some(clip => !clipHighlights[clip]?.isDone)}
                    onClick={() => {
                      const firstSelected = selectedClips[0];
                      const activeHighlight = firstSelected ? clipHighlights[firstSelected] : null;
                      const activeProcessedObjName = (activeHighlight && activeHighlight.isDone && activeHighlight.highlightedObjectName) ? activeHighlight.highlightedObjectName : null;

                      const activeClipObj = uploadedClips.find((c) => c.object_name === firstSelected) || uploadedClips[0];
                      
                      const targetUrl = activeProcessedObjName 
                        ? `${API_BASE_URL}/demo-videos/${activeProcessedObjName}` 
                        : (activeClipObj ? activeClipObj.url : (rawVideoObjectName ? `${API_BASE_URL}/demo-videos/${rawVideoObjectName}` : `${API_BASE_URL}/demo-videos/clip_1.mp4`));
                      
                      const targetObjName = activeProcessedObjName || (activeClipObj ? activeClipObj.object_name : (rawVideoObjectName || 'clip_1.mp4'));

                      const items = selectedClips.map((objName, idx) => {
                        const highlightState = clipHighlights[objName];
                        const processedObjName = (highlightState && highlightState.isDone && highlightState.highlightedObjectName) ? highlightState.highlightedObjectName : null;
                        
                        const found = uploadedClips.find((c) => c.object_name === objName);
                        
                        const finalUrl = processedObjName ? `${API_BASE_URL}/demo-videos/${processedObjName}` : (found ? found.url : `${API_BASE_URL}/demo-videos/${objName}`);
                        const finalObjName = processedObjName || objName;
                        
                        return {
                          id: `clip-${idx + 1}`,
                          objectName: finalObjName,
                          url: finalUrl,
                          label: `Clip ${idx + 1} (${finalObjName})`,
                        };
                      });

                      onOpenTimeline(targetUrl, targetObjName, items, customAudioFile || undefined, audioSegments);
                    }}
                    className={`px-6 py-4 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-black rounded-2xl text-base sm:text-lg transition shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 whitespace-nowrap ${
                      (selectedClips.length === 0 || isUploading || selectedClips.some(clip => !clipHighlights[clip]?.isDone))
                        ? "opacity-40 cursor-not-allowed"
                        : "cursor-pointer"
                    }`}
                  >
                    <span>🎛️</span> Open in Timeline Studio
                  </button>
                )}
              </div>
            </>
          )}

          {["merging_clips", "generating_reel"].includes(multiClipStage) && (
            <div className="bg-[#f0f9f6] border-2 border-[#0D473B]/20 rounded-3xl p-8 sm:p-12 flex flex-col items-center justify-center space-y-6 text-center shadow-xl relative overflow-hidden">
              <div className="flex items-center gap-3">
                <div className="animate-spin h-8 w-8 border-4 border-[#0D473B] border-t-transparent rounded-full" />
                <h3 className="text-2xl sm:text-3xl font-black text-[#0D473B]">
                  Rendering Real-Estate Reel... <span className="font-mono text-emerald-700">{progressPercent}%</span>
                </h3>
              </div>
              <div className="w-full max-w-xl bg-slate-200 rounded-full h-5 p-1 shadow-inner relative overflow-hidden">
                <div className="bg-gradient-to-r from-[#0D473B] via-emerald-500 to-amber-400 h-full rounded-full transition-all duration-500 ease-out shadow-md" style={{ width: `${Math.max(5, progressPercent)}%` }} />
              </div>
              <p className="text-slate-700 text-[10px] sm:text-xs md:text-sm font-bold bg-white px-3 sm:px-5 py-1.5 sm:py-2 rounded-full border border-emerald-200/80 shadow-sm animate-pulse max-w-full truncate">
                ⚡ {progressMessage}
              </p>
            </div>
          )}

          {multiClipStage === "done" && multiClipVideoUrl && (
            <div className="bg-emerald-50/50 border border-emerald-200 rounded-3xl p-4 sm:p-6 flex flex-col items-center space-y-4 sm:space-y-6 text-slate-800 text-center">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-[#0D473B]">🎉 Multi-Clip Reel Ready!</h2>
              </div>
              <video src={multiClipVideoUrl} controls autoPlay playsInline className="max-w-[280px] sm:max-w-xs w-full rounded-2xl shadow-2xl border-2 border-[#0D473B]" />
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full sm:w-auto">
                <button onClick={() => handleDownload(multiClipVideoUrl)} className="w-full sm:w-auto px-6 sm:px-8 py-3 bg-[#0D473B] hover:bg-[#09352C] text-white font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2 text-sm">
                  ⬇️ Download Reel
                </button>
                <button onClick={() => { setMultiClipStage("idle"); setMultiClipVideoUrl(null); }} className="w-full sm:w-auto px-4 sm:px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-xl transition text-sm">
                  🔄 Create Another
                </button>
              </div>
            </div>
          )}

          {multiClipStage === "error" && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800 flex flex-col items-center gap-3 text-center">
              <p className="font-semibold text-xs sm:text-sm">Error: {multiClipError}</p>
              <button onClick={() => setMultiClipStage("idle")} className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white font-bold rounded-lg text-xs transition">
                Try Again
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ReelGeneratorPage;
