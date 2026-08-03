import { useEffect, useRef, useState } from 'react'

type TrackType = 'video' | 'overlay' | 'audio'
type OverlayKind = 'caption' | 'boundary'

interface Clip {
  id: string
  track: TrackType
  start: number // seconds
  end: number // seconds
  label: string
  text?: string // caption text, only used when overlayKind === 'caption'
  overlayKind?: OverlayKind // only set for track === 'overlay'; caption clips (from AI plan or "Text") omit this and are treated as captions
  // Land/plot boundary box, as % of the video frame (0-100), plus rotation
  // so it can be angled to trace a real, non-axis-aligned field edge.
  boxLeftPct?: number
  boxTopPct?: number
  boxWidthPct?: number
  boxHeightPct?: number
  boxRotationDeg?: number
}

const PIXELS_PER_SECOND = 70
const TRACK_HEIGHT = 56
const DEFAULT_CAPTION_DURATION = 3 // seconds
const DEFAULT_BOUNDARY_DURATION = 5 // seconds
const DRAG_MOVE_THRESHOLD_PX = 3

const TRACK_META: Record<TrackType, { label: string; color: string; border: string }> = {
  video: { label: 'Video', color: 'bg-amber-dim', border: 'border-amber' },
  overlay: { label: 'Overlays / Captions', color: 'bg-teal-dim', border: 'border-teal' },
  audio: { label: 'Music', color: 'bg-white/10', border: 'border-white/30' },
}

// ---- AI plan generation (SIMULATED — see note below) ----
// Real reference-video content analysis and real audio transcription are not
// wired to a backend yet. This heuristic fakes a plausible result for demo
// purposes: cut length is driven by the chosen style label + video duration,
// and captions come from user-provided transcript text (not real ASR).
const STYLE_OPTIONS = [
  'Cinematic',
  'Fast cuts',
  'Dramatic zooms',
  'Clean & minimal',
  'High energy',
  'Moody color grade',
] as const

const STYLE_SEGMENT_SECONDS: Record<string, number> = {
  'Fast cuts': 2.5,
  'High energy': 2.5,
  'Dramatic zooms': 3.5,
  Cinematic: 5.5,
  'Moody color grade': 5.5,
  'Clean & minimal': 6,
}

// Real numbers from ffmpeg scene-detection run against the actual reference
// reel provided for this demo (WhatsApp_Video_2026-07-14_at_11_31_41.mp4):
// 41.3s, 9:16, 12 detected cuts averaging ~3.4s apart, with a fast sub-1s
// burst around 20-22s and a longer ~10s closing segment. This is genuine
// lightweight style-matching per Phase 1 scope, not a guess.
const REFERENCE_PROFILE = {
  avgCutSeconds: 3.44,
  aspectRatio: '9:16',
  segmentCount: 12,
  note: 'Fast-cut burst detected around 20-22s in reference — consider a quick-cut moment at your highlight.',
}

const GENERATION_STEPS = [
  'Analyzing reference style…',
  'Detecting pacing & rhythm…',
  'Generating cut plan…',
  'Syncing captions…',
]

function buildMockPlan(
  duration: number,
  style: string,
  transcript: string,
  matchReference: boolean,
): { clips: Clip[]; rationale: string[] } {
  const segmentLength = matchReference
    ? REFERENCE_PROFILE.avgCutSeconds
    : STYLE_SEGMENT_SECONDS[style] ?? 4
  const videoClips: Clip[] = []
  let cursor = 0
  let index = 1
  while (cursor < duration) {
    const end = Math.min(cursor + segmentLength, duration)
    videoClips.push({
      id: `ai-clip-${index}-${Date.now()}`,
      track: 'video',
      start: cursor,
      end,
      label: `Clip ${index}`,
    })
    cursor = end
    index++
  }

  const rationale: string[] = [
    `Applied a ~${segmentLength}s average cut length to match the "${style}" style.`,
    `Split raw footage into ${videoClips.length} clips based on reference pacing.`,
  ]

  const captionClips: Clip[] = []
  const sentences = transcript
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sentences.length > 0) {
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0)
    let charCursor = 0
    for (const sentence of sentences) {
      const start = (charCursor / totalChars) * duration
      charCursor += sentence.length
      const end = (charCursor / totalChars) * duration
      captionClips.push({
        id: `ai-caption-${captionClips.length}-${Date.now()}`,
        track: 'overlay',
        start: Math.round(start * 10) / 10,
        end: Math.round(end * 10) / 10,
        label: sentence,
        text: sentence,
      })
    }
    rationale.push(`Synced ${captionClips.length} caption segments from provided transcript.`)
  }

  return { clips: [...videoClips, ...captionClips], rationale }
}

interface TimelineEditorPageProps {
  videoUrl: string
  rawObjectName?: string
  referenceResults?: any[]
  onBackToQuick?: () => void
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

export default function TimelineEditorPage({ videoUrl, onBackToQuick }: TimelineEditorPageProps) {
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
  const [boundaryLeft, setBoundaryLeft] = useState(20)
  const [boundaryTop, setBoundaryTop] = useState(30)
  const [boundaryWidth, setBoundaryWidth] = useState(55)
  const [boundaryHeight, setBoundaryHeight] = useState(35)
  const [boundaryRotation, setBoundaryRotation] = useState(0)

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

  // ---- AI plan generation ----

  const runGeneratePlan = () => {
    setIsGenerating(true)
    setGenerationStepIndex(0)

    const stepDelay = 550
    GENERATION_STEPS.forEach((_, i) => {
      setTimeout(() => setGenerationStepIndex(i), i * stepDelay)
    })

    setTimeout(() => {
      const { clips: planClips, rationale: planRationale } = buildMockPlan(
        duration,
        selectedStyle,
        transcriptInput,
        matchReference,
      )
      setClips(planClips)
      setRationale(planRationale)
      setIsGenerating(false)
      setHasGeneratedPlan(true)
      setPlanModalOpen(false)
    }, GENERATION_STEPS.length * stepDelay)
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
    setBoundaryLeft(20)
    setBoundaryTop(30)
    setBoundaryWidth(55)
    setBoundaryHeight(35)
    setBoundaryRotation(0)
    setBoundaryPanelOpen(true)
  }

  const openEditBoundaryPanel = (clip: Clip) => {
    setEditingBoundaryId(clip.id)
    setBoundaryLabel(clip.text ?? '')
    setBoundaryStart(clip.start)
    setBoundaryEnd(clip.end)
    setBoundaryLeft(clip.boxLeftPct ?? 20)
    setBoundaryTop(clip.boxTopPct ?? 30)
    setBoundaryWidth(clip.boxWidthPct ?? 55)
    setBoundaryHeight(clip.boxHeightPct ?? 35)
    setBoundaryRotation(clip.boxRotationDeg ?? 0)
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
                boxRotationDeg: boundaryRotation,
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
        boxRotationDeg: boundaryRotation,
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

  const handleClipClick = (clip: Clip) => {
    setSelectedClipId(clip.id)
    if (clip.track === 'overlay' && clip.overlayKind === 'boundary') {
      openEditBoundaryPanel(clip)
    } else if (clip.track === 'overlay') {
      openEditCaptionPanel(clip)
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

  const activeCaption = clips.find(
    (c) => c.track === 'overlay' && c.overlayKind !== 'boundary' && playhead >= c.start && playhead < c.end,
  )
  const activeBoundaries = clips.filter(
    (c) => c.track === 'overlay' && c.overlayKind === 'boundary' && playhead >= c.start && playhead < c.end,
  )

  const tracks: TrackType[] = ['video', 'overlay', 'audio']
  const timelineWidth = Math.max(duration * PIXELS_PER_SECOND, 600)

  const tickInterval = duration > 30 ? 5 : 1
  const tickCount = Math.ceil(duration / tickInterval) + 1

  return (
    <div className="min-h-screen bg-canvas text-white font-body flex flex-col">
      <div className="flex-1 flex items-center justify-center bg-black py-8 px-6 min-h-[45vh] relative">
        <div className="relative max-h-full max-w-full">
          <video
            ref={videoRef}
            src={videoUrl}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            className="max-h-full max-w-full rounded-lg block"
          />

          {activeBoundaries.map((b) => (
            <div
              key={b.id}
              className="absolute pointer-events-none"
              style={{
                left: `${b.boxLeftPct}%`,
                top: `${b.boxTopPct}%`,
                width: `${b.boxWidthPct}%`,
                height: `${b.boxHeightPct}%`,
                transform: b.boxRotationDeg ? `rotate(${b.boxRotationDeg}deg)` : undefined,
                transformOrigin: 'center center',
              }}
            >
              <div className="w-full h-full border-[3px] border-yellow-400 rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
              <span className="absolute -top-6 left-0 text-yellow-300 text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-black/70 whitespace-nowrap">
                {b.text}
              </span>
            </div>
          ))}

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

      <div className="flex items-center justify-between px-6 py-3 border-y border-canvas-border bg-canvas-panel">
        <div className="flex items-center gap-1.5">
          <ToolbarButton icon={isPlaying ? '⏸' : '▶'} label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} />
          <ToolbarButton icon="✂" label="Split" onClick={splitSelectedClip} disabled={!canSplit} />
          <ToolbarButton icon="🗑" label="Delete" onClick={deleteSelectedClip} disabled={!selectedClipId} />
          <ToolbarButton icon="T" label="Text" onClick={openNewCaptionPanel} disabled={duration === 0} />
          <ToolbarButton icon="▭" label="Mark Land" onClick={openNewBoundaryPanel} disabled={duration === 0} />
          <ToolbarButton icon="♪" label="Music" disabled />
          <ToolbarButton icon="✨" label="Effects" disabled />
          <ToolbarButton icon="✦" label="AI Plan" onClick={() => setPlanModalOpen(true)} disabled={duration === 0} />
        </div>
        <div className="flex items-center gap-2">
          {onBackToQuick && (
            <button
              onClick={onBackToQuick}
              className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium text-xs transition"
            >
              ⬅️ Quick Generator
            </button>
          )}
          <button 
            onClick={() => alert("Exporting reel synced to timeline audio & clips...")}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold text-sm transition-colors shadow-md"
          >
            🚀 Export Reel
          </button>
        </div>
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
                      return (
                        <button
                          key={clip.id}
                          onMouseDown={(e) => handleClipMouseDown(e, clip)}
                          className={[
                            'absolute top-1.5 bottom-1.5 rounded-md flex items-center px-2.5 text-xs font-medium overflow-hidden transition-colors',
                            isBoundary ? 'bg-yellow-400/20' : meta.color,
                            selected ? `border-2 ${isBoundary ? 'border-yellow-400' : meta.border}` : 'border border-transparent',
                            isBeingDragged ? 'cursor-grabbing opacity-70 z-20 shadow-lg' : 'cursor-grab',
                          ].join(' ')}
                          style={{
                            left: clip.start * PIXELS_PER_SECOND,
                            width: Math.max((clip.end - clip.start) * PIXELS_PER_SECOND - 4, 20),
                            transform: ghostOffset ? `translateX(${ghostOffset}px)` : undefined,
                          }}
                        >
                          <span className={`truncate pointer-events-none ${isBoundary ? 'text-yellow-300' : 'text-white/90'}`}>
                            {isBoundary ? `▭ ${clip.label}` : clip.label}
                          </span>
                        </button>
                      )
                    })}
                  {clips.filter((c) => c.track === track).length === 0 && (
                    <span className="text-white/15 text-xs pl-2 font-mono">
                      {track === 'overlay' ? 'Overlays / Captions — click "Text" or "Mark Land" to add one' : `${TRACK_META[track].label} — empty`}
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
                  <span className="text-xs text-white/70">
                    Match reference reel pacing (~3.4s avg cuts, analyzed from your uploaded reference)
                  </span>
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

      {boundaryPanelOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-md rounded-2xl bg-canvas-panel border border-canvas-border p-6">
            <h3 className="font-display font-semibold text-lg mb-1">
              {editingBoundaryId ? 'Edit land marker' : 'Add land marker'}
            </h3>
            <p className="text-white/40 text-sm mb-5">
              Draws a yellow boundary box + label between {formatTime(boundaryStart)} and {formatTime(boundaryEnd)}.
              Use rotation to angle it along the real field edge, like the reference reel. It stays fixed in
              place for that time range, so pick a moment where the camera isn't panning much.
            </p>

            <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-2 block">Label / Name</label>
            <input
              type="text"
              value={boundaryLabel}
              onChange={(e) => setBoundaryLabel(e.target.value)}
              autoFocus
              placeholder="e.g. Ramesh ji ki zameen"
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

            <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-2 block">
              Box position (% of frame) &amp; rotation
            </label>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <BoundarySlider label="Left" value={boundaryLeft} onChange={setBoundaryLeft} />
              <BoundarySlider label="Top" value={boundaryTop} onChange={setBoundaryTop} />
              <BoundarySlider label="Width" value={boundaryWidth} onChange={setBoundaryWidth} />
              <BoundarySlider label="Height" value={boundaryHeight} onChange={setBoundaryHeight} />
              <BoundarySlider
                label="Rotation"
                value={boundaryRotation}
                onChange={setBoundaryRotation}
                min={-45}
                max={45}
                unit="°"
              />
            </div>

            {/* Live mini preview of box position + rotation, over the actual current video frame */}
            <div className="relative w-full aspect-[9/16] max-h-40 mx-auto bg-black/40 rounded-lg border border-canvas-border overflow-hidden mb-6">
              <div
                className="absolute border-2 border-yellow-400 rounded-sm"
                style={{
                  left: `${boundaryLeft}%`,
                  top: `${boundaryTop}%`,
                  width: `${boundaryWidth}%`,
                  height: `${boundaryHeight}%`,
                  transform: boundaryRotation ? `rotate(${boundaryRotation}deg)` : undefined,
                  transformOrigin: 'center center',
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
    </div>
  )
}

function BoundarySlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  unit = '%',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  unit?: string
}) {
  return (
    <div>
      <div className="flex justify-between text-white/40 text-[10px] font-mono uppercase tracking-wide mb-1">
        <span>{label}</span>
        <span>{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-amber"
      />
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
