# Orbital planet demo (New Horizon Landing Console)

A single-page Three.js prototype from the pre-game exploration work: seeded procedural planets rendered with custom GLSL shaders, each with 3 to 5 landing sites placed on matching terrain.

- Five planet styles: Verdance (temperate ocean), Cinder (volcanic lava), Miasma (toxic nebulous), Glacia (frozen ice) and Dune (arid desert), each with its own size, palette, clouds and atmosphere.
- Seeded and repeatable: enter a seed and press LOAD, or REGENERATE for a new one.
- Each system rolls 1 to 2 suns (colours from real stellar classes), 0 to 6 moons, and sometimes an asteroid belt or planetary ring.
- Surface features: lakes, rivers, lava seas, spinning typhoons, lightning and auroras.
- Click a hexagonal marker or a row in the zone index to open the landing zone specification panel.

Open `index.html` in a browser with WebGL. It loads Three.js r128 from the jsDelivr CDN, so it needs network access.
