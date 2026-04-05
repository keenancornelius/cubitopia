# Cubitopia Monitoring Plan

Real-time monitoring strategy for the first week post-launch. Covers infrastructure health, user engagement, payments, and incident response.

---

## Infrastructure Monitoring

### Firebase Console Alerts

Set up email notifications in Firebase Console for:

- **Authentication failures**: Sudden spike in failed sign-ins (> 10% of total auth attempts)
  - Action: Check Firebase logs for error patterns; may indicate DDoS or broken login flow

- **Database write limit exceeded**: Realtime Database write throughput hits limits
  - Action: Check MONITORING.md for bursty write patterns; consider rate-limiting client-side
  - Mitigation: Review database rules; optimize queries

- **Bandwidth overages**: Egress exceeds expected levels
  - Action: Check for unexpected downloads or API calls; verify CDN is serving assets

- **Hosting deployment failures**: Build fails or assets don't sync
  - Action: Review GitHub Actions logs; check build command and asset paths

### CloudFlare/CDN Monitoring (if applicable)

- Monitor cache hit ratio (target: > 95%)
- Check for unusual bandwidth spikes
- Verify SSL certificate is valid and renewed
- Monitor origin server response times (< 200ms target)

---

## Matchmaking Health

### Queue Monitoring

- **Average queue time per region**: Track matchmaking wait times
  - Target: < 30 seconds for typical matches
  - Alert threshold: > 60 seconds indicates potential issues
  - Action: Check matchmaking logic; verify WebRTC signaling is responsive

- **Connection success rate**: Percentage of matches that successfully connect
  - Target: > 95%
  - Alert threshold: < 90%
  - Action: Review WebRTC logs; check STUN/TURN server configuration

- **Active queue size**: Number of players waiting for matches
  - Use to predict wait times during off-peak hours
  - Can trigger promotional push to encourage play during slow periods

### Data Collection

- Log every matchmaking event to Firebase: `queue_join`, `match_start`, `match_end`
- Include timestamps, player IDs, queue wait time, connection status
- Run daily analysis of queue metrics; review before morning standup

---

## Payment Monitoring

### Stripe Webhook Monitoring

Configure webhooks for critical payment events in Stripe Dashboard:

- **charge.succeeded**: Payment processed
  - Log to database with timestamp, amount, player ID
  - Trigger unlock logic on client

- **charge.failed**: Payment failed
  - Alert: Log and investigate (card declined, authentication failed, etc.)
  - Determine if client needs to retry or contact support

- **dispute.created**: Chargeback filed
  - Alert: High priority; investigate immediately
  - Contact user to resolve; may require account review

- **customer.subscription.deleted**: Subscription cancelled (if recurring)
  - Log; no immediate action unless future revenue affected

### Payment Dashboard Review

- Daily: Check Stripe Dashboard for transaction volume and failed charges
- Weekly: Review dispute ratio and refund requests
- Watch for fraud patterns (multiple failed attempts from same card, geographic anomalies)

### Revenue Tracking

- DAU conversion rate: % of daily active users who make a purchase
  - Target: > 2% (typical for casual games)
  - Track by tribe skin and price tier

- Average revenue per user (ARPU): Total revenue / DAU
  - Monitor for trends (should be stable or growing week-over-week)

---

## Client-Side Error Tracking

### window.onerror Hook

Add to game initialization:

```javascript
window.onerror = function(message, source, lineno, colno, error) {
  const errorPayload = {
    message,
    source,
    lineno,
    colno,
    stack: error?.stack || 'no stack',
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
  };

  // Send to error tracking service or Firebase
  fetch('/api/log-error', {
    method: 'POST',
    body: JSON.stringify(errorPayload),
  }).catch(() => console.error('Failed to log error'));
};
```

### Unhandled Promise Rejections

Add listener for async errors:

```javascript
window.addEventListener('unhandledrejection', event => {
  const errorPayload = {
    reason: event.reason?.message || String(event.reason),
    stack: event.reason?.stack || 'no stack',
    timestamp: new Date().toISOString(),
  };

  fetch('/api/log-error', {
    method: 'POST',
    body: JSON.stringify(errorPayload),
  });
});
```

### Sentry Integration (Recommended)

- Set up Sentry for professional error tracking and alerting
- Captures errors, stack traces, breadcrumbs (user actions leading up to error)
- Provides error grouping and trend analysis
- Sentry free tier: sufficient for launch phase (up to 10k errors/month)

---

## Key Metrics Dashboard

Create a daily tracking sheet or Grafana dashboard for:

| Metric | Target | Alert Threshold | Frequency |
|--------|--------|-----------------|-----------|
| DAU (Daily Active Users) | Growing WoW | Flat > 3 days | Hourly |
| Matches Played | Growing WoW | None (early data) | Hourly |
| Avg Match Duration | 8-12 minutes | < 5 min (broken matches) | Daily |
| Payment Conversion % | > 2% | < 1% | Daily |
| Queue Success Rate | > 95% | < 90% | Hourly |
| Avg Queue Wait Time | < 30 sec | > 60 sec | Hourly |
| Server Response Time | < 200ms | > 500ms | Continuous |
| Error Rate | < 0.5% | > 2% | Hourly |
| Memory Leak Detected | No | Yes | Daily |

---

## Incident Response

### Severity Levels

**Critical (P0):** Game is unplayable or users cannot pay
- Examples: Server down, authentication broken, all matches failing
- Response time: < 15 minutes
- Escalation: Notify team lead immediately; consider rolling back deploy

**High (P1):** Major feature broken, significantly impacts experience
- Examples: Matchmaking down, payment processing failing, crash on startup
- Response time: < 1 hour
- Escalation: Notify team lead; gather logs and investigate root cause

**Medium (P2):** Feature partially broken or performance degraded
- Examples: Some tribe skins not loading, occasional desync, slow queue times
- Response time: < 4 hours
- Escalation: Track as issue; prioritize in next iteration

**Low (P3):** Minor cosmetic or non-critical issues
- Examples: UI text typo, tooltip misaligned, rare animation glitch
- Response time: Next business day
- Escalation: Log in issue tracker; fix in next release

### Incident Contact Tree

- **On-call engineer**: [NAME]
- **Technical lead**: [NAME]
- **Community manager**: [NAME] (for status updates)

Contact order for P0/P1 issues:
1. Text/Slack on-call engineer
2. If no response in 10 min, call technical lead
3. Post status update in Discord #announcements

### Incident Response Checklist

When an incident occurs:

- [ ] Acknowledge the issue in #announcements channel
- [ ] Gather logs: Firebase Console, Stripe Dashboard, Sentry errors
- [ ] Reproduce the issue if possible (test environment first)
- [ ] Identify root cause: deploy issue, database query, third-party service, etc.
- [ ] Implement fix (or rollback if recent deploy is culprit)
- [ ] Test fix in staging environment
- [ ] Deploy fix with rollback plan ready
- [ ] Monitor metrics for next 30 min
- [ ] Post incident report in Discord: what happened, duration, root cause, fix applied
- [ ] Schedule post-mortem if issue was P0/P1

### Rollback Procedure

- Keep previous build deployed and ready to swap
- Document deployment process so any team member can execute rollback
- Rollback should take < 5 minutes
- Test rollback procedure before launch week

---

## First 48 Hours Monitoring Schedule

### Hour 0-1 (Launch)
- Monitor Firebase Console for auth/database errors
- Check that players can join queue and start matches
- Watch payment processing in Stripe
- Refresh metrics dashboard every 5 minutes

### Hour 1-4
- Collect initial DAU numbers and matchmaking stats
- Monitor for any critical errors in Sentry
- Check social media for feedback/issues reported by players
- Verify no database write limits being hit

### Hour 4-12
- Review first batch of completed matches for desync issues
- Analyze payment conversion rate
- Monitor memory usage and performance metrics
- Prepare Discord announcements based on player feedback

### Hour 12-24
- Summarize Day 1 metrics: DAU, revenue, player feedback
- Review any incidents and their resolutions
- Check for trends (are metrics stable, growing, or declining?)
- Plan Day 2 monitoring adjustments if needed

### Hour 24-48
- Continue hourly monitoring of critical metrics
- Review cumulative stats (2-day DAU, retention, ARPU)
- Scale infrastructure if needed (Firebase or CDN)
- Prepare post-launch report with key learnings

---

## Monitoring Tools Checklist

- [ ] Firebase Console bookmarked and logged in
- [ ] Stripe Dashboard bookmarked and logged in
- [ ] Sentry account created and SDK integrated
- [ ] GitHub Actions workflow monitoring (if auto-deploy enabled)
- [ ] Discord #alerts channel created for notifications
- [ ] Metrics spreadsheet/dashboard created
- [ ] Incident response contacts listed and notified
- [ ] On-call schedule established for first week
- [ ] Rollback procedure documented and tested

---

## Post-Launch Review (Week 1)

Schedule a team meeting at end of Week 1 to review:

1. **Player metrics**: DAU, retention, match completion rate
2. **Revenue**: Total gross revenue, conversion rate, top-selling tribe skins
3. **Technical health**: Uptime, error rate, any critical incidents
4. **Player feedback**: Common issues reported on Discord/Reddit, feature requests
5. **Optimizations**: Quick wins for Week 2 (UI tweaks, balance changes, bug fixes)
6. **Scale plan**: Do we need to increase Firebase quotas? CDN bandwidth?

Use these learnings to inform Week 2 roadmap and ongoing monitoring strategy.
