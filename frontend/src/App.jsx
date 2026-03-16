import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import KeywordReportsPage from './pages/KeywordReportsPage'
import ReportDetailPage from './pages/ReportDetailPage'
import GapAnalysesPage from './pages/GapAnalysesPage'
import GapAnalysisDetailPage from './pages/GapAnalysisDetailPage'
import FiltersPage from './pages/FiltersPage'
import FilterDetailPage from './pages/FilterDetailPage'
import PortfoliosPage from './pages/PortfoliosPage'
import PortfolioDetailPage from './pages/PortfolioDetailPage'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/keyword-reports" replace />} />
          <Route path="/keyword-reports" element={<KeywordReportsPage />} />
          <Route path="/keyword-reports/:reportId" element={<ReportDetailPage />} />
          <Route path="/gap-analyses" element={<GapAnalysesPage />} />
          <Route path="/gap-analyses/:analysisId" element={<GapAnalysisDetailPage />} />
          <Route path="/filters" element={<FiltersPage />} />
          <Route path="/filters/:filterId" element={<FilterDetailPage />} />
          <Route path="/portfolios" element={<PortfoliosPage />} />
          <Route path="/portfolios/:id" element={<PortfolioDetailPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
