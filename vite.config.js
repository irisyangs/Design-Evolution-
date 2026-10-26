import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fal } from '@fal-ai/client';
import { loadEnv } from 'vite';

const appBase = '/Design-Evolution-/';
const fluxEndpoint = `${appBase}api/flux-render`;

function fluxRenderApi() {
  return {
    name: 'flux-render-api',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      const key = env.FLUX_API_KEY;
      server.middlewares.use(fluxEndpoint, async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        if (!key) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'FLUX_API_KEY is missing from .env.' }));
          return;
        }
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 12_000_000) throw new Error('Sketch image is too large.');
          }
          const { image, prompt, rendererId } = JSON.parse(body);
          const match = typeof image === 'string' && image.match(/^data:image\/(png|jpeg);base64,([\s\S]+)$/);
          const modelId = rendererId === 'trellis'
            ? 'fal-ai/trellis'
            : rendererId === 'tripo-api'
              ? 'tripo3d/tripo/v2.5/image-to-3d'
              : rendererId === 'meshy-text'
                ? 'meshy/v7.1/text-to-3d'
                : rendererId === 'hunyuan3d'
                  ? 'fal-ai/hunyuan-3d/v3.1/pro/image-to-3d'
              : rendererId === 'flux-kontext'
                ? 'fal-ai/flux-pro/kontext/max/multi'
                : null;
          const validPrompt = typeof prompt === 'string' && prompt.trim().length > 0;
          if (!modelId || (rendererId === 'meshy-text' && (!validPrompt || prompt.length > 600)) ||
            (rendererId !== 'meshy-text' && !match) || (rendererId === 'flux-kontext' && !validPrompt)) {
            throw new Error('A sketch and supported fal renderer are required.');
          }
          fal.config({ credentials: key });
          const bytes = match ? Buffer.from(match[2], 'base64') : null;
          const output = await fal.subscribe(modelId, {
            input: {
              ...(rendererId === 'meshy-text' ? { prompt } : rendererId === 'hunyuan3d'
                ? { input_image_url: image }
                : rendererId === 'flux-kontext'
                  ? { prompt, image_urls: [image], output_format: 'png' }
                  : {
                image_url: new Blob([bytes], { type: `image/${match[1]}` }),
              }),
            },
            ...(rendererId === 'tripo-api' || rendererId === 'meshy-text' || rendererId === 'flux-kontext' || rendererId === 'hunyuan3d' ? {
              logs: true,
              onQueueUpdate: (update) => {
                if (update.status === 'IN_PROGRESS') {
                  const rendererName = rendererId === 'meshy-text' ? 'Meshy' : rendererId === 'tripo-api' ? 'Tripo' : rendererId === 'hunyuan3d' ? 'Hunyuan' : 'FLUX Kontext Max';
                  update.logs?.map((log) => log.message).forEach((message) => console.log(`[fal ${rendererName}] ${message}`));
                }
              },
            } : {}),
          });
          const result = rendererId === 'trellis'
            ? { url: output.data?.model_mesh?.url, filename: output.data?.model_mesh?.file_name }
            : rendererId === 'meshy-text'
              ? {
                url: output.data?.model_glb?.url || output.data?.model_urls?.glb?.url,
                previewUrl: output.data?.thumbnail?.url,
                filename: output.data?.model_glb?.file_name || 'meshy-model.glb',
              }
            : rendererId === 'hunyuan3d'
              ? {
                url: output.data?.model_glb?.url || output.data?.model_urls?.glb?.url,
                previewUrl: output.data?.thumbnail?.url,
                filename: output.data?.model_glb?.file_name || 'hunyuan-model.glb',
              }
            : rendererId === 'tripo-api'
              ? {
                url: output.data?.model_mesh?.url || output.data?.pbr_model?.url || output.data?.base_model?.url,
                previewUrl: output.data?.rendered_image?.url,
                filename: output.data?.model_mesh?.file_name || 'tripo-model.glb',
              }
              : { url: output.data?.images?.[0]?.url };
          if (!result.url) {
            const rendererName = rendererId === 'trellis' ? 'Trellis' : rendererId === 'tripo-api' ? 'Tripo' : rendererId === 'hunyuan3d' ? 'Hunyuan' : 'FLUX';
            throw new Error(`${rendererName} did not return an output file.`);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ...result, kind: rendererId === 'flux-kontext' ? 'image' : 'model' }));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message || 'FLUX rendering failed.' }));
        }
      });

    },
  };
}

export default defineConfig({
  plugins: [react(), fluxRenderApi()],
  base: appBase,
});