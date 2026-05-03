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
let validFfmpegPath = process.env.SYSTEM_FFMPEG_PATH || 'ffmpeg'; // Defaulting to system ffmpeg for h264_nvenc
ffmpeg.setFfmpegPath(validFfmpegPath as string);
console.log(`[FFmpeg] Using binary at: ${validFfmpegPath}`);

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

const jobQueue: (() => Promise<void>)[] = [];
let isQueueProcessing = false;
let globalCachedBundleLocation: string | null = null;

async function processQueue() {
  if (isQueueProcessing) return;
  isQueueProcessing = true;
  while (jobQueue.length > 0) {
    const job = jobQueue.shift();
    if (job) {
      try {
        await job();
      } catch (err) {
        console.error("[Queue] Job failed", err);
      }
    }
  }
  isQueueProcessing = false;
}

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

app.post("/api/export-video", upload.single('videoFile'), async (req: any, res: any) => {
  const videoUrl = req.body.videoUrl || '';
  const uploadedFilePath = req.file?.path;
  
  const { srtContent, assStyle, originalName, videoWidth, videoHeight, aspectRatio, captionsJson } = req.body;
  const isAss = String(req.body.isAss) === 'true';
  
  const safeOriginalName = (originalName || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
  console.log(`[Export Pipeline] Received job for: ${safeOriginalName}`);
  
  if (!videoUrl && !uploadedFilePath) {
    return res.status(400).json({ error: "No video provided." });
  }
  
  // We prioritize JSON-based captions for WYSIWYG
  if (!captionsJson && !srtContent) {
     return res.status(400).json({ error: "Missing captions data." });
  }

  if (jobQueue.length >= 30) {
     return res.status(429).json({ error: "Server is currently at maximum capacity. Please try again in a few minutes." });
  }

  const sessionId = uuidv4().substring(0, 8);
  let videoSource = uploadedFilePath || videoUrl;
  
  exportJobs.set(sessionId, { status: 'pending' });
  res.json({ jobId: sessionId });

  jobQueue.push(async () => {
    exportJobs.set(sessionId, { status: 'processing' });
    let srtFileName: string | undefined;
    let outputPath: string | undefined;
    let downloadedVideoPath: string | undefined;
    
    try {
        // 1. Resolve Video Source (Download if URL to avoid FFmpeg TLS/Timeout issues)
        if (videoSource.startsWith('http')) {
           console.log(`[Export Background] Downloading video from URL: ${videoSource}`);
           const dlRes = await fetch(videoSource);
           if (!dlRes.ok) throw new Error('Failed to download video from URL');
           const arr = await dlRes.arrayBuffer();
           downloadedVideoPath = path.join(os.tmpdir(), `dl_${sessionId}.mp4`);
           fs.writeFileSync(downloadedVideoPath, Buffer.from(arr));
           videoSource = downloadedVideoPath;
        }

        const tempDir = os.tmpdir();
        outputPath = path.join(tempDir, `out_${sessionId}.mp4`);
        
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

        let captionsParams: any = null;
        let styleOptionsParsed: any = null;
        
        try {
            captionsParams = typeof req.body.captionsJson === 'string' ? JSON.parse(req.body.captionsJson) : req.body.captionsJson;
            styleOptionsParsed = typeof req.body.styleOptions === 'string' ? JSON.parse(req.body.styleOptions) : req.body.styleOptions;
        } catch (e) {
            console.error("[Export] Failed to parse JSON params:", e);
        }

        // If we have JSON, we use Remotion for the high-quality WYSIWYG experience
        if (captionsParams && styleOptionsParsed) {
            console.log("[Export] Using Remotion rendering for WYSIWYG...");
            const { bundle } = await import('@remotion/bundler');
            const { renderMedia, selectComposition } = await import('@remotion/renderer');
            
            if (!globalCachedBundleLocation) {
                console.log("[Export] Bundling Remotion project...");
                globalCachedBundleLocation = await bundle({
                    entryPoint: path.join(__dirname, 'remotion', 'index.tsx')
                });
                
                // Serve the bundle on a dedicated, high port static server
                // This ensures all absolute paths (like `/bundle.js`) resolve correctly for Remotion's Puppeteer.
                const bundleApp = express();
                bundleApp.use(cors());
                bundleApp.use(express.static(globalCachedBundleLocation));
                await new Promise<void>((resolve) => {
                   bundleApp.listen(39485, '127.0.0.1', () => {
                      console.log("[Export] Remotion bundle static server running on port 39485");
                      resolve();
                   });
                });
            }
            const bundleLocation = `http://127.0.0.1:39485`;

            const relativePath = path.relative(os.tmpdir(), videoSource);
            // Provide a local URL for the headless browser to fetch the video file
            const localVideoUrl = `http://127.0.0.1:${PORT}/temp/${relativePath.replace(/\\/g, '/')}`;

            console.log(`[Export] Internal Video URL: ${localVideoUrl}`);

            const rawDuration = parseFloat(req.body.duration);
            const validDuration = (isNaN(rawDuration) || rawDuration <= 0) ? 10 : rawDuration;
            const durationInFrames = Math.max(1, Math.ceil(validDuration * 30));

            const inputProps = {
                videoUrl: localVideoUrl,
                captions: captionsParams,
                styleOptions: styleOptionsParsed,
                videoWidth: Number(targetW),
                videoHeight: Number(targetH),
                durationInFrames: Number(durationInFrames)
            };

            const composition = await selectComposition({
                serveUrl: bundleLocation,
                id: 'Captions',
                inputProps
            });

            const tempVideoPath = outputPath.replace('.mp4', '_temp.mp4');
            await renderMedia({
                composition,
                serveUrl: bundleLocation,
                codec: 'h264',
                outputLocation: tempVideoPath,
                inputProps,
                concurrency: os.cpus().length || null,
                crf: 24, // High quality
                imageFormat: 'jpeg',
                jpegQuality: 85,
                chromiumOptions: {
                    gl: 'swiftshader',
                    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-web-security"]
                }
            });
            
            console.log("[Export] Remotion rendering success. Muxing original audio...");
            
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(tempVideoPath)
                    .input(videoSource)
                    .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0?', '-shortest'])
                    .save(outputPath)
                    .on('end', () => {
                        try { fs.unlinkSync(tempVideoPath); } catch(e) {}
                        resolve(null);
                    })
                    .on('error', (err) => {
                        console.error("[Export] Muxing error, outputting video only:", err);
                        try { fs.renameSync(tempVideoPath, outputPath); } catch(e) {}
                        resolve(null);
                    });
            });
        } else {
            // FFmpeg Fallback (only used if JSON is missing but SRT exists)
            console.log("[Export] Using FFmpeg fallback rendering (SRT/ASS)...");
            
            const isAss = String(req.body.isAss) === 'true';
            const ext = isAss ? '.ass' : '.srt';
            srtFileName = path.join(tempDir, `subs_${sessionId}${ext}`);
            fs.writeFileSync(srtFileName, srtContent);

            let requestedFont = 'DejaVu Sans';
            if (isAss) {
              const match = srtContent.match(/Style:\s*[^,]+,([^,]+)/);
              if (match) requestedFont = match[1];
            } else {
              const match = (assStyle || srtContent).match(/Fontname=([^,]+)/);
              if (match) requestedFont = match[1];
            }
            
            const fontsDir = await ensureFont(requestedFont);
            const scaleFilter = `scale=${targetW}:${targetH}:flags=fast_bilinear`;
            const escapedSrtPath = srtFileName.replace(/\\/g, '/').replace(/'/g, "'\\''");
            const escapedFontsDir = fontsDir?.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\\\:') || '';
            
            let subtitleFilter = '';
            if (isAss) {
                subtitleFilter = `subtitles='${escapedSrtPath}':fontsdir='${escapedFontsDir}'`;
            } else {
                let cleanStyle = assStyle ? assStyle.trim().replace(/,$/, '') : '';
                if (!cleanStyle.includes("Fontname=")) cleanStyle = `Fontname='${requestedFont}',` + cleanStyle;
                subtitleFilter = `subtitles='${escapedSrtPath}':fontsdir='${escapedFontsDir}':force_style='${cleanStyle}'`;
            }

            const args = [
                '-y', '-i', videoSource,
                '-vf', `${scaleFilter},${subtitleFilter}`,
                '-c:v', 'h264_nvenc', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-b:v', '6M',
                '-c:a', 'copy', '-movflags', '+faststart', outputPath
            ];

            await new Promise<void>((resolve, reject) => {
                const ffmpegProcess = spawn(validFfmpegPath as string, args);
                ffmpegProcess.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg error code ${code}`)));
                ffmpegProcess.on('error', (err) => reject(err));
            });
        }

      const downloadUrl = `/api/download-export/${sessionId}?name=captioned_${encodeURIComponent(safeOriginalName)}`;
      exportJobs.set(sessionId, { status: 'completed', downloadUrl });

    } catch (err: any) {
      console.error(`[Export Background] Fatal Error for ${sessionId}:`, err);
      exportJobs.set(sessionId, { status: 'failed', error: err.message || "Video processing failed." });
    } finally {
      setTimeout(() => {
        try {
          if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          exportJobs.delete(sessionId);
        } catch (e) {}
      }, 30 * 60 * 1000);

      [uploadedFilePath, srtFileName, downloadedVideoPath].forEach(p => {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch(e){}
      });
      
      // Cleanup Vercel Blob if used
      if (videoUrl && process.env.BLOB_READ_WRITE_TOKEN) {
          await del(videoUrl, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => {});
      }
    }
  });

  processQueue();
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
