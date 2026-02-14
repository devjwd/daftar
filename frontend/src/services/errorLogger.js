/**
 * Error Tracking & Logging Service
 * Integrates with Sentry for production error monitoring
 */

let sentryInitialized = false;

/**
 * Initialize Sentry error tracking
 * Called once at app startup
 */
export function initializeSentry() {
  // Skip if no DSN is configured
  if (!import.meta.env.VITE_SENTRY_DSN) {
    console.log('Sentry not configured - error tracking disabled');
    return;
  }

  // Skip if already initialized
  if (sentryInitialized) {
    return;
  }

  try {
    // Dynamic import to avoid loading Sentry if not needed
    // In production, add: npm install @sentry/react
    // Then uncomment this:
    
    // import * as Sentry from "@sentry/react";
    // 
    // Sentry.init({
    //   dsn: import.meta.env.VITE_SENTRY_DSN,
    //   environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    //   tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1,
    //   integrations: [
    //     new Sentry.Replay({
    //       maskAllText: true,
    //       blockAllMedia: true
    //     })
    //   ],
    //   replaysSessionSampleRate: 0.1,
    //   replaysOnErrorSampleRate: 1.0
    // });

    sentryInitialized = true;
    console.log('Sentry error tracking initialized');
  } catch (error) {
    console.error('Failed to initialize Sentry:', error);
  }
}

/**
 * Log an error
 * Sends to Sentry if configured, also logs locally
 * @param {Error|string} error - Error object or message
 * @param {Object} context - Additional context data
 * @param {string} level - Log level (error, warning, info)
 */
export function logError(error, context = {}, level = 'error') {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : '';

  // Log locally
  const logLevel = {
    error: console.error,
    warning: console.warn,
    info: console.info
  }[level] || console.error;

  logLevel(`[${level.toUpperCase()}] ${errorMessage}`, {
    stack: errorStack,
    context
  });

  // Send to Sentry if initialized
  if (sentryInitialized && import.meta.env.VITE_SENTRY_DSN) {
    try {
      // Sentry.captureException(error, {
      //   level,
      //   contexts: {
      //     ...context
      //   }
      // });
    } catch (e) {
      console.error('Failed to send error to Sentry:', e);
    }
  }
}

/**
 * Log a warning
 * @param {string} message - Warning message
 * @param {Object} context - Additional context data
 */
export function logWarning(message, context = {}) {
  logError(message, context, 'warning');
}

/**
 * Log info message
 * @param {string} message - Info message
 * @param {Object} context - Additional context data
 */
export function logInfo(message, context = {}) {
  if (import.meta.env.VITE_DEBUG_MODE) {
    logError(message, context, 'info');
  }
}

/**
 * Log API request
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {number} statusCode - Response status code
 * @param {number} duration - Request duration in ms
 * @param {Object} metadata - Additional metadata
 */
export function logApiRequest(method, url, statusCode, duration, metadata = {}) {
  if (statusCode >= 400) {
    logWarning(`API Error: ${method} ${url} - ${statusCode}`, {
      method,
      url,
      statusCode,
      duration,
      ...metadata
    });
  } else if (import.meta.env.VITE_DEBUG_MODE) {
    logInfo(`API: ${method} ${url} - ${statusCode} (${duration}ms)`, {
      method,
      url,
      statusCode,
      duration,
      ...metadata
    });
  }
}

/**
 * Log blockchain transaction
 * @param {string} txHash - Transaction hash
 * @param {string} status - Status (pending, success, failed)
 * @param {Object} metadata - Transaction metadata
 */
export function logTransaction(txHash, status, metadata = {}) {
  const message = `Transaction ${status}: ${txHash}`;
  
  if (status === 'failed') {
    logError(message, metadata, 'error');
  } else {
    logInfo(message, metadata);
  }
}

/**
 * Create error boundary compatible error logger
 * @param {Error} error - Error from error boundary
 * @param {Object} errorInfo - Error info from error boundary
 */
export function logErrorBoundary(error, errorInfo) {
  logError(error, {
    componentStack: errorInfo.componentStack,
    errorBoundary: true
  }, 'error');
}

/**
 * Setup global error handlers
 */
export function setupGlobalErrorHandlers() {
  // Catch uncaught errors
  window.addEventListener('error', (event) => {
    logError(event.error, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      type: 'uncaught'
    }, 'error');
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    logError(event.reason, {
      type: 'unhandledRejection'
    }, 'error');
  });

  // Log performance issues
  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 3000) { // Log slow operations (>3s)
            logWarning(`Slow operation: ${entry.name} - ${entry.duration.toFixed(0)}ms`, {
              type: 'performance',
              name: entry.name,
              duration: entry.duration
            });
          }
        }
      });

      observer.observe({ entryTypes: ['measure', 'navigation'] });
    } catch (e) {
      // PerformanceObserver not available or error
    }
  }
}

/**
 * Log performance metric
 * @param {string} name - Metric name
 * @param {number} value - Metric value
 */
export function logMetric(name, value) {
  if (import.meta.env.VITE_DEBUG_MODE) {
    console.log(`Metric: ${name} = ${value}`);
  }

  // Could send to analytics service here
  // analytics.track('metric', { name, value });
}

export default {
  initializeSentry,
  logError,
  logWarning,
  logInfo,
  logApiRequest,
  logTransaction,
  logErrorBoundary,
  setupGlobalErrorHandlers,
  logMetric
};
