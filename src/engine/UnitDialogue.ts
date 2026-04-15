// ============================================
// CUBITOPIA — Unit Dialogue Bank
// Short, funny voice lines per unit type and context.
// Used by SpeechBubbleSystem for cartoon speech bubbles + TTS barks.
// ============================================

import { UnitType } from '../types';

/** Contexts in which a unit can speak */
export type DialogueContext =
  | 'command'       // Player issues a move/rally order
  | 'attack'        // Ordered to attack or engaging combat
  | 'attacked'      // Taking damage
  | 'kill'          // Killed an enemy
  | 'death'         // Unit dies
  | 'idle'          // Idle too long without orders
  | 'level_up'      // Gained a level
  | 'select';       // Player clicks/selects the unit

/** Personality archetype that determines voice pitch and speaking style */
export interface UnitPersonality {
  pitchRate: number;   // speechSynthesis rate (0.5 = slow/deep, 2.0 = fast/squeaky)
  pitchShift: number;  // speechSynthesis pitch (0.1 = very deep, 2.0 = very high)
  volume: number;      // 0.0–1.0
}

// ── Personality profiles ──────────────────────────────────
const PERSONALITY: Record<string, UnitPersonality> = {
  gruff:       { pitchRate: 1.1, pitchShift: 0.6, volume: 0.35 },   // Warriors, Shieldbearers
  cocky:       { pitchRate: 1.3, pitchShift: 0.9, volume: 0.3 },    // Berserkers, Greatswords
  sarcastic:   { pitchRate: 1.4, pitchShift: 1.1, volume: 0.25 },   // Archers, Scouts, Assassins
  pretentious: { pitchRate: 1.0, pitchShift: 1.0, volume: 0.3 },    // Mages, Battlemages
  gentle:      { pitchRate: 1.1, pitchShift: 1.3, volume: 0.25 },   // Healers
  cheerful:    { pitchRate: 1.3, pitchShift: 1.2, volume: 0.3 },    // Builders, Lumberjacks, Villagers
  noble:       { pitchRate: 0.9, pitchShift: 0.8, volume: 0.35 },   // Paladins, Champions
  mounted:     { pitchRate: 1.2, pitchShift: 0.9, volume: 0.3 },    // Riders
  deep:        { pitchRate: 0.7, pitchShift: 0.3, volume: 0.4 },    // Ogres, Trebuchets (crew)
};

export function getPersonality(unitType: UnitType): UnitPersonality {
  switch (unitType) {
    case UnitType.WARRIOR:     return PERSONALITY.gruff;
    case UnitType.SHIELDBEARER: return PERSONALITY.gruff;
    case UnitType.BERSERKER:   return PERSONALITY.cocky;
    case UnitType.GREATSWORD:  return PERSONALITY.cocky;
    case UnitType.ARCHER:      return PERSONALITY.sarcastic;
    case UnitType.SCOUT:       return PERSONALITY.sarcastic;
    case UnitType.ASSASSIN:    return PERSONALITY.sarcastic;
    case UnitType.MAGE:        return PERSONALITY.pretentious;
    case UnitType.BATTLEMAGE:  return PERSONALITY.pretentious;
    case UnitType.HEALER:      return PERSONALITY.gentle;
    case UnitType.BUILDER:     return PERSONALITY.cheerful;
    case UnitType.LUMBERJACK:  return PERSONALITY.cheerful;
    case UnitType.VILLAGER:    return PERSONALITY.cheerful;
    case UnitType.PALADIN:     return PERSONALITY.noble;
    case UnitType.CHAMPION:    return PERSONALITY.noble;
    case UnitType.RIDER:       return PERSONALITY.mounted;
    case UnitType.OGRE:        return PERSONALITY.deep;
    case UnitType.TREBUCHET:   return PERSONALITY.deep;
    default:                   return PERSONALITY.gruff;
  }
}

// ── Dialogue lines ────────────────────────────────────────
// Each unit type has lines keyed by context.
// Generic fallbacks used when a type doesn't have specific lines.

const GENERIC_LINES: Record<DialogueContext, string[]> = {
  command:  ['On it!', 'Moving out.', 'Copy that.', 'Right away.', 'Yes sir!'],
  attack:   ['Charge!', 'For glory!', 'Get \'em!', 'Attack!'],
  attacked: ['Ow!', 'Hey!', 'We\'re hit!', 'Ouch!'],
  kill:     ['Got one!', 'Down!', 'Next!', 'One less.'],
  death:    ['Ugh...', 'I\'m done...', 'Avenge me...', 'No...'],
  idle:     ['...hello?', 'Waiting...', 'Orders?', 'Anyone there?'],
  level_up: ['I feel stronger!', 'Level up!', 'Upgraded!', 'Nice!'],
  select:   ['Ready.', 'Reporting.', 'Here.', 'What\'s up?'],
};

type DialogueBank = Partial<Record<DialogueContext, string[]>>;

const UNIT_LINES: Partial<Record<UnitType, DialogueBank>> = {
  [UnitType.WARRIOR]: {
    command:  ['Aye aye!', 'On my way.', 'Fine, I\'ll go.', 'Do I HAVE to?', 'March!'],
    attack:   ['Get \'em!', 'Steel meets flesh!', 'CHAAARGE!', 'For the homeland!'],
    attacked: ['Ow!', 'That tickled.', 'Is that all?', 'My armor!'],
    kill:     ['Too easy.', 'Who\'s next?', 'Rest in pieces.', 'Should\'ve worn armor.'],
    death:    ['Tell my family... I was brave.', 'Good... fight...', 'I regret nothing!'],
    idle:     ['I\'m bored.', '*yawns*', 'Can I sit down?', 'This is AFK, right?'],
    level_up: ['Gains!', 'Stronger than ever!', 'Fear me!'],
    select:   ['Warrior here.', 'Ready to fight.', 'Point me at \'em.', 'Sword\'s sharp.'],
  },
  [UnitType.ARCHER]: {
    command:  ['Sure, whatever.', 'Ugh, walking.', 'Fine.', 'On my way... reluctantly.'],
    attack:   ['Eat arrow!', 'Nothing personal.', 'Bullseye incoming.', 'Pew pew!'],
    attacked: ['Hey, rude!', 'That\'s gonna leave a mark.', 'I\'m RANGED, get away!', 'Personal space!'],
    kill:     ['Didn\'t even need to aim.', 'Called it.', 'Too slow.', 'Headshot. Probably.'],
    death:    ['Should\'ve... stayed back...', 'I knew I should\'ve been a mage...'],
    idle:     ['*twangs bowstring*', 'I could shoot a fly from here.', 'Sooo boring.', 'Hello??'],
    level_up: ['Sharper eyes!', 'Even more accurate? Scary.'],
    select:   ['What?', 'I see you.', 'Archer, yes, hi.', 'Need something shot?'],
  },
  [UnitType.MAGE]: {
    command:  ['If I must.', 'Relocating.', 'The arcane cannot be rushed.', 'Hmm, very well.'],
    attack:   ['Behold!', 'By the ancient texts!', 'TASTE MAGIC!', 'You\'re outmatched intellectually.'],
    attacked: ['How DARE you!', 'My robes!', 'That was uncouth.', 'Violence? Really?'],
    kill:     ['As calculated.', 'Elementary.', 'Peer reviewed and published.', 'QED.'],
    death:    ['My research... unfinished...', 'Impossible... I checked the math...'],
    idle:     ['*reads spellbook*', 'Fascinating... the mana here is...', 'I should be in the library.'],
    level_up: ['Knowledge IS power.', 'A new theorem!', 'My intellect grows!'],
    select:   ['Speak.', 'You have my attention.', 'Make it quick.', 'Yes, I\'m brilliant, what of it?'],
  },
  [UnitType.HEALER]: {
    command:  ['Coming!', 'On my way~', 'I\'ll be right there.', 'Stay alive till I get there!'],
    attack:   ['I\'m a HEALER!', 'This goes against my oath...', 'Healing you... to DEATH.', 'Don\'t make me!'],
    attacked: ['Heal MYSELF? How novel.', 'Stop hitting the medic!', 'SO rude!', 'Do you WANT heals or not?'],
    kill:     ['That was... therapeutic.', 'Consider yourself cured.', 'Oops.', 'Permanently healed.'],
    death:    ['Who heals... the healer...', 'I needed a healer...'],
    idle:     ['Everyone\'s healthy? Suspicious.', 'I KNOW someone\'s hurt.', '*checks bandages*'],
    level_up: ['My healing grows!', 'Stronger medicine!', 'PhD in healing!'],
    select:   ['Need a heal?', 'Someone hurt?', 'I\'m here~', 'Say ahhh.'],
  },
  [UnitType.ASSASSIN]: {
    command:  ['Vanishing.', 'Silent but deadly.', 'You won\'t see me move.', '*already gone*'],
    attack:   ['Nothing personal.', 'Surprise!', 'Behind you.', 'Shh shh shh...'],
    attacked: ['You can SEE me?!', 'Impossible!', 'My stealth!', 'Lucky shot.'],
    kill:     ['Clean.', 'They never knew.', 'Like a shadow.', 'Contract fulfilled.'],
    death:    ['Didn\'t see... that coming...', 'Out-stealthed...'],
    idle:     ['*lurks*', 'I could kill that fly.', 'Patience... is a weapon.', '...'],
    level_up: ['Even sneakier.', 'More stabby!', 'Ghost mode.'],
    select:   ['I was always here.', 'Boo.', 'You called?', '*appears from nowhere*'],
  },
  [UnitType.PALADIN]: {
    command:  ['By honor!', 'Onward, for justice!', 'A noble path.', 'With conviction!'],
    attack:   ['In the name of light!', 'Justice strikes!', 'Righteous fury!', 'SMITE!'],
    attacked: ['My faith is my shield!', 'You test my resolve!', 'Unshaken!', 'Is that all?'],
    kill:     ['Justice served.', 'Go in peace.', 'A necessary sacrifice.', 'Forgiven.'],
    death:    ['My duty... is done...', 'The light... endures...', 'Carry on... brothers...'],
    idle:     ['The light protects.', '*polishes armor*', 'Evil never rests. Neither should we.'],
    level_up: ['The light grows!', 'Holier than before!', 'Ascended!'],
    select:   ['Champion of light.', 'Ready to serve.', 'Honor guides me.'],
  },
  [UnitType.BERSERKER]: {
    command:  ['YEAH!', 'LET\'S GOOOO!', 'CAN\'T STOP WON\'T STOP!', 'WOOOO!'],
    attack:   ['RAAAAAGH!', 'BLOOD!', 'COME AT ME!', 'I\'LL EAT YOUR SHIELD!'],
    attacked: ['MORE! HIT ME MORE!', 'THAT MAKES ME ANGRY!', 'IS THAT A TICKLE?!', 'HAHAHAHA!'],
    kill:     ['CRUSHED!', 'WHO\'S NEXT?! WHO\'S NEXT?!', 'ANOTHER ONE!', 'HAHAHA YES!'],
    death:    ['GOOD... FIGHT...', 'WORTH IT!', 'GLORY!'],
    idle:     ['I NEED TO HIT SOMETHING!', '*punches tree*', 'BORED BORED BORED!', 'AAAAA!'],
    level_up: ['UNLIMITED POWER!', 'EVEN ANGRIER!', 'RAAAGE UPGRADE!'],
    select:   ['WHAT?!', 'YEAH?!', 'POINT ME AT SOMETHING!', 'FIGHT TIME?!'],
  },
  [UnitType.SHIELDBEARER]: {
    command:  ['Shields up!', 'Moving formation.', 'Advancing.', 'Solid.'],
    attack:   ['SHIELD BASH!', 'Try getting through THIS!', 'Wall of steel!'],
    attacked: ['*CLANG*', 'Blocked.', 'Nice try.', 'My shield says no.'],
    kill:     ['Bonk.', 'Shoulda gone around.', 'Shield: 1, them: 0.'],
    death:    ['Shield... broken...', 'Couldn\'t block... that one...'],
    idle:     ['*adjusts shield*', 'Standing guard.', 'Nothing gets past me.'],
    level_up: ['Thicker shield!', 'Unmovable!', 'Even tankier!'],
    select:   ['Shield wall ready.', 'Protected.', 'Behind me.'],
  },
  [UnitType.SCOUT]: {
    command:  ['Scouting ahead!', 'On the move!', 'Fast and quiet.', 'Already there!'],
    attack:   ['Surprise attack!', 'Didn\'t see me coming!', 'Quick strike!'],
    attacked: ['Too fast for you!', 'Can\'t hit what you can\'t catch!', 'Ow! Lucky!'],
    kill:     ['Scouted AND deleted.', 'Report: enemy down.', 'Swift justice.'],
    death:    ['Too fast to... wait, no...', 'Report my... position...'],
    idle:     ['I\'ve mapped this WHOLE area.', 'I see everything.', 'So. Much. Running.'],
    level_up: ['Even faster!', 'Zoom zoom!', 'Sonic speed!'],
    select:   ['Intel ready.', 'What do you need found?', 'I know a shortcut.'],
  },
  [UnitType.RIDER]: {
    command:  ['Ride!', 'Giddyup!', 'Hooves thundering!', 'Flanking!'],
    attack:   ['CHAAARGE!', 'Cavalry\'s here!', 'Trample \'em!', 'Lances down!'],
    attacked: ['My horse!', 'Watch the mount!', 'Dismounting was NOT the plan!'],
    kill:     ['Rode \'em down!', 'Cavalry claims another!', 'Can\'t outrun a horse!'],
    death:    ['The ride... ends...', 'Take care of... my horse...'],
    idle:     ['*pats horse*', 'Easy there, boy.', 'We could be running right now.'],
    level_up: ['Faster steed!', 'Stronger charge!', 'Knight upgrade!'],
    select:   ['Mounted and ready.', 'Cavalry reporting.', 'Which direction?'],
  },
  [UnitType.BUILDER]: {
    command:  ['I can fix that!', 'Got my hammer!', 'Building time!', 'On the job!'],
    attack:   ['Hammer time!', 'I build AND I break!', 'Construction violence!'],
    attacked: ['I\'m a BUILDER!', 'Hard hat zone!', 'This isn\'t OSHA approved!'],
    kill:     ['Nailed it!', 'Built different.', 'Deconstructed.'],
    death:    ['Project... incomplete...', 'Someone finish... my blueprint...'],
    idle:     ['Anyone need a wall?', '*whistles while working*', 'I see fixer-uppers everywhere.'],
    level_up: ['Master builder!', 'Blueprints upgraded!', 'Faster construction!'],
    select:   ['What needs building?', 'Builder here!', 'I see potential.'],
  },
  [UnitType.LUMBERJACK]: {
    command:  ['Timber!', 'Heading out!', 'Where\'s the trees?', 'Choppy chop!'],
    attack:   ['AXE SWING!', 'You\'re firewood!', 'TIMBER!'],
    attacked: ['I chop TREES not fight!', 'Bark is worse than my bite!', 'Ow, splinters!'],
    kill:     ['Chopped.', 'You\'ve been lumbered.', 'Like a tree — FELL.'],
    death:    ['I should\'ve been... a tree...', 'The forest... remembers...'],
    idle:     ['*sharpens axe*', 'I can hear the trees growing.', 'Need more wood?'],
    level_up: ['Sharper axe!', 'Paul Bunyan mode!', 'Mega chop!'],
    select:   ['Lumberjack ready!', 'Got wood?', 'Axe is sharp!'],
  },
  [UnitType.GREATSWORD]: {
    command:  ['Heavy steps.', 'Moving. Slowly.', 'This sword weighs a ton.', 'Advancing!'],
    attack:   ['BIG SWING!', 'CLEAVE!', 'TASTE STEEL!', 'MASSIVE DAMAGE!'],
    attacked: ['I barely felt that.', 'My turn.', 'Bad idea.', 'You\'re gonna regret that.'],
    kill:     ['Sliced in half.', 'Clean cut.', 'Should\'ve dodged.', 'DEVASTATING!'],
    death:    ['Too heavy... to keep... fighting...', 'My sword... carry it on...'],
    idle:     ['*drags sword on ground*', 'This thing is heavy.', 'I need a back brace.'],
    level_up: ['BIGGER SWORD!', 'Even more damage!', 'ULTRAGREATSWORD!'],
    select:   ['Big sword, big problems.', 'Ready to cleave.', 'Need something cut in half?'],
  },
  [UnitType.BATTLEMAGE]: {
    command:  ['Spell-marching.', 'Arcane stride.', 'Both fist and fireball.', 'Moving.'],
    attack:   ['SPELLBLADE!', 'Magic AND muscle!', 'Double threat!', 'Feel the arcane!'],
    attacked: ['My barrier!', 'Both shields up!', 'You fight a scholar AND a warrior!'],
    kill:     ['Calculated AND physical.', 'Thesis: you lose.', 'Peer combat review: passed.'],
    death:    ['The spell... fades...', 'Magic and might... weren\'t enough...'],
    idle:     ['*levitates slightly*', 'I could be studying AND fighting.', 'Dual spec is exhausting.'],
    level_up: ['Arcane warrior ascends!', 'Spell AND sword!', 'Dual mastery!'],
    select:   ['Battle and magic.', 'Spell or sword?', 'Battlemage ready.'],
  },
  [UnitType.OGRE]: {
    command:  ['OGRE GO.', 'BIG WALK.', 'SMASH WHERE?', 'ME MOVING.'],
    attack:   ['OGRE SMASH!', 'CRUSH TINY ONES!', 'GROUND POUND!', 'RAAAA!'],
    attacked: ['OW.', 'THAT HURT OGRE.', 'OGRE MAD NOW.', 'BAD TINY ONE.'],
    kill:     ['SPLAT.', 'TINY ONE GONE.', 'OGRE WIN.', 'HEHEHE.'],
    death:    ['OGRE... SLEEPY...', 'BIG... NAP...', 'OGRE... DOWN...'],
    idle:     ['OGRE BORED.', 'WANT SMASH.', '*scratches head*', 'HUNGRY.'],
    level_up: ['OGRE BIGGER!', 'MORE SMASH!', 'OGRE STRONG!'],
    select:   ['OGRE HERE.', 'WHAT?', 'SMASH?', 'OGRE READY.'],
  },
  [UnitType.TREBUCHET]: {
    command:  ['Repositioning!', 'Rolling out!', 'Siege crew, move!', 'Slow and steady!'],
    attack:   ['FIRE!', 'LAUNCH!', 'INCOMING!', 'Boulder away!'],
    attacked: ['Protect the siege!', 'They\'re targeting us!', 'We need cover!'],
    kill:     ['Direct hit!', 'Splash damage!', 'Area denied!', 'Boom!'],
    death:    ['The trebuchet... falls...', 'Siege... over...'],
    idle:     ['Loaded and ready.', 'Awaiting coordinates.', 'Ammo check: good.'],
    level_up: ['Bigger boulders!', 'Extended range!', 'Siege mastery!'],
    select:   ['Siege engine ready.', 'Give us a target.', 'Trebuchet online.'],
  },
  [UnitType.VILLAGER]: {
    command:  ['Okay!', 'Going!', 'Yes, right away!', 'I\'ll try my best!'],
    attack:   ['I\'m not trained for this!', 'AAA!', 'Take THAT! ...please work...'],
    attacked: ['HELP!', 'I\'M JUST A VILLAGER!', 'AAAHHH!', 'NOT THE FACE!'],
    kill:     ['I... I did it?', 'Wait, really?', 'Beginner\'s luck!'],
    death:    ['I just wanted... to farm...', 'Should\'ve stayed home...'],
    idle:     ['Nice day for farming!', 'La la la~', '*picks flowers*', 'Is it lunch yet?'],
    level_up: ['I\'m learning!', 'Getting braver!', 'Village hero!'],
    select:   ['Hi!', 'Hello!', 'Me? Really?', 'Villager here!'],
  },
  [UnitType.CHAMPION]: {
    command:  ['With honor.', 'The Champion moves.', 'Glory awaits.', 'Forward!'],
    attack:   ['FOR ETERNAL GLORY!', 'CHAMPION\'S STRIKE!', 'WITNESS MY POWER!', 'LEGENDARY!'],
    attacked: ['A worthy blow!', 'You dare?!', 'Champions don\'t flinch!', 'Impressive. Almost.'],
    kill:     ['Champion\'s might!', 'None can stand.', 'Legendary kill!', 'Unmatched!'],
    death:    ['Even champions... fall...', 'A glorious... end...', 'Remember... my name...'],
    idle:     ['*poses heroically*', 'Legends aren\'t written idle.', 'My hammer thirsts.'],
    level_up: ['TRANSCENDENT!', 'Beyond mortal!', 'CHAMPION SUPREME!'],
    select:   ['The Champion.', 'I am here.', 'Command me.', 'Legends don\'t wait.'],
  },
};

/**
 * Get a random dialogue line for a given unit type and context.
 * Falls back to generic lines if the unit type has no specific entry.
 */
export function getDialogueLine(unitType: UnitType, context: DialogueContext): string {
  const bank = UNIT_LINES[unitType];
  const lines = bank?.[context] ?? GENERIC_LINES[context];
  return lines[Math.floor(Math.random() * lines.length)];
}

