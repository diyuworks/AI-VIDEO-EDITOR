import { useState } from 'react'
import UploadPage from './features/upload/UploadPage'
import PromptInputPage from './features/prompt/PromptInputPage'
import TimelineEditorPage from './features/timeline/TimelineEditorPage'
import ReelGeneratorPage from './pages/ReelGeneratorPage'

type Screen = 'upload' | 'prompt' | 'reel-generator' | 'timeline'

export interface PromptData {
  presets: string[]
  prompt: string
}

function App() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [objectName, setObjectName] = useState<string | null>(null)
  const [referenceObjectName, setReferenceObjectName] = useState<string | null>(null)
  const [promptData, setPromptData] = useState<PromptData | null>(null)

  if (screen === 'upload') {
    return (
      <UploadPage
        onContinue={(data) => {
          console.log('Backend upload result:', data.uploadResult)
          console.log('Reference upload result:', data.referenceUploadResult)
          setVideoUrl(URL.createObjectURL(data.sourceFile))
          if (data.uploadResult) setObjectName(data.uploadResult.object_name)
          if (data.referenceUploadResult) setReferenceObjectName(data.referenceUploadResult.object_name)
          setScreen('prompt')
        }}
      />
    )
  }

  if (screen === 'prompt') {
    return (
      <PromptInputPage
        onContinue={(data) => {
          console.log('Prompt submitted:', data)
          setPromptData(data)
          // Move to reel generator step
          setScreen('reel-generator')
        }}
      />
    )
  }

  if (screen === 'reel-generator' && objectName) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
        <div className="bg-white p-6 rounded-xl shadow-md w-full max-w-4xl flex justify-center">
          <ReelGeneratorPage
            rawVideoObjectName={objectName}
            prompt={promptData?.prompt}
          />
        </div>
      </div>
    )
  }

  // Fallback to timeline if ever needed
  if (screen === 'timeline' && videoUrl && objectName && promptData) {
    return (
      <TimelineEditorPage 
        videoUrl={videoUrl} 
        objectName={objectName}
        referenceObjectName={referenceObjectName}
        promptData={promptData}
      />
    )
  }

  return null
}

export default App

