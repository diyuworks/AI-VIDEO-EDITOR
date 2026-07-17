import { useEffect, useRef, useState } from 'react'

type TrackType = 'video' | 'overlay' | 'audio'

interface Clip {
  id: string
  track: TrackType
  start: number // seconds
  end: number // seconds
  label: string
  playbackRate?: number
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
  objectName: string
  referenceObjectName?: string | null
  promptData: { presets: string[]; prompt: string }
}

export default function TimelineEditorPage({ videoUrl, objectName, referenceObjectName, promptData }: TimelineEditorPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)

  const [duration, setDuration] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0) // Original video duration (without end screen)
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState('Initializing...')
  const [wordBoundaries, setWordBoundaries] = useState<any[]>([])
  
  // Export State
  const [exportAudioId, setExportAudioId] = useState<string | null>(null)
  const [exportScript, setExportScript] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const handleLoadedMetadata = () => {
    const d = videoRef.current?.duration ?? 0
    setDuration(d)
    setVideoDuration(d)
    
    // Update all clips to match true video duration
    setClips(prev => {
      if (prev.length === 0) return prev
      
      // Deep copy to prevent React state mutation bugs!
      const updated = prev.map(c => ({ ...c }))
      
      updated.forEach(c => {
        if (c.track === 'video' || c.track === 'audio') {
          c.end = d
        }
      })
      
      // Fix dynamic overlay chunks to stretch across full video duration
      const genOverlays = updated.filter(c => c.id.startsWith('cap-gen-'))
      if (genOverlays.length > 0) {
        const timePerChunk = d / genOverlays.length
        genOverlays.forEach((c, i) => {
          c.start = i * timePerChunk
          c.end = (i + 1) * timePerChunk
        })
      }
      return updated
    })
  }
  
  // Watch for duration changes in case metadata loads after clips are generated
  useEffect(() => {
     if (duration > 0 && clips.length > 0) {
        // Just trigger the same logic
        handleLoadedMetadata()
     }
  }, [duration])

  // Fetch AI Plan & Captions
  useEffect(() => {
    let isMounted = true
    
    const generatePlan = async () => {
      try {
        setIsLoading(true)
        
        // 1. Generate Captions (from reference video if available, else main video)
        const targetObjectForCaptions = referenceObjectName || objectName
        setLoadingMsg(`Analyzing audio & generating script (Whisper AI) from ${referenceObjectName ? 'reference' : 'video'}...`)
        const capRes = await fetch(`http://localhost:8000/captions/${targetObjectForCaptions}`, { method: 'POST' })
        if (!capRes.ok) throw new Error('Failed to generate captions')
        const capData = await capRes.json()
        
        if (!isMounted) return
        
        // 2. Generate Editing Plan
        setLoadingMsg('Structuring editing plan (Groq AI)...')
        const planRes = await fetch('http://localhost:8000/editing-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            object_name: objectName,
            reference_object_name: referenceObjectName || null, // Optional
            prompt: promptData.prompt,
            structured_options: { presets: promptData.presets },
            reference_captions: capData.captions // Pass the extracted script so Groq knows what to adapt
          })
        })
        if (!planRes.ok) throw new Error('Failed to generate editing plan')
        const planData = await planRes.json()
        
        if (!isMounted) return

        // 3. Generate TTS from the generated script
        let ttsAudioId = 'audio-main'
        let ttsAudioUrl = ''
        
        if (planData.editing_plan.generated_script) {
          setLoadingMsg('Generating AI Voiceover (Edge TTS)...')
          try {
            const ttsRes = await fetch('http://localhost:8000/generate-tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: planData.editing_plan.generated_script })
            })
            if (ttsRes.ok) {
              const ttsData = await ttsRes.json()
              ttsAudioId = ttsData.audio_id
              ttsAudioUrl = ttsData.audio_url
              setExportAudioId(ttsData.audio_id)
              if (ttsData.word_boundaries) {
                setWordBoundaries(ttsData.word_boundaries)
              }
            }
          } catch (e) {
            console.error('Failed to generate TTS', e)
          }
          setExportScript(planData.editing_plan.generated_script)
        }
        
        if (!isMounted) return

        // Determine true duration to prevent React closure bugs
        const currentDuration = videoRef.current?.duration || duration || 10;

        let actualAudioDuration = currentDuration;
        let speedRatio = 1.0;
        if (ttsAudioId !== 'audio-main' && ttsAudioUrl) {
          // Fetch true duration of the generated audio for perfect caption sync
          const audioDur = await new Promise<number>((resolve) => {
            const tempAudio = new Audio(ttsAudioUrl);
            tempAudio.addEventListener('loadedmetadata', () => resolve(tempAudio.duration));
            tempAudio.addEventListener('error', () => resolve(currentDuration));
          });
          if (audioDur > 0) {
            speedRatio = audioDur / currentDuration;
          }
        }

        // 4. Assemble clips
        const newClips: Clip[] = []
        
        // Base video clip
        newClips.push({
          id: 'video-main',
          track: 'video',
          start: 0,
          end: currentDuration, 
          label: 'Original Footage'
        })
        
        // Dynamic Captions clips (from generated script)
        if (wordBoundaries && wordBoundaries.length > 0) {
          // PERFECT SYNC: Group exact word boundaries from TTS into natural chunks
          let currentChunk = [];
          let chunkIndex = 0;
          for (let i = 0; i < wordBoundaries.length; i++) {
            currentChunk.push(wordBoundaries[i]);
            
            const isSentenceEnd = /[.!?।]/.test(wordBoundaries[i].text);
            const isComma = /,/.test(wordBoundaries[i].text);
            
            // Group up to 6 words to allow full addresses to stay together
            // Break immediately on Full Stops (.) so new sentences always get a fresh caption!
            // Break on commas only if we already have 4+ words.
            if (currentChunk.length >= 6 || isSentenceEnd || (isComma && currentChunk.length >= 4) || i === wordBoundaries.length - 1) {
              
              let start = currentChunk[0].start;
              let end = currentChunk[currentChunk.length - 1].end;
              
              // Prevent "aage piche" flickering! Extend end time to bridge short silences between words
              if (i + 1 < wordBoundaries.length) {
                 const nextWordStart = wordBoundaries[i + 1].start;
                 const gap = nextWordStart - end;
                 if (gap > 0 && gap < 1.0) { 
                    end = nextWordStart; // Fill the gap perfectly
                 } else if (gap >= 1.0) {
                    end += 0.3; // Small padding for large gaps
                 }
              } else {
                 // Final word padding + extend by 5 seconds to show over the JAMIN24 end screen image
                 end += 5.5;
              }
              
              newClips.push({
                id: `cap-gen-${chunkIndex++}`,
                track: 'overlay',
                start: start,
                end: end,
                label: currentChunk.map(w => w.text).join(' ')
              });
              currentChunk = [];
            }
          }
        } else if (planData.editing_plan.generated_script) {
          // Break the script into smaller chunks (3 words each for punchy, dynamic captions)
          const words = planData.editing_plan.generated_script.split(/\s+/);
          const chunks = [];
          let currentChunk = [];
          for (let i = 0; i < words.length; i++) {
            currentChunk.push(words[i]);
            if (currentChunk.length >= 3 || i === words.length - 1) {
              chunks.push(currentChunk.join(' '));
              currentChunk = [];
            }
          }

          // Character-weighted proportional timing for PERFECT voice sync!
          // This ensures long words stay on screen longer, matching exactly how the AI speaks.
          const totalChars = chunks.reduce((acc, text) => acc + text.length, 0);
          let currentTime = 0;
          
          chunks.forEach((text, i) => {
            // Add a baseline weight (5) to ensure even short words get enough readable time
            const weight = text.length + 5; 
            const totalWeight = totalChars + (chunks.length * 5);
            let chunkDuration = (weight / totalWeight) * actualAudioDuration;
            
            // If it's the last chunk, extend it by 5 seconds so it displays over the end screen
            if (i === chunks.length - 1) {
              chunkDuration += 5;
            }
            
            newClips.push({
              id: `cap-gen-${i}`,
              track: 'overlay',
              start: currentTime,
              end: currentTime + chunkDuration,
              label: text
            });
            currentTime += chunkDuration;
          });
        } else if (capData.captions && capData.captions.length > 0) {
          // Fallback to reference captions
          capData.captions.forEach((c: any, i: number) => {
            newClips.push({
              id: `cap-${i}`,
              track: 'overlay',
              start: c.start,
              end: c.end,
              label: c.text
            })
          })
        }
        
        // End Screen clip (last 5 seconds — JAMIN24 branding image)
        newClips.push({
          id: 'end-screen',
          track: 'video',
          start: currentDuration,
          end: currentDuration + 5,
          label: 'End Screen (JAMIN24)'
        })

        // Audio clip (AI Voiceover)
        newClips.push({
          id: ttsAudioId,
          track: 'audio',
          start: 0,
          end: currentDuration, // Force it to span EXACTLY the video duration
          label: 'AI Voiceover (Generated)',
          playbackRate: speedRatio
        })
        
        setClips(newClips)
        setDuration(currentDuration + 5) // Extend timeline to include 5s end screen
        setIsLoading(false)
        
      } catch (err: any) {
        console.error(err)
        if (isMounted) {
          setLoadingMsg(`Error: ${err.message || 'Failed to generate plan'}. Check console/backend logs.`)
          // Don't auto-hide the error immediately so they can read it
          setTimeout(() => setIsLoading(false), 5000)
        }
      }
    }
    
    generatePlan()
    
    return () => { isMounted = false }
  }, [objectName, promptData])

  const handleTimeUpdate = () => {
    if (videoRef.current) setPlayhead(videoRef.current.currentTime)
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      // If video has finished completely (at or past total duration), restart from beginning
      if (playhead >= duration - 0.1) {
        videoRef.current.currentTime = 0
        setPlayhead(0)
        videoRef.current.play()
        setIsPlaying(true)
        return
      }
      // If we're in the end screen phase (past video, but not finished), just resume the timer
      if (playhead >= videoDuration && videoDuration > 0) {
        setIsPlaying(true)
        return
      }
      videoRef.current.play()
      setIsPlaying(true)
    }
  }

  // Timer to advance playhead during end screen (video element is not playing anymore)
  useEffect(() => {
    if (!isPlaying || videoDuration <= 0 || playhead < videoDuration) return
    if (playhead >= duration) {
      setIsPlaying(false)
      return
    }
    const interval = setInterval(() => {
      setPlayhead(prev => {
        const next = prev + 0.05
        if (next >= duration) {
          setIsPlaying(false)
          clearInterval(interval)
          return duration
        }
        return next
      })
    }, 50)
    return () => clearInterval(interval)
  }, [isPlaying, playhead >= videoDuration, duration, videoDuration])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => {
      // Don't stop isPlaying if video ended naturally — end screen timer will take over
      if (video.ended) return
      setIsPlaying(false)
    }
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

  // --- Perfect Audio Synchronization for TTS ---
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioClipIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    if (!isPlaying) {
      audioRef.current.pause();
      return;
    }

    // Find the audio clip in the timeline that the playhead is currently inside
    const audioClip = clips.find(c => c.track === 'audio' && playhead >= c.start && playhead < c.end);
    const audioClipId = audioClip?.id || null;
    
    // If we have an AI voiceover clip that should be playing right now!
    if (audioClipId && audioClipId !== 'audio-main' && audioClipId !== currentAudioClipIdRef.current) {
      audioRef.current.src = `http://localhost:8000/tts-file/${audioClipId}.mp3`;
      
      const rate = audioClip?.playbackRate || 1.0;
      audioRef.current.playbackRate = rate;
      
      // Sync it to the current playhead (scaled by playbackRate to match original audio time)
      audioRef.current.currentTime = playhead * rate;
      audioRef.current.play().catch(err => console.log('Audio error:', err));
      currentAudioClipIdRef.current = audioClipId;
    } 
    else if (!audioClipId || audioClipId === 'audio-main') {
      audioRef.current.pause();
      currentAudioClipIdRef.current = null;
    }
    else if (audioRef.current.paused) {
      const rate = audioClip?.playbackRate || 1.0;
      audioRef.current.playbackRate = rate;
      // Sync it to the current playhead before resuming
      if (Math.abs(audioRef.current.currentTime - (playhead * rate)) > 0.5) {
        audioRef.current.currentTime = playhead * rate;
      }
      audioRef.current.play().catch(err => console.log('Audio error:', err));
    }

  }, [isPlaying, clips, playhead]);

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
      {isLoading && (
        <div className="absolute inset-0 z-50 bg-canvas/90 backdrop-blur flex flex-col items-center justify-center">
          <div className="w-14 h-14 mb-4 rounded-full border-2 border-teal/30 border-t-teal animate-spin" />
          <p className="font-mono text-teal tracking-wide">{loadingMsg}</p>
        </div>
      )}
      {/* ---------------- PREVIEW ---------------- */}
      <div className="flex-1 flex items-center justify-center bg-black py-8 px-6 min-h-[45vh]">
        <div className="relative h-full w-full flex items-center justify-center">
          {/* Video — always in DOM, hidden via opacity during end screen so it keeps its space */}
          <video
            ref={videoRef}
            src={videoUrl}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            className="max-h-full max-w-full rounded-lg"
            style={{ opacity: videoDuration > 0 && playhead >= videoDuration ? 0 : 1 }}
            muted
          />
          {/* End screen image — shown on top during last 5 seconds */}
          {videoDuration > 0 && playhead >= videoDuration && (
            <img
              src="http://localhost:8000/assets/end_screen.PNG"
              alt="End Screen - JAMIN24"
              className="absolute inset-0 m-auto max-h-full max-w-full rounded-lg object-contain z-20"
            />
          )}
          {/* Caption Overlay */}
          {displayCaption && (
            <div className="absolute bottom-10 left-0 w-full flex justify-center px-4 z-10 pointer-events-none">
              <p className="text-white text-3xl md:text-4xl font-black text-center px-4 py-2 max-w-[90%] break-words leading-tight" style={{
                textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 4px 15px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.5)',
                fontFamily: '"Hind Vadodara", "Mukta Vaani", sans-serif'
              }}>
                {displayCaption}
              </p>
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
          onClick={async () => {
            if (!exportAudioId || !exportScript) {
              alert('Wait for AI plan to finish generating before exporting!');
              return;
            }
            try {
              setIsExporting(true);
              const res = await fetch('http://localhost:8000/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  object_name: objectName,
                  audio_id: exportAudioId,
                  generated_script: exportScript,
                  word_boundaries: wordBoundaries
                })
              });
              
              if (!res.ok) {
                throw new Error('Export failed on backend');
              }
              
              // Trigger download of the returned blob
              const blob = await res.blob();
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.style.display = 'none';
              a.href = url;
              a.download = 'AI_Edited_Video.mp4';
              document.body.appendChild(a);
              a.click();
              window.URL.revokeObjectURL(url);
              document.body.removeChild(a);
              
            } catch (err) {
              console.error(err);
              alert('Failed to export video.');
            } finally {
              setIsExporting(false);
            }
          }}
          disabled={isExporting}
          className="px-5 py-2 rounded-lg bg-amber text-canvas font-medium text-sm hover:bg-amber-bright transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isExporting ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-canvas border-t-transparent animate-spin" />
              Exporting...
            </>
          ) : (
            'Export'
          )}
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
