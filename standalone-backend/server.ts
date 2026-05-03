/**
 * REVISED BACKEND SERVER - VERSION 2.0 (MODIFIED BY AI AGENT)
 * ---------------------------------------------------------
 * This version uses local bundling for Remotion as recommended.
 * Port: 8080 (Vast.ai mapped)
 * Author: Mumantij AI Assistant
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import fs from "fs";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";

// Optional: Vercel Blob API (only if you fallback to blob links)
import { del } from "@vercel/blob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Initialize backend app
const app = express();
const PORT = process.env.PORT || 3000; 

// Debug logging for every request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({limit: "50mb"}));
app.use(express.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));

app.use("/temp", express.static(os.tmpdir()));

// Set the native ffmpeg binary path for fluent-ffmpeg
let validFfmpegPath = process.env.SYSTEM_FFMPEG_PATH || 'ffmpeg'; 
ffmpeg.setFfmpegPath(validFfmpegPath as string);
console.log(`[FFmpeg] Using binary at: ${validFfmpegPath}`);

// Configure Multer
const uploadDir = path.join(os.tmpdir(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ 
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 } 
});

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

async function ensureFont(fontName: string): Promise<string | null> {
  const fontsDir = path.join(os.tmpdir(), 'fonts');
  if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

  const normalizedKey = Object.keys(FONT_URLS).find(k => k.toLowerCase() === fontName.toLowerCase());
  const actualFontName = normalizedKey ? normalizedKey : 'DejaVu Sans';
  const url = FONT_URLS[actualFontName];
  const fontPath = path.join(fontsDir, `${actualFontName}_v2.ttf`);
  
  if (!fs.existsSync(fontPath)) {
     try {
       const response = await fetch(url);
       const buffer = await response.arrayBuffer();
       fs.writeFileSync(fontPath, Buffer.from(buffer));
     } catch (e) {}
  }
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
    if (job) await job().catch(console.error);
  }
  isQueueProcessing = false;
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", version: "v2-fixed" }));

app.get("/", (_req, res) => {
  res.send("Mumantij AI Backend Running (V2 Fixed)");
});

app.get("/api/download-export/:fileId", (req, res) => {
  const { fileId } = req.params;
  const filePath = path.join(os.tmpdir(), `out_${fileId}.mp4`);
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
  res.download(filePath, 'exported_video.mp4');
});

app.post("/api/export-video", upload.single('video'), async (req: any, res: any) => {
  const videoUrl = req.body.videoUrl || '';
  const uploadedFilePath = req.file?.path;
  const sessionId = uuidv4().substring(0, 8);
  
  res.json({ jobId: sessionId });

  jobQueue.push(async () => {
    exportJobs.set(sessionId, { status: 'processing' });
    let videoSource = uploadedFilePath || videoUrl;
    let outputPath = path.join(os.tmpdir(), `out_${sessionId}.mp4`);

    try {
        if (videoSource.startsWith('http')) {
           const dlRes = await fetch(videoSource);
           const arr = await dlRes.arrayBuffer();
           const dlPath = path.join(os.tmpdir(), `dl_${sessionId}.mp4`);
           fs.writeFileSync(dlPath, Buffer.from(arr));
           videoSource = dlPath;
        }

        const { captionsJson, styleOptions, videoWidth, videoHeight, duration } = req.body;
        const cJson = typeof captionsJson === 'string' ? JSON.parse(captionsJson) : captionsJson;
        const sOpts = typeof styleOptions === 'string' ? JSON.parse(styleOptions) : styleOptions;

        if (cJson && sOpts) {
            console.log("[Export] Starting Remotion render pipeline...");
            const { bundle } = await import('@remotion/bundler');
            const { renderMedia, selectComposition } = await import('@remotion/renderer');
            
            if (!globalCachedBundleLocation) {
                console.log("[Export] Creating fresh Remotion bundle...");
                globalCachedBundleLocation = await bundle({
                    entryPoint: path.join(__dirname, 'remotion', 'index.tsx'),
                    publicDir: path.join(__dirname, 'remotion', 'public'),
                });
            }
            
            // Use expert advice: prefer live URL if provided, otherwise local bundle
            const finalServeUrl = process.env.REMOTION_SERVE_URL || globalCachedBundleLocation;
            console.log(`[Export] Using serveUrl: ${finalServeUrl}`);

            const vW = Number(videoWidth) || 1080;
            const vH = Number(videoHeight) || 1920;
            const rawDuration = parseFloat(duration);
            const durationInFrames = Math.max(1, Math.ceil((isNaN(rawDuration) ? 10 : rawDuration) * 30));

            const inputProps = {
                videoUrl: videoSource, 
                captions: cJson,
                styleOptions: sOpts,
                videoWidth: vW,
                videoHeight: vH,
                durationInFrames
            };

            const composition = await selectComposition({
                serveUrl: finalServeUrl,
                id: 'Captions',
                inputProps
            });

            const tempVideoPath = outputPath.replace('.mp4', '_temp.mp4');
            await renderMedia({
                composition,
                serveUrl: finalServeUrl,
                codec: 'h264',
                outputLocation: tempVideoPath,
                inputProps,
                concurrency: os.cpus().length || 1,
                crf: 28,
                browserExecutable: process.env.CHROME_BIN || undefined,
                chromiumOptions: {
                    gl: 'swiftshader',
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
                }
            });

            // Mux audio
            await new Promise((resolve) => {
                ffmpeg()
                    .input(tempVideoPath)
                    .input(videoSource)
                    .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0?', '-shortest'])
                    .save(outputPath)
                    .on('end', resolve)
                    .on('error', (err) => {
                        console.error("[Export] Mux error:", err);
                        fs.renameSync(tempVideoPath, outputPath);
                        resolve(null);
                    });
            });
            try { fs.unlinkSync(tempVideoPath); } catch(e){}

            const downloadUrl = `/api/download-export/${sessionId}`;
            exportJobs.set(sessionId, { status: 'completed', downloadUrl });
        }
    } catch (err: any) {
        console.error("[Export Error]", err);
        exportJobs.set(sessionId, { status: 'failed', error: err.message });
    }
  });

  processQueue();
});

app.get("/api/export-status/:jobId", (req, res) => {
   const job = exportJobs.get(req.params.jobId);
   res.json(job || { error: "Not found" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend server listening on port ${PORT}`);
});
