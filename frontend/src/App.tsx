import { useState } from 'react'
import UploadPage from './features/upload/UploadPage'
import PromptInputPage from './features/prompt/PromptInputPage'
import TimelineEditorPage from './features/timeline/TimelineEditorPage'

type Screen = 'upload' | 'prompt' | 'timeline'

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
          setScreen('timeline')
        }}
      />
    )
  }

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

