import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import fs from "fs";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";

import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// Optional: Vercel Blob API (only if you fallback to blob links)
import { del } from "@vercel/blob";

dotenv.config();

// Initialize backend app
const app = express();
const PORT = process.env.PORT || 3000; // Match Docker Compose mapping

// Debug logging for every request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Cache-Control']
}));
app.use(express.json({limit: "50mb"}));
app.use(express.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));
app.use(express.text({ limit: '200mb' }));

app.use("/temp", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
}, express.static(os.tmpdir()));

// Set the native ffmpeg binary path for fluent-ffmpeg
let validFfmpegPath = ffmpegStatic;
if (!validFfmpegPath) {
  console.warn("ffmpegStatic returned null, fallback via import not trivial");
}
ffmpeg.setFfmpegPath(validFfmpegPath as string);
console.log(`[FFmpeg] Using native binary at: ${validFfmpegPath}`);

// Configure Multer for processing incoming video uploads directly to disk temporary storage
const uploadDir = path.join(os.tmpdir(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ 
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max limit to cover raw 4K mobile video inputs
});

// Font Manager
const FONT_URLS: Record<string, string> = {
  'Janna LT': 'https://hjrm8lbtnby37npy.public.blob.vercel-storage.com/Janna%20LT%20Regular.ttf',
  'Cairo': 'https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt%2Cwght%5D.ttf',
  'Tajawal': 'https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/Tajawal-Bold.ttf',
  'Amiri': 'https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Bold.ttf',
  'IBM Plex Sans Arabic': 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf',
  'DejaVu Sans': 'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf',
  'Roboto': 'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf',
  'Noto Sans Arabic': 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/NotoSansArabic%5Bwdth%2Cwght%5D.ttf',
  'Noto Sans JP': 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf',
  'Noto Sans SC': 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'
};

async function downloadFont(fontName: string, url: string, fontsDir: string) {
  const fontPath = path.join(fontsDir, `${fontName}_v2.ttf`);
  if (fs.existsSync(fontPath)) return;
  try {
    console.log(`[Font Installer] Downloading font: ${fontName} from ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Font download failed: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(fontPath, Buffer.from(buffer));
    console.log(`[Font Installer] Font ${fontName} installed at: ${fontPath}`);
  } catch (err) {
    console.error(`[Font Installer] Failed to download font ${fontName}:`, err);
  }
}

async function ensureFont(fontName: string): Promise<string | null> {
  console.log(`[Font Installer] Ensure font called with: '${fontName}'`);
  const fontsDir = path.join(os.tmpdir(), 'fonts');
  if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

  const normalizedKey = Object.keys(FONT_URLS).find(k => k.toLowerCase() === fontName.toLowerCase());
  const actualFontName = normalizedKey ? normalizedKey : 'DejaVu Sans';
  
  await downloadFont(actualFontName, FONT_URLS[actualFontName], fontsDir);
  return fontsDir;
}

const exportJobs = new Map<string, { status: string; progress?: number; downloadUrl?: string; error?: string }>();

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/", (_req, res) => {
  res.send(`
    <html>
      <head><title>Mumantij AI Backend</title></head>
      <body>
        <h1>Mumantij AI Backend is Running</h1>
        <p>Status: Healthy</p>
        <p>Endpoint: <code>/api/export-video</code></p>
      </body>
    </html>
  `);
});

app.get("/api/download-export/:fileId", (req, res) => {
  const { fileId } = req.params;
  const { name } = req.query;
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `out_${fileId}.mp4`);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found or expired. Please export again.");
  }

  const downloadName = name ? String(name) : 'exported_video.mp4';
  res.setHeader('Content-Type', 'video/mp4');
  res.download(filePath, downloadName);
});

app.post("/api/export-video", upload.single('video'), async (req: any, res: any) => {
  const videoUrl = req.body.videoUrl || '';
  const uploadedFilePath = req.file?.path;
  
  const { srtContent, assStyle, originalName, videoWidth, videoHeight, aspectRatio } = req.body;
  const isAss = String(req.body.isAss) === 'true';
  
  const safeOriginalName = (originalName || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
  console.log(`[Export Pipeline] Received job for: ${safeOriginalName}`);
  
  if (!videoUrl && !uploadedFilePath) {
    return res.status(400).json({ error: "No video provided." });
  }
  
  if (!srtContent) {
     return res.status(400).json({ error: "Missing subtitle parameters." });
  }

  const sessionId = uuidv4().substring(0, 8);
  let videoSource = uploadedFilePath || videoUrl;
  
  exportJobs.set(sessionId, { status: 'processing' });
  res.json({ jobId: sessionId });

  (async () => {
    let srtFileName: string | undefined;
    let outputPath: string | undefined;
    let downloadedVideoPath: string | undefined;
    
    try {
        if (videoSource.startsWith('http')) {
           console.log(`[Export Background] Downloading video from URL to avoid FFmpeg TLS issues...`);
           const dlRes = await fetch(videoSource);
           if (!dlRes.ok) throw new Error('Failed to download video from URL');
           const arr = await dlRes.arrayBuffer();
           downloadedVideoPath = path.join(os.tmpdir(), `dl_${sessionId}.mp4`);
           fs.writeFileSync(downloadedVideoPath, Buffer.from(arr));
           videoSource = downloadedVideoPath;
        }
        let requestedFont = null;
        if (isAss) {
          const match = srtContent.match(/Style:\s*[^,]+,([^,]+)/);
          requestedFont = match ? match[1] : null;
        } else {
          const match = (assStyle || srtContent).match(/Fontname=([^,]+)/);
          requestedFont = match ? match[1] : null;
        }

        const tempDir = os.tmpdir();
        const ext = isAss ? '.ass' : '.srt';
        srtFileName = path.join(tempDir, `subs_${sessionId}${ext}`);
        outputPath = path.join(tempDir, `out_${sessionId}.mp4`);
        
        const fontsDir = await ensureFont(requestedFont || 'DejaVu Sans');
        fs.writeFileSync(srtFileName, srtContent);

        const vW = parseInt(videoWidth || '1080') || 1080;
        const vH = parseInt(videoHeight || '1920') || 1920;

        let targetW = vW;
        let targetH = vH;
        const maxDimension = 1920;
        
        if (targetW > maxDimension || targetH > maxDimension) {
          const scale = maxDimension / Math.max(targetW, targetH);
          targetW = Math.round(targetW * scale);
          targetH = Math.round(targetH * scale);
        }

        targetW = Math.max(2, Math.floor(targetW / 2) * 2);
        targetH = Math.max(2, Math.floor(targetH / 2) * 2);

        let captionsJson: any = null;
        let styleOptionsParsed: any = null;
        try {
            if (req.body.captionsJson) captionsJson = typeof req.body.captionsJson === 'string' ? JSON.parse(req.body.captionsJson) : req.body.captionsJson;
            if (req.body.styleOptions) styleOptionsParsed = typeof req.body.styleOptions === 'string' ? JSON.parse(req.body.styleOptions) : req.body.styleOptions;
        } catch (e) {}

        if (captionsJson && styleOptionsParsed) {
            console.log("[Export] Using Remotion rendering...");
            const { bundle } = await import('@remotion/bundler');
            const { renderMedia, selectComposition } = await import('@remotion/renderer');
            
            const bundleLocation = await bundle({
                entryPoint: path.join(__dirname, 'remotion', 'index.tsx')
            });

            const videoBasename = path.basename(videoSource);
            const relativePath = path.relative(os.tmpdir(), videoSource);
            const localVideoUrl = `http://127.0.0.1:${PORT}/temp/${relativePath.replace(/\\/g, '/')}`;

            console.log(`[Export] Local Video URL for Remotion: ${localVideoUrl}`);

            // Ensure duration is a valid positive number
            const rawDuration = parseFloat(req.body.duration);
            const validDuration = (isNaN(rawDuration) || rawDuration <= 0) ? 10 : rawDuration;
            const durationInFrames = Math.max(1, Math.ceil(validDuration * 30));

            const inputProps = {
                videoUrl: videoSource.startsWith('http') ? videoSource : localVideoUrl,
                captions: captionsJson,
                styleOptions: styleOptionsParsed,
                videoWidth: Number(targetW),
                videoHeight: Number(targetH),
                durationInFrames: Number(durationInFrames)
            };

            console.log(`[Export] Final Render Config: w=${targetW}, h=${targetH}, frames=${durationInFrames}`);

            try {
                const composition = await selectComposition({
                    serveUrl: bundleLocation,
                    id: 'Captions',
                    inputProps
                });

                // Override the default duration and dimensions with the dynamic ones from the video
                composition.durationInFrames = Number(durationInFrames);
                composition.width = Number(targetW);
                composition.height = Number(targetH);

                const tempVideoPath = outputPath.replace('.mp4', '_temp.mp4');
                await renderMedia({
                    composition,
                    serveUrl: bundleLocation,
                    codec: 'h264',
                    outputLocation: tempVideoPath,
                    inputProps,
                    concurrency: os.cpus().length || null,
                    crf: 28, // higher crf = much faster, 28 is visually fine for social media
                    imageFormat: 'jpeg',
                    jpegQuality: 80,
                    chromiumOptions: {
                       gl: 'swiftshader', // angle may fail or hang if there's no GPU at all on the VPS. swiftshader is robust CPU renderer.
                       args: [
                           "--no-sandbox", 
                           "--disable-setuid-sandbox",
                           "--allow-file-access-from-files",
                           "--disable-web-security",
                           "--disable-gpu"
                       ]
                    } as any
                });
                console.log("[Export] Remotion rendering completed (video only). Muxing audio...");
                
                await new Promise((resolve, reject) => {
                    ffmpeg()
                        .input(tempVideoPath)
                        .input(videoSource)
                        .outputOptions([
                            '-c:v copy',
                            '-c:a aac',
                            '-map 0:v:0',
                            '-map 1:a:0?',
                            '-shortest'
                        ])
                        .save(outputPath)
                        .on('end', () => {
                            try { fs.unlinkSync(tempVideoPath); } catch(e) {}
                            resolve(null);
                        })
                        .on('error', (err) => {
                            console.error("[Export] Muxing error, falling back to video only:", err);
                            try { fs.renameSync(tempVideoPath, outputPath); } catch(e) {}
                            resolve(null);
                        });
                });
            } catch (renderErr: any) {
                console.error("[Export] Remotion renderMedia error:", renderErr);
                throw new Error(`Remotion Engine Error: ${renderErr.message || renderErr}`);
            }
        } else {
            console.log("[Export Background] Using FFmpeg fallback rendering...");
            const scaleFilter = `scale=${targetW}:${targetH}:flags=fast_bilinear`;
            let fontName = requestedFont || 'DejaVu Sans';

            const escapedSrtPath = srtFileName.replace(/\\/g, '/').replace(/'/g, "'\\''");
            let cleanStyle = assStyle ? assStyle.trim().replace(/,$/, '') : '';
            
            if (!cleanStyle.includes("Fontname=")) {
                cleanStyle = `Fontname='${fontName}',` + cleanStyle;
            } else {
                cleanStyle = cleanStyle.replace(/Fontname=[^,]+/, `Fontname='${fontName}'`);
            }
            
            const escapedFontsDir = fontsDir.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\\\:');
            
            let subtitleFilter = '';
            if (isAss) {
            subtitleFilter = `subtitles='${escapedSrtPath}':fontsdir='${escapedFontsDir}'`;
            } else {
            subtitleFilter = `subtitles='${escapedSrtPath}':fontsdir='${escapedFontsDir}':force_style='${cleanStyle}'`;
            }
            
            const filterStr = `${scaleFilter},${subtitleFilter}`;
            console.log(`[Export Background] Starting FFmpeg Filter: ${filterStr}`);

            const args = [
            '-y',
            '-i', videoSource,
            '-vf', filterStr,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-profile:v', 'main',
            '-level', '3.1',
            '-pix_fmt', 'yuv420p',
            '-crf', '24',
            '-c:a', 'copy',
            '-threads', '0',
            '-movflags', '+faststart',
            outputPath
            ];

            await new Promise<void>((resolve, reject) => {
            const ffmpegProcess = spawn(validFfmpegPath as string, args);
            let errorOutput = '';
            ffmpegProcess.stderr.on('data', (data) => {
                console.log(`[FFmpeg stderr]: ${data.toString()}`);
                errorOutput += data.toString();
            });
            ffmpegProcess.stdout.on('data', (data) => {
                console.log(`[FFmpeg stdout]: ${data.toString()}`);
            });
            ffmpegProcess.on('close', (code, signal) => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg exited with code ${code}, signal: ${signal}, stderr: ${errorOutput}`));
            });
            ffmpegProcess.on('error', (err: Error) => {
                reject(new Error(`FFmpeg spawn failed: ${err.message}`));
            });
            });
        }

      // Provide complete backend URL for download
      const downloadUrl = `/api/download-export/${sessionId}?name=captioned_${encodeURIComponent(safeOriginalName)}`;
      exportJobs.set(sessionId, { status: 'completed', downloadUrl });

      setTimeout(() => {
        try {
          if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          exportJobs.delete(sessionId);
        } catch (e) {}
      }, 30 * 60 * 1000);

    } catch (err: any) {
      console.error(`[Export Background] Fatal Error for ${sessionId}:`, err);
      exportJobs.set(sessionId, { status: 'failed', error: err.message || "Video processing failed." });
    } finally {
      [uploadedFilePath, srtFileName, downloadedVideoPath].forEach(p => {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch(e){}
      });
      // Try to clean up vercel blob if we used it (graceful fail)
      if (videoUrl) await del(videoUrl).catch(() => {});
    }
  })();
});

app.get("/api/export-status/:jobId", async (req: any, res: any) => {
   const { jobId } = req.params;
   const job = exportJobs.get(jobId);
   if (job) return res.json(job);
   res.status(404).json({ error: "Job not found or expired" });
});

app.listen(PORT as number, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
