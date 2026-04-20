import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import DatasetsPage from './pages/DatasetsPage'
import DatasetDetailPage from './pages/DatasetDetailPage'
import DatasetGroupsPage from './pages/DatasetGroupsPage'
import DatasetGroupDetailPage from './pages/DatasetGroupDetailPage'
import GapAnalysesPage from './pages/GapAnalysesPage'
import GapAnalysisDetailPage from './pages/GapAnalysisDetailPage'
import FiltersPage from './pages/FiltersPage'
import FilterDetailPage from './pages/FilterDetailPage'
import SettingsPage from './pages/SettingsPage'
import OAuthCallbackPage from './pages/OAuthCallbackPage'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/datasets" replace />} />
          <Route path="/datasets" element={<DatasetsPage />} />
          <Route path="/datasets/:datasetId" element={<DatasetDetailPage />} />
          <Route path="/dataset-groups" element={<DatasetGroupsPage />} />
          <Route path="/dataset-groups/:groupId" element={<DatasetGroupDetailPage />} />
          <Route path="/gap-analyses" element={<GapAnalysesPage />} />
          <Route path="/gap-analyses/:analysisId" element={<GapAnalysisDetailPage />} />
          <Route path="/filters" element={<FiltersPage />} />
          <Route path="/filters/:filterId" element={<FilterDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Loaded inside OAuth popup — sends postMessage then closes */}
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
