<!--
Scaffold-only. Keep this guide concise until the unified “update the guides” workflow is in place.
-->

## Admin Guide

### System overview
- What the bot does at a high level
- Primary goals (signal quality, tracking, moderation leverage)

### Architecture overview
- Major components (Discord bot, tracking store, scanners/providers, X integration)
- Key data files (what they store, why they matter)

### Trust system
- **Caller trust levels**: `none`, `approved`, `top_caller`, `trusted_pro`, `restricted`
- What each tier means (intent + moderation expectations)
- What is *manual* vs what is *stats-informed*

### Moderation systems
- `#mod-approvals` hub: what appears there and why
- Approval types:
  - X verification approvals
  - Coin approvals (approve/deny/exclude, tags/notes)
  - Top Caller candidate review (approve/dismiss)
- Data retention expectations (resolved message cleanup)

### X integration
- Verified-handle linkage (Discord ↔ X)
- Mention intake overview (`#call`, `#procall`)
- Posting behavior boundaries (what posts to X vs Discord-only)

### Known risks / failure modes
- Provider outages / rate limits
- Bad market cap data / noisy scans
- Duplicate ingestion / dedupe edge cases
- Moderation queue drift (missing channel, stale messages)

### Maintenance / debugging
- Health checks / status commands
- Common incident playbooks (scanner stuck, approvals not posting, X creds)
- Logs to look for and what they mean

### Future expansion notes
- Mod Review / Action Hub (next steps)
- Trusted Pro enrichment (future X-post narrative, additional submission paths)
- Audit trail / moderation history improvements

