import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import KeywordReportsPage from './pages/KeywordReportsPage'
import ReportDetailPage from './pages/ReportDetailPage'
import FiltersPage from './pages/FiltersPage'
import FilterDetailPage from './pages/FilterDetailPage'
import PortfolioPage from './pages/PortfolioPage'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Routes>
        <Route path="/" element={<Navigate to="/keyword-reports" replace />} />
        <Route path="/keyword-reports" element={<KeywordReportsPage />} />
        <Route path="/keyword-reports/:reportId" element={<ReportDetailPage />} />
        <Route path="/filters" element={<FiltersPage />} />
        <Route path="/filters/:filterId" element={<FilterDetailPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
      </Routes>
    </div>
  )
}

export default App
