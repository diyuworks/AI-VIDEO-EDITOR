import { useEffect, useRef, useState } from 'react'

type TrackType = 'video' | 'overlay' | 'audio'

interface Clip {
  id: string
  track: TrackType
  start: number // seconds
  end: number // seconds
  label: string
}

const PIXELS_PER_SECOND = 70
const TRACK_HEIGHT = 56

const TRACK_META: Record<TrackType, { label: string; color: string; border: string }> = {
  video: { label: 'Video', color: 'bg-amber-dim', border: 'border-amber' },
  overlay: { label: 'Overlays / Captions', color: 'bg-teal-dim', border: 'border-teal' },
  audio: { label: 'Music', color: 'bg-white/10', border: 'border-white/30' },
}

interface TimelineEditorPageProps {
  videoUrl: string
}

export default function TimelineEditorPage({ videoUrl }: TimelineEditorPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)

  const [duration, setDuration] = useState(0)
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // Once we know the video's real duration, seed the timeline with one
  // full-length clip on the video track. Real scene-detected clips will
  // replace this once the backend's scene detection endpoint exists.
  const handleLoadedMetadata = () => {
    const d = videoRef.current?.duration ?? 0
    setDuration(d)
    setClips([{ id: 'clip-1', track: 'video', start: 0, end: d, label: 'Clip 1' }])
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

  const selectedClip = clips.find((c) => c.id === selectedClipId)
  const canSplit =
    !!selectedClip && playhead > selectedClip.start && playhead < selectedClip.end

  const tracks: TrackType[] = ['video', 'overlay', 'audio']
  const timelineWidth = Math.max(duration * PIXELS_PER_SECOND, 600)

  // Ruler tick every 5 seconds, or every 1s for very short clips
  const tickInterval = duration > 30 ? 5 : 1
  const tickCount = Math.ceil(duration / tickInterval) + 1

  return (
    <div className="min-h-screen bg-canvas text-white font-body flex flex-col">
      {/* ---------------- PREVIEW ---------------- */}
      <div className="flex-1 flex items-center justify-center bg-black py-8 px-6 min-h-[45vh]">
        <video
          ref={videoRef}
          src={videoUrl}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          className="max-h-full max-w-full rounded-lg"
        />
      </div>

      {/* ---------------- TOOLBAR ---------------- */}
      <div className="flex items-center justify-between px-6 py-3 border-y border-canvas-border bg-canvas-panel">
        <div className="flex items-center gap-1.5">
          <ToolbarButton icon={isPlaying ? '⏸' : '▶'} label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} />
          <ToolbarButton
            icon="✂"
            label="Split"
            onClick={splitSelectedClip}
            disabled={!canSplit}
          />
          <ToolbarButton
            icon="🗑"
            label="Delete"
            onClick={deleteSelectedClip}
            disabled={!selectedClipId}
          />
          <ToolbarButton icon="T" label="Text" disabled />
          <ToolbarButton icon="♪" label="Music" disabled />
          <ToolbarButton icon="✨" label="Effects" disabled />
          <span className="text-white/20 text-xs font-mono ml-2">
            (Text / Music / Effects — coming next)
          </span>
        </div>
        <button className="px-5 py-2 rounded-lg bg-amber text-canvas font-medium text-sm hover:bg-amber-bright transition-colors">
          Export
        </button>
      </div>

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
            {/* Ruler */}
            <div
              onClick={handleRulerClick}
              className="relative h-6 border-b border-canvas-border cursor-pointer select-none"
            >
              {Array.from({ length: tickCount }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full flex flex-col items-start"
                  style={{ left: i * tickInterval * PIXELS_PER_SECOND }}
                >
                  <div className="w-px h-2 bg-white/20" />
                  <span className="text-[10px] text-white/30 font-mono">
                    {formatTime(i * tickInterval)}
                  </span>
                </div>
              ))}
            </div>

            {/* Tracks */}
            <div className="relative mt-1">
              {/* Playhead line */}
              <div
                className="absolute top-0 bottom-0 w-px bg-amber z-10 pointer-events-none"
                style={{ left: playhead * PIXELS_PER_SECOND }}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-amber -translate-x-1/2" />
              </div>

              {tracks.map((track) => (
                <div
                  key={track}
                  className="relative border-b border-canvas-border/60 flex items-center"
                  style={{ height: TRACK_HEIGHT }}
                >
                  <div className="absolute -left-0 text-[10px] font-mono text-white/25 hidden" />
                  {clips
                    .filter((c) => c.track === track)
                    .map((clip) => {
                      const meta = TRACK_META[clip.track]
                      const selected = clip.id === selectedClipId
                      return (
                        <button
                          key={clip.id}
                          onClick={() => setSelectedClipId(clip.id)}
                          className={[
                            'absolute top-1.5 bottom-1.5 rounded-md flex items-center px-2.5 text-xs font-medium overflow-hidden transition-all',
                            meta.color,
                            selected ? `border-2 ${meta.border}` : 'border border-transparent',
                          ].join(' ')}
                          style={{
                            left: clip.start * PIXELS_PER_SECOND,
                            width: Math.max((clip.end - clip.start) * PIXELS_PER_SECOND - 4, 20),
                          }}
                        >
                          <span className="truncate text-white/90">{clip.label}</span>
                        </button>
                      )
                    })}
                  {clips.filter((c) => c.track === track).length === 0 && (
                    <span className="text-white/15 text-xs pl-2 font-mono">
                      {TRACK_META[track].label} — empty
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Track labels legend */}
        <div className="flex gap-4 mt-3">
          {tracks.map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${TRACK_META[t].color}`} />
              <span className="text-white/30 text-xs">{TRACK_META[t].label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors min-w-[56px]',
        disabled
          ? 'text-white/20 cursor-not-allowed'
          : 'text-white/70 hover:bg-canvas-raised hover:text-white cursor-pointer',
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
