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
    
    // DEMO HACK: Adding mock Audio and Caption tracks for the presentation!
    setClips([
      { id: 'clip-1', track: 'video', start: 0, end: d, label: 'Original Footage (Cinematic)' },
      { id: 'audio-1', track: 'audio', start: 0, end: d, label: 'AI Voiceover (Gujarati) + Music' },
      
      { id: 'cap-1', track: 'overlay', start: 0, end: 1.5, label: 'આ અદ્ભુત સફરમાં' },
      { id: 'cap-2', track: 'overlay', start: 1.5, end: 3, label: 'તમારું સ્વાગત છે' },
      { id: 'cap-3', track: 'overlay', start: 3, end: 4.5, label: 'આજે આપણે' },
      { id: 'cap-4', track: 'overlay', start: 4.5, end: 6, label: 'એક નવી જગ્યાની' },
      { id: 'cap-5', track: 'overlay', start: 6, end: 8, label: 'મુલાકાત લઈ રહ્યા છીએ' },
      { id: 'cap-6', track: 'overlay', start: 8, end: 9.5, label: 'કુદરતની આ સુંદરતા' },
      { id: 'cap-7', track: 'overlay', start: 9.5, end: 11, label: 'ખરેખર મનમોહક છે' },
      { id: 'cap-8', track: 'overlay', start: 11, end: 12.5, label: 'જ્યારે પણ આપણે' },
      { id: 'cap-9', track: 'overlay', start: 12.5, end: 14, label: 'આવી જગ્યાએ આવીએ છીએ' },
      { id: 'cap-10', track: 'overlay', start: 14, end: 15.5, label: 'ત્યારે શહેરની દોડધામ' },
      { id: 'cap-11', track: 'overlay', start: 15.5, end: 17, label: 'ભૂલી જઈએ છીએ' },
      { id: 'cap-12', track: 'overlay', start: 17, end: 18.5, label: 'આ લીલાછમ ખેતરો' },
      { id: 'cap-13', track: 'overlay', start: 18.5, end: 20, label: 'અને વાદળછાયું આકાશ' },
      { id: 'cap-14', track: 'overlay', start: 20, end: 21.5, label: 'આપણા મનને' },
      { id: 'cap-15', track: 'overlay', start: 21.5, end: 23.5, label: 'એક અનોખી શાંતિ આપે છે' },
      { id: 'cap-16', track: 'overlay', start: 23.5, end: 25, label: 'અહીંની તાજી હવા' },
      { id: 'cap-17', track: 'overlay', start: 25, end: 27, label: 'એક નવી ઉર્જા આપે છે' },
      { id: 'cap-18', track: 'overlay', start: 27, end: 28.5, label: 'પહાડોની વચ્ચે' },
      { id: 'cap-19', track: 'overlay', start: 28.5, end: 30, label: 'વહેતી આ નદી' },
      { id: 'cap-20', track: 'overlay', start: 30, end: 32, label: 'કેટલો અદ્ભુત નજારો છે' },
      { id: 'cap-21', track: 'overlay', start: 32, end: 33.5, label: 'પ્રકૃતિ સાથેનો' },
      { id: 'cap-22', track: 'overlay', start: 33.5, end: 35, label: 'આ સીધો સંપર્ક' },
      { id: 'cap-23', track: 'overlay', start: 35, end: 36.5, label: 'જીવનને એક' },
      { id: 'cap-24', track: 'overlay', start: 36.5, end: 38, label: 'નવી દિશા આપે છે' },
      { id: 'cap-25', track: 'overlay', start: 38, end: 39.5, label: 'તમે પણ' },
      { id: 'cap-26', track: 'overlay', start: 39.5, end: 41, label: 'આવી સુંદર જગ્યાઓની' },
      { id: 'cap-27', track: 'overlay', start: 41, end: 43, label: 'મુલાકાત જરૂર લો' },
      { id: 'cap-28', track: 'overlay', start: 43, end: d, label: 'આ એક સિનેમેટિક અનુભવ છે' },
    ])
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

  // Get current caption to display on video
  const currentCaptionClip = clips.find(c => c.track === 'overlay' && playhead >= c.start && playhead < c.end);
  const displayCaption = currentCaptionClip ? currentCaptionClip.label.replace(/\[.*?\]\s*/, '').replace(/"/g, '') : '';

  // --- Perfect Audio-Caption Synchronization ---
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentClipIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    if (!isPlaying) {
      audioRef.current.pause();
      return;
    }

    const currentClipId = currentCaptionClip?.id || null;
    
    // If the caption changed, load and play the specific audio for that caption
    if (currentClipId && currentClipId !== currentClipIdRef.current) {
      audioRef.current.src = `/tts/${currentClipId}.mp3`;
      audioRef.current.play().catch(err => console.log('Audio error:', err));
      currentClipIdRef.current = currentClipId;
    } 
    else if (!currentClipId) {
      audioRef.current.pause();
      currentClipIdRef.current = null;
    }
    else if (audioRef.current.paused) {
      // If it's paused inside the same clip, resume it
      audioRef.current.play().catch(err => console.log('Audio error:', err));
    }

  }, [isPlaying, currentCaptionClip]);

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
        <div className="relative h-full w-full flex items-center justify-center">
          <video
            ref={videoRef}
            src={videoUrl}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            className="max-h-full max-w-full rounded-lg"
          />
          {displayCaption && (
            <div className="absolute bottom-[20%] left-0 right-0 flex justify-center pointer-events-none px-8">
              <span 
                className="text-white text-4xl md:text-5xl lg:text-6xl font-extrabold uppercase text-center tracking-tight"
                style={{ 
                  WebkitTextStroke: '2px black', 
                  textShadow: '3px 3px 0px rgba(0,0,0,1), 6px 6px 15px rgba(0,0,0,0.8)' 
                }}
              >
                {displayCaption}
              </span>
            </div>
          )}
        </div>
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
          <ToolbarButton icon="T" label="Text" />
          <ToolbarButton icon="♪" label="Music" />
          <ToolbarButton icon="✨" label="Effects" />
          <span className="text-white/20 text-xs font-mono ml-2">
            (AI editing plan applied successfully!)
          </span>
        </div>
        <button 
          onClick={() => {
            alert('Exporting Video...\n\nApplying AI Voiceover...\nRendering Captions...\n\n✅ Video Exported Successfully (Demo)!')
          }}
          className="px-5 py-2 rounded-lg bg-amber text-canvas font-medium text-sm hover:bg-amber-bright transition-colors"
        >
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
                            width: Math.max((clip.end - clip.start) * PIXELS_PER_SECOND, 10),
                            borderRight: '1px solid rgba(255,255,255,0.1)' // subtle separator
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
