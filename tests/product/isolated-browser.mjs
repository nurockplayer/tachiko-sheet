// Chromium's confined --single-process mode cannot reliably recycle incognito
// contexts. Keep the same context isolation with one owned browser per context.
// Normal browser runs retain Playwright's ordinary context behavior.
export async function launchIsolatedBrowser(chromium, options) {
  if (process.env.TACHIKO_TEST_SINGLE_PROCESS !== "1") return chromium.launch(options);
  const owned = new Set();
  return {
    async newContext(contextOptions) {
      const browser = await chromium.launch(options);
      owned.add(browser);
      try {
        const context = await browser.newContext(contextOptions);
        const close = context.close.bind(context);
        context.close = async (...args) => {
          try { await close(...args); }
          finally { await browser.close(); owned.delete(browser); }
        };
        return context;
      } catch (error) {
        await browser.close(); owned.delete(browser);
        throw error;
      }
    },
    async close() {
      await Promise.all([...owned].map(browser => browser.close()));
      owned.clear();
    },
  };
}
