# Cubitopia Launch Checklist

Pre-launch verification checklist. Check off each item before going live. Use this as the final gating document for production release.

---

## Game Functionality

- [ ] All game modes work
  - [ ] 1v1 vs Player
  - [ ] FFA 4-player mode
  - [ ] vs AI (single & multiple opponents)

- [ ] All map types load and render correctly
  - [ ] Standard
  - [ ] Tundra
  - [ ] Skyland
  - [ ] Arena
  - [ ] Any additional custom maps

- [ ] All 9 tribes selectable and display correctly
  - [ ] Tribe selection screen loads
  - [ ] Each tribe shows proper unit roster
  - [ ] Tribe abilities/bonuses apply correctly

- [ ] Combat mechanics functional
  - [ ] Unit movement and pathfinding
  - [ ] Melee/ranged combat resolves
  - [ ] Elemental combo system triggers
  - [ ] Garrison mechanics work (unit stacking in bases)
  - [ ] Casualties apply correctly

- [ ] Base tier progression complete
  - [ ] Camp → Fort (at population/building thresholds)
  - [ ] Fort → Castle
  - [ ] Castle → Citadel
  - [ ] All tier upgrades apply stat bonuses
  - [ ] Base visuals update per tier

- [ ] Audio fully functional
  - [ ] Sound effects trigger on actions (combat, build, unit spawn)
  - [ ] Ambient music plays in menus and gameplay
  - [ ] Volume controls work
  - [ ] No audio clipping or overlap issues

- [ ] Visual effects and UI
  - [ ] Speech bubbles appear on unit interaction
  - [ ] VFX render on combat and abilities
  - [ ] Damage numbers display correctly
  - [ ] No UI overlap or z-order issues
  - [ ] Tooltips appear and are readable

---

## Multiplayer

- [ ] Firebase project configured
  - [ ] Production credentials loaded (not test keys)
  - [ ] Database rules reviewed and set correctly
  - [ ] Authentication method chosen (email, anonymous, etc.)
  - [ ] Hosting configured for custom domain

- [ ] WebRTC matchmaking
  - [ ] Player queue system functional
  - [ ] Two players match within reasonable time (< 30 seconds typical)
  - [ ] Connection negotiation completes without errors
  - [ ] Signaling server (Firebase) communication stable

- [ ] Full multiplayer match verification
  - [ ] Match initializes correctly for both players
  - [ ] Game state syncs (map, units, resources visible to both)
  - [ ] Both players can take actions
  - [ ] Match completes to victory condition without desync
  - [ ] End-of-match screen displays for both players

- [ ] Disconnect handling
  - [ ] Disconnected player appears as ghost unit
  - [ ] Reconnect mechanism allows player to rejoin
  - [ ] Reconnecting player's units resume control
  - [ ] Game doesn't crash if one player exits

- [ ] ELO rating system
  - [ ] ELO calculated after match completion
  - [ ] Winner's ELO increases, loser's decreases
  - [ ] Rating persists in database
  - [ ] Player can view their current rating
  - [ ] Matchmaking considers ELO for pairing

---

## Payments

- [ ] Stripe test mode checkout
  - [ ] Stripe keys loaded (test publishable & secret)
  - [ ] Checkout page appears with purchase options
  - [ ] Test card (4242 4242 4242 4242) processes without errors
  - [ ] No real charges occur in test mode

- [ ] Tribe skin unlock after purchase
  - [ ] Payment completion triggers unlock logic
  - [ ] Selected tribe skin becomes available in tribe selector
  - [ ] Unlocked skin displays correctly in-game

- [ ] Unlock persistence
  - [ ] Unlocked skins saved to localStorage
  - [ ] Skins remain unlocked after browser refresh
  - [ ] Skins persist across new sessions (same browser)
  - [ ] Can verify in browser DevTools > Application > LocalStorage

- [ ] No unintended charges
  - [ ] Stripe dashboard shows only test transactions
  - [ ] No production account funds affected

---

## Performance

- [ ] Mobile browser testing
  - [ ] iOS Safari: game loads and plays (iPhone 12+)
  - [ ] Android Chrome: game loads and plays (Pixel 4+)
  - [ ] Mobile performance acceptable (no severe lag)

- [ ] Draw call count
  - [ ] Use Chrome DevTools > Rendering > Paint timing
  - [ ] Maintain < 2000 draw calls during typical gameplay
  - [ ] Large battles or dense maps don't exceed reasonable threshold

- [ ] Frame rate stability
  - [ ] Target 30+ FPS on mid-range devices (iPhone 11, Pixel 3a)
  - [ ] 60 FPS on modern devices (iPhone 14+, flagship Android)
  - [ ] No frame rate drops during normal play
  - [ ] Verify with Chrome DevTools > Performance tab

- [ ] WebGL context leaks
  - [ ] No texture memory accumulation over time
  - [ ] No shader recompilation on each frame
  - [ ] Context loss handled gracefully if it occurs
  - [ ] Test over 10+ minute session without memory climb

- [ ] Memory stability
  - [ ] Heap size stable during 10+ minute session
  - [ ] No continuous memory growth
  - [ ] Garbage collection functioning (check Chrome DevTools > Memory)

---

## Web Presence

- [ ] GitHub Pages deployment
  - [ ] Custom domain points to GitHub Pages
  - [ ] HTTPS enabled
  - [ ] Build/deploy pipeline verified
  - [ ] All assets load (no 404 errors)

- [ ] Landing page
  - [ ] Homepage loads and renders correctly
  - [ ] All links are functional
  - [ ] Call-to-action buttons lead to game
  - [ ] Responsive design works on mobile

- [ ] Game accessibility from landing page
  - [ ] Play button clearly visible
  - [ ] Play button leads to correct game URL
  - [ ] Game initializes successfully

- [ ] Legal pages
  - [ ] Privacy Policy page accessible
  - [ ] Terms of Service page accessible
  - [ ] Links present in footer or header
  - [ ] Content is accurate and legally reviewed

---

## Marketing

- [ ] Reddit launch posts ready
  - [ ] All 4 subreddit versions written and reviewed
  - [ ] Reddit accounts verified/linked
  - [ ] Posts scheduled or marked ready to publish
  - [ ] Images/screenshots attached

- [ ] Discord server
  - [ ] Server created and moderators assigned
  - [ ] Welcome/rules channels set up
  - [ ] Game discussion channels created
  - [ ] Invite link ready to share
  - [ ] Bot(s) configured if needed

- [ ] Instagram account
  - [ ] Account created and profile completed
  - [ ] Bio includes game link
  - [ ] Profile picture is game logo/icon
  - [ ] Linked to website if possible

- [ ] Content scheduled
  - [ ] First week of posts drafted/scheduled
  - [ ] Mix of gameplay, community, and announcements planned
  - [ ] Posting times optimized for target audience
  - [ ] Hashtags researched and ready

---

## Sign-Off

- [ ] Technical lead: ________________________ Date: _______
- [ ] Community manager: __________________ Date: _______
- [ ] QA verification: ______________________ Date: _______

**Ready to launch:** [ ] YES [ ] NO

**Blockers (if NO):**
```
-
-
-
```
