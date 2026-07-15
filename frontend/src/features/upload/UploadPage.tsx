import { useCallback, useRef, useState } from 'react'

type SourceUploadState = 'idle' | 'drag-over' | 'uploading' | 'done' | 'error'

interface ReferenceVideo {
  id: string
  file: File
  previewUrl: string
}

const MAX_REFERENCE_VIDEOS = 5
const UPLOAD_ENDPOINT = 'http://localhost:8000/upload'

interface UploadResult {
  success: boolean
  filename: string
  object_name: string
  url: string
}

interface UploadPageProps {
  onContinue?: (data: {
    sourceFile: File
    referenceVideos: File[]
    uploadResult: UploadResult | null
    referenceUploadResult: UploadResult | null
  }) => void
}

export default function UploadPage({ onContinue }: UploadPageProps) {
  // ---- Source video state ----
  const [sourceState, setSourceState] = useState<SourceUploadState>('idle')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)

  // ---- Reference video state ----
  const [referenceVideos, setReferenceVideos] = useState<ReferenceVideo[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)

  const isVideoFile = (file: File) => file.type.startsWith('video/')

  // ---- Source upload handlers ----

  const handleSourceFile = useCallback((file: File) => {
    if (!isVideoFile(file)) {
      setErrorMessage('That file doesn\'t look like a video. Try .mp4, .mov, or .webm.')
      setSourceState('error')
      return
    }

    setErrorMessage(null)
    setSourceFile(file)
    setSourcePreviewUrl(URL.createObjectURL(file))
    setSourceState('uploading')
    setUploadProgress(0)
    setUploadResult(null)

    // Real upload to the backend's /upload endpoint (multipart/form-data,
    // field name "file"). Using XMLHttpRequest instead of fetch because
    // fetch has no built-in upload progress event.
    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', UPLOAD_ENDPOINT)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result: UploadResult = JSON.parse(xhr.responseText)
          setUploadResult(result)
          setUploadProgress(100)
          setSourceState('done')
        } catch {
          setErrorMessage('Upload succeeded but the response was unexpected.')
          setSourceState('error')
        }
      } else {
        let detail = `Upload failed (${xhr.status}).`
        try {
          const body = JSON.parse(xhr.responseText)
          if (body?.detail) detail = body.detail
        } catch {
          // ignore parse failure, use default message
        }
        setErrorMessage(detail)
        setSourceState('error')
      }
    }

    xhr.onerror = () => {
      setErrorMessage('Could not reach the backend. Is it running on localhost:8000?')
      setSourceState('error')
    }

    xhr.send(formData)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) handleSourceFile(file)
    },
    [handleSourceFile],
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setSourceState((prev) => (prev === 'uploading' || prev === 'done' ? prev : 'drag-over'))
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setSourceState((prev) => (prev === 'drag-over' ? 'idle' : prev))
  }, [])

  const handleReset = () => {
    setSourceState('idle')
    setSourceFile(null)
    setSourcePreviewUrl(null)
    setUploadProgress(0)
    setErrorMessage(null)
    setUploadResult(null)
  }

  const [referenceUploadResult, setReferenceUploadResult] = useState<UploadResult | null>(null)
  const [isUploadingRefs, setIsUploadingRefs] = useState(false)

  const handleReferenceFiles = async (files: FileList | null) => {
    if (!files) return
    const incoming = Array.from(files).filter(isVideoFile)
    if (incoming.length === 0) return

    setIsUploadingRefs(true)
    setReferenceVideos((prev) => {
      const room = MAX_REFERENCE_VIDEOS - prev.length
      const toAdd = incoming.slice(0, room).map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }))
      return [...prev, ...toAdd]
    })

    // Upload the first reference video to backend
    const refFile = incoming[0]
    const formData = new FormData()
    formData.append('file', refFile)

    try {
      const res = await fetch(UPLOAD_ENDPOINT, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const result = await res.json()
        setReferenceUploadResult(result)
      }
    } catch (e) {
      console.error('Failed to upload reference video', e)
    } finally {
      setIsUploadingRefs(false)
    }
  }

  const removeReferenceVideo = (id: string) => {
    setReferenceVideos((prev) => prev.filter((v) => v.id !== id))
    // Simplification: if we remove, we don't bother deleting from backend for now
  }

  return (
    <div className="min-h-screen bg-canvas text-white font-body flex flex-col items-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <header className="mb-10 text-center">
          <h1 className="font-display font-semibold text-3xl tracking-tight">
            Upload your footage
          </h1>
          <p className="text-white/50 mt-2 text-sm">
            Bring the clip you want edited. You can add reference videos for style next.
          </p>
        </header>

        {/* ---------------- SOURCE VIDEO DROPZONE ---------------- */}
        {sourceState !== 'done' && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => sourceState === 'idle' && fileInputRef.current?.click()}
            className={[
              'relative rounded-2xl border-2 transition-colors duration-200 cursor-pointer',
              'flex flex-col items-center justify-center gap-4 py-20 px-8',
              sourceState === 'drag-over'
                ? 'border-amber bg-amber/5'
                : sourceState === 'error'
                  ? 'border-red-500/60 bg-red-500/5'
                  : 'border-canvas-border bg-canvas-panel hover:border-white/20',
            ].join(' ')}
          >
            {/* Corner brackets — the signature detail, evokes a viewfinder/slate frame */}
            <CornerBrackets active={sourceState === 'drag-over'} />

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleSourceFile(e.target.files[0])}
            />

            {sourceState === 'uploading' ? (
              <>
                <div className="w-14 h-14 rounded-full border-2 border-teal/30 border-t-teal animate-spin" />
                <div className="text-center">
                  <p className="font-mono text-sm text-teal">{uploadProgress}%</p>
                  <p className="text-white/50 text-sm mt-1">
                    Uploading {sourceFile?.name}
                  </p>
                </div>
              </>
            ) : (
              <>
                <UploadIcon />
                <div className="text-center">
                  <p className="font-medium">
                    {sourceState === 'error' ? errorMessage : 'Drag a video here'}
                  </p>
                  <p className="text-white/40 text-sm mt-1">
                    or <span className="text-amber underline underline-offset-2">browse your files</span>
                  </p>
                  <p className="text-white/25 text-xs mt-3 font-mono">MP4 · MOV · WEBM</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---------------- SOURCE VIDEO PREVIEW (after upload) ---------------- */}
        {sourceState === 'done' && sourcePreviewUrl && (
          <div className="rounded-2xl bg-canvas-panel border border-canvas-border overflow-hidden">
            <video src={sourcePreviewUrl} controls className="w-full max-h-96 bg-black" />
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="font-mono text-sm text-white/80">{sourceFile?.name}</p>
                <p className="text-teal text-xs mt-0.5">
                  {uploadResult ? `Uploaded — stored as ${uploadResult.object_name}` : 'Uploaded'}
                </p>
              </div>
              <button
                onClick={handleReset}
                className="text-white/40 hover:text-white text-sm transition-colors"
              >
                Replace
              </button>
            </div>
          </div>
        )}

        {/* ---------------- REFERENCE VIDEOS ---------------- */}
        {sourceState === 'done' && (
          <div className="mt-12">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-display font-semibold text-lg">Reference videos</h2>
              <span className="font-mono text-xs text-white/40">
                {referenceVideos.length} of {MAX_REFERENCE_VIDEOS} selected
              </span>
            </div>
            <p className="text-white/40 text-sm mb-5">
              Optional — add up to {MAX_REFERENCE_VIDEOS} videos whose editing style you want to match.
              We'll learn the style, not copy the content.
            </p>

            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {referenceVideos.map((ref) => (
                <div
                  key={ref.id}
                  className="relative aspect-[9/16] rounded-lg overflow-hidden border-2 border-amber bg-black group"
                >
                  <video src={ref.previewUrl} className="w-full h-full object-cover" muted />
                  <button
                    onClick={() => removeReferenceVideo(ref.id)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white/80 hover:text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove reference video"
                  >
                    ×
                  </button>
                  <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-amber text-canvas flex items-center justify-center">
                    <CheckIcon />
                  </div>
                </div>
              ))}

              {referenceVideos.length < MAX_REFERENCE_VIDEOS && (
                <button
                  onClick={() => referenceInputRef.current?.click()}
                  className="aspect-[9/16] rounded-lg border-2 border-dashed border-canvas-border hover:border-white/30 flex flex-col items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="text-white/30 text-2xl leading-none">+</span>
                  <span className="text-white/30 text-xs">Add</span>
                </button>
              )}
            </div>

            <input
              ref={referenceInputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => handleReferenceFiles(e.target.files)}
            />

            <button
              onClick={() =>
                sourceFile &&
                onContinue?.({
                  sourceFile,
                  referenceVideos: referenceVideos.map((v) => v.file),
                  uploadResult,
                  referenceUploadResult,
                })
              }
              className="w-full mt-8 py-3.5 rounded-xl font-medium bg-amber text-canvas hover:bg-amber-bright transition-colors"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CornerBrackets({ active }: { active: boolean }) {
  const color = active ? 'border-amber' : 'border-white/15'
  const base = 'absolute w-6 h-6 transition-colors duration-200'
  return (
    <>
      <div className={`${base} ${color} top-4 left-4 border-t-2 border-l-2 rounded-tl-md`} />
      <div className={`${base} ${color} top-4 right-4 border-t-2 border-r-2 rounded-tr-md`} />
      <div className={`${base} ${color} bottom-4 left-4 border-b-2 border-l-2 rounded-bl-md`} />
      <div className={`${base} ${color} bottom-4 right-4 border-b-2 border-r-2 rounded-br-md`} />
    </>
  )
}

function UploadIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-white/30">
      <path
        d="M12 16V4M12 4L7 9M12 4L17 9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
