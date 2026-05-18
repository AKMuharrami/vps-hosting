import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import http from "http";
import https from "https";

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
const EXPRESS_PORT = process.env.PORT || "3005";

console.log(`[Init] Starting backend on port: ${EXPRESS_PORT}`);
console.log(`[System] CPU Cores: ${os.cpus().length}`);
console.log(`[System] Total Memory: ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(2)} GB`);
console.log(`[Hardware] GPU Count Mode: ${process.env.GPU_COUNT || 1}`);
console.log(`[Hardware] Max Concurrent Jobs: ${process.env.MAX_CONCURRENT_JOBS || 4}`);
if (EXPRESS_PORT === "3000") {
  console.warn("[Init] WARNING: Running on port 3000 might conflict with Remotion's internal browser server.");
}

// Prevent proxy loops if VAST_AI_URL is misconfigured to point to itself
const isProxyMode = !!(process.env.VAST_AI_URL && 
                   !process.env.VAST_AI_URL.includes("localhost") && 
                   !process.env.VAST_AI_URL.includes("127.0.0.1"));

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

if (isProxyMode) {
  const vastUrl = process.env.VAST_AI_URL.replace(/\/$/, "");
  console.log(`[Proxy] VAST_AI_URL configured: ${vastUrl}. Acting as Middleman proxy.`);
  
  const proxyToVast = (req: any, res: any) => {
    const targetUrl = new URL(req.originalUrl || req.url, vastUrl);
    console.log(`[Proxy] Forwarding ${req.method} ${req.originalUrl || req.url} to ${targetUrl.toString()}`);
    
    const reqFn = targetUrl.protocol === 'https:' ? https.request : http.request;
    
    // For proxying, we might still want to call 3000 on the worker if the worker doesn't have Nginx
    // but the worker app will now be on 3005. So we use the targetUrl provided by VAST_AI_URL.
    
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: { ...req.headers },
    };
    
    delete options.headers.host;
    // Remove connection headers to avoid keep-alive issues
    delete options.headers.connection;
    
    const proxyReq = reqFn(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });
    
    // Set a long timeout for video processing (10 minutes)
    proxyReq.setTimeout(600000, () => {
      console.error(`[Proxy] Request to Vast AI timed out after 10 minutes`);
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: "Gateway Timeout - Video processing took too long on worker." });
      }
    });

    proxyReq.on('error', (err) => {
      console.error(`[Proxy] Error forwarding to Vast AI: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ error: "Bad Gateway - Vast AI worker unreachable." });
      }
    });
    
    req.pipe(proxyReq, { end: true });
  };

  app.use('/api/export-video', proxyToVast);
  app.use('/api/export-status', proxyToVast);
  app.use('/api/download-export', proxyToVast);
}

app.use(express.json({limit: "50mb"}));
app.use(express.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));
app.use(express.text({ limit: '200mb' }));

app.use("/temp", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
}, express.static(os.tmpdir()));

app.use("/fonts", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
}, express.static(path.join(os.tmpdir(), "fonts")));

// Static route to serve Remotion bundle
app.get("/", (req, res, next) => {
  if (globalCachedBundleLocation) {
    return express.static(globalCachedBundleLocation)(req, res, next);
  }
  res.send("<h1>Mumantij-ai Video Worker is Running! gpu is ready!</h1>");
});

// Set the native ffmpeg binary path for fluent-ffmpeg
let validFfmpegPath = process.env.SYSTEM_FFMPEG_PATH || 'ffmpeg'; // Defaulting to system ffmpeg for h264_nvenc
ffmpeg.setFfmpegPath(validFfmpegPath as string);
console.log(`[FFmpeg] Using binary at: ${validFfmpegPath}`);

// --- NVENC WRAPPER SCRIPT INITIALIZATION ---
// This is generated once at boot to be thread safe and support global GPU round robin logic across Remotion rendering jobs securely
const wrapperPath = path.join(os.tmpdir(), "ffmpeg_nvenc_wrapper.sh");
process.env.REMOTION_FFMPEG_EXECUTABLE = wrapperPath;

const wrapperScript = `#!/bin/bash
GPU_COUNT=${process.env.GPU_COUNT || 1}
GPU_INDEX=0

if [ "$GPU_COUNT" -gt 1 ]; then
    COUNTER_FILE="/tmp/gpu_counter.txt"
    touch $COUNTER_FILE
    (
        flock -x 200
        COUNT=$(cat $COUNTER_FILE)
        COUNT=\${COUNT:-0}
        GPU_INDEX=$((COUNT % GPU_COUNT))
        echo $((COUNT + 1)) > $COUNTER_FILE
    ) 200>/tmp/gpu_counter.lock
fi

ARGS_NVENC=()
SKIP_NEXT=0
for arg in "$@"; do
    if [ "$SKIP_NEXT" = "1" ]; then
        SKIP_NEXT=0
        continue
    fi
    if [ "$arg" = "libx264" ]; then
        ARGS_NVENC+=("h264_nvenc")
        ARGS_NVENC+=("-gpu" "$GPU_INDEX")
        ARGS_NVENC+=("-preset" "p6")
        ARGS_NVENC+=("-tune" "hq")
        ARGS_NVENC+=("-spatial-aq" "1")
        ARGS_NVENC+=("-temporal-aq" "1")
    elif [ "$arg" = "-preset" ]; then
        SKIP_NEXT=1
    elif [ "$arg" = "-crf" ]; then
        ARGS_NVENC+=("-cq")
    else
        ARGS_NVENC+=("$arg")
    fi
done

echo "[Wrapper] Trying NVENC on GPU $GPU_INDEX..." >&2
\${SYSTEM_FFMPEG_PATH:-ffmpeg} "\${ARGS_NVENC[@]}"
if [ $? -ne 0 ]; then
    echo "[Wrapper] NVENC failed. Falling back to CPU ultrafast." >&2
    ARGS_CPU=()
    SKIP_NEXT=0
    for arg in "$@"; do
        if [ "$SKIP_NEXT" = "1" ]; then
            SKIP_NEXT=0
            continue
        fi
        if [ "$arg" = "-preset" ]; then
            ARGS_CPU+=("-preset")
            ARGS_CPU+=("ultrafast")
            SKIP_NEXT=1
        else
            ARGS_CPU+=("$arg")
        fi
    done
    exec \${SYSTEM_FFMPEG_PATH:-ffmpeg} "\${ARGS_CPU[@]}"
fi
`;
fs.writeFileSync(wrapperPath, wrapperScript);
fs.chmodSync(wrapperPath, 0o755);
// --------------------------------------------

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
const MAX_CONCURRENT_JOBS = process.env.MAX_CONCURRENT_JOBS ? parseInt(process.env.MAX_CONCURRENT_JOBS) : 4;
let activeJobs = 0;
let globalGpuIndexCounter = 0;
let globalCachedBundleLocation: string | null = null;
let globalBundlePromise: Promise<string> | null = null;

async function processQueue() {
  while (jobQueue.length > 0 && activeJobs < MAX_CONCURRENT_JOBS) {
    const job = jobQueue.shift();
    if (job) {
      activeJobs++;
      // Run the job asynchronously without blocking the loop
      job()
        .catch(err => console.error("[Queue] Job failed", err))
        .finally(() => {
          activeJobs--;
          processQueue(); // Prompt the queue to process next item
        });
    }
  }
}

app.get("/api/health", (_req, res) => res.json({ 
  status: "ok", 
  version: "1.0.7-gpu-fix",
  port: EXPRESS_PORT,
  mode: isProxyMode ? "Middleman Proxy" : "GPU Worker"
}));

app.get("/api-status", (_req, res) => {
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

  if (jobQueue.length >= 2000) {
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
        let captionPositionParsed: any = null;
        
        try {
            captionsParams = typeof req.body.captionsJson === 'string' ? JSON.parse(req.body.captionsJson) : req.body.captionsJson;
            styleOptionsParsed = typeof req.body.styleOptions === 'string' ? JSON.parse(req.body.styleOptions) : req.body.styleOptions;
            captionPositionParsed = typeof req.body.captionPosition === 'string' ? JSON.parse(req.body.captionPosition) : req.body.captionPosition;
            if (captionPositionParsed) {
               styleOptionsParsed = styleOptionsParsed || {};
               styleOptionsParsed.captionPosition = captionPositionParsed;
            }
        } catch (e) {
            console.error("[Export] Failed to parse JSON params:", e);
        }

        // If we have JSON, we use Remotion for the high-quality WYSIWYG experience
        if (captionsParams && styleOptionsParsed) {
            console.log("[Export] Using Remotion rendering for WYSIWYG...");
            const { bundle } = await import('@remotion/bundler');
            const { renderMedia, selectComposition } = await import('@remotion/renderer');
            
            if (!globalCachedBundleLocation || globalCachedBundleLocation.endsWith('index.html')) {
                if (!globalBundlePromise || globalCachedBundleLocation?.endsWith('index.html')) {
                    globalBundlePromise = (async () => {
                        console.log("[Export] Bundling Remotion project... this might take a minute on first run.");
                        const location = await bundle({
                            entryPoint: path.join(__dirname, 'remotion', 'index.tsx'),
                            publicPath: ""
                        });
                        // Ensure we don't have index.html in the directory path
                        globalCachedBundleLocation = location.replace(/\/index\.html$/, '');
                        return globalCachedBundleLocation;
                    })();
                }
                try {
                    await globalBundlePromise;
                } catch (e) {
                    globalBundlePromise = null;
                    throw e;
                }
            }
            const bundleLocation = globalCachedBundleLocation!;
            
            // We must use bundleLocation as serveUrl so Remotion spawns its own server internally
            const serveUrl = bundleLocation;

            // Provide a local URL for the video file using the Express server
            const relativePath = path.relative(os.tmpdir(), videoSource);
            const localVideoUrl = `http://127.0.0.1:${EXPRESS_PORT}/temp/${relativePath.replace(/\\/g, '/')}`;

            console.log(`[Export] Using bundle DIR for Remotion: ${serveUrl}`);
            console.log(`[Export] Using internal video URL: ${localVideoUrl}`);

            const rawDuration = parseFloat(req.body.duration);
            const validDuration = (isNaN(rawDuration) || rawDuration <= 0) ? 10 : rawDuration;

            const durationInFrames = Math.max(1, Math.ceil(validDuration * 30));

            const fontName = styleOptionsParsed?.fontFamily || 'font-sans';
            const FONT_MAP: Record<string, string> = {
                'font-sans': 'Janna LT',
                'font-cairo': 'Cairo',
                'font-tajawal': 'Tajawal',
                'font-serif': 'Amiri',
                'font-roboto': 'Roboto',
                'font-amiri': 'Amiri',
                'font-ibm': 'IBM Plex Sans Arabic',
            };
            const actualFontName = FONT_MAP[fontName] || fontName;
            await ensureFont(actualFontName);

            styleOptionsParsed.captionsOnly = false;
            const inputProps = {
                videoUrl: localVideoUrl,
                captions: captionsParams,
                styleOptions: styleOptionsParsed,
                videoWidth: Number(targetW),
                videoHeight: Number(targetH),
                durationInFrames: Number(durationInFrames),
                expressPort: Number(EXPRESS_PORT)
            };

            const chromiumOptions: any = {
                gl: 'egl',
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 
                              (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : '/usr/bin/chromium'),
                headless: 'new',
                args: [
                    "--headless=new",
                    "--no-sandbox", 
                    "--disable-setuid-sandbox", 
                    "--enable-gpu",
                    "--enable-webgl",
                    "--use-gl=egl",
                    "--enable-accelerated-video-decode",
                    "--disable-web-security",
                    "--disable-dev-shm-usage",
                    "--allow-file-access-from-files",
                    "--allow-file-access",
                    "--autoplay-policy=no-user-gesture-required",
                    "--hide-scrollbars",
                    "--mute-audio",
                    "--no-first-run",
                    "--safebrowsing-disable-auto-update",
                    "--ignore-certificate-errors",
                    "--ignore-ssl-errors",
                    "--ignore-certificate-errors-spki-list",
                    "--disable-features=IsolateOrigins,site-per-process",
                    "--disable-site-isolation-trials"
                ]
            };

            const renderPort = 3030 + Math.floor(Math.random() * 100);
            console.log(`[Export] Using explicit port ${renderPort} for Remotion server...`);

            const composition = await selectComposition({
                serveUrl,
                port: renderPort,
                id: 'Captions',
                inputProps,
                chromiumOptions,
                timeoutInMilliseconds: 60000,
                onBrowserLog: (log) => {
                    if (log.type === 'error' || log.type === 'warning') {
                        console.log(`[Browser] ${log.type}: ${log.text}`);
                    }
                }
            });

            const cpuCount = os.cpus().length;
            const numChunks = durationInFrames > 900 ? 8 : (durationInFrames > 300 ? 4 : 1); 
            const optimalConcurrency = Math.max(1, Math.floor(cpuCount / (MAX_CONCURRENT_JOBS * numChunks)));

            console.log(`[Export] Starting parallel render. Chunks: ${numChunks}, Concurrency per chunk: ${optimalConcurrency}`);
            
            const chunkPaths: string[] = [];
            const renderPromises: Promise<void>[] = [];

            for (let i = 0; i < numChunks; i++) {
                const startFrame = Math.floor((durationInFrames / numChunks) * i);
                const endFrame = i === numChunks - 1 ? durationInFrames - 1 : Math.floor((durationInFrames / numChunks) * (i + 1)) - 1;
                const chunkPath = outputPath.replace('.mp4', `_chunk_${i}.mp4`);
                chunkPaths.push(chunkPath);

                renderPromises.push((async () => {
                   const { renderMedia } = await import('@remotion/renderer');
                   console.log(`[Export] Rendering chunk ${i}: frames ${startFrame}-${endFrame}`);
                   await renderMedia({
                        composition,
                        serveUrl,
                        // Removed fixed port: renderPort to allow Remotion to pick a free random port for each chunk
                        codec: 'h264',
                        imageFormat: 'jpeg',
                        jpegQuality: 100, // Maximizing quality for parallel chunks
                        muted: true,
                        outputLocation: chunkPath,
                        inputProps: { ...inputProps, styleOptions: styleOptionsParsed },
                        frameRange: [startFrame, endFrame],
                        concurrency: optimalConcurrency,
                        timeoutInMilliseconds: 300000,
                        chromiumOptions: {
                            ...chromiumOptions,
                            args: [
                                ...chromiumOptions.args,
                                "--force-color-profile=srgb",
                                "--font-render-hinting=medium", // Changed from none to medium for better strength/clarity
                                "--enable-font-antialiasing",
                                "--smooth-scrolling"
                            ]
                        },
                        onBrowserLog: (log) => {
                            if (log.type === 'error' || log.type === 'warning') {
                                console.log(`[Browser Chunk ${i}] ${log.type}: ${log.text}`);
                            }
                        }
                    });
                })());
            }

            await Promise.all(renderPromises);
            console.log("[Export] All chunks rendered. Concatenating...");

            const tempVideoPath = outputPath.replace('.mp4', '_temp.mp4');
            
            // Create concat list for FFmpeg
            const concatListPath = path.join(os.tmpdir(), `concat_${sessionId}.txt`);
            const concatContent = chunkPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
            fs.writeFileSync(concatListPath, concatContent);

            await new Promise((resolve, reject) => {
                const ffmpegProcess = spawn(validFfmpegPath as string, [
                    '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', tempVideoPath
                ]);
                ffmpegProcess.on('close', (code) => {
                    fs.unlinkSync(concatListPath);
                    chunkPaths.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
                    if (code === 0) resolve(null);
                    else reject(new Error(`Concat failed with code ${code}`));
                });
                ffmpegProcess.on('error', reject);
            });
                
            console.log("[Export] Chunk concatenation success. Muxing original audio...");
                
            await new Promise((resolve, reject) => {
                const ffmpegProcess = spawn(validFfmpegPath as string, [
                    '-y', 
                    '-i', tempVideoPath,
                    '-i', videoSource,
                    '-c:v', 'copy',
                    '-map', '0:v:0',
                    '-map', '1:a:0?',
                    '-c:a', 'copy',
                    '-shortest', outputPath
                ]);
                
                let stderrLog = "";
                ffmpegProcess.stderr.on('data', (data) => {
                    stderrLog += data.toString();
                    console.log(`[Audio Muxing] ${data}`);
                });

                ffmpegProcess.on('close', (code) => {
                    try { fs.unlinkSync(tempVideoPath); } catch(e) {}
                    if (code === 0) {
                        resolve(null);
                    } else {
                        console.error("[Export] Audio Muxing error:", stderrLog);
                        reject(new Error(`Audio Muxing failed: ${code}`));
                    }
                });
                ffmpegProcess.on('error', reject);
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

            let targetGpuIndex = '0';
            const gpuCount = process.env.GPU_COUNT ? parseInt(process.env.GPU_COUNT) : 0;
            if (gpuCount > 1) {
                targetGpuIndex = String(globalGpuIndexCounter % gpuCount);
                globalGpuIndexCounter++;
            }

            const args = [
                '-y', '-i', videoSource,
                '-vf', `${scaleFilter},${subtitleFilter}`,
                '-c:v', 'h264_nvenc', '-gpu', targetGpuIndex, '-preset', 'p6', '-tune', 'hq', '-spatial-aq', '1', '-temporal-aq', '1', '-pix_fmt', 'yuv420p', '-b:v', '6M',
                '-c:a', 'copy', '-movflags', '+faststart', outputPath
            ];

            try {
                await new Promise<void>((resolve, reject) => {
                    const ffmpegProcess = spawn(validFfmpegPath as string, args);
                    
                    let stderrLog = "";
                    ffmpegProcess.stderr.on('data', (data) => {
                        stderrLog += data.toString();
                        console.log(`[FFmpeg] ${data}`);
                    });

                    ffmpegProcess.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`FFmpeg error code ${code}: ${stderrLog}`));
                    });
                    ffmpegProcess.on('error', (err) => reject(err));
                });
            } catch (err: any) {
                console.log("[Export] FFmpeg failed with nvenc, retrying with libx264. Error:", err.message);
                const fallbackArgs = [];
                for (let i = 0; i < args.length; i++) {
                    if (args[i] === 'h264_nvenc') fallbackArgs.push('libx264');
                    else if (args[i] === '-gpu') i++; // Skip -gpu and its value
                    else fallbackArgs.push(args[i]);
                }
                await new Promise<void>((resolve, reject) => {
                    const ffmpegProcess = spawn(validFfmpegPath as string, fallbackArgs);
                    
                    let stderrLog = "";
                    ffmpegProcess.stderr.on('data', (data) => {
                        stderrLog += data.toString();
                        console.log(`[FFmpeg Fallback] ${data}`);
                    });

                    ffmpegProcess.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`FFmpeg Fallback error code ${code}: ${stderrLog}`));
                    });
                    ffmpegProcess.on('error', (err) => reject(err));
                });
            }
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

app.listen(Number(EXPRESS_PORT), "0.0.0.0", () => {
  console.log(`Server is running on port ${EXPRESS_PORT}`);
});
