import { useEffect, useRef, useState } from 'react'

type TrackType = 'video' | 'overlay' | 'audio'
type OverlayKind = 'caption' | 'boundary' | 'logo'

interface Clip {
  id: string
  track: TrackType
  start: number // seconds
  end: number // seconds
  label: string
  text?: string // caption/land-marker label text
  overlayKind?: OverlayKind // only set for track === 'overlay'
  // Box position, as % of the video frame (0-100) — used by 'boundary' and 'logo'
  boxLeftPct?: number
  boxTopPct?: number
  boxWidthPct?: number
  boxHeightPct?: number
  imageDataUrl?: string // only set for overlayKind === 'logo'
}

const PIXELS_PER_SECOND = 70
const TRACK_HEIGHT = 56
const DEFAULT_CAPTION_DURATION = 3 // seconds
const DEFAULT_BOUNDARY_DURATION = 4 // seconds
const DRAG_MOVE_THRESHOLD_PX = 3

const TRACK_META: Record<TrackType, { label: string; color: string; border: string }> = {
  video: { label: 'Video', color: 'bg-amber-dim', border: 'border-amber' },
  overlay: { label: 'Overlays / Captions', color: 'bg-teal-dim', border: 'border-teal' },
  audio: { label: 'Music', color: 'bg-white/10', border: 'border-white/30' },
}

// ---- AI plan generation ----
// Style/pacing options shown in the "Generate editing plan" modal. Reference-pacing
// numbers come from a real backend call to /analyze-reference (ffmpeg scene detection)
// when a reference video was uploaded; otherwise these style presets set the pacing.
const STYLE_OPTIONS = [
  'Cinematic',
  'Fast cuts',
  'Dramatic zooms',
  'Clean & minimal',
  'High energy',
  'Moody color grade',
] as const

const GENERATION_STEPS = [
  'Analyzing reference style…',
  'Detecting pacing & rhythm…',
  'Generating cut plan…',
  'Syncing captions…',
]

interface TimelineEditorPageProps {
  videoUrl: string
  referenceResults?: any[]
}

// Drag session data. Lives in a ref (not state) so mousemove/mouseup handlers
// always read the latest values without needing to re-subscribe listeners.
interface DragSession {
  clipId: string
  track: TrackType
  startClientX: number
  origStart: number
  origEnd: number
  moved: boolean
}

export default function TimelineEditorPage({ videoUrl, referenceResults }: TimelineEditorPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)

  const [duration, setDuration] = useState(0)
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // ---- Caption panel state ----
  const [captionPanelOpen, setCaptionPanelOpen] = useState(false)
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null)
  const [captionText, setCaptionText] = useState('')
  const [captionStart, setCaptionStart] = useState(0)
  const [captionEnd, setCaptionEnd] = useState(0)

  // ---- Boundary (land marker) panel state ----
  const [boundaryPanelOpen, setBoundaryPanelOpen] = useState(false)
  const [editingBoundaryId, setEditingBoundaryId] = useState<string | null>(null)
  const [boundaryLabel, setBoundaryLabel] = useState('')
  const [boundaryStart, setBoundaryStart] = useState(0)
  const [boundaryEnd, setBoundaryEnd] = useState(0)
  const [boundaryLeft, setBoundaryLeft] = useState(25)
  const [boundaryTop, setBoundaryTop] = useState(25)
  const [boundaryWidth, setBoundaryWidth] = useState(40)
  const [boundaryHeight, setBoundaryHeight] = useState(30)

  // ---- Logo/watermark panel state ----
  const [logoPanelOpen, setLogoPanelOpen] = useState(false)
  const [editingLogoId, setEditingLogoId] = useState<string | null>(null)
  const [logoLabel, setLogoLabel] = useState('Logo')
  const [logoImageDataUrl, setLogoImageDataUrl] = useState<string | null>(null)
  const [logoStart, setLogoStart] = useState(0)
  const [logoEnd, setLogoEnd] = useState(0)
  const [logoLeft, setLogoLeft] = useState(70)
  const [logoTop, setLogoTop] = useState(4)
  const [logoWidth, setLogoWidth] = useState(22)
  const [logoHeight, setLogoHeight] = useState(14)

  // ---- Drag-to-rearrange state ----
  const dragSessionRef = useRef<DragSession | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null)
  const [dragOffsetPx, setDragOffsetPx] = useState(0)

  // ---- AI plan generation state ----
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [hasGeneratedPlan, setHasGeneratedPlan] = useState(false)
  const [selectedStyle, setSelectedStyle] = useState<string>(STYLE_OPTIONS[0])
  const [matchReference, setMatchReference] = useState(true)
  const [transcriptInput, setTranscriptInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStepIndex, setGenerationStepIndex] = useState(0)
  const [rationale, setRationale] = useState<string[]>([])

  const handleLoadedMetadata = () => {
    const d = videoRef.current?.duration ?? 0
    setDuration(d)
    setClips([{ id: 'clip-1', track: 'video', start: 0, end: d, label: 'Clip 1' }])
    setPlanModalOpen(true)
  }

  const handleTimeUpdate = () => {
    if (videoRef.current) setPlayhead(videoRef.current.currentTime)
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [])

  const seekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(seconds, duration))
    }
  }

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left + (timelineScrollRef.current?.scrollLeft ?? 0)
    seekTo(clickX / PIXELS_PER_SECOND)
  }

  // ---- AI plan generation (real backend calls) ----

  const runGeneratePlan = async () => {
    setIsGenerating(true)
    setGenerationStepIndex(0)

    try {
      let referenceProfile = null
      if (matchReference && referenceResults && referenceResults.length > 0) {
        setGenerationStepIndex(0) // Analyzing reference style...
        const res = await fetch('http://localhost:8000/analyze-reference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ object_name: referenceResults[0].object_name }),
        })
        if (!res.ok) throw new Error('Failed to analyze reference')
        referenceProfile = await res.json()
      } else if (matchReference) {
        alert('No reference video uploaded. Proceeding without reference pacing.')
      }

      setGenerationStepIndex(2) // Generating cut plan...

      const planRes = await fetch('http://localhost:8000/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_duration: duration,
          reference_profile: referenceProfile || {
            duration: 10,
            scene_cuts: [],
            avg_cut_seconds: 4.0,
            cut_count: 0,
          },
          style: selectedStyle,
          transcript: transcriptInput,
          match_reference: matchReference && !!referenceProfile,
        }),
      })

      if (!planRes.ok) throw new Error('Failed to generate plan')
      const planData = await planRes.json()

      setGenerationStepIndex(3) // Syncing captions...

      setClips(planData.clips)
      setRationale(planData.rationale)
      setIsGenerating(false)
      setHasGeneratedPlan(true)
      setPlanModalOpen(false)
    } catch (e) {
      console.error(e)
      alert('Error generating plan from backend. Check console.')
      setIsGenerating(false)
    }
  }

  const skipPlanGeneration = () => {
    setPlanModalOpen(false)
  }

  // ---- Clip operations ----

  const splitSelectedClip = () => {
    if (!selectedClipId) return
    setClips((prev) => {
      const clip = prev.find((c) => c.id === selectedClipId)
      if (!clip || playhead <= clip.start || playhead >= clip.end) return prev
      const clipA: Clip = { ...clip, id: `${clip.id}-a-${Date.now()}`, end: playhead }
      const clipB: Clip = {
        ...clip,
        id: `${clip.id}-b-${Date.now()}`,
        start: playhead,
        label: clip.label,
      }
      return prev.flatMap((c) => (c.id === selectedClipId ? [clipA, clipB] : [c]))
    })
  }

  const deleteSelectedClip = () => {
    if (!selectedClipId) return
    setClips((prev) => prev.filter((c) => c.id !== selectedClipId))
    setSelectedClipId(null)
  }

  // ---- Caption operations ----

  const openNewCaptionPanel = () => {
    const start = playhead
    const end = Math.min(playhead + DEFAULT_CAPTION_DURATION, duration)
    setEditingCaptionId(null)
    setCaptionText('')
    setCaptionStart(Math.round(start * 10) / 10)
    setCaptionEnd(Math.round(end * 10) / 10)
    setCaptionPanelOpen(true)
  }

  const openEditCaptionPanel = (clip: Clip) => {
    setEditingCaptionId(clip.id)
    setCaptionText(clip.text ?? '')
    setCaptionStart(clip.start)
    setCaptionEnd(clip.end)
    setCaptionPanelOpen(true)
  }

  const closeCaptionPanel = () => {
    setCaptionPanelOpen(false)
    setEditingCaptionId(null)
  }

  const saveCaption = () => {
    if (!captionText.trim() || captionEnd <= captionStart) return

    if (editingCaptionId) {
      setClips((prev) =>
        prev.map((c) =>
          c.id === editingCaptionId
            ? { ...c, start: captionStart, end: captionEnd, text: captionText, label: captionText }
            : c,
        ),
      )
    } else {
      const newClip: Clip = {
        id: `caption-${Date.now()}`,
        track: 'overlay',
        overlayKind: 'caption',
        start: captionStart,
        end: captionEnd,
        label: captionText,
        text: captionText,
      }
      setClips((prev) => [...prev, newClip])
    }
    closeCaptionPanel()
  }

  const deleteCaption = () => {
    if (editingCaptionId) {
      setClips((prev) => prev.filter((c) => c.id !== editingCaptionId))
    }
    closeCaptionPanel()
  }

  // ---- Boundary (land marker) operations ----

  const openNewBoundaryPanel = () => {
    const start = playhead
    const end = Math.min(playhead + DEFAULT_BOUNDARY_DURATION, duration)
    setEditingBoundaryId(null)
    setBoundaryLabel('')
    setBoundaryStart(Math.round(start * 10) / 10)
    setBoundaryEnd(Math.round(end * 10) / 10)
    setBoundaryLeft(25)
    setBoundaryTop(25)
    setBoundaryWidth(40)
    setBoundaryHeight(30)
    setBoundaryPanelOpen(true)
  }

  const openEditBoundaryPanel = (clip: Clip) => {
    setEditingBoundaryId(clip.id)
    setBoundaryLabel(clip.text ?? '')
    setBoundaryStart(clip.start)
    setBoundaryEnd(clip.end)
    setBoundaryLeft(clip.boxLeftPct ?? 25)
    setBoundaryTop(clip.boxTopPct ?? 25)
    setBoundaryWidth(clip.boxWidthPct ?? 40)
    setBoundaryHeight(clip.boxHeightPct ?? 30)
    setBoundaryPanelOpen(true)
  }

  const closeBoundaryPanel = () => {
    setBoundaryPanelOpen(false)
    setEditingBoundaryId(null)
  }

  const saveBoundary = () => {
    if (!boundaryLabel.trim() || boundaryEnd <= boundaryStart) return

    if (editingBoundaryId) {
      setClips((prev) =>
        prev.map((c) =>
          c.id === editingBoundaryId
            ? {
                ...c,
                start: boundaryStart,
                end: boundaryEnd,
                text: boundaryLabel,
                label: boundaryLabel,
                boxLeftPct: boundaryLeft,
                boxTopPct: boundaryTop,
                boxWidthPct: boundaryWidth,
                boxHeightPct: boundaryHeight,
              }
            : c,
        ),
      )
    } else {
      const newClip: Clip = {
        id: `boundary-${Date.now()}`,
        track: 'overlay',
        overlayKind: 'boundary',
        start: boundaryStart,
        end: boundaryEnd,
        label: boundaryLabel,
        text: boundaryLabel,
        boxLeftPct: boundaryLeft,
        boxTopPct: boundaryTop,
        boxWidthPct: boundaryWidth,
        boxHeightPct: boundaryHeight,
      }
      setClips((prev) => [...prev, newClip])
    }
    closeBoundaryPanel()
  }

  const deleteBoundary = () => {
    if (editingBoundaryId) {
      setClips((prev) => prev.filter((c) => c.id !== editingBoundaryId))
    }
    closeBoundaryPanel()
  }

  // ---- Logo/watermark operations ----

  const openNewLogoPanel = () => {
    setEditingLogoId(null)
    setLogoLabel('Logo')
    setLogoImageDataUrl(null)
    setLogoStart(0)
    setLogoEnd(duration)
    setLogoLeft(70)
    setLogoTop(4)
    setLogoWidth(22)
    setLogoHeight(14)
    setLogoPanelOpen(true)
  }

  const openEditLogoPanel = (clip: Clip) => {
    setEditingLogoId(clip.id)
    setLogoLabel(clip.label ?? 'Logo')
    setLogoImageDataUrl(clip.imageDataUrl ?? null)
    setLogoStart(clip.start)
    setLogoEnd(clip.end)
    setLogoLeft(clip.boxLeftPct ?? 70)
    setLogoTop(clip.boxTopPct ?? 4)
    setLogoWidth(clip.boxWidthPct ?? 22)
    setLogoHeight(clip.boxHeightPct ?? 14)
    setLogoPanelOpen(true)
  }

  const closeLogoPanel = () => {
    setLogoPanelOpen(false)
    setEditingLogoId(null)
  }

  const handleLogoFileChange = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLogoImageDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  const saveLogo = () => {
    if (!logoImageDataUrl || logoEnd <= logoStart) return

    if (editingLogoId) {
      setClips((prev) =>
        prev.map((c) =>
          c.id === editingLogoId
            ? {
                ...c,
                start: logoStart,
                end: logoEnd,
                label: logoLabel,
                imageDataUrl: logoImageDataUrl,
                boxLeftPct: logoLeft,
                boxTopPct: logoTop,
                boxWidthPct: logoWidth,
                boxHeightPct: logoHeight,
              }
            : c,
        ),
      )
    } else {
      const newClip: Clip = {
        id: `logo-${Date.now()}`,
        track: 'overlay',
        overlayKind: 'logo',
        start: logoStart,
        end: logoEnd,
        label: logoLabel,
        imageDataUrl: logoImageDataUrl,
        boxLeftPct: logoLeft,
        boxTopPct: logoTop,
        boxWidthPct: logoWidth,
        boxHeightPct: logoHeight,
      }
      setClips((prev) => [...prev, newClip])
    }
    closeLogoPanel()
  }

  const deleteLogo = () => {
    if (editingLogoId) {
      setClips((prev) => prev.filter((c) => c.id !== editingLogoId))
    }
    closeLogoPanel()
  }

  const handleClipClick = (clip: Clip) => {
    setSelectedClipId(clip.id)
    if (clip.track === 'overlay') {
      if (clip.overlayKind === 'boundary') openEditBoundaryPanel(clip)
      else if (clip.overlayKind === 'logo') openEditLogoPanel(clip)
      else openEditCaptionPanel(clip)
    }
  }

  // ---- Drag-to-rearrange ----

  const handleClipMouseDown = (e: React.MouseEvent<HTMLButtonElement>, clip: Clip) => {
    if (e.button !== 0) return
    dragSessionRef.current = {
      clipId: clip.id,
      track: clip.track,
      startClientX: e.clientX,
      origStart: clip.start,
      origEnd: clip.end,
      moved: false,
    }
    setDraggingClipId(clip.id)
    setDragOffsetPx(0)
    setIsDragging(true)
  }

  const reorderVideoClip = (clipId: string, deltaPx: number) => {
    setClips((prev) => {
      const videoClips = prev.filter((c) => c.track === 'video').sort((a, b) => a.start - b.start)
      const otherClips = prev.filter((c) => c.track !== 'video')

      const draggedIndex = videoClips.findIndex((c) => c.id === clipId)
      if (draggedIndex === -1) return prev
      const dragged = videoClips[draggedIndex]
      const draggedCenterPx = ((dragged.start + dragged.end) / 2) * PIXELS_PER_SECOND + deltaPx

      const remaining = videoClips.filter((_, i) => i !== draggedIndex)
      let targetIndex = remaining.length
      for (let i = 0; i < remaining.length; i++) {
        const centerPx = ((remaining[i].start + remaining[i].end) / 2) * PIXELS_PER_SECOND
        if (draggedCenterPx < centerPx) {
          targetIndex = i
          break
        }
      }

      const newOrder = [...remaining.slice(0, targetIndex), dragged, ...remaining.slice(targetIndex)]

      let cursor = 0
      const reflowed = newOrder.map((c) => {
        const dur = c.end - c.start
        const next = { ...c, start: cursor, end: cursor + dur }
        cursor += dur
        return next
      })

      return [...reflowed, ...otherClips]
    })
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const session = dragSessionRef.current
      if (!session) return
      const deltaPx = e.clientX - session.startClientX

      if (!session.moved && Math.abs(deltaPx) > DRAG_MOVE_THRESHOLD_PX) {
        session.moved = true
      }

      if (session.track === 'video') {
        setDragOffsetPx(deltaPx)
      } else {
        const deltaSeconds = deltaPx / PIXELS_PER_SECOND
        const clipDuration = session.origEnd - session.origStart
        let newStart = session.origStart + deltaSeconds
        newStart = Math.max(0, Math.min(newStart, Math.max(duration - clipDuration, 0)))
        const newEnd = newStart + clipDuration
        setClips((prev) =>
          prev.map((c) => (c.id === session.clipId ? { ...c, start: newStart, end: newEnd } : c)),
        )
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      const session = dragSessionRef.current
      if (session && session.track === 'video' && session.moved) {
        const deltaPx = e.clientX - session.startClientX
        reorderVideoClip(session.clipId, deltaPx)
      }
      if (!session?.moved && session) {
        setClips((prev) => {
          const clip = prev.find((c) => c.id === session.clipId)
          if (clip) handleClipClick(clip)
          return prev
        })
      }
      dragSessionRef.current = null
      setIsDragging(false)
      setDraggingClipId(null)
      setDragOffsetPx(0)
    }

    document.body.style.cursor = 'grabbing'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, duration])

  const selectedClip = clips.find((c) => c.id === selectedClipId)
  const canSplit =
    !!selectedClip && playhead > selectedClip.start && playhead < selectedClip.end

  // Overlays currently visible at the playhead, split by kind, rendered over the video preview
  const activeCaption = clips.find(
    (c) => c.track === 'overlay' && (c.overlayKind ?? 'caption') === 'caption' && playhead >= c.start && playhead < c.end,
  )
  const activeBoundary = clips.find(
    (c) => c.track === 'overlay' && c.overlayKind === 'boundary' && playhead >= c.start && playhead < c.end,
  )
  const activeLogo = clips.find(
    (c) => c.track === 'overlay' && c.overlayKind === 'logo' && playhead >= c.start && playhead < c.end,
  )

  const tracks: TrackType[] = ['video', 'overlay', 'audio']
  const timelineWidth = Math.max(duration * PIXELS_PER_SECOND, 600)

  const tickInterval = duration > 30 ? 5 : 1
  const tickCount = Math.ceil(duration / tickInterval) + 1

  return (
    <div className="min-h-screen bg-canvas text-white font-body flex flex-col">
      {/* ---------------- PREVIEW ---------------- */}
      <div className="flex-1 flex items-center justify-center bg-black py-8 px-6 min-h-[45vh] relative">
        <div className="relative max-h-full max-w-full">
          <video
            ref={videoRef}
            src={videoUrl}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            className="max-h-full max-w-full rounded-lg block"
          />

          {/* Land-boundary marker: static yellow box + label, does not track camera motion */}
          {activeBoundary && (
            <div
              className="absolute border-4 border-yellow-400 bg-yellow-400/20 rounded-sm pointer-events-none flex items-start justify-start"
              style={{
                left: `${activeBoundary.boxLeftPct}%`,
                top: `${activeBoundary.boxTopPct}%`,
                width: `${activeBoundary.boxWidthPct}%`,
                height: `${activeBoundary.boxHeightPct}%`,
              }}
            >
              <span className="bg-yellow-400 text-canvas text-xs font-display font-semibold px-1.5 py-0.5 -translate-y-1/2 ml-1 rounded">
                {activeBoundary.label}
              </span>
            </div>
          )}

          {/* Logo/watermark image overlay */}
          {activeLogo?.imageDataUrl && (
            <img
              src={activeLogo.imageDataUrl}
              alt={activeLogo.label}
              className="absolute object-contain pointer-events-none"
              style={{
                left: `${activeLogo.boxLeftPct}%`,
                top: `${activeLogo.boxTopPct}%`,
                width: `${activeLogo.boxWidthPct}%`,
                height: `${activeLogo.boxHeightPct}%`,
              }}
            />
          )}

          {/* Caption text, karaoke-style bold with stroke */}
          {activeCaption && (
            <div className="absolute bottom-6 left-0 right-0 flex justify-center px-6 pointer-events-none">
              <span
                className="text-white font-display font-semibold text-xl sm:text-2xl text-center leading-snug"
                style={{
                  textShadow:
                    '0 0 6px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.9), 2px 2px 0 rgba(0,0,0,0.9)',
                }}
              >
                {activeCaption.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- TOOLBAR ---------------- */}
      <div className="flex items-center justify-between px-6 py-3 border-y border-canvas-border bg-canvas-panel">
        <div className="flex items-center gap-1.5 flex-wrap">
          <ToolbarButton icon={isPlaying ? '⏸' : '▶'} label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} />
          <ToolbarButton icon="✂" label="Split" onClick={splitSelectedClip} disabled={!canSplit} />
          <ToolbarButton icon="🗑" label="Delete" onClick={deleteSelectedClip} disabled={!selectedClipId} />
          <ToolbarButton icon="T" label="Text" onClick={openNewCaptionPanel} disabled={duration === 0} />
          <ToolbarButton icon="▭" label="Mark Land" onClick={openNewBoundaryPanel} disabled={duration === 0} />
          <ToolbarButton icon="🖼" label="Logo" onClick={openNewLogoPanel} disabled={duration === 0} />
          <ToolbarButton icon="♪" label="Music" disabled />
          <ToolbarButton icon="✨" label="Effects" disabled />
          <ToolbarButton icon="✦" label="AI Plan" onClick={() => setPlanModalOpen(true)} disabled={duration === 0} />
          <span className="text-white/20 text-xs font-mono ml-2">(Music / Effects — coming next)</span>
        </div>
        <button className="px-5 py-2 rounded-lg bg-amber text-canvas font-medium text-sm hover:bg-amber-bright transition-colors">
          Export
        </button>
      </div>

      {hasGeneratedPlan && rationale.length > 0 && (
        <div className="px-6 py-2.5 bg-teal-dim/30 border-b border-canvas-border">
          <div className="flex items-start gap-2">
            <span className="text-teal text-sm mt-0.5">✦</span>
            <ul className="text-xs text-white/70 space-y-0.5">
              {rationale.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ---------------- TIMELINE ---------------- */}
      <div className="bg-canvas-raised px-6 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs text-white/40">
            {formatTime(playhead)} / {formatTime(duration)}
          </span>
          <span className="font-mono text-xs text-white/25">
            {selectedClip ? `Selected: ${selectedClip.label}` : 'No clip selected'}
          </span>
        </div>

        <div ref={timelineScrollRef} className="overflow-x-auto">
          <div style={{ width: timelineWidth }}>
            <div onClick={handleRulerClick} className="relative h-6 border-b border-canvas-border cursor-pointer select-none">
              {Array.from({ length: tickCount }).map((_, i) => (
                <div key={i} className="absolute top-0 h-full flex flex-col items-start" style={{ left: i * tickInterval * PIXELS_PER_SECOND }}>
                  <div className="w-px h-2 bg-white/20" />
                  <span className="text-[10px] text-white/30 font-mono">{formatTime(i * tickInterval)}</span>
                </div>
              ))}
            </div>

            <div className="relative mt-1">
              <div className="absolute top-0 bottom-0 w-px bg-amber z-10 pointer-events-none" style={{ left: playhead * PIXELS_PER_SECOND }}>
                <div className="w-2.5 h-2.5 rounded-full bg-amber -translate-x-1/2" />
              </div>

              {tracks.map((track) => (
                <div key={track} className="relative border-b border-canvas-border/60 flex items-center select-none" style={{ height: TRACK_HEIGHT }}>
                  {clips
                    .filter((c) => c.track === track)
                    .map((clip) => {
                      const meta = TRACK_META[clip.track]
                      const selected = clip.id === selectedClipId
                      const isBeingDragged = clip.id === draggingClipId
                      const ghostOffset = isBeingDragged && clip.track === 'video' ? dragOffsetPx : 0
                      const isBoundary = clip.overlayKind === 'boundary'
                      const isLogo = clip.overlayKind === 'logo'
                      const clipColor = isBoundary ? 'bg-yellow-400/20' : isLogo ? 'bg-purple-400/20' : meta.color
                      const clipBorder = isBoundary ? 'border-yellow-400' : isLogo ? 'border-purple-400' : meta.border
                      const clipTextColor = isBoundary ? 'text-yellow-300' : isLogo ? 'text-purple-300' : 'text-white/90'
                      const clipIcon = isBoundary ? '▭ ' : isLogo ? '🖼 ' : ''
                      return (
                        <button
                          key={clip.id}
                          onMouseDown={(e) => handleClipMouseDown(e, clip)}
                          className={[
                            'absolute top-1.5 bottom-1.5 rounded-md flex items-center px-2.5 text-xs font-medium overflow-hidden transition-colors',
                            clipColor,
                            selected ? `border-2 ${clipBorder}` : 'border border-transparent',
                            isBeingDragged ? 'cursor-grabbing opacity-70 z-20 shadow-lg' : 'cursor-grab',
                          ].join(' ')}
                          style={{
                            left: clip.start * PIXELS_PER_SECOND,
                            width: Math.max((clip.end - clip.start) * PIXELS_PER_SECOND - 4, 20),
                            transform: ghostOffset ? `translateX(${ghostOffset}px)` : undefined,
                          }}
                        >
                          <span className={`truncate pointer-events-none ${clipTextColor}`}>
                            {clipIcon}
                            {clip.label}
                          </span>
                        </button>
                      )
                    })}
                  {clips.filter((c) => c.track === track).length === 0 && (
                    <span className="text-white/15 text-xs pl-2 font-mono">
                      {track === 'overlay' ? 'Overlays / Captions — click "Text", "Mark Land", or "Logo" to add one' : `${TRACK_META[track].label} — empty`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-4 mt-3">
          {tracks.map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${TRACK_META[t].color}`} />
              <span className="text-white/30 text-xs">{TRACK_META[t].label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- AI PLAN MODAL ---------------- */}
      {planModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-lg rounded-2xl bg-canvas-panel border border-canvas-border p-6">
            {!isGenerating ? (
              <>
                <h3 className="font-display font-semibold text-lg mb-1">Generate editing plan</h3>
                <p className="text-white/40 text-sm mb-5">
                  Pick a style to match your reference, and optionally paste what's said in the clip so captions can be synced automatically.
                </p>

                <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-2 block">Style</label>
                <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={matchReference}
                    onChange={(e) => setMatchReference(e.target.checked)}
                    className="accent-amber"
                  />
                  <span className="text-xs text-white/70">Match reference reel pacing (analyzed from your uploaded reference)</span>
                </label>
                <div className="flex flex-wrap gap-2 mb-5">
                  {STYLE_OPTIONS.map((style) => (
                    <button
                      key={style}
                      onClick={() => setSelectedStyle(style)}
                      className={[
                        'px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                        selectedStyle === style ? 'bg-amber text-canvas border-amber' : 'text-white/60 border-canvas-border hover:border-white/30',
                      ].join(' ')}
                    >
                      {style}
                    </button>
                  ))}
                </div>

                <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-2 block">
                  Transcript (optional — powers captions)
                </label>
                <textarea
                  value={transcriptInput}
                  onChange={(e) => setTranscriptInput(e.target.value)}
                  rows={4}
                  placeholder="Paste what's said in your clip here…"
                  className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2.5 text-sm placeholder:text-white/25 resize-none focus:outline-none focus:border-amber/60 mb-6"
                />

                <div className="flex gap-2">
                  <button onClick={skipPlanGeneration} className="px-4 py-2.5 rounded-lg text-sm text-white/50 hover:text-white transition-colors">
                    Skip
                  </button>
                  <div className="flex-1" />
                  <button onClick={runGeneratePlan} className="px-5 py-2.5 rounded-lg text-sm font-medium bg-amber text-canvas hover:bg-amber-bright transition-colors">
                    Generate plan
                  </button>
                </div>
              </>
            ) : (
              <div className="py-8 flex flex-col items-center">
                <div className="w-8 h-8 rounded-full border-2 border-amber border-t-transparent animate-spin mb-5" />
                <span className="font-mono text-sm text-white/70">{GENERATION_STEPS[generationStepIndex]}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- CAPTION PANEL ---------------- */}
      {captionPanelOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-md rounded-2xl bg-canvas-panel border border-canvas-border p-6">
            <h3 className="font-display font-semibold text-lg mb-1">{editingCaptionId ? 'Edit caption' : 'Add caption'}</h3>
            <p className="text-white/40 text-sm mb-5">
              Shown on screen between {formatTime(captionStart)} and {formatTime(captionEnd)}.
            </p>

            <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-2 block">Text</label>
            <textarea
              value={captionText}
              onChange={(e) => setCaptionText(e.target.value)}
              rows={2}
              maxLength={120}
              autoFocus
              placeholder="e.g. Best day of my life"
              className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2.5 text-sm placeholder:text-white/25 resize-none focus:outline-none focus:border-amber/60 mb-4"
            />

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div>
                <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-1.5 block">Start (s)</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={duration}
                  value={captionStart}
                  onChange={(e) => setCaptionStart(parseFloat(e.target.value) || 0)}
                  className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/60"
                />
              </div>
              <div>
                <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-1.5 block">End (s)</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={duration}
                  value={captionEnd}
                  onChange={(e) => setCaptionEnd(parseFloat(e.target.value) || 0)}
                  className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/60"
                />
              </div>
            </div>

            <div className="flex gap-2">
              {editingCaptionId && (
                <button onClick={deleteCaption} className="px-4 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button onClick={closeCaptionPanel} className="px-4 py-2.5 rounded-lg text-sm text-white/50 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={saveCaption}
                disabled={!captionText.trim() || captionEnd <= captionStart}
                className={[
                  'px-5 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  captionText.trim() && captionEnd > captionStart ? 'bg-amber text-canvas hover:bg-amber-bright' : 'bg-canvas-raised text-white/25 cursor-not-allowed',
                ].join(' ')}
              >
                {editingCaptionId ? 'Update' : 'Add caption'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- LAND-BOUNDARY MARKER PANEL ---------------- */}
      {boundaryPanelOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-md rounded-2xl bg-canvas-panel border border-canvas-border p-6">
            <h3 className="font-display font-semibold text-lg mb-1">{editingBoundaryId ? 'Edit land marker' : 'Add land marker'}</h3>
            <p className="text-white/40 text-sm mb-5">
              Draws a fixed yellow box + label between {formatTime(boundaryStart)} and {formatTime(boundaryEnd)}. Position it over the plot in the preview using the sliders below.
            </p>

            <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-2 block">Label</label>
            <input
              type="text"
              value={boundaryLabel}
              onChange={(e) => setBoundaryLabel(e.target.value)}
              maxLength={40}
              autoFocus
              placeholder="e.g. Vadnagar"
              className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber/60 mb-4"
            />

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-1.5 block">Start (s)</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={duration}
                  value={boundaryStart}
                  onChange={(e) => setBoundaryStart(parseFloat(e.target.value) || 0)}
                  className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/60"
                />
              </div>
              <div>
                <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-1.5 block">End (s)</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={duration}
                  value={boundaryEnd}
                  onChange={(e) => setBoundaryEnd(parseFloat(e.target.value) || 0)}
                  className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/60"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-2">
              <PercentSlider label="Left" value={boundaryLeft} onChange={setBoundaryLeft} />
              <PercentSlider label="Top" value={boundaryTop} onChange={setBoundaryTop} />
              <PercentSlider label="Width" value={boundaryWidth} onChange={setBoundaryWidth} />
              <PercentSlider label="Height" value={boundaryHeight} onChange={setBoundaryHeight} />
            </div>

            {/* Live mini-preview of the box position */}
            <div className="relative w-full aspect-video bg-canvas-raised rounded-lg border border-canvas-border mb-6 overflow-hidden">
              <div
                className="absolute border-2 border-yellow-400 bg-yellow-400/20 rounded-sm"
                style={{
                  left: `${boundaryLeft}%`,
                  top: `${boundaryTop}%`,
                  width: `${boundaryWidth}%`,
                  height: `${boundaryHeight}%`,
                }}
              />
            </div>

            <div className="flex gap-2">
              {editingBoundaryId && (
                <button onClick={deleteBoundary} className="px-4 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button onClick={closeBoundaryPanel} className="px-4 py-2.5 rounded-lg text-sm text-white/50 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={saveBoundary}
                disabled={!boundaryLabel.trim() || boundaryEnd <= boundaryStart}
                className={[
                  'px-5 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  boundaryLabel.trim() && boundaryEnd > boundaryStart ? 'bg-amber text-canvas hover:bg-amber-bright' : 'bg-canvas-raised text-white/25 cursor-not-allowed',
                ].join(' ')}
              >
                {editingBoundaryId ? 'Update' : 'Add marker'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- LOGO/WATERMARK PANEL ---------------- */}
      {logoPanelOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-md rounded-2xl bg-canvas-panel border border-canvas-border p-6">
            <h3 className="font-display font-semibold text-lg mb-1">{editingLogoId ? 'Edit logo' : 'Add logo / watermark'}</h3>
            <p className="text-white/40 text-sm mb-5">
              Shown between {formatTime(logoStart)} and {formatTime(logoEnd)}. Upload a PNG with a transparent background for best results.
            </p>

            <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-2 block">Logo image</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleLogoFileChange(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-white/60 mb-4 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-canvas-raised file:text-white/70 file:text-xs hover:file:bg-canvas-border"
            />

            {logoImageDataUrl && (
              <div className="w-full aspect-video bg-canvas-raised rounded-lg border border-canvas-border mb-4 relative overflow-hidden">
                <img
                  src={logoImageDataUrl}
                  alt="Logo preview"
                  className="absolute object-contain"
                  style={{
                    left: `${logoLeft}%`,
                    top: `${logoTop}%`,
                    width: `${logoWidth}%`,
                    height: `${logoHeight}%`,
                  }}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-1.5 block">Start (s)</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={duration}
                  value={logoStart}
                  onChange={(e) => setLogoStart(parseFloat(e.target.value) || 0)}
                  className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/60"
                />
              </div>
              <div>
                <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-1.5 block">End (s)</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={duration}
                  value={logoEnd}
                  onChange={(e) => setLogoEnd(parseFloat(e.target.value) || 0)}
                  className="w-full bg-canvas-raised border border-canvas-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/60"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-6">
              <PercentSlider label="Left" value={logoLeft} onChange={setLogoLeft} />
              <PercentSlider label="Top" value={logoTop} onChange={setLogoTop} />
              <PercentSlider label="Width" value={logoWidth} onChange={setLogoWidth} />
              <PercentSlider label="Height" value={logoHeight} onChange={setLogoHeight} />
            </div>

            <div className="flex gap-2">
              {editingLogoId && (
                <button onClick={deleteLogo} className="px-4 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button onClick={closeLogoPanel} className="px-4 py-2.5 rounded-lg text-sm text-white/50 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={saveLogo}
                disabled={!logoImageDataUrl || logoEnd <= logoStart}
                className={[
                  'px-5 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  logoImageDataUrl && logoEnd > logoStart ? 'bg-amber text-canvas hover:bg-amber-bright' : 'bg-canvas-raised text-white/25 cursor-not-allowed',
                ].join(' ')}
              >
                {editingLogoId ? 'Update' : 'Add logo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ToolbarButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors min-w-[56px]',
        disabled ? 'text-white/20 cursor-not-allowed' : 'text-white/70 hover:bg-canvas-raised hover:text-white cursor-pointer',
      ].join(' ')}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="text-[10px]">{label}</span>
    </button>
  )
}

function PercentSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-white/40 text-xs font-mono uppercase tracking-wide">{label}</label>
        <span className="text-white/50 text-xs font-mono">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-amber"
      />
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
