import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import RunDetailPage from './pages/RunDetailPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/run/:runId" element={<RunDetailPage />} />
    </Routes>
  )
}

export default App
