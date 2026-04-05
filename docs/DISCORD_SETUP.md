# Cubitopia Discord Server Setup Guide

A complete setup plan for building an engaged community around Cubitopia, a turn-based voxel strategy game with 9 tribes and multiplayer gameplay.

---

## 1. Server Structure

### Category Layout

Create the following channel structure with categories to organize by purpose:

```
📋 GETTING STARTED
├── #welcome
├── #rules
└── #announcements

🎮 GAMEPLAY
├── #general
├── #strategy-discussion
├── #multiplayer-chat
└── #tribe-selection

🐛 FEEDBACK & REPORTS
├── #bug-reports
├── #feature-requests
└── #patch-notes

🎨 CONTENT & MEDIA
├── #screenshots
├── #video-clips
├── #fan-art
└── #memes

🏘️ TRIBES
├── #tribe-discussion
├── #tribe-1-nomads
├── #tribe-2-craftsmen
├── #tribe-3-scholars
├── #tribe-4-warriors
├── #tribe-5-merchants
├── #tribe-6-mystics
├── #tribe-7-engineers
├── #tribe-8-hunters
└── #tribe-9-nobility

💬 COMMUNITY
├── #off-topic
├── #streaming
└── #lfg-looking-for-group

🔊 VOICE CHANNELS
├── 🎤 General Voice
├── 🎤 Multiplayer Coordination
├── 🎤 Tribe Wars
└── 🎤 AFK
```

### Channel Descriptions

| Channel | Purpose |
|---------|---------|
| **#welcome** | Server entry point; pinned welcome message with links |
| **#rules** | Community guidelines and code of conduct |
| **#announcements** | Dev updates, scheduled maintenance, new releases (mods/admins post only) |
| **#general** | Main chat; casual game talk and questions |
| **#strategy-discussion** | Base building, unit composition, meta discussion |
| **#multiplayer-chat** | Coordination for live multiplayer matches |
| **#tribe-selection** | Reaction role setup for tribe preferences |
| **#bug-reports** | Structured bug reporting with template |
| **#feature-requests** | Feature voting and community suggestions |
| **#patch-notes** | Automated patch notes from GitHub/dev blog |
| **#screenshots** | In-game moments, base designs, battle replays |
| **#video-clips** | Gameplay videos, tutorials, highlights |
| **#fan-art** | Community art, skins, alternate tribe designs |
| **#memes** | Game-related memes and humor |
| **#tribe-discussion** | Cross-tribe strategy, lore, tribe comparisons |
| **#tribe-[1-9]** | Tribe-specific channels for build optimization, lore, cosmetics |
| **#off-topic** | Non-game chat (memes, gaming, life) |
| **#streaming** | Self-promotion; link Twitch/YouTube streams |
| **#lfg-looking-for-group** | Find multiplayer teammates |
| **Voice Channels** | Real-time coordination during matches |

---

## 2. Roles & Hierarchy

### Role Structure

Create roles in this order (Discord respects role hierarchy top-to-bottom):

#### Admin/Moderation Tier
1. **@Admin** (Red #E74C3C)
   - Full permissions; server management
   - Auto-assign: James only initially

2. **@Moderator** (Orange #F39C12)
   - Kick, ban, mute, delete messages
   - Manage channels and roles
   - Assign to trusted community members

3. **@Developer** (Purple #9B59B6)
   - Can post in #announcements
   - Access to dev-only channels (create private channel later)
   - Assign to core team members

#### Community Tiers
4. **@Alpha Tester** (Blue #3498DB)
   - Early access to experimental builds
   - Can react-vote on feature requests
   - Assign manually or via command

5. **@Tribe: Nomads** (Cyan #1ABC9C)
6. **@Tribe: Craftsmen** (Gold #F1C40F)
7. **@Tribe: Scholars** (Indigo #4B0082)
8. **@Tribe: Warriors** (Crimson #DC143C)
9. **@Tribe: Merchants** (Green #27AE60)
10. **@Tribe: Mystics** (Magenta #E91E63)
11. **@Tribe: Engineers** (Gray #95A5A6)
12. **@Tribe: Hunters** (Brown #8B4513)
13. **@Tribe: Nobility** (Royal Blue #4169E1)

#### Auto-Assign Roles
- **@Everyone** – All members (default)
- Create a role for **@Verified** (no permissions, cosmetic only) to gate access to specific channels if needed later

### Tribe Color Reference

Map Discord role colors to in-game tribe palettes:

| Tribe | Discord Color | Hex | In-Game Feel |
|-------|---------------|-----|-------------|
| Nomads | Cyan | `#1ABC9C` | Desert, sandy tones |
| Craftsmen | Gold | `#F1C40F` | Warm, wooden, crafted |
| Scholars | Indigo | `#4B0082` | Mystical, knowledge |
| Warriors | Crimson | `#DC143C` | Red, blood, battle |
| Merchants | Green | `#27AE60` | Rich, prosperity |
| Mystics | Magenta | `#E91E63` | Pink, ethereal, magic |
| Engineers | Gray | `#95A5A6` | Metal, industrial |
| Hunters | Brown | `#8B4513` | Natural, earthy |
| Nobility | Royal Blue | `#4169E1` | Royal, authoritative |

### Role Assignment Strategy

**Manual Assignment:**
- Admins/Mods: Manually assign when trusted
- Developers: Manually assign to core team
- Alpha Testers: Manually assign early-access players

**Reaction Roles (Automated):**
- Set up **#tribe-selection** with reaction role bot (see Bot Recommendations)
- Users react to a message to self-assign their tribe role
- Example: "React 🗡️ for Warriors, ⚒️ for Craftsmen, 📚 for Scholars, etc."

---

## 3. Welcome Message

### Paste This in #welcome

```
🏰 Welcome to Cubitopia!

This is the official community server for Cubitopia, a turn-based voxel strategy
game where you lead one of 9 unique tribes to build empires, engage in tactical
combat, and unlock cosmetic skins.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ **GET STARTED HERE**

1. Read #rules to understand community guidelines
2. Visit #tribe-selection to pick your favorite tribe (reaction roles)
3. Check #announcements for latest patches and updates
4. Jump into #general to introduce yourself

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎮 **TRIBES OF CUBITOPIA**

Choose your path:

🗡️ **Warriors** – Masters of combat, strategic unit composition
⚒️ **Craftsmen** – Skilled builders, resource optimization
📚 **Scholars** – Knowledge-focused, tech trees and bonuses
💰 **Merchants** – Trade-focused, economic dominance
✨ **Mystics** – Magic and mystical bonuses
🛠️ **Engineers** – Advanced mechanics, automation
🏹 **Hunters** – Speed and reconnaissance
⏰ **Nomads** – Mobility and adaptability
👑 **Nobility** – Leadership perks and units

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 **QUICK LINKS**

• Game Website: [link]
• Play Now: [link]
• Roadmap: [link]
• Bug Reports: #bug-reports
• Feature Requests: #feature-requests

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Have fun, be respectful, and build something legendary! 🚀
```

### Rules Message

Paste this in #rules:

```
⚖️ **COMMUNITY RULES**

By joining this server, you agree to:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣  **Be Respectful**
   • Treat all members with kindness
   • No harassment, hate speech, or discrimination
   • Disagreements are fine; personal attacks are not

2️⃣  **Keep It Clean**
   • No NSFW content or excessive profanity
   • Use #off-topic for non-game chat
   • No spam or self-promotion (except #streaming)

3️⃣  **Stay On Topic**
   • Use the right channels for the right discussion
   • Bug reports go in #bug-reports with the template
   • Feature requests belong in #feature-requests

4️⃣  **No Cheating or Exploits**
   • Report game exploits privately to @Developer
   • Don't share exploit details publicly
   • Griefing in multiplayer can result in bans

5️⃣  **Respect Privacy & Moderation**
   • No doxxing or sharing personal info
   • Don't argue with moderators publicly (DM them)
   • Follow mod requests without debate

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  **CONSEQUENCES**

   First Violation: Verbal warning
   Second: Mute (12-24 hours)
   Third: Kick
   Severe violations: Immediate ban

Moderators use discretion. Appeal bans by DM'ing @Admin

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Questions? Ask in #general or DM a @Moderator
```

---

## 4. Bug Report Template

Pin this message in #bug-reports:

```
🐛 **BUG REPORT TEMPLATE**

Use this format when reporting bugs. Reports without details are harder to fix!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**📌 TITLE:** [Short, clear bug title]

**📝 DESCRIPTION:** [What were you doing when this happened?]

**🔄 STEPS TO REPRODUCE:**
1.
2.
3.

**❌ EXPECTED BEHAVIOR:**
[What should happen?]

**✅ ACTUAL BEHAVIOR:**
[What actually happened?]

**🎮 GAME VERSION:** [e.g., 0.5.2]

**💻 PLATFORM:** [Web browser / Mobile app + OS]

**🖼️ SCREENSHOT/VIDEO:** [Attach if helpful]

**⚙️ ADDITIONAL INFO:**
[Server lag? Network issues? Tribe-specific? Browser console errors?]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Thanks for helping improve Cubitopia!
```

---

## 5. Bot Recommendations

### Essential Bots (Add in This Order)

#### 1. **MEE6** (Moderation + Roles)
   - **Why:** Auto-moderation, role reactions, leveling
   - **Setup:**
     - Enable welcome messages (send message to #welcome)
     - Set up reaction roles for #tribe-selection
     - Configure auto-moderation (spam detection, mass mentions)
   - **Commands:**
     - `/role add @user @role` – Assign roles manually
     - Handles reaction role button setup
   - **Cost:** Free tier sufficient for community <10k members

#### 2. **Dyno** (Moderation + Logs)
   - **Why:** Advanced moderation, audit logs, role management
   - **Setup:**
     - Enable moderation logging to a private mod channel
     - Set auto-kick for excessive caps/spam
     - Configure role reactions
   - **Commands:**
     - `/ban`, `/kick`, `/mute`
     - Logs every action for accountability
   - **Cost:** Free tier is good; premium adds more features

#### 3. **Ticket Tool** (Support)
   - **Why:** Organize bug reports and feature requests
   - **Setup:**
     - Create ticket system in #bug-reports
     - Auto-generate threads for each report
     - Allow users to open tickets with reactions
   - **Cost:** Free

#### 4. **UnbelievaBoat** (Economy/Engagement, Optional)
   - **Why:** Gamify engagement with currency
   - **Setup:**
     - Award "Cubitopia coins" for messages, helping others
     - Let users buy cosmetic perks (access to hidden channels, custom roles)
     - Tribe-specific leaderboards
   - **Commands:**
     - `/balance` – Check coins
     - `/leaderboard` – Tribe ranking
   - **Cost:** Free with paid tiers available

#### 5. **Embeds** (GitHub Integration, Optional)
   - **Why:** Auto-post patch notes to #patch-notes
   - **Setup:**
     - Connect GitHub repo webhook
     - Auto-embed releases or commit messages
     - Pretty format for patch notes
   - **Cost:** Free
   - **Alternative:** Use Discord's native webhooks if you prefer manual posting

#### 6. **GiselleBot** (Fun/Engagement)
   - **Why:** Fun commands keep server active
   - **Setup:**
     - Meme reactions
     - Random game tips
     - Tribe fortune teller ("What tribe are you meant for?")
   - **Commands:**
     - `/tribe-fortune` – Random tribe prediction
   - **Cost:** Free

### Bot Setup Checklist

- [ ] Install MEE6 from Discord App Marketplace
- [ ] Install Dyno from Discord App Marketplace
- [ ] Install Ticket Tool
- [ ] Install UnbelievaBoat (optional)
- [ ] Set up GitHub webhook for patch notes (optional)
- [ ] Test all role reactions in #tribe-selection
- [ ] Configure MEE6 welcome message
- [ ] Set moderator permissions in Dyno

---

## 6. Engagement Ideas

### Weekly Events

#### 📸 **Monday: Screenshot Showcase**
- Theme changes weekly (e.g., "Best Base Design," "Funniest Unit Placement," "Biggest Army")
- Post in #screenshots with theme
- Most-reacted image gets highlighted in #announcements
- Reward: Mention in weekly newsletter (or cosmetic item if you add achievements)

#### 🗡️ **Wednesday: Tribe Wars**
- Community event: Squad up with your tribe
- Organize 2v2 or FFA tournament in #multiplayer-chat
- Voice channels open in 🎤 Tribe Wars
- Winner tribe gets temporary "Champion" role (cosmetic)

#### 💡 **Friday: Feedback Friday**
- James posts development update in #announcements
- Community votes on next feature in #feature-requests
- Upvoted ideas get GitHub milestones tagged
- Live Q&A in voice if time permits

#### 🎨 **Bi-weekly: Art/Skin Design Contest**
- Fan-submitted tribe cosmetics
- Vote in #fan-art
- Winning design featured in game or as Discord reaction emote
- Encourage creative engagement with cosmetics

### Reaction Role System

**Setup in #tribe-selection:**

```
React below to join your tribe!

🗡️ Warriors | ⚒️ Craftsmen | 📚 Scholars
💰 Merchants | ✨ Mystics | 🛠️ Engineers
🏹 Hunters | ⏰ Nomads | 👑 Nobility

Your tribe role unlocks:
✓ Tribe-specific channel
✓ Colored name in chat
✓ Access to tribe strategy discussions
```

**Implementation:**
1. Post message in #tribe-selection
2. Use MEE6 or Dyno to enable reaction roles
3. Each emoji maps to a tribe role
4. Users can self-assign by reacting

### Bot-Driven Engagement

#### Auto-Tribal Greetings
Use MEE6 welcome message:
```
Welcome {user.mention}!

Pick your tribe in #tribe-selection, then say hello in #general.
Ready to build an empire? ⚔️
```

#### Tribe Leaderboards
Use UnbelievaBoat to display:
```
/leaderboard tribe

🥇 Warriors: 4,250 coins
🥈 Merchants: 3,890 coins
🥉 Scholars: 3,420 coins
```

### Integration Ideas

#### GitHub Webhook for Patch Notes
1. Go to repo Settings → Webhooks
2. Add webhook URL from Discord
3. Trigger on Releases
4. Auto-posts to #patch-notes with:
   - Version number
   - Feature list
   - Bug fixes
   - Download link

#### Twitch/YouTube Streaming Alerts
- Use Discord's built-in streaming alerts
- When members go live, notification posts in #streaming
- Encourage community clips

#### Scheduled Announcements
- Use MEE6 scheduling to remind about events
- Daily tip: "Today's Tribe Challenge: Build the tallest base!"
- Weekly update: Link to latest blog post

---

## 7. Setup Checklist

### Initial Setup (Day 1)
- [ ] Create Discord server
- [ ] Create categories and channels per "Server Structure"
- [ ] Set channel permissions (who can see/post what)
- [ ] Add all roles with correct colors
- [ ] Paste welcome message in #welcome
- [ ] Paste rules in #rules
- [ ] Paste bug template in #bug-reports

### Bot Setup (Day 2)
- [ ] Install MEE6, Dyno, Ticket Tool
- [ ] Configure MEE6 welcome message and reaction roles
- [ ] Test reaction roles in #tribe-selection
- [ ] Set up moderation logging in private mod channel
- [ ] Install optional bots (UnbelievaBoat, GitHub, GiselleBot)

### Community Kickoff (Day 3)
- [ ] Invite alpha testers and friends
- [ ] Assign @Alpha Tester role to early players
- [ ] Have James intro in #general
- [ ] Pin important messages (welcome, rules, template)
- [ ] Post first event announcement

### Ongoing Maintenance
- [ ] Weekly moderation check
- [ ] Monthly role audits (remove inactive @Alpha Tester)
- [ ] Keep #patch-notes updated
- [ ] Monitor #bug-reports for critical issues
- [ ] Celebrate wins in #announcements

---

## 8. Pro Tips

### Keeping Server Active
1. **Respond quickly** – Reply to bug reports within 24 hours
2. **Highlight content** – React to cool base designs, funny moments
3. **Be present** – James participating in #general builds trust
4. **Celebrate milestones** – "10k players!" role announcements
5. **Solicit feedback** – "What feature should we build next?" polls

### Avoiding Common Problems
- **Don't overload with channels** – Start with core 15, add niche ones as needed
- **Don't ghost on bug reports** – Even "Can't reproduce" is better than silence
- **Don't let toxicity fester** – Act fast on rule breaks
- **Don't auto-ban on first offense** – Warnings let people learn
- **Don't neglect tribe channels** – Update them with tribe-specific content

### Content Ideas for Tribe Channels
Each tribe channel (#tribe-1-nomads, etc.) should have:
- **Pinned message:** Tribe lore, unit composition tips, cosmetic skins
- **Weekly thread:** "How do YOU build as [Tribe]?"
- **Cosmetic showcase:** Links to popular skins for this tribe
- **Lore discussion:** Tribe history, personality, Easter eggs

### Monetization Alignment
Since Cubitopia has cosmetic skin purchases:
- Feature cosmetic showcases in #fan-art
- Celebrate user-designed skins
- Consider exclusive Discord role (e.g., "Skin Creator") for cosmetic artists
- Mention cosmetics in weekly themes ("Design a Warriors skin!")
- Post cosmetic announcements in #announcements

---

## 9. Advanced: Private Dev Channel (Optional)

If you want developer-only discussion:

1. Create **#dev-log** (locked, @Developer + @Admin only)
2. Create **#dev-voice** (voice channel, same permissions)
3. Post internal roadmap, bug priority list, sprint notes
4. Use this for sensitive discussions before public announcements

---

## Quick Start Command

**Once server is created, post this in #general to get people started:**

```
🚀 **Welcome, Cubitopia Player!**

Here's what to do next:
1. Head to #tribe-selection and pick your tribe (react to the message!)
2. Introduce yourself in #general
3. Check #announcements for the latest patch notes
4. Found a bug? Report it in #bug-reports (use the template)
5. Have an idea? Post in #feature-requests

Questions? Ask in #general or DM a moderator.

Now go build something legendary! ⚔️
```

---

**Document Version:** 1.0
**Last Updated:** 2026-04-04
**For:** Cubitopia Community Launch
**Maintained by:** Game Development Team
