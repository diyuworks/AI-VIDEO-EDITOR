import { useState } from 'react'
import UploadPage from './features/upload/UploadPage'
import PromptInputPage from './features/prompt/PromptInputPage'
import TimelineEditorPage from './features/timeline/TimelineEditorPage'
import ReelGeneratorPage from './pages/ReelGeneratorPage'

type Screen = 'upload' | 'prompt' | 'timeline' | 'reel'

export interface PromptData {
  presets: string[]
  prompt: string
}

function App() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [referenceResults, setReferenceResults] = useState<any[]>([])
  const [rawObjectName, setRawObjectName] = useState<string | null>(null)
  const [promptData, setPromptData] = useState<PromptData | null>(null)

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#0F0F11' }}>
      {/* Top Bar Quick Access Button for Live Demo */}
      <button
        onClick={() => setScreen('reel')}
        style={{
          position: 'fixed',
          top: 14,
          right: 14,
          zIndex: 9999,
          padding: '10px 18px',
          background: '#FFEB3B',
          color: '#000000',
          borderRadius: 10,
          fontWeight: 700,
          fontSize: '14px',
          cursor: 'pointer',
          border: '2px solid #000',
          boxShadow: '0 4px 12px rgba(255,235,59,0.4)',
        }}
      >
        🎬 Launch Real Estate Reel Generator
      </button>

      {screen === 'upload' && (
        <UploadPage
          onContinue={(data) => {
            console.log('Backend upload result:', data.uploadResult)
            if (data.sourceFile) {
              setVideoUrl(URL.createObjectURL(data.sourceFile))
            }
            setReferenceResults(data.referenceUploadResults || [])
            if (data.uploadResult?.object_name) {
              setRawObjectName(data.uploadResult.object_name)
            }
            setScreen('prompt')
          }}
        />
      )}

      {screen === 'prompt' && (
        <PromptInputPage
          onContinue={(data) => {
            console.log('Prompt submitted:', data)
            setPromptData(data)
            setScreen('timeline')
          }}
        />
      )}

      {screen === 'timeline' && (
        <TimelineEditorPage
          videoUrl={videoUrl || ''}
          referenceResults={referenceResults}
          rawObjectName={rawObjectName || undefined}
        />
      )}

      {screen === 'reel' && (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
          <div className="bg-white p-6 rounded-xl shadow-md w-full max-w-4xl flex justify-center text-black">
            <ReelGeneratorPage
              rawVideoObjectName={rawObjectName || 'clip_1.mp4'}
              referenceObjectName={referenceResults?.[0]?.object_name || undefined}
              prompt={promptData?.prompt}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
