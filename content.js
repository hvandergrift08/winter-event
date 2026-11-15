/* =====================================================================
   OPERATION: FALCON FROST — GAME CONTENT
   This is the only file you need to edit for content.
   - Change instruction text in each step's `body` (plain HTML).
   - Paste YouTube IDs into `youtubeId` once videos are uploaded
     (the ID is the part after "v=" in the link, e.g. dQw4w9WgXcQ).
     Upload as Unlisted and leave "Allow embedding" ON.
   - Add hints to each mission's `hints` list (see the template below).
   - Codewords: `answers` lists every accepted answer. Capitalization,
     spaces and punctuation are ignored automatically.
   ===================================================================== */

window.GAME = {
  title: "Operation: Falcon Frost",

  // Simple PINs to keep students out of each view. Change before game day.
  pins: {
    teacher: "frost",       // homeroom teachers check in with this
    control: "falcon2026",  // your control panel
    library: "cookies"      // Mrs. Vu's check-in screen
  },

  capMinutes: 70,                 // any score over this counts as 70:00
  defaultHintPenaltyMinutes: 2,   // used when a hint doesn't set its own
  startCountdownSeconds: 10,      // countdown shown on every screen at start

  teams: [
    { id: "lanner",    name: "Lanner Falcons",    color: "#B98CFF" },
    { id: "bat",       name: "Bat Falcons",       color: "#FF6B6B" },
    { id: "gyr",       name: "GyrFalcons",        color: "#4ADE80" },
    { id: "peregrine", name: "Peregrine Falcons", color: "#FACC15" }
  ],

  homerooms: [
    // Lanner Falcons
    { room: "3",  teacher: "Carnal",    team: "lanner" },
    { room: "14", teacher: "Hughes",    team: "lanner" },
    { room: "18", teacher: "Hadden",    team: "lanner" },
    { room: "20", teacher: "Johnson",   team: "lanner" },
    { room: "21", teacher: "Fraley",    team: "lanner" },
    { room: "27", teacher: "Linsangan", team: "lanner" },
    // Bat Falcons
    { room: "5",  teacher: "Sandate",   team: "bat" },
    { room: "10", teacher: "Olivares",  team: "bat" },
    { room: "12", teacher: "Uriarte",   team: "bat" },
    { room: "16", teacher: "Montes",    team: "bat" },
    { room: "22", teacher: "Ramos",     team: "bat" },
    { room: "25", teacher: "Scheid",    team: "bat" },
    // GyrFalcons
    { room: "6",  teacher: "Phelps",    team: "gyr" },
    { room: "11", teacher: "Rios",      team: "gyr" },
    { room: "15", teacher: "Katsuda",   team: "gyr" },
    { room: "17", teacher: "Martinez",  team: "gyr" },
    { room: "19", teacher: "Serrano",   team: "gyr" },
    { room: "28", teacher: "Espinoza",  team: "gyr" },
    // Peregrine Falcons
    { room: "1",  teacher: "Lopez",     team: "peregrine" },
    { room: "7",  teacher: "Keating",   team: "peregrine" },
    { room: "9",  teacher: "Chhour",    team: "peregrine" },
    { room: "23", teacher: "Kang",      team: "peregrine" },
    { room: "24", teacher: "Souza",     team: "peregrine" },
    { room: "26", teacher: "Carrillo",  team: "peregrine" }
  ],

  /* ------------------------------------------------------------------
     STEPS, in order. Types:
       video   – plays a YouTube video, then "Continue"
       mission – instructions + "Enter codeword" + hints
       final   – instructions + hints; ends when the library checks them in
     The video marked `finale: true` only unlocks after the library
     check-in (or when time runs out).

     HINT TEMPLATE (copy into a mission's hints list):
       { text: "Look at the colors of the wrapping paper first." },
       { text: "A bigger hint that costs more.", penaltyMinutes: 3 },
     ------------------------------------------------------------------ */
  steps: [
    {
      id: "v1", type: "video", label: "Video 1: The Briefing",
      title: "Incoming transmission: Captain Jingles",
      youtubeId: "",
      recap: "Every holiday treat backstage in the MPR has vanished. A strike note points at the elves. Captain Jingles has deputized your homeroom as a Falcon Frost Squad. Crack Evidence Kit #1 to unlock the interrogation footage."
    },
    {
      id: "m1", type: "mission", label: "Mission 1: Wrapper Relay",
      title: "Mission 1: The Wrapper Relay",
      body: `
        <p>The strikers left scraps of wrapping paper behind. Each scrap hides one letter of a secret message.</p>
        <ol>
          <li>Run the relay: carry a ping pong ball on a spoon from the start line to the evidence table and back. No hands on the ball. If it drops, go back to the start.</li>
          <li>Each runner who makes it collects one wrapping-paper scrap. You need 18 scraps, and 18 different agents must run.</li>
          <li>Use the Christmas cipher to decode the symbol on every scrap.</li>
          <li>Each type of wrapping paper is one word. Group your letters by paper, unscramble each word, then put the words in order.</li>
        </ol>
        <p class="callout">Keep your spoon. You'll need it later.</p>`,
      code: { answers: ["FIND PIP IN THE LOUNGE"] },
      hints: []
    },
    {
      id: "v2", type: "video", label: "Video 2: Pip the Elf",
      title: "Interrogation footage: Pip the Elf",
      youtubeId: "",
      recap: "Pip admits the elves went on strike but swears they didn't touch the treats. Pip saw Professor Frost sneaking out of the MPR with a heavy cart under a blue tarp, and found blueprint scraps. Figure out what Frost was building."
    },
    {
      id: "m2a", type: "mission", label: "Mission 2A: Frost's Lab Notes",
      title: "Mission 2, Part 1: Frost's Lab Notes",
      body: `
        <p>Pip's blueprint scraps are pages from Professor Frost's lab notes, and they're completely out of order.</p>
        <ol>
          <li>Read every note. Work together to put the steps in the correct order.</li>
          <li>The notes explain how to build a launcher from 8 popsicle sticks, 5 rubber bands, and your spoon from Mission 1.</li>
          <li>When the steps are in the right order, look closely. The notes reveal a password that unlocks Frost's private video journal.</li>
        </ol>
        <p class="callout">Don't launch anything yet. Frost's journal has safety instructions.</p>`,
      code: { answers: ["CATAPULT"] },
      hints: []
    },
    {
      id: "v25", type: "video", label: "Video 2.5: Frost's Journal",
      title: "Recovered file: Professor Frost's journal",
      youtubeId: "",
      recap: "The snowballs are unstable cryo crystals. Human hands make them go POOF, so they can only be moved with tongs. Five must be launched at least 5 feet into the bucket to stabilize the reaction. Split the team: half build, half gather crystals."
    },
    {
      id: "m2b", type: "mission", label: "Mission 2B: Cryo Launch",
      title: "Mission 2, Part 2: Launch the Cryo Crystals",
      body: `
        <p>Split your squad into two crews.</p>
        <ol>
          <li><strong>Builders:</strong> build the catapult using Frost's notes, in order.</li>
          <li><strong>Handlers:</strong> move every snowball to the starting line using chopsticks only. Hands never touch a cryo crystal.</li>
          <li>No launching until every snowball is at the starting line.</li>
          <li>Launch from behind the line into the bucket. Each snowball that lands in the bucket earns one map overlay from ASB.</li>
          <li>Stack your overlays on Frost's campus map to find where he's hiding.</li>
        </ol>`,
      code: {
        prefix: "Professor Frost is",
        answers: ["BEHIND ROOM 28", "BEHIND ROOM TWENTY EIGHT", "BEHIND RM 28"]
      },
      hints: []
    },
    {
      id: "v3", type: "video", label: "Video 3: Professor Frost",
      title: "Found him: Professor Frost",
      youtubeId: "",
      recap: "Frost's cart held sleigh-booster equipment, not cookies. The glitter in the security footage is holographic silver, and only Holly Jolly uses that. She was near the MPR stage at 6:30 AM. Go check her story."
    },
    {
      id: "m3", type: "mission", label: "Mission 3: Holly's Inspection",
      title: "Mission 3: Holly Jolly's Gift Inspection",
      body: `
        <p>Holly Jolly has exacting standards. Prove you can meet them.</p>
        <ol>
          <li>Read Holly's rules for an acceptable present.</li>
          <li>Sort every gift card into Accepted or Rejected using her rules.</li>
          <li>Call ASB to check your sort. Every card must be right. If any are wrong, ASB sends you back to re-check.</li>
          <li>Once you pass, ASB hands you Holly's grid. Use the coordinates on the back of your cards to color in the grid.</li>
          <li>The finished picture reveals the codeword.</li>
        </ol>`,
      code: { answers: ["CHRISTMAS TREE", "XMAS TREE"] },
      hints: []
    },
    {
      id: "v4", type: "video", label: "Video 4: Holly Jolly",
      title: "Witness statement: Holly Jolly",
      youtubeId: "",
      recap: "Holly insists she'd never crush her perfect corner folds. She saw Barnaby Humbug in the MPR with a giant black trash bag, and everyone knows he hates Christmas. Track him down."
    },
    {
      id: "m4", type: "mission", label: "Mission 4: Barnaby's Sweep",
      title: "Mission 4: Barnaby's Clean Sweep",
      body: `
        <p>Barnaby won't talk to anyone until this room is spotless.</p>
        <ol>
          <li>Every agent gets one ruler. Sweep every pom pom into the trash cans using only your ruler. No hands, no feet.</li>
          <li>When the floor is clear, ASB gives you an envelope of lost keys.</li>
          <li>Each key has a clue about the teacher who lost it. Figure out who each key belongs to and write down your list.</li>
          <li>Return each key to its owner in the hallway as ASB directs.</li>
          <li>When every key is home, you'll receive Barnaby's master key. It holds your next clue.</li>
        </ol>`,
      code: { answers: ["GRINCH", "THE GRINCH"] },
      hints: []
    },
    {
      id: "v5", type: "video", label: "Video 5: The Twist",
      title: "Breaking footage: Barnaby and Nick Jr.",
      youtubeId: "",
      recap: "Holly Jolly sleepwalked the treats out of the MPR to protect them from the band, with Freddy Falcon tiptoeing behind her. She's asleep in the library. Mrs. Vu won't let you in unless you get it exactly right."
    },
    {
      id: "m5", type: "final", label: "Mission 5: Library Pass",
      title: "Mission 5: Mrs. Vu's Library Pass",
      body: `
        <p>Mrs. Vu has exacting standards for entering the library.</p>
        <ol>
          <li>Build the chain section by section, following the instructions for each section, in order.</li>
          <li>The whole squad works in complete silence.</li>
          <li>When your chain is complete, send your runners to the library with it.</li>
          <li>Mrs. Vu stops your clock when your runners arrive. If the chain isn't right, she sends them back to fix it and your clock keeps running.</li>
        </ol>`,
      hints: []
    },
    {
      id: "v6", type: "video", finale: true, label: "Video 6: Case Closed",
      title: "Case closed",
      youtubeId: "",
      recap: "It wasn't an inside job. It was an insomnia job. Holly Jolly relocated the treats in her sleep, the elves are back to work, and holiday synergy at Ross is back at 100%."
    }
  ]
};
