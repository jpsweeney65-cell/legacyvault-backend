# LegacyVault Backend

Backend functions for the **LegacyVault** app — create beautiful video memories from photos, audio, and music.

## Functions

### `ownerOverride`
An admin dashboard to manage all memories. Features:
- View all 4 memories with photos and current status
- **Generate Video** — submits hero photo to Replicate (Stable Video Diffusion) and saves the result back to LegacyVault
- **Force Complete** — manually mark a memory as completed
- **Reset to Pending** — clear a stuck "processing" status

**Live URL:**
```
https://api.base44.com/api/apps/6a112857eef4c0620eb297f1/functions/ownerOverride
```

### `generateMemoryVideo`
Core video generation function using Stability AI image-to-video API. Takes a `memoryId`, fetches the hero photo, submits to Stability AI, polls for completion, and saves the `video_url` back to the memory record.

## Requirements
- `REPLICATE_API_TOKEN` — set as environment secret (get one at replicate.com)
- `STABILITY_API_KEY` — for the generateMemoryVideo function (get one at platform.stability.ai)

## Stack
- Runtime: Deno (Base44 backend functions)
- AI Video: Replicate (Stable Video Diffusion)
- Database: Base44 entities (LegacyVault app)
