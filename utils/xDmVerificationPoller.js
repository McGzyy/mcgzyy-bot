function startXDmVerificationPoller() {
  console.log('[XVerify/DM] Poller started');

  setInterval(() => {
    console.log('[XVerify/DM] Polling...');
  }, 15000);
}

module.exports = { startXDmVerificationPoller };
