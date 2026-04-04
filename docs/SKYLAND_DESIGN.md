# SKYLAND — Floating Cloud Islands Map Design

## Vision
A bright, whimsical sky-world of floating islands connected by rainbow crystal bridges.
The polar opposite of grimdark — think Care Bear land meets Polytopia in the clouds.
Pastel terrain, prismatic crystals, cloud-puff decorations, and a swirling cloudscape below instead of ocean.

## Gameplay Identity
- **Islands create natural territories** — each island is a defensible zone
- **Bridges are chokepoints** — narrow 1-2 hex rainbow bridges connect islands, control them to control the map
- **Vertical drama** — islands float at varying elevations over a cloud void
- **Resource distribution** — each island has different resources, forcing expansion across bridges
- **Vibes** — bright, joyful, almost dreamlike. Players should smile when this map loads.

## Terrain Generation Plan

### Island Layout (Phase 1: Core Generator)
1. **Seed 5-8 island centers** using golden angle spiral (reuse standard pattern)
   - 2 large "home islands" (radius 6-8) near player base positions
   - 1 large "central island" (radius 7-9) in the mid-map — contested ground
   - 2-4 small "outpost islands" (radius 3-5) scattered between
2. **Island shape**: circular base + noise distortion for organic edges
   - Use fbm noise to wobble the radius per angle (±30% variation)
   - Terrain: PLAINS core with FOREST groves, small elevation hills (2-5 max)
   - No mountains, no water tiles ON islands — flat and playable
3. **Void between islands**: special SKY terrain type (impassable, renders as cloud void below)
   - All non-island tiles are SKY/void
   - Edge tiles get a gentle slope-down for visual cliff effect

### Bridge Generation (Phase 2: Connections)
1. **Minimum spanning tree** of island centers ensures all islands are reachable
2. **Add 1-2 extra edges** for alternate routes (so it's not pure tree topology)
3. **Bridge tiles**: 1-hex-wide CLOUD_BRIDGE terrain, walkable, elevation matches endpoints
   - Bridge path: straight line or gentle arc between nearest island edges
   - PathFinder treats CLOUD_BRIDGE as walkable (cost 1.5 — slightly slower than plains)
4. **Visual**: rainbow-gradient blocks, translucent shimmer, slightly emissive

### Resource Distribution (Phase 3: Economy)
- **Home islands**: wood (forest groves) + stone outcrops + starting food
- **Central island**: crystal deposits + iron — high-value contested resources
- **Outpost islands**: 1-2 resource types each (wood OR stone OR crystal)
- **No resources on bridges** — pure transit chokepoints

## Visual Design

### Color Palette
- **Island grass**: soft pastel green (#98FB98) with subtle pink/lavender tint variation
- **Island dirt/sub**: warm cream (#FFEFD5) instead of brown
- **Stone blocks**: soft lilac (#DDA0DD) instead of grey
- **Crystal/gems**: prismatic rainbow cycle (hue shifts across the block face)
- **Bridge blocks**: rainbow gradient along bridge length (red→orange→yellow→green→blue→violet)
- **Tree trunks**: warm pink-brown (#DEB887)
- **Tree foliage**: mix of pastel green, soft pink (#FFB6C1), and lavender (#E6E6FA)

### Cloud Void Shader (replaces ocean plane)
- **Below islands**: swirling volumetric cloud layer instead of water
- **Vertex shader**: billowing sine-wave displacement (slower, softer than water)
- **Fragment shader**:
  - Base: white (#FFFFFF) to soft pink (#FFF0F5) gradient
  - Scrolling cloud noise for depth (2-3 octave fbm)
  - Subtle rainbow prismatic highlights at cloud edges (fresnel-like effect)
  - Soft golden glow from "sun below" effect
- **Mesh**: large plane below all islands, Y = -3 (islands start at Y = 0+)

### Decorations (TerrainDecorator additions)
- **Cloud puffs**: small white sphere clusters on island edges (like clouds clinging to cliffs)
- **Rainbow flowers**: existing flower system but with full rainbow color rotation
- **Crystal spires**: tall prismatic columns on crystal-resource tiles (emissive, color-cycling)
- **Pastel trees**: pink/lavender/mint foliage instead of standard green

### Lighting Adjustments
- **Brighter ambient**: boost ambient light intensity for dreamy feel
- **Warm sun**: shift sun color toward golden-pink
- **Reduced fog**: pull back fog density so the sky feels open and vast
- **Dust motes**: recolor from grey to soft gold/pink sparkles

## Implementation Order
1. MapType.SKYLAND enum + preset + menu entry
2. generateSkylandMap() — island placement, bridge connection, resource seeding
3. CLOUD_BRIDGE BlockType + Pathfinder support
4. Cloud void shader (SkyCloudSystem.ts — like WaterSystem.ts but clouds)
5. Prismatic block colors in VoxelBuilder palette
6. TerrainDecorator skyland mode (pastel trees, cloud puffs)
7. Lighting/fog adjustments when skyland map active
8. Playtest iteration on island sizes, bridge lengths, resource balance

## Technical Notes
- Bridges are regular Tile objects with terrain=PLAINS and a bridge flag
  - This avoids pathfinder changes — they're just walkable tiles
  - VoxelBuilder renders them with rainbow gradient based on position along bridge
- Cloud shader lives in new SkyCloudSystem.ts, parallel to WaterSystem.ts
  - MapInitializer checks mapType and creates cloud plane instead of ocean plane
- Island generation is self-contained in MapPresets.ts (like Arena, Desert Tunnels)
- No underground/tunnels on Skyland — the void IS the underground
