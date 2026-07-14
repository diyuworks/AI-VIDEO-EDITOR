import { useState } from 'react'

interface StylePreset {
  id: string
  label: string
}

const STYLE_PRESETS: StylePreset[] = [
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'fast-cuts', label: 'Fast cuts' },
  { id: 'dramatic-zooms', label: 'Dramatic zooms' },
  { id: 'clean-minimal', label: 'Clean & minimal' },
  { id: 'high-energy', label: 'High energy' },
  { id: 'moody-grade', label: 'Moody color grade' },
]

interface PromptInputPageProps {
  onContinue?: (data: { presets: string[]; prompt: string }) => void
}

export default function PromptInputPage({ onContinue }: PromptInputPageProps) {
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set())
  const [prompt, setPrompt] = useState('')

  const togglePreset = (id: string) => {
    setSelectedPresets((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const canContinue = selectedPresets.size > 0 || prompt.trim().length > 0

  return (
    <div className="min-h-screen bg-canvas text-white font-body flex flex-col items-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <header className="mb-10 text-center">
          <h1 className="font-display font-semibold text-3xl tracking-tight">
            How should we edit it?
          </h1>
          <p className="text-white/50 mt-2 text-sm">
            Pick a style, describe it in your own words, or both.
          </p>
        </header>

        {/* ---------------- STYLE PRESET CHIPS ---------------- */}
        <div className="mb-8">
          <p className="text-white/40 text-xs font-mono uppercase tracking-wide mb-3">
            Style presets
          </p>
          <div className="flex flex-wrap gap-2">
            {STYLE_PRESETS.map((preset) => {
              const active = selectedPresets.has(preset.id)
              return (
                <button
                  key={preset.id}
                  onClick={() => togglePreset(preset.id)}
                  className={[
                    'px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 border',
                    active
                      ? 'bg-amber text-canvas border-amber'
                      : 'bg-canvas-panel text-white/70 border-canvas-border hover:border-white/30 hover:text-white',
                  ].join(' ')}
                >
                  {active && <span className="mr-1.5">✓</span>}
                  {preset.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ---------------- FREE TEXT PROMPT ---------------- */}
        <div className="mb-8">
          <label className="text-white/40 text-xs font-mono uppercase tracking-wide mb-3 block">
            Describe it, if you want to add more detail
          </label>
          <div className="relative rounded-xl border-2 border-canvas-border bg-canvas-panel focus-within:border-amber/60 transition-colors">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='e.g. "Make it feel like a travel vlog, with quick cuts on the beat and warm tones"'
              rows={4}
              maxLength={500}
              className="w-full bg-transparent px-4 py-3.5 text-sm placeholder:text-white/25 resize-none focus:outline-none"
            />
            <span className="absolute bottom-2.5 right-3.5 text-white/20 text-xs font-mono">
              {prompt.length}/500
            </span>
          </div>
        </div>

        {/* ---------------- CONTINUE ---------------- */}
        <button
          disabled={!canContinue}
          onClick={() =>
            onContinue?.({ presets: Array.from(selectedPresets), prompt: prompt.trim() })
          }
          className={[
            'w-full py-3.5 rounded-xl font-medium transition-all duration-150',
            canContinue
              ? 'bg-amber text-canvas hover:bg-amber-bright cursor-pointer'
              : 'bg-canvas-panel text-white/25 cursor-not-allowed border border-canvas-border',
          ].join(' ')}
        >
          Generate editing plan
        </button>
        {!canContinue && (
          <p className="text-white/25 text-xs text-center mt-2.5">
            Pick at least one style, or describe what you want.
          </p>
        )}
      </div>
    </div>
  )
}
