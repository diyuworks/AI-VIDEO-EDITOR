import { useState, useEffect } from 'react'
import UploadPage from './features/upload/UploadPage'
import PromptInputPage from './features/prompt/PromptInputPage'
import TimelineEditorPage from './features/timeline/TimelineEditorPage'
import ReelGeneratorPage from './pages/ReelGeneratorPage'
import { Jamin24Header } from './components/Jamin24Header'

type Screen = 'upload' | 'prompt' | 'timeline' | 'reel'

export interface PromptData {
  presets: string[]
  prompt: string
}

function App() {
  const [screen, setScreen] = useState<Screen>('reel')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [referenceResults, setReferenceResults] = useState<any[]>([])
  const [rawObjectName, setRawObjectName] = useState<string | null>(null)
  const [promptData, setPromptData] = useState<PromptData | null>(null)

  useEffect(() => {
    // Silent website visit notification to the backend
    fetch('http://localhost:4005/visit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }).catch((err) => {
      console.warn('Failed to send silent visit notification:', err);
    });
  }, [])

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-800 flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
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
          <div className="w-full flex justify-center py-4">
            <ReelGeneratorPage
              rawVideoObjectName={rawObjectName || 'clip_1.mp4'}
              referenceObjectName={referenceResults?.[0]?.object_name || undefined}
              prompt={promptData?.prompt}
            />
          </div>
        )}
      </main>
    </div>
  )
}

export default App

