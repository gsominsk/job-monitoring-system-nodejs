Act as an Expert Game Developer, UX Designer, and Frontend Engineer.
I am building a 2D Endless Runner in pure HTML5 Canvas and Vanilla JS (NO external engines, zero dependencies). This must run entirely in the browser.

The game is a visualizer for a Node.js Job Monitoring system. Every 500ms, the game fetches a JSON object with CUMULATIVE statistics. 
For the sake of this environment, implement a `mockFetchStats()` function that simulates this API by returning a JSON object whose values slowly increment over time.

JSON Structure:
{
  "totalJobs": 46,
  "patterns": { "namePrefix": { "critical-": 8, "test-": 11 }, "argumentFlags": { "--fast": 12 } },
  "durationCorrelation": { "failedCount": 2 },
  "pidParity": { "even": 23, "odd": 23 }
}

# Core Mechanics (Delta & Chunking):
1. Delta Calculation: Every 500ms, calculate the difference between the new JSON and the old JSON (e.g., delta `failedCount` = new - old). If new values are lower, assume a server restart and reset the baseline.
2. Track Buffer: Use the Deltas to generate a "0.5-second chunk" of gameplay and append it to the track buffer ahead of the player.
3. Level Design (Combinations):
   - Delta `failedCount` > 0: Spawns Traps (spikes/pits).
   - Delta `critical-` > 0: Spawns high-value coins. Place them strategically (e.g., above traps for risk/reward).
   - Delta `pidParity`: If even > odd, slope terrain UP. If odd > even, slope DOWN.
   - All Deltas 0: Generate a flat "peaceful zone".

# Realistic Mock Server (Data Simulator):
Implement a highly realistic `mockFetchStats()` function that acts as a stateful virtual backend to test the game. 
- It must store an internal baseline state matching the exact JSON structure provided above.
- On each call, it should realistically mutate the state using weighted probabilities to simulate a living Node.js server:
  * 70% chance of Normal Load: Increment `totalJobs`, standard prefixes (`test-`, `other`), and randomly distribute +1/2 to `pidParity.even` or `odd`.
  * 15% chance of Idle: Do not mutate the state at all (simulating 0 deltas / peaceful zone).
  * 10% chance of a Burst: Increment `totalJobs` by 15-30 at once, significantly boost `--fast` and `critical-`.
  * 5% chance of Error: Increment `failedCount` by 1 or 2.
- Return a deep copy of the state so the game's Delta Calculation receives realistic, production-like data flow.

# NEW UI REQUIREMENT: "The Logic Console" (HUD)
The player MUST understand how stats translate to gameplay. 
Create an overlay HTML `<div>` (e.g., top-right corner, hacker/terminal aesthetic) that acts as a live log. Every 500ms, append text explaining the math. 
Example output in the HUD:
"[+] delta totalJobs: 3 -> generating path"
"[!] delta failedCount: 1 -> spawning TRAP"
"[*] delta critical: 2 -> spawning Coins"
"[=] pidParity balanced -> keeping terrain flat"

# Visuals & Aesthetics (Japanese Spring Pixel Art):
The game must feature a beautiful "Retro Pixel Art" aesthetic themed around a Japanese Spring.
- Color Palette: Soft pinks, whites, light greens, and warm sunset colors. 
- Background: Implement a simple parallax scrolling background showing distant pixel-art mountains (like Mt. Fuji) and falling Sakura (cherry blossom) petals using a particle system.
- Entities styling (draw using Canvas API shapes or pixel-arrays, keep it dependency-free):
  * Player: A cute pixel-art style character (e.g., a tiny ninja, fox, or just a stylized pixel block with a headband).
  * Traps (from failed jobs): Pixel-art bamboo spikes or small puddles.
  * Coins (from critical jobs): Floating pixel-art Sakura flowers or glowing Japanese coins.
  * Ground: Grassy pixel-blocks with soft green/brown colors.
- Canvas Context: Make sure to set `ctx.imageSmoothingEnabled = false` to preserve the crisp, chunky pixel-art look. The Logic Console (HUD) should have a slightly translucent dark-pink or dark-gray background with a retro monospace font.

# Technical Requirements:
- Output a single `index.html` (or separate HTML/CSS/JS if the builder supports it) containing everything.
- `requestAnimationFrame` for 60FPS rendering.
- Box physics for the Player (Jump, Gravity, collision detection).
- Auto-scrolling camera/world.
- Keep the code clean, heavily commented, and highly performant.

