import { NavLink } from 'react-router-dom'

export default function Navbar() {
  const tabs = [
    { label: 'Keyword Reports', to: '/keyword-reports' },
    { label: 'Filters', to: '/filters' },
    { label: 'Portfolio', to: '/portfolio' },
    { label: 'Gap Analyses', to: '/gap-analyses' },
  ]

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 gap-8">
          <span className="text-gray-900 font-bold text-lg tracking-tight whitespace-nowrap">
            Gandalf
          </span>
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  )
}
