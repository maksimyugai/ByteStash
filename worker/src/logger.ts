let debugEnabled = false;

export function configureLogger(debug: boolean) {
  debugEnabled = debug;
}

const Logger = {
  debug(...args: unknown[]) {
    if (debugEnabled) {
      console.log('[DEBUG]', ...args);
    }
  },

  info(...args: unknown[]) {
    console.log('[INFO]', ...args);
  },

  error(...args: unknown[]) {
    if (debugEnabled) {
      console.error('[ERROR]', ...args);
    } else {
      const messages = args.map((arg) => (arg instanceof Error ? arg.message : arg));
      console.error('[ERROR]', ...messages);
    }
  },
};

export default Logger;
