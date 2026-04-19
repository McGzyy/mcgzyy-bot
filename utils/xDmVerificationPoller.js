function startXDmVerificationPoller() {
  console.log('[XVerify/DM] Poller started');

  const hasKeys = process.env.X_API_KEY && process.env.X_ACCESS_TOKEN;

  if (!hasKeys) {
    console.log('[XVerify/DM] Missing X API credentials');
  } else {
    console.log('[XVerify/DM] X credentials detected');
  }

  setInterval(() => {
    console.log('[XVerify/DM] Polling...');
  }, 15000);
}

module.exports = { startXDmVerificationPoller };
