import { createClient } from 'npm:@base44/sdk@0.8.25';

// Hardcoded token — update here if it changes
const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN") || "";
const LEGACYVAULT_APP_ID = "697de3f8caf56c5b917e0c7e";

const client = createClient({ appId: LEGACYVAULT_APP_ID, serviceRole: true });
const db = client.entities;

async function getMemories() {
  return await db.Memory.list();
}

async function triggerVideoGeneration(memoryId: string) {
  const memories = await db.Memory.list();
  const memory = memories.find((m: any) => m.id === memoryId);
  if (!memory) throw new Error("Memory not found");

  const heroPhoto = memory.photos?.[0];
  if (!heroPhoto) throw new Error("No photos found on this memory");

  const photoUrl = heroPhoto.startsWith("https://base44.app")
    ? heroPhoto.replace(
        "https://base44.app/api/apps/697de3f8caf56c5b917e0c7e/files/public/697de3f8caf56c5b917e0c7e/",
        "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/697de3f8caf56c5b917e0c7e/"
      )
    : heroPhoto;

  await db.Memory.update(memoryId, { generation_status: "processing" });

  const submitRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: "3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438",
      input: {
        input_image: photoUrl,
        sizing_strategy: "maintain_aspect_ratio",
        motion_bucket_id: 127,
        frames_per_second: 6,
        noise_aug_strength: 0.1,
      },
    }),
  });

  const prediction = await submitRes.json();
  if (!prediction.id) {
    throw new Error(`Replicate submit failed: ${JSON.stringify(prediction)}`);
  }

  let videoUrl = null;
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` },
    });
    const status = await pollRes.json();

    if (status.status === "succeeded") {
      videoUrl = status.output;
      break;
    } else if (status.status === "failed" || status.status === "canceled") {
      throw new Error(`Replicate prediction failed: ${status.error}`);
    }
  }

  if (!videoUrl) throw new Error("Video generation timed out");

  const finalUrl = Array.isArray(videoUrl) ? videoUrl[0] : videoUrl;
  await db.Memory.update(memoryId, {
    video_url: finalUrl,
    generation_status: "completed",
  });

  return { success: true, video_url: finalUrl };
}

async function forceStatus(memoryId: string, status: string) {
  await db.Memory.update(memoryId, { generation_status: status });
  return { success: true };
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LegacyVault Owner Override</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f1a; color: #e2e8f0; min-height: 100vh; padding: 24px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 6px; color: #a78bfa; }
    p.sub { font-size: 14px; color: #64748b; margin-bottom: 28px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
    .card { background: #1e1e2e; border: 1px solid #2d2d44; border-radius: 14px; padding: 20px; }
    .card h2 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
    .status { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
    .status.processing { background: #fbbf24; color: #1a1a00; }
    .status.completed { background: #34d399; color: #001a0a; }
    .status.failed { background: #f87171; color: #1a0000; }
    .status.pending { background: #60a5fa; color: #00001a; }
    .thumb { width: 100%; height: 140px; object-fit: cover; border-radius: 8px; margin-bottom: 12px; background: #2d2d44; }
    .actions { display: flex; flex-direction: column; gap: 8px; }
    button { padding: 9px 14px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; transition: opacity 0.2s; }
    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-generate { background: #7c3aed; color: white; }
    .btn-reset { background: #2d2d44; color: #94a3b8; }
    .btn-complete { background: #065f46; color: #6ee7b7; }
    .video-link { font-size: 12px; margin-top: 6px; margin-bottom: 10px; }
    .log { margin-top: 10px; font-size: 12px; color: #94a3b8; background: #12121e; border-radius: 6px; padding: 8px 10px; min-height: 36px; max-height: 80px; overflow-y: auto; word-break: break-all; }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <h1>LegacyVault Owner Override</h1>
  <p class="sub">Manually trigger video generation or force-update memory statuses.</p>
  <div class="grid" id="grid">Loading memories...</div>
  <script>
    var BASE_URL = window.location.href.split('?')[0];
    async function loadMemories() {
      var res = await fetch(BASE_URL + '?action=list');
      var data = await res.json();
      return data.memories || [];
    }
    function statusClass(s) {
      if (s === 'completed') return 'completed';
      if (s === 'processing') return 'processing';
      if (s === 'failed') return 'failed';
      return 'pending';
    }
    function renderMemory(m) {
      var thumb = m.photos && m.photos[0] ? m.photos[0] : '';
      var hasVideo = m.video_url;
      return '<div class="card" id="card-' + m.id + '">' +
        (thumb ? '<img class="thumb" src="' + thumb + '" onerror="this.style.display=\'none\'" />' : '') +
        '<h2>' + (m.title || 'Untitled Memory') + '</h2>' +
        '<span class="status ' + statusClass(m.generation_status) + '">' + (m.generation_status || 'pending') + '</span>' +
        (hasVideo ? '<div class="video-link"><a href="' + m.video_url + '" target="_blank" style="color:#a78bfa">View Video</a></div>' : '') +
        '<div class="actions">' +
        '<button class="btn-generate" onclick="generate(\'' + m.id + '\')" id="gen-' + m.id + '">Generate Video</button>' +
        '<button class="btn-complete" onclick="forceStatus(\'' + m.id + '\', \'completed\')">Force Complete</button>' +
        '<button class="btn-reset" onclick="forceStatus(\'' + m.id + '\', \'pending\')">Reset to Pending</button>' +
        '</div>' +
        '<div class="log" id="log-' + m.id + '">Ready.</div>' +
        '</div>';
    }
    function log(id, msg) {
      var el = document.getElementById('log-' + id);
      if (el) el.textContent = msg;
    }
    async function generate(id) {
      var btn = document.getElementById('gen-' + id);
      btn.disabled = true;
      btn.textContent = 'Generating... (up to 3 min)';
      log(id, 'Submitting to Replicate...');
      try {
        var res = await fetch(BASE_URL + '?action=generate&memoryId=' + id);
        var data = await res.json();
        if (data.success) {
          log(id, 'Done! ' + data.video_url);
          setTimeout(function() { location.reload(); }, 1500);
        } else {
          log(id, 'Error: ' + (data.error || 'Unknown'));
          btn.disabled = false;
          btn.textContent = 'Generate Video';
        }
      } catch(e) {
        log(id, 'Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Generate Video';
      }
    }
    async function forceStatus(id, status) {
      log(id, 'Updating...');
      var res = await fetch(BASE_URL + '?action=forceStatus&memoryId=' + id + '&status=' + status);
      var data = await res.json();
      if (data.success) {
        log(id, 'Status set to ' + status);
        setTimeout(function() { location.reload(); }, 800);
      } else {
        log(id, 'Error: ' + (data.error || 'Failed'));
      }
    }
    async function init() {
      var memories = await loadMemories();
      var grid = document.getElementById('grid');
      if (!memories.length) { grid.textContent = 'No memories found.'; return; }
      grid.innerHTML = memories.map(renderMemory).join('');
    }
    init();
  </script>
</body>
</html>`;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (!action) {
    return new Response(HTML, { headers: { "Content-Type": "text/html" } });
  }

  try {
    if (action === "list") {
      const memories = await getMemories();
      return Response.json({ memories });
    }
    if (action === "generate") {
      const memoryId = url.searchParams.get("memoryId");
      if (!memoryId) return Response.json({ error: "Missing memoryId" }, { status: 400 });
      const result = await triggerVideoGeneration(memoryId);
      return Response.json(result);
    }
    if (action === "forceStatus") {
      const memoryId = url.searchParams.get("memoryId");
      const status = url.searchParams.get("status");
      if (!memoryId || !status) return Response.json({ error: "Missing params" }, { status: 400 });
      const result = await forceStatus(memoryId, status);
      return Response.json(result);
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});
