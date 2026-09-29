import { useEffect, useState } from 'react'

type Greeting = { message: string }

function App() {
  const [greeting, setGreeting] = useState<string>('Loading...')

  useEffect(() => {
    fetch('/api/hello')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Greeting>
      })
      .then((data) => setGreeting(data.message))
      .catch((err) => setGreeting(`Failed to reach API: ${err.message}`))
  }, [])

  return (
    <main>
      <h1>ImgTagr</h1>
      <p>{greeting}</p>
    </main>
  )
}

export default App
