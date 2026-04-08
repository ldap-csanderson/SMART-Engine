import { Link, useLocation } from 'react-router-dom'

const navItems = [
  { path: '/datasets', label: 'Datasets' },
  { path: '/dataset-groups', label: 'Dataset Groups' },
  { path: '/gap-analyses', label: 'Gap Analyses' },
  { path: '/filters', label: 'Filters' },
]

export default function Navbar() {
  const location = useLocation()

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
      <Link to="/" className="font-bold text-lg text-indigo-600 mr-4">
        SMART Engine
      </Link>
      {navItems.map(item => (
        <Link
          key={item.path}
          to={item.path}
          className={`text-sm font-medium transition-colors ${
            location.pathname.startsWith(item.path)
              ? 'text-indigo-600 border-b-2 border-indigo-600 pb-0.5'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
