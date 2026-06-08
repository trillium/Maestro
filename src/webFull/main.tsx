/**
 * Maestro Web Interface Entry Point
 */

import { createRoot } from 'react-dom/client';
import { AppRoot } from './App';
import { webLogger } from './utils/logger';
import { initSentry, captureException } from './utils/sentry';
import './index.css';

export { useOfflineStatus, useMaestroMode, useDesktopTheme } from './App';

// Initialize Sentry as early as possible so any error thrown during React
// mount (or before) is captured when `MAESTRO_PUBLIC_SENTRY_DSN` is set.
// No-op when no DSN is configured.
initSentry();

// Route unhandled browser-level errors and promise rejections to Sentry.
// These handlers complement React's own error boundaries by catching faults
// that escape the component tree (event handlers, async work, native APIs).
// Both are no-ops when Sentry isn't initialized.
window.addEventListener('error', (e) => {
	captureException(e.error, { source: 'window_error' });
});
window.addEventListener('unhandledrejection', (e) => {
	captureException(e.reason, { source: 'unhandled_rejection' });
});

// Mount the application
const container = document.getElementById('root');
if (container) {
	const root = createRoot(container);
	root.render(<AppRoot />);
} else {
	webLogger.error('Root element not found', 'App');
}
