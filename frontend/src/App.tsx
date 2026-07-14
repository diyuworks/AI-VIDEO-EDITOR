import { useState } from 'react'
import UploadPage from './features/upload/UploadPage'
import PromptInputPage from './features/prompt/PromptInputPage'
import TimelineEditorPage from './features/timeline/TimelineEditorPage'

type Screen = 'upload' | 'prompt' | 'timeline'

function App() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  if (screen === 'upload') {
    return (
      <UploadPage
        onContinue={(data) => {
          console.log('Backend upload result:', data.uploadResult)
          setVideoUrl(URL.createObjectURL(data.sourceFile))
          setScreen('prompt')
        }}
      />
    )
  }

  if (screen === 'prompt') {
    return (
      <PromptInputPage
        onContinue={(data) => {
          // Next step: send this + the uploaded video to the backend's
          // editing-planner endpoint once it exists. For now, skip straight
          // to the timeline with the raw uploaded video as a single clip.
          console.log('Prompt submitted:', data)
          setScreen('timeline')
        }}
      />
    )
  }

  if (screen === 'timeline' && videoUrl) {
    return <TimelineEditorPage videoUrl={videoUrl} />
  }

  return null
}

export default App

