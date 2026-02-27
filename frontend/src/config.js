// API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Override global fetch to automatically route /api/* to backend
const originalFetch = window.fetch;
window.fetch = function(url, options) {
  // If URL starts with /api/, replace with backend URL
  if (typeof url === 'string' && url.startsWith('/api/')) {
    url = `${API_BASE_URL}${url.substring(4)}`; // Strip /api prefix
  }
  return originalFetch(url, options);
};

console.log('API configured:', API_BASE_URL);
