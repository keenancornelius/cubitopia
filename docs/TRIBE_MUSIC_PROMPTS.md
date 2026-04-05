# Cubitopia — Tribe Music Prompts & Lyrics

> **Purpose:** AI music generation prompts for each tribe's soundtrack. Each tribe has 11 tracks: 1 title theme, 1 tutorial theme, 3 peaceful, 3 exploration, 3 combat. Feed each prompt into Suno, Udio, or similar AI music tools.
>
> **File naming convention:** Drop generated MP3s into `public/music/<folder>/` as:
> `Title.mp3`, `tutorial.mp3`, `peaceful1.mp3`–`peaceful3.mp3`, `exploration1.mp3`–`exploration3.mp3` (mapped as peaceful4–6 in code), `combat1.mp3`–`combat3.mp3`
>
> **Target duration:** Title ~2:30, Tutorial ~3:00, Peaceful/Exploration ~2:00–3:00, Combat ~2:00–2:30
> **Format:** Loopable (tracks crossfade in-game, so clean endings help)

---

## Tribe Naming — 5 TBA Tribes

| Slot | Genre | Tribe Name | Theme | Color | Icon |
|------|-------|-----------|-------|-------|------|
| V | Electronic | **Synthforged** | Techno-constructs, automatons, lightning forges | #1abc9c | ⚡ |
| VI | Hip-hop | **Ashwalkers** | Desert nomads, ash wastes, survivor culture | #f1c40f | 🔥 |
| VII | Lo-fi | **Dreamweavers** | Illusionists, dream magic, mist and moonlight | #e67e22 | 🌙 |
| VIII | Oldies | **Dustborn** | Ancient desert empire, sun temples, timeless rites | #d4a373 | ☀️ |
| IX | Alternative | **Voidtouched** | Chaos magic, dimensional rifts, entropy wielders | #8e7cc3 | 🌀 |

---

## 1. IRONVEIL (Fantasy)

**Musical Identity:** Epic high-fantasy orchestral with a grounded, martial edge. Think Skyrim meets Medieval Total War. Brass fanfares, war drums, choir swells, lute and harp for peaceful moments. The Ironveil are the "default" faction — classic sword-and-sorcery.

**Instrument Palette:** French horn, war drums, timpani, orchestral strings, harp, lute, choir (wordless "ah"), flute, cello solo, anvil strikes

**Key:** D minor (combat), F major (peaceful)
**Feel:** Noble, stoic, steadfast

---

### 1.1 — Title Theme
**File:** `music/fantasy/Title.mp3`
**Prompt:** Epic fantasy title screen theme. Starts with a lone French horn melody over distant war drums, builds into full orchestral brass fanfare with choir. Majestic and inviting, like approaching a medieval kingdom at dawn. Sweeping strings, timpani rolls, resolves into a heroic brass motif. 120 BPM, D minor to D major resolution. Loopable. Video game soundtrack, cinematic.
**Mood:** Awe, adventure awaits, dawn over castle walls
**Tempo:** 120 BPM

**Lyrics (choir, wordless with key phrases):**
```
[Wordless choir swell]
Ahhhh... Ahhhh...
Rise, shields of iron
Stand, veils of steel
The kingdom endures
Through fire revealed
Ahhhh... Ahhhh...
[Repeat as horn melody returns]
```

---

### 1.2 — Tutorial Theme
**File:** `music/fantasy/tutorial.mp3`
**Prompt:** Gentle fantasy tutorial music. Plucked lute over soft string pads, light flute melody, warm and encouraging. Feels like a wise mentor showing you the ropes in a sunlit courtyard. Simple, memorable melody that doesn't distract. 90 BPM, F major. Calm but not sleepy — there's purpose. Video game tutorial background music.
**Mood:** Learning, gentle encouragement, safe haven
**Tempo:** 90 BPM

**Lyrics:** (instrumental only)

---

### 1.3 — Peaceful 1: "The Hearth"
**File:** `music/fantasy/peaceful1.mp3`
**Prompt:** Peaceful medieval fantasy ambient music. Fingerpicked lute melody, soft harp arpeggios, distant birdsong, gentle cello. A quiet village at morning — smoke rising from chimneys, farmers walking to fields. Warm, nostalgic, hopeful. 80 BPM, F major. Loopable ambient game music.
**Mood:** Morning calm, village life, contentment
**Tempo:** 80 BPM

**Lyrics:** (instrumental only)

---

### 1.4 — Peaceful 2: "Stone and Stream"
**File:** `music/fantasy/peaceful2.mp3`
**Prompt:** Serene fantasy nature music. Running water sound layered under gentle flute melody with string drones. Harp glissandos, soft French horn in the distance. Feels like sitting by a brook in an ancient forest near old stone ruins. 75 BPM, C major. Ambient, contemplative, video game background.
**Mood:** Nature, reflection, ancient peace
**Tempo:** 75 BPM

**Lyrics:** (instrumental only)

---

### 1.5 — Peaceful 3: "Anvil's Rest"
**File:** `music/fantasy/peaceful3.mp3`
**Prompt:** Cozy medieval workshop ambient music. Rhythmic soft anvil taps woven into the beat, warm cello melody, plucked bass, gentle woodwinds. The feeling of a blacksmith's shop at evening — warm firelight, satisfying craft. 85 BPM, Bb major. Loopable game music.
**Mood:** Craft, industry, warm evening
**Tempo:** 85 BPM

**Lyrics:** (instrumental only)

---

### 1.6 — Exploration 1: "Beyond the Gate"
**File:** `music/fantasy/exploration1.mp3`
**Prompt:** Adventurous fantasy exploration music. Walking-pace rhythm with light snare, ascending string melody suggesting open horizons, flute countermelody, French horn punctuation. Curious and optimistic — you've just left the safety of your walls. 100 BPM, G major. Video game exploration theme.
**Mood:** Curiosity, open world, first steps into the unknown
**Tempo:** 100 BPM

**Lyrics:** (instrumental only)

---

### 1.7 — Exploration 2: "Old Roads"
**File:** `music/fantasy/exploration2.mp3`
**Prompt:** Mysterious fantasy exploration music. Low strings drone, solo oboe melody that winds and turns, occasional harp sparkles, muted timpani pulse. Walking through ancient ruins, overgrown paths, forgotten kingdoms. Slightly melancholy but wonder-filled. 95 BPM, A minor. Video game ambient exploration.
**Mood:** Mystery, ancient ruins, forgotten history
**Tempo:** 95 BPM

**Lyrics:** (instrumental only)

---

### 1.8 — Exploration 3: "Watchtower"
**File:** `music/fantasy/exploration3.mp3`
**Prompt:** Tense fantasy scouting music. Pizzicato strings creating forward momentum, muted horn motif, light woodblock percussion, building anticipation. You've spotted something on the horizon — could be allies or enemies. Alert but not panicked. 105 BPM, E minor. Video game exploration tension music.
**Mood:** Vigilance, scouting, something approaches
**Tempo:** 105 BPM

**Lyrics:** (instrumental only)

---

### 1.9 — Combat 1: "Shield Wall"
**File:** `music/fantasy/combat1.mp3`
**Prompt:** Intense fantasy battle music. Driving war drums, aggressive brass staccato, fast string runs, choir shouts. The clash of armies — shields splintering, swords ringing. Urgent and powerful but controlled, like a disciplined army holding formation. 140 BPM, D minor. Epic video game combat music, loopable.
**Mood:** Disciplined fury, shield clash, organized battle
**Tempo:** 140 BPM

**Lyrics (choir shouts, sparse):**
```
HOLD! HOLD!
Iron stands! Iron holds!
SHIELDS! FORWARD!
[War cry] HAAAH!
```

---

### 1.10 — Combat 2: "The Breaking Point"
**File:** `music/fantasy/combat2.mp3`
**Prompt:** Desperate fantasy battle music. Frantic strings, thundering timpani, brass melody that sounds strained and urgent, choir building to a crescendo. The battle is turning — the line is about to break. More intense and chaotic than Combat 1. 150 BPM, C minor. High-intensity video game boss battle music.
**Mood:** Desperation, turning point, all-or-nothing
**Tempo:** 150 BPM

**Lyrics (choir):**
```
No retreat! No retreat!
Stand or fall — the veil holds!
IRON! IRON! IRON!
[Crescendo to instrumental]
```

---

### 1.11 — Combat 3: "Victory March"
**File:** `music/fantasy/combat3.mp3`
**Prompt:** Triumphant fantasy battle resolution music. Victorious brass fanfare over driving drums, soaring string melody, choir in major key. The enemy is routing — press the advantage. Powerful, forward-momentum, celebratory but still martial. 135 BPM, D major. Epic victory combat music, video game.
**Mood:** Triumph, pursuit, glorious victory
**Tempo:** 135 BPM

**Lyrics (choir):**
```
Rise! The iron veil!
Glory crowned in steel!
Forward! Ever forward!
The kingdom prevails!
```

---
---

## 2. WILDBORNE (Metal)

**Musical Identity:** Aggressive, primal, raw. Folk metal meets Viking war chants. Distorted guitars, pounding double-bass drums, Nordic folk instruments (Hardingfele, Tagelharpa), guttural chants, throat singing. The Wildborne are feral berserkers who fight alongside beasts.

**Instrument Palette:** Distorted electric guitar, double-bass kick drum, Tagelharpa/Hardingfele (Nordic fiddle), war horns (Gjallarhorn), throat singing, tribal hand drums, growl vocals, clean female folk vocals, bone flutes

**Key:** E minor (combat), A minor (peaceful)
**Feel:** Primal, untamed, savage and free

---

### 2.1 — Title Theme
**File:** `music/metal/Title.mp3`
**Prompt:** Viking folk metal title theme. Opens with a lone war horn blast echoing across mountains, then tribal drums kick in with a driving double-bass metal beat. Distorted guitar riff over Nordic fiddle melody. Throat singing chant builds to a headbanging crescendo. Raw, powerful, wild. 130 BPM, E minor. Video game title screen, folk metal.
**Mood:** Wild freedom, the hunt begins, howl at the moon
**Tempo:** 130 BPM

**Lyrics (chanted/growled):**
```
[War horn blast]
BORN OF WILD! BORN OF FANG!
We hunt beneath the blackened sky!
WILDBORNE! WILDBORNE!
No cage! No crown! No chain!
The forest remembers our name!
[Guitar solo over war drums]
```

---

### 2.2 — Tutorial Theme
**File:** `music/metal/tutorial.mp3`
**Prompt:** Calm folk acoustic tutorial music with metal undertones. Fingerpicked acoustic guitar, bone flute melody, soft tribal drum pulse, distant wolf howl. Like sitting around a campfire deep in an ancient forest, a shaman teaching a young warrior. Warm but wild. 85 BPM, A minor. Acoustic folk game music.
**Mood:** Campfire wisdom, forest calm, learning the old ways
**Tempo:** 85 BPM

**Lyrics:** (instrumental only)

---

### 2.3 — Peaceful 1: "Deep Roots"
**File:** `music/metal/peaceful1.mp3`
**Prompt:** Dark forest ambient folk music. Layered Hardingfele drone, soft acoustic guitar fingerpicking, distant bird calls and wind, light hand drum pulse. Ancient forest at twilight — massive trees, moss-covered stones, faint mist. Atmospheric and grounding. 70 BPM, A minor. Nordic folk ambient, video game.
**Mood:** Ancient forest, deep roots, quiet strength
**Tempo:** 70 BPM

**Lyrics:** (instrumental only)

---

### 2.4 — Peaceful 2: "Wolf Mother"
**File:** `music/metal/peaceful2.mp3`
**Prompt:** Gentle Nordic folk lullaby. Clean female vocals humming a haunting melody over soft Tagelharpa drone and fingerpicked guitar. Distant wolf howl harmonizing. The den at rest — cubs sleeping, the pack safe. Tender but with underlying wildness. 75 BPM, D minor. Scandinavian folk lullaby, ambient game music.
**Mood:** Pack bond, protective calm, the den at rest
**Tempo:** 75 BPM

**Lyrics (hummed/sung softly by female voice):**
```
[Humming melody]
Sleep now, little fang
The moon guards the den
The pack runs in dreams
Until dawn comes again
[Humming continues]
```

---

### 2.5 — Peaceful 3: "Bone and Bark"
**File:** `music/metal/peaceful3.mp3`
**Prompt:** Ritualistic ambient folk music. Slow rhythmic bone percussion, deep throat singing drone, wooden flute melody that curves and wanders, occasional antler clicks. A shaman preparing totems, carving runes into bark. Meditative, primal. 65 BPM, E minor. Tribal ambient music, dark folk.
**Mood:** Ritual, totem craft, shamanic meditation
**Tempo:** 65 BPM

**Lyrics:** (instrumental only)

---

### 2.6 — Exploration 1: "The Trackless Wild"
**File:** `music/metal/exploration1.mp3`
**Prompt:** Driving acoustic folk exploration music. Fast fingerpicked acoustic guitar, Hardingfele melody darting up and down scales, light tribal drums in a trotting rhythm. Running through dense forest, leaping logs, tracking prey. Energetic and free. 115 BPM, G minor. Folk rock exploration music, video game.
**Mood:** The hunt, tracking prey, moving through dense forest
**Tempo:** 115 BPM

**Lyrics:** (instrumental only)

---

### 2.7 — Exploration 2: "Blood Scent"
**File:** `music/metal/exploration2.mp3`
**Prompt:** Tense dark folk exploration music. Low Tagelharpa drone building intensity, muted tribal drums like a heartbeat, bone flute playing a stalking melody. Something is being hunted — or you're being hunted. Predatory tension. 95 BPM, B minor. Dark Nordic folk, tense game music.
**Mood:** Stalking, predator-prey tension, the wild watches
**Tempo:** 95 BPM

**Lyrics:** (instrumental only)

---

### 2.8 — Exploration 3: "High Ridge"
**File:** `music/metal/exploration3.mp3`
**Prompt:** Expansive Nordic folk exploration music. Gjallarhorn call over panoramic string pads, acoustic guitar arpeggios, wind sounds, soaring clean female vocals (wordless). Standing on a mountain ridge overlooking endless wild territory. Grand and free. 100 BPM, D major. Epic folk ambient, Viking exploration.
**Mood:** Mountain vista, territory surveying, wild majesty
**Tempo:** 100 BPM

**Lyrics (wordless female vocals):**
```
[Soaring "Ahhh" and "Ohhh" melody lines over the vista]
```

---

### 2.9 — Combat 1: "Berserker Rage"
**File:** `music/metal/combat1.mp3`
**Prompt:** Aggressive Viking folk metal battle music. Blast-beat double-bass drums, heavy distorted guitar chugging riff, Hardingfele shrieking over the top, guttural war chants. Pure berserker fury — axes swinging, no formations, just chaos and blood. 160 BPM, E minor. Folk metal combat music, video game battle theme.
**Mood:** Berserker fury, uncontrolled rage, primal violence
**Tempo:** 160 BPM

**Lyrics (growled/chanted):**
```
RRRAAAGH! BLOOD FOR THE WILD!
Teeth and claw! Fang and steel!
BREAK THEM! TEAR THEM!
The beast inside is REAL!
[Breakdown with tribal drums]
WILD! BORN! WILD! BORN!
```

---

### 2.10 — Combat 2: "Pack Tactics"
**File:** `music/metal/combat2.mp3`
**Prompt:** Coordinated Viking battle metal. Galloping guitar rhythm like wolves running in formation, tight drum patterns, call-and-response war horn blasts, growl vocals alternating with clean chant. More organized than Berserker Rage — the pack hunting as one. 145 BPM, A minor. Melodic folk metal, strategic battle music.
**Mood:** Pack coordination, flanking, wolves closing in
**Tempo:** 145 BPM

**Lyrics (alternating growl and clean chant):**
```
[Clean] Circle... circle... close the ring
[Growl] NO ESCAPE FROM FANG AND CLAW
[Clean] Left flank howls, the right flank springs
[Growl] THE PACK DEVOURS ALL!
```

---

### 2.11 — Combat 3: "The Red Feast"
**File:** `music/metal/combat3.mp3`
**Prompt:** Climactic folk metal victory battle. Maximum intensity — blast beats, tremolo guitar picking, triumphant Hardingfele melody soaring above the chaos, massive choir chanting. The enemy is broken, the feast of victory begins. Savage but euphoric. 155 BPM, E minor resolving to E major. Epic metal battle climax, video game.
**Mood:** Savage triumph, the kill, celebration through bloodlust
**Tempo:** 155 BPM

**Lyrics (choir + growl):**
```
[Choir] THE WILD RECLAIMS! THE WILD RECLAIMS!
[Growl] Bones for the forest floor!
[Choir] FEAST! FEAST! THE RED FEAST!
[Growl] The Wildborne settle the score!
[All together] AWOOOOO!
```

---
---

## 3. ARCANISTS (Orchestral)

**Musical Identity:** Grand, sweeping, magical. Full symphony orchestra with ethereal elements. Think Harry Potter meets Final Fantasy. Sparkling celesta, soaring violin solos, deep brass for gravitas, magical synth shimmer layers. The Arcanists are scholars and battlemages — their music is intellectual, layered, and awe-inspiring.

**Instrument Palette:** Full string section, celesta, glockenspiel, French horn, trumpet, harp, choir (ethereal soprano), synth shimmer pads, tubular bells, piano, glass harmonica

**Key:** Bb minor (combat), Eb major (peaceful)
**Feel:** Mystical, intellectual, awe-inspiring grandeur

---

### 3.1 — Title Theme
**File:** `music/orchestral/Title.mp3`
**Prompt:** Grand magical orchestral title theme. Opens with celesta playing a crystalline melody over string tremolo, then full orchestra swells in with soaring trumpet fanfare. Ethereal soprano choir joins. Feels like the doors of a magical academy opening to reveal infinite wonder. Sweeping, grand, magical. 115 BPM, Bb minor to Eb major. Cinematic orchestral, video game title theme.
**Mood:** Wonder, arcane power, the academy awaits
**Tempo:** 115 BPM

**Lyrics (ethereal soprano choir):**
```
[Celesta intro]
Beyond the veil of knowing
Where starlight turns to flame
The Arcanists are calling
Speak the world's true name
Ahhhh... [soaring vocal over orchestra swell]
Knowledge is our armor
Wisdom is our blade
```

---

### 3.2 — Tutorial Theme
**File:** `music/orchestral/tutorial.mp3`
**Prompt:** Whimsical magical tutorial music. Playful celesta and glockenspiel melody, light pizzicato strings, gentle harp, occasional magical sparkle sound effects. Like a patient wizard instructor demonstrating basic spells with a knowing smile. Charming, lighthearted, magical. 95 BPM, Eb major. Orchestral tutorial music, Harry Potter style.
**Mood:** Playful learning, first spells, magical wonder
**Tempo:** 95 BPM

**Lyrics:** (instrumental only)

---

### 3.3 — Peaceful 1: "The Library Eternal"
**File:** `music/orchestral/peaceful1.mp3`
**Prompt:** Serene magical library ambient music. Soft piano arpeggios, distant string pads, celesta twinkles like turning pages, deep warm cello. An infinite library where knowledge floats as motes of light. Contemplative, vast, hushed reverence. 70 BPM, Eb major. Ambient orchestral, magical study music.
**Mood:** Study, ancient knowledge, infinite shelves
**Tempo:** 70 BPM

**Lyrics:** (instrumental only)

---

### 3.4 — Peaceful 2: "Crystal Garden"
**File:** `music/orchestral/peaceful2.mp3`
**Prompt:** Ethereal magical garden ambient music. Glass harmonica melody, harp glissandos, soft wind chimes, high violin harmonics, delicate flute. A garden where crystalline flowers grow and emit soft light. Beautiful, otherworldly, meditative. 75 BPM, Ab major. Fantasy ambient, magical garden soundscape.
**Mood:** Magical beauty, crystal growth, peaceful wonder
**Tempo:** 75 BPM

**Lyrics:** (instrumental only)

---

### 3.5 — Peaceful 3: "Starfall"
**File:** `music/orchestral/peaceful3.mp3`
**Prompt:** Nocturnal magical ambient music. Slow piano chords with sustain pedal, high string harmonics like stars twinkling, gentle tubular bells, celesta descending runs like falling stars. Mages observing the night sky from a tower observatory. Peaceful, infinite, contemplative. 65 BPM, F minor. Night sky ambient, orchestral meditation.
**Mood:** Night observation, cosmic wonder, still contemplation
**Tempo:** 65 BPM

**Lyrics:** (instrumental only)

---

### 3.6 — Exploration 1: "Arcane Cartography"
**File:** `music/orchestral/exploration1.mp3`
**Prompt:** Curious orchestral exploration music. Clarinet leading a winding melody, pizzicato strings providing rhythm, celesta accents, building French horn motif. Exploring new territory with arcane instruments and magical mapping. Intellectual curiosity driving each step. 105 BPM, G minor. Orchestral exploration, adventure game music.
**Mood:** Intellectual curiosity, magical surveying, discovery
**Tempo:** 105 BPM

**Lyrics:** (instrumental only)

---

### 3.7 — Exploration 2: "Ley Lines"
**File:** `music/orchestral/exploration2.mp3`
**Prompt:** Mystical ambient orchestral exploration. Deep cello melody following a path, synth shimmer pads pulsing with magical energy, harp arpeggios, distant tubular bells. Tracing invisible lines of magical energy through the landscape. The ground hums with power. 90 BPM, D minor. Mystical exploration ambient, video game.
**Mood:** Following magical energy, hidden power, the world hums
**Tempo:** 90 BPM

**Lyrics:** (instrumental only)

---

### 3.8 — Exploration 3: "The Unknown Variable"
**File:** `music/orchestral/exploration3.mp3`
**Prompt:** Tense mysterious orchestral exploration. Staccato violin, uncertain clarinet melody, muted brass swells, building timpani rumble. Something unknown ahead — could be a breakthrough discovery or a dangerous anomaly. Scholarly caution meets burning curiosity. 100 BPM, C# minor. Suspenseful orchestral, mystery game music.
**Mood:** Cautious discovery, anomaly detected, the unknown calls
**Tempo:** 100 BPM

**Lyrics:** (instrumental only)

---

### 3.9 — Combat 1: "Spellstorm"
**File:** `music/orchestral/combat1.mp3`
**Prompt:** Intense magical orchestral battle music. Rapid string runs like casting gestures, brass blasts like spell impacts, timpani thunder, choir shouting arcane syllables. Battlemages unleashing coordinated spell barrages — organized destruction through intellect. 140 BPM, Bb minor. Epic orchestral battle, magical combat music.
**Mood:** Coordinated magical assault, spell volleys, controlled power
**Tempo:** 140 BPM

**Lyrics (choir, arcane-sounding):**
```
IGNIS! VENTUS! TERRA! FLUX!
Weave the storm! Bind the light!
ARCANA DOMINATUS!
Knowledge burns eternal bright!
```

---

### 3.10 — Combat 2: "Mana Surge"
**File:** `music/orchestral/combat2.mp3`
**Prompt:** Overwhelming magical orchestral battle. Full orchestra at maximum intensity, celesta playing frantic ascending runs, massive brass chords, choir in dissonant harmonies resolving into power chords. Mana levels overloading — spells going critical, raw magical energy everywhere. 150 BPM, F# minor. Maximum intensity orchestral, magical overload.
**Mood:** Power overload, mana critical, beautiful destruction
**Tempo:** 150 BPM

**Lyrics (choir, urgent):**
```
THE WEAVE IS BREAKING! HOLD THE PATTERN!
More power — MORE!
CHANNEL EVERYTHING!
Let the arcane POUR!
[Dissonant choir climax]
```

---

### 3.11 — Combat 3: "Theorem of Victory"
**File:** `music/orchestral/combat3.mp3`
**Prompt:** Triumphant magical orchestral resolution. Soaring violin solo over victorious brass fanfare, celesta cascading down in celebration, full choir in radiant major key. The equation is solved — victory was mathematically inevitable. Elegant, grand, intellectually satisfying. 130 BPM, Eb major. Triumphant orchestral victory, video game.
**Mood:** Calculated triumph, elegant victory, QED
**Tempo:** 130 BPM

**Lyrics (choir, triumphant):**
```
The theorem stands! The proof is light!
What was unknown now shines bright!
Arcanists prevail through mind!
Leave the darkness far behind!
[Soaring soprano solo]
```

---
---

## 4. TIDECALLERS (Celtic)

**Musical Identity:** Seafaring Celtic folk with a maritime pulse. Uilleann pipes, bodhrán, tin whistle, fiddle, concertina. Shanty rhythms, sea-spray energy, haunting harbor melodies. The Tidecallers are naval traders and sea raiders — their music rolls with the waves.

**Instrument Palette:** Uilleann pipes, tin whistle, Irish fiddle, bodhrán (frame drum), concertina, acoustic guitar, mandolin, deep male chorus (shanty style), Celtic harp, ocean wave sound design

**Key:** G minor (combat), D major/G major (peaceful)
**Feel:** Rolling, maritime, adventurous with melancholy undertow

---

### 4.1 — Title Theme
**File:** `music/celtic/Title.mp3`
**Prompt:** Epic Celtic maritime title theme. Starts with a lone tin whistle melody over ocean wave ambience, then bodhrán kicks in with a driving 6/8 sea rhythm, full fiddle joins, Uilleann pipes soar. Male chorus sings a triumphant sailing anthem. The open sea, salt wind, a fleet on the horizon. 130 BPM, G mixolydian. Celtic folk rock, sea shanty anthem, video game title.
**Mood:** Salt wind, open sea, fleet glory, adventure
**Tempo:** 130 BPM (6/8 feel)

**Lyrics (male chorus, shanty style):**
```
[Tin whistle intro over waves]
HO! The tide answers our call!
From harbor deep to waterfall!
TIDECALLERS! Ride the swell!
Every wave a story to tell!
HO! HO! The sea provides!
Fortune favors those who ride the tides!
[Fiddle solo break]
```

---

### 4.2 — Tutorial Theme
**File:** `music/celtic/tutorial.mp3`
**Prompt:** Gentle Celtic tutorial music. Light fingerpicked acoustic guitar, soft tin whistle melody, gentle bodhrán tap, Celtic harp accents. Like an old sailor teaching knots on a calm harbor dock. Warm, patient, slightly salty. 90 BPM, D major. Gentle Celtic folk, tutorial game music.
**Mood:** Harbor lessons, calm waters, learning the ropes
**Tempo:** 90 BPM

**Lyrics:** (instrumental only)

---

### 4.3 — Peaceful 1: "Safe Harbor"
**File:** `music/celtic/peaceful1.mp3`
**Prompt:** Peaceful Celtic harbor ambient music. Concertina playing a gentle waltz, distant seagull calls, soft Celtic harp, lapping water sounds, warm fiddle. Ships creaking at dock, merchants unloading, the pub glowing warm at the end of the pier. 80 BPM, D major, 3/4 time. Celtic ambient, peaceful harbor music.
**Mood:** Harbor at evening, ships at rest, merchants and ale
**Tempo:** 80 BPM (waltz)

**Lyrics:** (instrumental only)

---

### 4.4 — Peaceful 2: "The Coral Throne"
**File:** `music/celtic/peaceful2.mp3`
**Prompt:** Mystical underwater Celtic ambient music. Reverb-heavy Celtic harp arpeggios, deep ocean drones, distant whale-song-like Uilleann pipes, soft shimmering sounds. An underwater palace of coral and pearl, light filtering down from above. Otherworldly, beautiful, deep. 70 BPM, E minor. Celtic ambient, underwater fantasy.
**Mood:** Underwater wonder, coral palace, deep mystery
**Tempo:** 70 BPM

**Lyrics:** (instrumental only)

---

### 4.5 — Peaceful 3: "Mending Nets"
**File:** `music/celtic/peaceful3.mp3`
**Prompt:** Homey Celtic domestic music. Cheerful mandolin melody, light bodhrán, acoustic guitar rhythm, tin whistle countermelody. Village folk mending nets on the beach, children playing in tide pools, easy laughter. Warm, communal, grounded. 95 BPM, G major. Irish folk, cheerful village music, video game.
**Mood:** Community, daily work, simple joy
**Tempo:** 95 BPM

**Lyrics:** (instrumental only)

---

### 4.6 — Exploration 1: "Charting New Waters"
**File:** `music/celtic/exploration1.mp3`
**Prompt:** Adventurous Celtic seafaring exploration music. Rolling 6/8 bodhrán rhythm like ocean swells, fiddle playing a curious searching melody, tin whistle answering, concertina chords. Sailing into uncharted waters with a spyglass and a grin. 110 BPM, A mixolydian. Celtic adventure folk, sailing exploration music.
**Mood:** Open sea adventure, spyglass ahead, uncharted waters
**Tempo:** 110 BPM

**Lyrics:** (instrumental only)

---

### 4.7 — Exploration 2: "Fog Bank"
**File:** `music/celtic/exploration2.mp3`
**Prompt:** Eerie Celtic maritime exploration music. Slow Uilleann pipes drone in thick reverb, distant ship bell, muted bodhrán like a heartbeat, ghostly fiddle harmonics. Sailing blind through dense fog — shapes in the mist, is that a reef or a ship? Tense, atmospheric. 85 BPM, B minor. Dark Celtic ambient, foggy sea tension.
**Mood:** Fog navigation, unseen danger, ghost ships
**Tempo:** 85 BPM

**Lyrics:** (instrumental only)

---

### 4.8 — Exploration 3: "Coastline"
**File:** `music/celtic/exploration3.mp3`
**Prompt:** Bright Celtic coastal exploration music. Upbeat fiddle reel feel but at exploration pace, bodhrán driving, tin whistle trills, acoustic guitar strumming. Following a beautiful coastline — cliffs, sea caves, hidden coves. Invigorating salt air. 105 BPM, D major. Irish folk, coastal adventure music.
**Mood:** Coastal discovery, cliffs and coves, fresh salt air
**Tempo:** 105 BPM

**Lyrics:** (instrumental only)

---

### 4.9 — Combat 1: "Broadside!"
**File:** `music/celtic/combat1.mp3`
**Prompt:** Aggressive Celtic sea battle music. Fast 6/8 bodhrán driving, aggressive fiddle reel, Uilleann pipes war melody, male chorus shouting battle shanty. Naval combat — cannons firing, boarding parties, cutlass clashing. 150 BPM, G minor. Celtic punk battle music, pirate combat.
**Mood:** Naval battle, cannon fire, boarding action
**Tempo:** 150 BPM

**Lyrics (male chorus, shouted):**
```
BROADSIDE! FIRE! RELOAD!
Send 'em down to Davy's road!
BOARD 'EM! STEEL AND SPRAY!
The Tidecallers own this bay!
HO! HO! CUT 'EM DOWN!
Every wave wears our crown!
```

---

### 4.10 — Combat 2: "Maelstrom"
**File:** `music/celtic/combat2.mp3`
**Prompt:** Chaotic Celtic storm battle music. Frantic fiddle runs, thunderous bodhrán, Uilleann pipes screaming over crashing wave sounds, male chorus in urgent call-and-response. Fighting in a storm — the sea itself is an enemy. Desperate, chaotic, exhilarating. 155 BPM, D minor. Intense Celtic combat, storm battle music.
**Mood:** Storm combat, chaos, fighting sea and foe
**Tempo:** 155 BPM

**Lyrics (call and response):**
```
[Call] THE STORM RISES!
[Response] WE RISE HIGHER!
[Call] THE WAVES CRASH!
[Response] WE CRASH HARDER!
[All] TIDECALLERS NEVER DROWN!
TIDECALLERS NEVER DROWN!
```

---

### 4.11 — Combat 3: "Plunder Tide"
**File:** `music/celtic/combat3.mp3`
**Prompt:** Triumphant Celtic victory sea battle. Celebratory fast fiddle reel, bodhrán in double time, concertina pumping, tin whistle dancing, male chorus in joyous shanty. The battle is won — haul the plunder aboard, raise the flag! 145 BPM, G major. Celebratory Celtic folk, victory shanty.
**Mood:** Victory at sea, plunder, celebration on deck
**Tempo:** 145 BPM

**Lyrics (shanty, celebratory):**
```
HAUL IT UP! HAUL IT UP!
Gold and glory fill the cup!
The tide ran red, now runs gold!
The Tidecallers' tale is told!
HO HO HO! Another victory!
The sea remembers Tidecaller history!
```

---
---

## 5. SYNTHFORGED (Electronic)

**Musical Identity:** Futuristic techno-industrial. Pulsing synths, mechanical rhythms, glitchy textures, vocoder vocals. Think Daft Punk meets a steampunk forge. The Synthforged build automatons and wield lightning — their music is precision-engineered and crackling with energy.

**Instrument Palette:** Analog synth bass, arpeggiator sequences, vocoder, industrial percussion (anvil hits, piston rhythms), electric crackle sound design, 808 kicks, sidechained pads, glitch effects, tesla coil zaps

**Key:** F minor (combat), Ab major (peaceful)
**Feel:** Precise, crackling, machine-beautiful

---

### 5.1 — Title Theme
**File:** `music/electronic/Title.mp3`
**Prompt:** Futuristic electronic title theme. Starts with a spark — electric crackle into pulsing arpeggiator sequence, heavy sidechain bass drops in, vocoder choir sings an anthemic melody. Industrial percussion like hammers on anvils mixed with 808 patterns. Feels like booting up an ancient machine god. 128 BPM, F minor. Synthwave industrial, video game title theme.
**Mood:** Ignition, the forge awakens, electric genesis
**Tempo:** 128 BPM

**Lyrics (vocoder/processed vocals):**
```
[Electric crackle → arpeggiator boot sequence]
We are the SYNTHFORGED
Built from lightning and steel
Every circuit a prayer
Every gear makes it real
POWER UP — POWER UP
The forge never sleeps
What we build will outlast
What the old world still keeps
```

---

### 5.2 — Tutorial Theme
**File:** `music/electronic/tutorial.mp3`
**Prompt:** Gentle electronic tutorial music. Soft synth pads, light arpeggiator melody at low tempo, gentle electronic blips like interface sounds, warm bass hum. Like a friendly AI assistant walking you through a holographic interface. Clean, modern, reassuring. 100 BPM, Ab major. Chillstep tutorial, video game UI music.
**Mood:** System tutorial, friendly interface, guided learning
**Tempo:** 100 BPM

**Lyrics:** (instrumental only)

---

### 5.3 — Peaceful 1: "The Idle Forge"
**File:** `music/electronic/peaceful1.mp3`
**Prompt:** Ambient industrial peaceful music. Deep warm synth drones, gentle mechanical rhythms like distant pistons, soft arpeggiator twinkle, occasional steam hiss. A massive forge at rest — pilot lights glowing, machines humming in standby, warm and safe. 85 BPM, Ab major. Ambient electronic, industrial chill.
**Mood:** Machine standby, warm hum, idle beauty
**Tempo:** 85 BPM

**Lyrics:** (instrumental only)

---

### 5.4 — Peaceful 2: "Circuit Garden"
**File:** `music/electronic/peaceful2.mp3`
**Prompt:** Dreamy electronic ambient music. Layered synth pads evolving slowly, high sparkle arpeggios like data flowing through crystal wires, deep sub bass warmth, soft glitch textures. A garden where plants grow along circuit boards, merging nature and machine. Beautiful and strange. 80 BPM, Db major. Ambient electronic, nature-meets-tech soundscape.
**Mood:** Nature-tech fusion, growing circuits, beautiful integration
**Tempo:** 80 BPM

**Lyrics:** (instrumental only)

---

### 5.5 — Peaceful 3: "Charge Cycle"
**File:** `music/electronic/peaceful3.mp3`
**Prompt:** Minimal electronic ambient music. Slow pulsing bass note like a heartbeat, soft electric crackle textures, gentle rising and falling synth chords like breathing, occasional tesla coil sparkle. Automatons recharging in rows, energy gently flowing. Meditative, electric. 70 BPM, F minor. Minimal techno ambient, machine meditation.
**Mood:** Recharging, electric meditation, stored potential
**Tempo:** 70 BPM

**Lyrics:** (instrumental only)

---

### 5.6 — Exploration 1: "Signal Trace"
**File:** `music/electronic/exploration1.mp3`
**Prompt:** Driving electronic exploration music. Pulsing arpeggiator sequence building layers, tight electronic drums, synth lead scanning like radar, bass following a path. Tracking an energy signal through unknown terrain — scanners active, data streaming. 120 BPM, G minor. Synthwave exploration, scanning music.
**Mood:** Signal tracking, radar sweep, data discovery
**Tempo:** 120 BPM

**Lyrics:** (instrumental only)

---

### 5.7 — Exploration 2: "Rust and Wire"
**File:** `music/electronic/exploration2.mp3`
**Prompt:** Atmospheric industrial exploration music. Detuned synth pads, glitchy percussion like broken machines, distorted bass notes, occasional burst of static. Exploring ruins of an old forge — rusted automatons, sparking wires, forgotten technology. Eerie, fascinating. 95 BPM, Bb minor. Dark electronic ambient, ruin exploration.
**Mood:** Ruin exploration, broken tech, forgotten forge
**Tempo:** 95 BPM

**Lyrics:** (instrumental only)

---

### 5.8 — Exploration 3: "Grid Walk"
**File:** `music/electronic/exploration3.mp3`
**Prompt:** Upbeat electronic exploration music. Clean synth melody, four-on-the-floor kick at walking pace, bright arpeggiator, optimistic chord progression. Mapping new territory with geometric precision — every hex accounted for, every resource catalogued. Efficient and satisfying. 110 BPM, Ab major. Upbeat synthwave, mapping game music.
**Mood:** Efficient mapping, systematic exploration, everything catalogued
**Tempo:** 110 BPM

**Lyrics:** (instrumental only)

---

### 5.9 — Combat 1: "Overclock"
**File:** `music/electronic/combat1.mp3`
**Prompt:** Aggressive electronic combat music. Heavy distorted bass drops, rapid-fire arpeggiator like machine gun fire, industrial percussion hits, glitch stutters on impacts, sidechain pumping hard. Automatons in combat — efficient, devastating, mechanical precision. 140 BPM, F minor. Aggressive industrial techno, combat music.
**Mood:** Machine warfare, overclocked systems, efficient destruction
**Tempo:** 140 BPM

**Lyrics (vocoder, sparse):**
```
OVERCLOCK — ENGAGE
Systems hot — MAXIMUM OUTPUT
Target acquired — NEUTRALIZE
The forge demands VICTORY
```

---

### 5.10 — Combat 2: "Voltage Spike"
**File:** `music/electronic/combat2.mp3`
**Prompt:** Chaotic electronic combat music. Distorted synth screams, breakbeat percussion, tesla coil discharge sound effects layered into the rhythm, bass so heavy it distorts, glitch stutter buildups into massive drops. Power overloading — systems redlining, everything at maximum. 150 BPM, E minor. Heavy industrial dubstep, overload combat music.
**Mood:** System overload, voltage critical, beautiful chaos
**Tempo:** 150 BPM

**Lyrics (vocoder, distorted):**
```
WARNING — VOLTAGE CRITICAL
SURGE — SURGE — SURGE
CANNOT CONTAIN — RELEASING ALL POWER
THE LIGHTNING — CONSUMES
[Drop into heavy bass]
```

---

### 5.11 — Combat 3: "Forge Victory"
**File:** `music/electronic/combat3.mp3`
**Prompt:** Triumphant electronic victory theme. Soaring synth lead melody over driving four-on-the-floor beat, uplifting chord progression, vocoder choir singing in harmony, arpeggiator cascading in celebration. Systems returning to optimal — victory computed, outcome achieved. 135 BPM, Ab major. Uplifting trance, electronic victory anthem.
**Mood:** Optimal outcome achieved, systems nominal, calculated triumph
**Tempo:** 135 BPM

**Lyrics (vocoder choir):**
```
FORGED IN LIGHTNING — PROVEN IN WAR
The Synthforged prevail — forevermore
Systems optimal — victory achieved
What we built — cannot be deceived
[Soaring synth solo]
```

---
---

## 6. ASHWALKERS (Hip-Hop)

**Musical Identity:** Gritty survival hip-hop with dusty, warm production. Boom-bap drums, vinyl crackle, deep 808 bass, sampled Middle Eastern/North African melodic elements. The Ashwalkers are desert nomads surviving in ash wastes — their music is resilient, rhythmic, and tells stories of endurance.

**Instrument Palette:** 808 bass, boom-bap drums, vinyl crackle, oud samples, dusty piano chops, brass stabs, scratching/turntablism, spoken word/rap vocals, hand claps, finger snaps, desert wind ambience

**Key:** C minor (combat), Eb major (peaceful)
**Feel:** Gritty, resilient, dusty warmth, survivor energy

---

### 6.1 — Title Theme
**File:** `music/hiphop/Title.mp3`
**Prompt:** Epic hip-hop title theme with Middle Eastern influence. Deep 808 bass over boom-bap beat, oud melody sample chopped and looped, dusty piano chords, brass stabs for emphasis. Confident spoken-word rap about survival and rising from ashes. Cinematic, gritty, powerful. 90 BPM, C minor. Hip-hop cinematic, desert warrior anthem.
**Mood:** Rising from ashes, desert resilience, survivor swagger
**Tempo:** 90 BPM

**Lyrics (spoken word/rap):**
```
[808 drop + oud sample]
We walked through the ashes when the world burned down
Built our throne from the rubble on scorched-earth ground
ASHWALKERS — yeah, we earned that name
Every scar's a story, every step's a claim

They said nothing grows where the fire's been?
Look around — we're the harvest rising from within
Desert wind at our backs, sun forged our skin
Ashwalkers don't break — Ashwalkers WIN

[Scratch break + brass stab]
```

---

### 6.2 — Tutorial Theme
**File:** `music/hiphop/tutorial.mp3`
**Prompt:** Chill lo-fi hip-hop tutorial beat. Mellow piano loop, soft boom-bap drums with vinyl crackle, gentle bass, finger snaps. Relaxed and encouraging — an elder calmly showing you the ways of the waste. 80 BPM, Eb major. Lo-fi hip-hop, chill tutorial beat.
**Mood:** Chill guidance, no rush, learn at your pace
**Tempo:** 80 BPM

**Lyrics:** (instrumental only)

---

### 6.3 — Peaceful 1: "Oasis"
**File:** `music/hiphop/peaceful1.mp3`
**Prompt:** Peaceful hip-hop ambient beat. Warm Rhodes piano chords, soft 808 bass, light finger snaps, oud melody floating over top, distant wind chimes. An oasis at sunset — palm trees, cool water, rest after long travel. Warm, grateful, still. 75 BPM, Ab major. Lo-fi hip-hop, desert oasis ambient.
**Mood:** Oasis rest, gratitude, cool water after long walk
**Tempo:** 75 BPM

**Lyrics:** (instrumental only)

---

### 6.4 — Peaceful 2: "Ember Stories"
**File:** `music/hiphop/peaceful2.mp3`
**Prompt:** Storytelling hip-hop ambient. Crackling campfire sounds layered into the beat, warm dusty piano chops, soft boom-bap, deep bass hum, occasional spoken word murmur. Nomads gathered around embers, sharing stories of the old world. 70 BPM, F minor. Lo-fi hip-hop, campfire storytelling beat.
**Mood:** Campfire stories, oral history, warm community
**Tempo:** 70 BPM

**Lyrics (whispered/murmured, barely audible):**
```
[Under the beat, like someone telling a story by firelight]
...and they say the ash fields go on forever...
...but we found green on the other side...
...that's how we learned... nothing's truly gone...
```

---

### 6.5 — Peaceful 3: "Dust to Gold"
**File:** `music/hiphop/peaceful3.mp3`
**Prompt:** Uplifting lo-fi hip-hop beat. Warm sampled brass melody, soft claps, deep pocket bass, optimistic piano chords with vinyl warmth. The feeling of finding something valuable in the waste — turning nothing into something. Hopeful, industrious. 85 BPM, Eb major. Uplifting lo-fi hip-hop, positive vibes.
**Mood:** Resourcefulness, making something from nothing, hope
**Tempo:** 85 BPM

**Lyrics:** (instrumental only)

---

### 6.6 — Exploration 1: "Nomad's Road"
**File:** `music/hiphop/exploration1.mp3`
**Prompt:** Driving hip-hop exploration beat. Walking-pace boom-bap with heavy kick, oud sample looping, dusty snare hits, bass following a forward path, desert wind layered in. Moving through ash wastes with purpose — every step is survival. 95 BPM, G minor. Hip-hop exploration beat, desert nomad travel.
**Mood:** Desert march, purposeful travel, every step counts
**Tempo:** 95 BPM

**Lyrics:** (instrumental only)

---

### 6.7 — Exploration 2: "Mirage"
**File:** `music/hiphop/exploration2.mp3`
**Prompt:** Hazy psychedelic hip-hop exploration. Detuned piano chops wobbling, heavy reverb on everything, distorted 808, oud melody pitched up and down, heat shimmer sound effects. Hallucinating in the desert — is that real or a mirage? Disorienting but compelling. 85 BPM, Bb minor. Psychedelic hip-hop, desert mirage music.
**Mood:** Heat haze, mirage, reality bending
**Tempo:** 85 BPM

**Lyrics:** (instrumental only)

---

### 6.8 — Exploration 3: "Trade Route"
**File:** `music/hiphop/exploration3.mp3`
**Prompt:** Confident hip-hop exploration beat. Clean boom-bap with swagger, brass stab accents, smooth bass line, finger snaps, upbeat oud riff. Following a known trade route between settlements — confidence, commerce, connection. 100 BPM, Eb major. Smooth hip-hop, confident travel beat.
**Mood:** Known path, trade swagger, connecting settlements
**Tempo:** 100 BPM

**Lyrics:** (instrumental only)

---

### 6.9 — Combat 1: "Sandstorm"
**File:** `music/hiphop/combat1.mp3`
**Prompt:** Aggressive trap-influenced combat beat. Rapid hi-hats, booming 808 bass drops, aggressive brass stabs, distorted oud riff, turntable scratches as transitions. Desert warriors emerging from a sandstorm — fast, brutal, disappearing back into dust. 140 BPM (half-time feel at 70), C minor. Aggressive trap, desert combat music.
**Mood:** Ambush from sandstorm, fast strikes, vanish into dust
**Tempo:** 140 BPM (half-time)

**Lyrics (aggressive rap):**
```
SANDSTORM! Can't see us coming!
808s RUMBLING — desert drums drumming!
ASH in your eyes, STEEL in our hands
You built walls? We ARE the sands!
ASHWALKERS! Rise from the ground!
Strike hard, strike fast — then we're NEVER FOUND!
```

---

### 6.10 — Combat 2: "No Quarter"
**File:** `music/hiphop/combat2.mp3`
**Prompt:** Intense dark hip-hop combat. Heavy distorted 808, aggressive boom-bap at double time, dark piano stabs, brass blasts, vocal chops used as percussion. Full commitment — no retreat, no surrender, this is for survival. 150 BPM, Ab minor. Dark aggressive hip-hop, survival combat.
**Mood:** All-in, survival fight, no retreat
**Tempo:** 150 BPM

**Lyrics (aggressive, urgent):**
```
NO QUARTER! NO MERCY! NO RUNNING!
We survived the ASH — you think we fear NOTHING?
Stand your ground — ASHWALKER CODE
Every fallen friend — a debt that's OWED
FIGHT! FIGHT! FIGHT!
Til the dust settles and we own the night!
```

---

### 6.11 — Combat 3: "Crown of Cinders"
**File:** `music/hiphop/combat3.mp3`
**Prompt:** Triumphant epic hip-hop victory beat. Massive 808 bass drop into victorious brass fanfare sampled over boom-bap, choir sample chopped into beat, uplifting piano melody breaking through the grit. From ashes to glory — the survivors claim what's theirs. 130 BPM, Eb major. Triumphant hip-hop, victory anthem.
**Mood:** Ash to glory, survivors victorious, crown earned
**Tempo:** 130 BPM

**Lyrics (triumphant rap):**
```
CROWN OF CINDERS on our heads!
We rose from what the old world shed!
Every battle — another page
ASHWALKERS writing a golden age!

They said we'd fall? Look at us NOW!
Desert throne — take a bow!
From dust to GLORY, ash to GOLD
This is the story that had to be told!
[Brass fanfare + 808 drop]
```

---
---

## 7. DREAMWEAVERS (Lo-Fi)

**Musical Identity:** Dreamy, ethereal lo-fi. Soft beats, warm analog textures, music-box melodies, ambient pads, rain/wind soundscapes. The Dreamweavers are illusionists who wield dream magic — their music floats between sleep and waking, gentle but disorienting.

**Instrument Palette:** Music box, Rhodes piano, warm tape-saturated drums, soft sub bass, vinyl crackle, ambient rain/wind, reversed reverb, celesta, vibraphone, breathy pads, gentle guitar

**Key:** Eb minor (combat), Gb major (peaceful)
**Feel:** Dreamy, floating, gentle disorientation, moonlit

---

### 7.1 — Title Theme
**File:** `music/lofi/Title.mp3`
**Prompt:** Dreamy lo-fi title theme. Music box melody playing a hauntingly beautiful tune over warm tape-saturated beat, soft Rhodes chords, vinyl crackle, ambient moonlight shimmer pads. Like falling asleep and waking up in a beautiful dream world. Gentle, hypnotic, enchanting. 80 BPM, Gb major. Lo-fi dream pop, fantasy title theme.
**Mood:** Entering a dream, moonlight, gentle enchantment
**Tempo:** 80 BPM

**Lyrics (soft, breathy, half-whispered):**
```
[Music box intro]
Close your eyes... let the dream begin
Moonlight threads... weaving from within
Dreamweavers calling... softly, softly
Every dream... a world worth holding

Can you see it? Just beyond the veil...
Every sleeping mind... tells a tale...
[Fades to music box solo]
```

---

### 7.2 — Tutorial Theme
**File:** `music/lofi/tutorial.mp3`
**Prompt:** Ultra-gentle lo-fi tutorial. Soft vibraphone melody, barely-there drum pattern, warm bass hum, rain sound effects, Rhodes piano chords with heavy tremolo. Like being guided through a lucid dream by a gentle voice. So calming it almost puts you to sleep. 70 BPM, Ab major. Lo-fi ambient, dream tutorial.
**Mood:** Lucid dream guidance, so gentle, floating learning
**Tempo:** 70 BPM

**Lyrics:** (instrumental only)

---

### 7.3 — Peaceful 1: "Moonpools"
**File:** `music/lofi/peaceful1.mp3`
**Prompt:** Ambient lo-fi peaceful music. Slow Rhodes piano arpeggios through tape saturation, distant music box, soft rain on leaves, sub bass warmth, reversed reverb swells. Pools of moonlight on a forest floor, each one showing a different dream. Deeply peaceful. 65 BPM, Gb major. Lo-fi ambient, moonlight forest.
**Mood:** Moonlit pools, deep peace, dream visions
**Tempo:** 65 BPM

**Lyrics:** (instrumental only)

---

### 7.4 — Peaceful 2: "Pillow Fort"
**File:** `music/lofi/peaceful2.mp3`
**Prompt:** Cozy lo-fi peaceful music. Warm muted guitar chords, soft brush drums, Rhodes melody, vinyl crackle extra heavy, cat purring sound subtly layered in. The coziest, safest feeling — blankets, warmth, total comfort. 75 BPM, Db major. Cozy lo-fi hip-hop, comfort music.
**Mood:** Maximum cozy, safe, warm blankets, gentle comfort
**Tempo:** 75 BPM

**Lyrics:** (instrumental only)

---

### 7.5 — Peaceful 3: "Paper Lanterns"
**File:** `music/lofi/peaceful3.mp3`
**Prompt:** Whimsical lo-fi ambient music. Celesta melody like tiny bells, soft hand drum, ambient pads that swell and recede like breathing, gentle wind chimes. Paper lanterns floating upward into a twilight sky, each carrying a wish. Beautiful, wistful. 70 BPM, Eb major. Lo-fi ambient, twilight whimsy.
**Mood:** Wishes floating skyward, twilight beauty, gentle wonder
**Tempo:** 70 BPM

**Lyrics:** (instrumental only)

---

### 7.6 — Exploration 1: "Sleepwalk"
**File:** `music/lofi/exploration1.mp3`
**Prompt:** Dreamy lo-fi exploration music. Walking-pace drum pattern with heavy tape wobble, Rhodes playing a curious wandering melody, bass following lazily, ambient textures shifting. Sleepwalking through a dream landscape — familiar yet strange, soft edges on everything. 90 BPM, Bb minor. Lo-fi dream exploration, sleepwalk music.
**Mood:** Sleepwalking, familiar-strange, soft dream edges
**Tempo:** 90 BPM

**Lyrics:** (instrumental only)

---

### 7.7 — Exploration 2: "The In-Between"
**File:** `music/lofi/exploration2.mp3`
**Prompt:** Surreal lo-fi exploration. Detuned music box playing backwards, soft glitchy drum hits, deep reverb on everything, bass notes that bend and wobble, whispered unintelligible words layered in. The space between dreams — reality is thin here. Disorienting but not scary. 80 BPM, Db minor. Experimental lo-fi, liminal space music.
**Mood:** Liminal space, between dreams, reality thinning
**Tempo:** 80 BPM

**Lyrics:** (instrumental only)

---

### 7.8 — Exploration 3: "Following Fireflies"
**File:** `music/lofi/exploration3.mp3`
**Prompt:** Playful lo-fi exploration music. Light staccato Rhodes notes like fireflies blinking, gentle walking-pace drums, warm bass, music box playing a hide-and-seek melody, soft giggles layered deep in the mix. Chasing points of light through a dream meadow. 95 BPM, Gb major. Playful lo-fi, firefly chase music.
**Mood:** Chasing lights, playful discovery, dream meadow
**Tempo:** 95 BPM

**Lyrics:** (instrumental only)

---

### 7.9 — Combat 1: "Nightmare Waltz"
**File:** `music/lofi/combat1.mp3`
**Prompt:** Dark dreamy combat music. Distorted music box melody in 3/4 waltz time over heavy lo-fi drums, deep bass drops, reversed cymbal crashes, eerie Rhodes chords. Combat in a nightmare — everything moves in slow-motion waltz, beautiful but deadly. 120 BPM (waltz feel), Eb minor. Dark lo-fi, nightmare combat waltz.
**Mood:** Nightmare combat, slow-motion waltz, beautiful dread
**Tempo:** 120 BPM (3/4)

**Lyrics (whispered, eerie):**
```
Dance... dance in the nightmare
One two three... one two three...
Every dream has teeth, darling
Close your eyes... and SEE
[Music box distorts into heavy bass]
```

---

### 7.10 — Combat 2: "Lucid Strike"
**File:** `music/lofi/combat2.mp3`
**Prompt:** Intense lucid dream combat music. Heavy tape-saturated drums at double speed, aggressive Rhodes stabs, distorted bass wobble, glitch effects intensifying, music box melody fighting through the distortion. Taking control of the nightmare — lucid dreaming as a weapon. 140 BPM, C minor. Aggressive lo-fi, lucid combat music.
**Mood:** Taking control, lucid power, reshaping the nightmare
**Tempo:** 140 BPM

**Lyrics (processed, commanding):**
```
This is MY dream — I CONTROL THIS
Wake up... WAKE UP... no — FIGHT!
Reshape the dark — weave it to LIGHT
Dreamweavers don't run from the NIGHT
[Glitch break into heavy drop]
```

---

### 7.11 — Combat 3: "Dawn Break"
**File:** `music/lofi/combat3.mp3`
**Prompt:** Triumphant dreamy victory music. Warm major-key Rhodes melody over satisfying lo-fi beat, music box playing triumphant motif, ambient sunrise sounds, bass resolving to warm root note, vinyl crackle fading out. Waking from the nightmare into golden dawn light. Relief, warmth, victory. 110 BPM, Gb major. Lo-fi victory, dawn breakthrough music.
**Mood:** Waking from nightmare, dawn light, warm relief
**Tempo:** 110 BPM

**Lyrics (soft, relieved):**
```
The dream holds... the dream breaks...
Dawn light through the darkness wakes
Dreamweavers — we shaped the night
And brought it gently... into light
[Music box plays peaceful resolution]
```

---
---

## 8. DUSTBORN (Oldies)

**Musical Identity:** Vintage Americana meets ancient desert empire. 50s/60s doo-wop and rock'n'roll filtered through sand and sun. Reverb-drenched vocals, twangy guitars, walking bass, organ, tambourine. The Dustborn are an ancient sun-worshipping civilization with a retro-timeless feel — like a jukebox in a pyramid.

**Instrument Palette:** Reverb-heavy vocals (doo-wop harmonies), twangy electric guitar, upright bass (walking), Hammond organ, tambourine, hand claps, saxophone, girl-group backing vocals, vintage drum kit, steel guitar

**Key:** A minor (combat), C major (peaceful)
**Feel:** Retro-timeless, sun-baked, nostalgic power

---

### 8.1 — Title Theme
**File:** `music/oldies/Title.mp3`
**Prompt:** Epic vintage rock'n'roll title theme with desert grandeur. Starts with reverb-drenched twangy guitar riff over distant sand wind, then a walking upright bass kicks in with a driving shuffle beat. Doo-wop vocal harmonies sing a majestic anthem. Hammond organ swells. Feels like an ancient empire's glory filtered through a 1960s jukebox. 130 BPM, C major. Vintage rock'n'roll, desert empire anthem, video game title.
**Mood:** Ancient glory, retro majesty, sun-crowned empire
**Tempo:** 130 BPM (shuffle)

**Lyrics (doo-wop harmonies):**
```
[Twangy guitar intro]
Bah-bah-bah BAH! (Dustborn!)
Bah-bah-bah BAH! (Dustborn!)

We've been here since the first sunrise
Built our temples where the eagle flies
DUSTBORN! Standing in the sun!
Our empire's story's never done!

Sha-la-la-la! (Oh-oh!)
The sands remember every one!
Sha-la-la-la! (Oh-oh!)
Children of the ancient sun!
```

---

### 8.2 — Tutorial Theme
**File:** `music/oldies/tutorial.mp3`
**Prompt:** Gentle 50s instructional music. Cheerful ukulele and soft acoustic guitar, light brush drums, warm organ chords, friendly whistling melody. Like a vintage educational film strip about building your first settlement. Charming, retro, clear. 100 BPM, F major. Vintage tutorial music, 1950s educational.
**Mood:** Retro educational, cheerful instruction, vintage charm
**Tempo:** 100 BPM

**Lyrics (whistled melody, with occasional spoken-word):**
```
[Whistling the main theme cheerfully]
[Friendly narrator voice] "And here's where the magic happens, folks..."
[More whistling]
```

---

### 8.3 — Peaceful 1: "Golden Hour"
**File:** `music/oldies/peaceful1.mp3`
**Prompt:** Warm vintage sunset music. Gentle steel guitar melody, soft brush drums, walking upright bass, warm organ pads, distant saxophone. Desert sunset casting everything in gold. Deeply nostalgic, like remembering the best day of your life. 80 BPM, G major. Vintage ambient, golden hour music.
**Mood:** Desert sunset, deep nostalgia, golden warmth
**Tempo:** 80 BPM

**Lyrics:** (instrumental only)

---

### 8.4 — Peaceful 2: "The Old Temple"
**File:** `music/oldies/peaceful2.mp3`
**Prompt:** Reverent vintage spiritual music. Hammond organ playing a slow hymn-like melody, soft backing "ooh" vocals, gentle tambourine, upright bass. Inside an ancient sun temple — shafts of light through stone, dust motes floating. Sacred, warm, timeless. 70 BPM, Eb major. Vintage spiritual, temple ambient music.
**Mood:** Sacred space, sun temple, reverent warmth
**Tempo:** 70 BPM

**Lyrics (soft "ooh" backing vocals):**
```
Ooh... ooh... ooh...
[Organ hymn continues]
Ooh... ooh... ooh...
```

---

### 8.5 — Peaceful 3: "Porch Swing"
**File:** `music/oldies/peaceful3.mp3`
**Prompt:** Cozy vintage domestic music. Soft acoustic guitar strumming, gentle hand claps, bass walking at lazy pace, warm female vocal humming, wind chimes. Sitting on a porch watching the desert evening, iced tea, easy conversation. Pure comfort. 85 BPM, C major. Vintage Americana, porch music.
**Mood:** Porch evening, easy comfort, simple pleasures
**Tempo:** 85 BPM

**Lyrics (hummed by warm female voice):**
```
[Humming the peaceful melody]
Mmm-mmm-mm-mmm...
[Occasionally] La da da...
[Back to humming]
```

---

### 8.6 — Exploration 1: "Desert Highway"
**File:** `music/oldies/exploration1.mp3`
**Prompt:** Cruising vintage rock'n'roll exploration. Twangy guitar riff over driving shuffle beat, walking bass with purpose, tambourine shaking, saxophone honking accents. Driving down an endless desert highway in a convertible — wind in your hair, adventure ahead. 120 BPM, A major. 50s rock'n'roll, desert road trip.
**Mood:** Road trip, desert highway, wind and freedom
**Tempo:** 120 BPM

**Lyrics:** (instrumental only)

---

### 8.7 — Exploration 2: "Buried Treasure"
**File:** `music/oldies/exploration2.mp3`
**Prompt:** Mysterious vintage exploration music. Muted twangy guitar, soft organ mystery chords, tiptoeing upright bass, light cymbal taps, occasional saxophone wail. Sneaking through ancient ruins looking for buried treasure — exciting, secretive. 95 BPM, D minor. Vintage mystery music, treasure hunt.
**Mood:** Treasure hunting, ancient ruins, exciting secrecy
**Tempo:** 95 BPM

**Lyrics:** (instrumental only)

---

### 8.8 — Exploration 3: "Caravan"
**File:** `music/oldies/exploration3.mp3`
**Prompt:** Upbeat vintage caravan travel music. Driving rhythm guitar, walking bass at travel pace, organ pumping, hand claps on 2 and 4, saxophone playing a jaunty melody. A caravan of traders crossing the desert — colorful, lively, communal. 110 BPM, G major. Vintage Americana, caravan travel music.
**Mood:** Caravan travel, colorful traders, desert crossing
**Tempo:** 110 BPM

**Lyrics:** (instrumental only)

---

### 8.9 — Combat 1: "Rumble!"
**File:** `music/oldies/combat1.mp3`
**Prompt:** Aggressive vintage rock'n'roll combat. Heavy distorted twangy guitar riff, pounding drums with crash cymbals, aggressive walking bass, screaming saxophone, gang vocals shouting. A 1950s gang rumble in the desert — switchblades and leather jackets. Raw, energetic, dangerous. 150 BPM, E minor. 50s rock'n'roll combat, rumble music.
**Mood:** Gang rumble, raw energy, dangerous confrontation
**Tempo:** 150 BPM

**Lyrics (gang vocal shouts):**
```
RUMBLE! RUMBLE! Here they come!
Desert sons under the blazing sun!
DUSTBORN don't back down — NO!
Hit 'em hard! Let 'em KNOW!
Bah-bah-BAH! [punch sound]
Who's the king? WE'RE the king!
```

---

### 8.10 — Combat 2: "Sun Fury"
**File:** `music/oldies/combat2.mp3`
**Prompt:** Intense vintage rock combat escalation. Maximum distortion guitar, double-time drums, screaming organ, saxophone wailing like a siren, doo-wop choir singing urgent battle harmonies. The sun itself seems angry — heat waves distorting the battlefield. Relentless. 155 BPM, A minor. Intense vintage rock, sun battle fury.
**Mood:** Solar fury, relentless assault, the sun fights with us
**Tempo:** 155 BPM

**Lyrics (doo-wop choir, urgent):**
```
OH-OH-OH! The sun burns DOWN!
(Burn it down! Burn it down!)
DUSTBORN fury! Shake the GROUND!
(Shake it! Shake it!)
No one stands when the sun says FALL!
DUSTBORN greatest of them ALL!
```

---

### 8.11 — Combat 3: "Victory Lap"
**File:** `music/oldies/combat3.mp3`
**Prompt:** Triumphant vintage rock'n'roll victory. Celebratory guitar riff, swinging drums, happy walking bass, honking saxophone, full doo-wop choir in joyous harmony. Taking a victory lap around the battlefield — confetti energy, pure joy. 140 BPM, C major. Celebratory 50s rock, victory parade.
**Mood:** Victory parade, pure celebration, triumphant joy
**Tempo:** 140 BPM

**Lyrics (doo-wop celebration):**
```
WE WON! WE WON! (Sha-la-la-la!)
Victory under the desert sun! (Sha-la-la-la!)
DUSTBORN! Take a bow!
Nobody can stop us now!
Bah-bah-bah BAH! (One more time!)
Bah-bah-bah BAH! (Feeling fine!)
The DUSTBORN — REIGN — SUPREME!
```

---
---

## 9. VOIDTOUCHED (Alternative)

**Musical Identity:** Dark, angular alternative rock with ethereal and industrial undertones. Think Radiohead meets Portal soundtrack. Dissonant guitar textures, irregular rhythms, haunting falsetto vocals, synth washes, controlled chaos. The Voidtouched wield entropy and dimensional rifts — their music bends, breaks, and reforms.

**Instrument Palette:** Clean/overdriven electric guitar (angular riffs), bass guitar (melodic, distorted), programmed + live drums (odd time signatures), synth pads (dark, evolving), falsetto vocals, reverse effects, delay/reverb washes, glitch textures, piano (sparse, dissonant), cello (processed)

**Key:** F# minor (combat), A major/F# minor alternating (peaceful)
**Feel:** Angular, haunting, beautiful entropy, controlled chaos

---

### 9.1 — Title Theme
**File:** `music/alternative/Title.mp3`
**Prompt:** Dark ethereal alternative rock title theme. Opens with a single clean guitar note ringing into massive reverb, then angular guitar riff enters in 7/8 time, bass guitar locks in with drums, synth pad swells from beneath. Haunting falsetto vocal enters with an otherworldly melody. Beautiful but unsettling — like staring into a crack in reality. 125 BPM (7/8 feel), F# minor. Alternative rock, dark ethereal, video game title.
**Mood:** Reality fracture, beautiful entropy, the void gazes back
**Tempo:** 125 BPM (7/8)

**Lyrics (haunting falsetto):**
```
[Clean guitar ring → angular riff]
Touch the void... and it touches you back
Every crack in the world... is a door
We are the entropy... the beautiful wrack
The Voidtouched... forevermore

Reality bends... when we call its name
Nothing is broken... that can't be reframed
[Guitar swells into feedback → resolve]
```

---

### 9.2 — Tutorial Theme
**File:** `music/alternative/tutorial.mp3`
**Prompt:** Gentle alternative tutorial music. Clean arpeggiated guitar, soft synth pad, gentle brushed drums, sparse piano notes. Slightly off-kilter rhythm but warm and welcoming. Like a kind but strange teacher explaining physics that don't quite work normally. 90 BPM, A major. Gentle alternative rock, tutorial music.
**Mood:** Friendly strange, gentle learning, off-kilter warmth
**Tempo:** 90 BPM

**Lyrics:** (instrumental only)

---

### 9.3 — Peaceful 1: "Still Point"
**File:** `music/alternative/peaceful1.mp3`
**Prompt:** Ambient alternative peaceful music. Slow clean guitar harmonics, evolving synth pad drone, processed cello playing a lonely melody, reverse reverb swells. A moment of absolute stillness at the center of chaos — the eye of the entropy storm. Hauntingly beautiful. 60 BPM, A major. Ambient alternative, still point meditation.
**Mood:** Absolute stillness, eye of chaos, haunting beauty
**Tempo:** 60 BPM

**Lyrics:** (instrumental only)

---

### 9.4 — Peaceful 2: "Parallel"
**File:** `music/alternative/peaceful2.mp3`
**Prompt:** Dreamy alternative ambient music. Two guitar parts playing the same melody slightly offset in time (canon), gentle synth wash, soft programmed beats, bass guitar playing long sustained notes. The feeling of two parallel dimensions overlapping peacefully. Beautiful, disorienting, serene. 75 BPM, D major. Ambient alternative, parallel worlds music.
**Mood:** Parallel dimensions, gentle overlap, serene duality
**Tempo:** 75 BPM

**Lyrics:** (instrumental only)

---

### 9.5 — Peaceful 3: "Entropy Garden"
**File:** `music/alternative/peaceful3.mp3`
**Prompt:** Strange beautiful alternative ambient. Piano playing a melody that slowly deconstructs and reconstructs, soft glitch textures, evolving pad, gentle bass pulse. A garden where flowers bloom and decay in seconds, beautiful in both directions. Time flowing strangely. 70 BPM, F# minor. Experimental ambient, time-distortion garden.
**Mood:** Beautiful decay, time flowing strangely, entropy as art
**Tempo:** 70 BPM

**Lyrics:** (instrumental only)

---

### 9.6 — Exploration 1: "Rift Walking"
**File:** `music/alternative/exploration1.mp3`
**Prompt:** Driving angular alternative exploration music. Guitar riff in 5/4 time, tight drums following, melodic bass line, synth stabs. Walking between dimensional rifts — each step might land in a different version of reality. Propulsive, curious, slightly dangerous. 110 BPM (5/4), F# minor. Alternative rock exploration, rift-walking music.
**Mood:** Dimensional rifts, each step uncertain, propulsive curiosity
**Tempo:** 110 BPM (5/4)

**Lyrics:** (instrumental only)

---

### 9.7 — Exploration 2: "Echo Chamber"
**File:** `music/alternative/exploration2.mp3`
**Prompt:** Eerie alternative exploration music. Heavily delayed guitar creating cascading echoes, bass playing a descending pattern, drums sparse and reverberant, whispered vocal samples echoing and layering. A space where sound doesn't behave — every noise returns changed. 90 BPM, Bb minor. Dark alternative ambient, echo exploration.
**Mood:** Sound distortion, echoes returning changed, eerie wonder
**Tempo:** 90 BPM

**Lyrics:** (instrumental only)

---

### 9.8 — Exploration 3: "Fault Line"
**File:** `music/alternative/exploration3.mp3`
**Prompt:** Tense alternative exploration. Angular guitar playing a tense riff that keeps almost resolving but doesn't, programmed drums building intensity, synth rising in pitch, bass rumbling. Standing on a dimensional fault line — reality is cracking underfoot. Exciting, dangerous. 105 BPM, E minor. Tense alternative rock, fault line exploration.
**Mood:** Reality cracking, standing on the edge, tense excitement
**Tempo:** 105 BPM

**Lyrics:** (instrumental only)

---

### 9.9 — Combat 1: "Shatter Point"
**File:** `music/alternative/combat1.mp3`
**Prompt:** Aggressive angular alternative combat. Dissonant guitar power chords in staggered rhythm, heavy bass distortion, complex drum pattern shifting between 4/4 and 7/8, synth screams. Reality shattering into combat — each attack tears a small hole in the world. Chaotic but precise. 145 BPM, F# minor. Aggressive alternative rock, reality-breaking combat.
**Mood:** Reality shattering, precise chaos, dimensional combat
**Tempo:** 145 BPM

**Lyrics (falsetto, aggressive):**
```
SHATTER! Every wall between worlds!
FRACTURE! Every rule that holds!
We are the VOID — we break what's REAL
And from the cracks — NEW WORLDS CONGEAL!
[Guitar breaks into angular solo]
```

---

### 9.10 — Combat 2: "Event Horizon"
**File:** `music/alternative/combat2.mp3`
**Prompt:** Maximum intensity alternative combat. Wall of distorted guitar feedback becoming musical, blast-beat drums, bass guitar playing a frantic chromatic run, all instruments being pulled toward a center point — an event horizon of sound. Past the point of no return. 155 BPM, C minor. Extreme alternative rock, event horizon combat.
**Mood:** Past the point of no return, gravitational pull, total commitment
**Tempo:** 155 BPM

**Lyrics (screamed/falsetto alternating):**
```
[Scream] NO RETURN! NO RETURN!
[Falsetto] The void consumes all that we've earned
[Scream] PULL US IN! TEAR US THROUGH!
[Falsetto] On the other side... something new
[All instruments collapse to silence → massive re-entry]
```

---

### 9.11 — Combat 3: "Reformation"
**File:** `music/alternative/combat3.mp3`
**Prompt:** Triumphant alternative resolution. From chaos to order — dissonant elements gradually resolving into a beautiful major-key guitar melody, drums settling into a powerful straight beat, bass finding root, synth blooming into warm pad. Victory through entropy — what was destroyed reforms into something better. 130 BPM, A major. Alternative rock triumph, reformation victory.
**Mood:** Chaos resolving to beauty, reformation, entropy as creation
**Tempo:** 130 BPM

**Lyrics (falsetto, ascending to triumphant):**
```
From the fragments... reformation
Every ending... a creation
The Voidtouched reshape what's been broken
Every silence... is a word unspoken

[Building to full voice]
We are the CHANGE! We are the DOOR!
What was before... is now so much MORE!
[Resolve to beautiful guitar outro]
```

---
---

## Quick Reference: All 99 Tracks

| # | Tribe | Track | File | BPM | Key |
|---|-------|-------|------|-----|-----|
| 1 | Ironveil | Title Theme | fantasy/Title.mp3 | 120 | Dm→D |
| 2 | Ironveil | Tutorial | fantasy/tutorial.mp3 | 90 | F |
| 3 | Ironveil | The Hearth | fantasy/peaceful1.mp3 | 80 | F |
| 4 | Ironveil | Stone and Stream | fantasy/peaceful2.mp3 | 75 | C |
| 5 | Ironveil | Anvil's Rest | fantasy/peaceful3.mp3 | 85 | Bb |
| 6 | Ironveil | Beyond the Gate | fantasy/exploration1.mp3 | 100 | G |
| 7 | Ironveil | Old Roads | fantasy/exploration2.mp3 | 95 | Am |
| 8 | Ironveil | Watchtower | fantasy/exploration3.mp3 | 105 | Em |
| 9 | Ironveil | Shield Wall | fantasy/combat1.mp3 | 140 | Dm |
| 10 | Ironveil | The Breaking Point | fantasy/combat2.mp3 | 150 | Cm |
| 11 | Ironveil | Victory March | fantasy/combat3.mp3 | 135 | D |
| 12 | Wildborne | Title Theme | metal/Title.mp3 | 130 | Em |
| 13 | Wildborne | Tutorial | metal/tutorial.mp3 | 85 | Am |
| 14 | Wildborne | Deep Roots | metal/peaceful1.mp3 | 70 | Am |
| 15 | Wildborne | Wolf Mother | metal/peaceful2.mp3 | 75 | Dm |
| 16 | Wildborne | Bone and Bark | metal/peaceful3.mp3 | 65 | Em |
| 17 | Wildborne | The Trackless Wild | metal/exploration1.mp3 | 115 | Gm |
| 18 | Wildborne | Blood Scent | metal/exploration2.mp3 | 95 | Bm |
| 19 | Wildborne | High Ridge | metal/exploration3.mp3 | 100 | D |
| 20 | Wildborne | Berserker Rage | metal/combat1.mp3 | 160 | Em |
| 21 | Wildborne | Pack Tactics | metal/combat2.mp3 | 145 | Am |
| 22 | Wildborne | The Red Feast | metal/combat3.mp3 | 155 | Em→E |
| 23 | Arcanists | Title Theme | orchestral/Title.mp3 | 115 | Bbm→Eb |
| 24 | Arcanists | Tutorial | orchestral/tutorial.mp3 | 95 | Eb |
| 25 | Arcanists | The Library Eternal | orchestral/peaceful1.mp3 | 70 | Eb |
| 26 | Arcanists | Crystal Garden | orchestral/peaceful2.mp3 | 75 | Ab |
| 27 | Arcanists | Starfall | orchestral/peaceful3.mp3 | 65 | Fm |
| 28 | Arcanists | Arcane Cartography | orchestral/exploration1.mp3 | 105 | Gm |
| 29 | Arcanists | Ley Lines | orchestral/exploration2.mp3 | 90 | Dm |
| 30 | Arcanists | The Unknown Variable | orchestral/exploration3.mp3 | 100 | C#m |
| 31 | Arcanists | Spellstorm | orchestral/combat1.mp3 | 140 | Bbm |
| 32 | Arcanists | Mana Surge | orchestral/combat2.mp3 | 150 | F#m |
| 33 | Arcanists | Theorem of Victory | orchestral/combat3.mp3 | 130 | Eb |
| 34 | Tidecallers | Title Theme | celtic/Title.mp3 | 130 | G mix |
| 35 | Tidecallers | Tutorial | celtic/tutorial.mp3 | 90 | D |
| 36 | Tidecallers | Safe Harbor | celtic/peaceful1.mp3 | 80 | D |
| 37 | Tidecallers | The Coral Throne | celtic/peaceful2.mp3 | 70 | Em |
| 38 | Tidecallers | Mending Nets | celtic/peaceful3.mp3 | 95 | G |
| 39 | Tidecallers | Charting New Waters | celtic/exploration1.mp3 | 110 | A mix |
| 40 | Tidecallers | Fog Bank | celtic/exploration2.mp3 | 85 | Bm |
| 41 | Tidecallers | Coastline | celtic/exploration3.mp3 | 105 | D |
| 42 | Tidecallers | Broadside! | celtic/combat1.mp3 | 150 | Gm |
| 43 | Tidecallers | Maelstrom | celtic/combat2.mp3 | 155 | Dm |
| 44 | Tidecallers | Plunder Tide | celtic/combat3.mp3 | 145 | G |
| 45 | Synthforged | Title Theme | electronic/Title.mp3 | 128 | Fm |
| 46 | Synthforged | Tutorial | electronic/tutorial.mp3 | 100 | Ab |
| 47 | Synthforged | The Idle Forge | electronic/peaceful1.mp3 | 85 | Ab |
| 48 | Synthforged | Circuit Garden | electronic/peaceful2.mp3 | 80 | Db |
| 49 | Synthforged | Charge Cycle | electronic/peaceful3.mp3 | 70 | Fm |
| 50 | Synthforged | Signal Trace | electronic/exploration1.mp3 | 120 | Gm |
| 51 | Synthforged | Rust and Wire | electronic/exploration2.mp3 | 95 | Bbm |
| 52 | Synthforged | Grid Walk | electronic/exploration3.mp3 | 110 | Ab |
| 53 | Synthforged | Overclock | electronic/combat1.mp3 | 140 | Fm |
| 54 | Synthforged | Voltage Spike | electronic/combat2.mp3 | 150 | Em |
| 55 | Synthforged | Forge Victory | electronic/combat3.mp3 | 135 | Ab |
| 56 | Ashwalkers | Title Theme | hiphop/Title.mp3 | 90 | Cm |
| 57 | Ashwalkers | Tutorial | hiphop/tutorial.mp3 | 80 | Eb |
| 58 | Ashwalkers | Oasis | hiphop/peaceful1.mp3 | 75 | Ab |
| 59 | Ashwalkers | Ember Stories | hiphop/peaceful2.mp3 | 70 | Fm |
| 60 | Ashwalkers | Dust to Gold | hiphop/peaceful3.mp3 | 85 | Eb |
| 61 | Ashwalkers | Nomad's Road | hiphop/exploration1.mp3 | 95 | Gm |
| 62 | Ashwalkers | Mirage | hiphop/exploration2.mp3 | 85 | Bbm |
| 63 | Ashwalkers | Trade Route | hiphop/exploration3.mp3 | 100 | Eb |
| 64 | Ashwalkers | Sandstorm | hiphop/combat1.mp3 | 140 | Cm |
| 65 | Ashwalkers | No Quarter | hiphop/combat2.mp3 | 150 | Abm |
| 66 | Ashwalkers | Crown of Cinders | hiphop/combat3.mp3 | 130 | Eb |
| 67 | Dreamweavers | Title Theme | lofi/Title.mp3 | 80 | Gb |
| 68 | Dreamweavers | Tutorial | lofi/tutorial.mp3 | 70 | Ab |
| 69 | Dreamweavers | Moonpools | lofi/peaceful1.mp3 | 65 | Gb |
| 70 | Dreamweavers | Pillow Fort | lofi/peaceful2.mp3 | 75 | Db |
| 71 | Dreamweavers | Paper Lanterns | lofi/peaceful3.mp3 | 70 | Eb |
| 72 | Dreamweavers | Sleepwalk | lofi/exploration1.mp3 | 90 | Bbm |
| 73 | Dreamweavers | The In-Between | lofi/exploration2.mp3 | 80 | Dbm |
| 74 | Dreamweavers | Following Fireflies | lofi/exploration3.mp3 | 95 | Gb |
| 75 | Dreamweavers | Nightmare Waltz | lofi/combat1.mp3 | 120 | Ebm |
| 76 | Dreamweavers | Lucid Strike | lofi/combat2.mp3 | 140 | Cm |
| 77 | Dreamweavers | Dawn Break | lofi/combat3.mp3 | 110 | Gb |
| 78 | Dustborn | Title Theme | oldies/Title.mp3 | 130 | C |
| 79 | Dustborn | Tutorial | oldies/tutorial.mp3 | 100 | F |
| 80 | Dustborn | Golden Hour | oldies/peaceful1.mp3 | 80 | G |
| 81 | Dustborn | The Old Temple | oldies/peaceful2.mp3 | 70 | Eb |
| 82 | Dustborn | Porch Swing | oldies/peaceful3.mp3 | 85 | C |
| 83 | Dustborn | Desert Highway | oldies/exploration1.mp3 | 120 | A |
| 84 | Dustborn | Buried Treasure | oldies/exploration2.mp3 | 95 | Dm |
| 85 | Dustborn | Caravan | oldies/exploration3.mp3 | 110 | G |
| 86 | Dustborn | Rumble! | oldies/combat1.mp3 | 150 | Em |
| 87 | Dustborn | Sun Fury | oldies/combat2.mp3 | 155 | Am |
| 88 | Dustborn | Victory Lap | oldies/combat3.mp3 | 140 | C |
| 89 | Voidtouched | Title Theme | alternative/Title.mp3 | 125 | F#m |
| 90 | Voidtouched | Tutorial | alternative/tutorial.mp3 | 90 | A |
| 91 | Voidtouched | Still Point | alternative/peaceful1.mp3 | 60 | A |
| 92 | Voidtouched | Parallel | alternative/peaceful2.mp3 | 75 | D |
| 93 | Voidtouched | Entropy Garden | alternative/peaceful3.mp3 | 70 | F#m |
| 94 | Voidtouched | Rift Walking | alternative/exploration1.mp3 | 110 | F#m |
| 95 | Voidtouched | Echo Chamber | alternative/exploration2.mp3 | 90 | Bbm |
| 96 | Voidtouched | Fault Line | alternative/exploration3.mp3 | 105 | Em |
| 97 | Voidtouched | Shatter Point | alternative/combat1.mp3 | 145 | F#m |
| 98 | Voidtouched | Event Horizon | alternative/combat2.mp3 | 155 | Cm |
| 99 | Voidtouched | Reformation | alternative/combat3.mp3 | 130 | A |
