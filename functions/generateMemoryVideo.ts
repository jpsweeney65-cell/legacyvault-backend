import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STABILITY_API_KEY = Deno.env.get('STABILITY_API_KEY');

async function generateVideoFromImage(imageUrl: string): Promise<ArrayBuffer> {
  // Fetch the image
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
  const imgBuffer = await imgResponse.arrayBuffer();
  const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';

  // Submit to Stability AI image-to-video
  const formData = new FormData();
  const blob = new Blob([imgBuffer], { type: contentType });
  formData.append('image', blob, 'image.jpg');
  formData.append('seed', '0');
  formData.append('cfg_scale', '1.8');
  formData.append('motion_bucket_id', '127');

  const submitRes = await fetch('https://api.stability.ai/v2beta/image-to-video', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${STABILITY_API_KEY}`,
    },
    body: formData,
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`Stability AI submit error (${submitRes.status}): ${err}`);
  }

  const { id: generationId } = await submitRes.json();

  // Poll for result (up to 3 minutes)
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));

    const pollRes = await fetch(
      `https://api.stability.ai/v2beta/image-to-video/result/${generationId}`,
      {
        headers: {
          'authorization': `Bearer ${STABILITY_API_KEY}`,
          'accept': 'video/*',
        },
      }
    );

    if (pollRes.status === 202) continue; // Still processing

    if (pollRes.ok) {
      return await pollRes.arrayBuffer();
    }

    throw new Error(`Stability AI poll error (${pollRes.status}): ${await pollRes.text()}`);
  }

  throw new Error('Video generation timed out after 3 minutes');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { memoryId } = body;

    if (!memoryId) {
      return Response.json({ error: 'memoryId is required' }, { status: 400 });
    }

    if (!STABILITY_API_KEY) {
      return Response.json({ error: 'STABILITY_API_KEY not configured' }, { status: 500 });
    }

    // Fetch the memory record
    const memory = await base44.entities.Memory.get(memoryId);
    if (!memory) {
      return Response.json({ error: 'Memory not found' }, { status: 404 });
    }

    const photos: string[] = memory.photos || [];
    if (photos.length === 0) {
      return Response.json({ error: 'No photos found in this memory' }, { status: 400 });
    }

    // Mark as processing
    await base44.entities.Memory.update(memoryId, {
      generation_status: 'processing',
      video_url: null,
    });

    // Generate video from first (hero) photo
    const heroPhoto = photos[0];
    let videoBuffer: ArrayBuffer;

    try {
      videoBuffer = await generateVideoFromImage(heroPhoto);
    } catch (err) {
      await base44.entities.Memory.update(memoryId, { generation_status: 'failed' });
      return Response.json({ error: `Video generation failed: ${err.message}` }, { status: 500 });
    }

    // Upload the video as a public file via Base44 storage API
    const appId = Deno.env.get('BASE44_APP_ID');
    const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });
    const uploadForm = new FormData();
    uploadForm.append('file', videoBlob, `memory_${memoryId}.mp4`);

    // Use Base44 file upload API
    const uploadRes = await fetch(
      `https://base44.app/api/apps/${appId}/files/public`,
      {
        method: 'POST',
        headers: {
          'Authorization': req.headers.get('Authorization') || '',
        },
        body: uploadForm,
      }
    );

    let videoUrl: string;
    if (uploadRes.ok) {
      const uploadData = await uploadRes.json();
      videoUrl = uploadData.url || uploadData.file_url || uploadData.public_url;
    } else {
      // Fallback: store as base64 data URL
      const bytes = new Uint8Array(videoBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      videoUrl = `data:video/mp4;base64,${btoa(binary)}`;
    }

    // Save back to memory
    await base44.entities.Memory.update(memoryId, {
      generation_status: 'completed',
      video_url: videoUrl,
    });

    return Response.json({
      ok: true,
      memoryId,
      message: 'Video generated and saved successfully',
      video_url: videoUrl,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
