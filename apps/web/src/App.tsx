import { useEffect, useState } from "react"

function App() {
  const [apiStatus, setApiStatus] = useState<"checking" | "connected" | "unreachable">("checking")

  useEffect(() => {
    fetch("http://localhost:8000/health")
      .then((res) => res.json())
      .then(() => setApiStatus("connected"))
      .catch(() => setApiStatus("unreachable"))
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold">AI Video Editor</h1>
      <p className="text-slate-400">Frontend scaffold — Phase 1 setup</p>
      <div className="text-sm">
        Backend status:{" "}
        <span
          className={
            apiStatus === "connected"
              ? "text-green-400"
              : apiStatus === "unreachable"
                ? "text-red-400"
                : "text-yellow-400"
          }
        >
          {apiStatus}
        </span>
      </div>
    </div>
  )
}

export default App
