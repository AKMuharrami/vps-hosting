import React, { useEffect, useState, useCallback } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Video, OffthreadVideo, delayRender, continueRender, spring, interpolate } from 'remotion';

// Simple implementation simulating the App.tsx styles
export const CaptionsComposition = ({
    videoUrl,
    captions,
    styleOptions,
    videoHeight: propVideoHeight,
    expressPort
}: any) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const currentTime = frame / fps;

    useEffect(() => {
        // Logging removed for performance
    }, [frame, fps, currentTime, captions, styleOptions]);

    const [handle] = useState(() => delayRender('Loading fonts...'));
    const [fontLoaded, setFontLoaded] = useState(false);

    const activeCaption = Array.isArray(captions) 
        ? captions.find((c: any) => currentTime >= c.start && currentTime <= c.end)
        : null;

    const FONT_MAP: Record<string, string> = {
        'font-sans': 'Janna LT',
        'font-cairo': 'Cairo',
        'font-tajawal': 'Tajawal',
        'font-serif': 'Amiri',
        'font-roboto': 'Roboto',
        'font-amiri': 'Amiri',
        'font-ibm': 'IBM Plex Sans Arabic',
    };
    
    const baseFont = FONT_MAP[styleOptions.fontFamily] || styleOptions.fontFamily || 'Janna LT';
    const displayFont = `${baseFont}, sans-serif`;

    useEffect(() => {
        if (!styleOptions.fontFamily) {
            setFontLoaded(true);
            continueRender(handle);
            return;
        }

        const fontUrl = `http://127.0.0.1:${expressPort || 3005}/fonts/${encodeURIComponent(baseFont + '_v2.ttf')}`;
        
        // Fix: Register weights up to 900. If we use the same file, the browser 
        // will use synthetic bolding for weights it thinks are too light relative 
        // to requested weight, but registering them explicitly helps with some 
        // CSS engine edge cases in Chromium.
        const weights = ['normal', '400', '700', '800', '900']; 
        
        Promise.all(weights.map(weight => {
            const font = new FontFace(baseFont, `url(${fontUrl})`, { weight });
            return font.load().then(f => f);
        })).then((loadedFonts) => {
            loadedFonts.forEach(f => document.fonts.add(f));
            setFontLoaded(true);
            continueRender(handle);
        }).catch((err) => {
            console.error('Failed to load font from local server:', fontUrl, err);
            // Fallback to previous logic if local fails
            if (baseFont.includes('Janna')) {
                const fbFont = new FontFace(baseFont, `url(https://hjrm8lbtnby37npy.public.blob.vercel-storage.com/Janna%20LT%20Regular.ttf)`, {
                    weight: 'normal'
                });
                fbFont.load().then(() => {
                    document.fonts.add(fbFont);
                    setFontLoaded(true);
                    continueRender(handle);
                }).catch(() => {
                    setFontLoaded(true);
                    continueRender(handle);
                });
            } else {
                const familyName = baseFont.replace(/ /g, '+');
                const weight = styleOptions.fontWeight || '400';
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = `https://fonts.googleapis.com/css2?family=${familyName}:wght@${weight}&display=swap`;
                link.onload = () => { document.fonts.ready.then(() => { setFontLoaded(true); continueRender(handle); }); };
                link.onerror = () => { setFontLoaded(true); continueRender(handle); };
                document.head.appendChild(link);
            }
        });
    }, [baseFont, handle, styleOptions.fontWeight, expressPort]);

    // Apply inline style logic from App.tsx
    const shadowOpacity = styleOptions?.shadowOpacity ?? 80;
    const bgOpacity = styleOptions?.bgOpacity ?? 0;
    const textOpacity = styleOptions?.textOpacity ?? 100;
    
    // Scale from preview container pixel space to source video pixel space
    const previewHeight = styleOptions?.previewHeight || 1;
    const videoHeight = propVideoHeight || styleOptions?.videoHeight || 1920;
    const scaleRatio = videoHeight / previewHeight;
    const scaledFontSize = Math.floor((styleOptions?.fontSize ?? 40) * scaleRatio);
    const scaledPaddingY = Math.floor(8 * scaleRatio);
    const scaledPaddingX = Math.floor(10 * scaleRatio);
    const scaledStroke = Math.floor((styleOptions?.strokeSize ?? 1) * scaleRatio);
    const scaledShadow = Math.floor((styleOptions?.shadowSize ?? 2) * scaleRatio);
    
    // Convert hex+opacity down if we want, or just rely on CSS
    const hasShadow = styleOptions?.hasShadow;
    const shadowSize = scaledShadow;
    const shadowColorHex = styleOptions?.shadowColor || '#000000';
    const shadowColorStr = `${shadowColorHex}${Math.floor(shadowOpacity / 100 * 255).toString(16).padStart(2, '0')}`;

    const textShadowValue = hasShadow 
        ? `${shadowSize}px ${shadowSize}px 0px ${shadowColorStr}`
        : 'none';

    // Animation Block
    let blockScale = 1;
    let blockTranslateY = 0;
    
    // Fallback if not specified
    const animType = styleOptions?.animation || 'none';
    const captionsOnly = styleOptions?.captionsOnly || false;

    if (activeCaption) {
        const startFrame = Math.round(activeCaption.start * fps);
        const endFrame = Math.round(activeCaption.end * fps);
        // Only run animation on entrance
        const relativeFrame = frame - startFrame;
        
        if (animType === 'pop') {
            blockScale = spring({
                fps,
                frame: relativeFrame,
                config: { damping: 12, stiffness: 200 },
                from: 0.8,
                to: 1
            });
        } else if (animType === 'slideUp') {
            const yOffset = 20 * scaleRatio;
            blockTranslateY = interpolate(
                spring({ fps, frame: relativeFrame, config: { damping: 15, stiffness: 200 } }),
                [0, 1],
                [yOffset, 0]
            );
        }
    }
    
    const posX = (styleOptions?.captionPosition?.x ?? 0) * scaleRatio;
    const posY = (styleOptions?.captionPosition?.y ?? 0) * scaleRatio;

    return (
        <AbsoluteFill style={{ backgroundColor: styleOptions?.captionsOnly ? 'transparent' : 'black' }}>
            <style>{`
                * {
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                    text-rendering: geometricPrecision;
                    font-smooth: always;
                }
            `}</style>
            {!styleOptions?.captionsOnly && (
                <OffthreadVideo 
                    src={videoUrl} 
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                    muted
                />
            )}
            
            {activeCaption && fontLoaded && (
                <div style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: '30%',
                    display: 'flex',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    zIndex: 40
                }}>
                    <span
                        style={{
                            display: 'inline-block',
                            textAlign: 'center',
                            paddingLeft: '1rem',
                            paddingRight: '1rem',
                            boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                            fontFamily: displayFont,
                            fontSize: `${scaledFontSize}px`,
                            maxWidth: `${styleOptions?.containerWidth ?? 80}%`,
                            color: styleOptions?.textColor + Math.floor(textOpacity / 100 * 255).toString(16).padStart(2, '0'),
                            backgroundColor: styleOptions?.hasBackground 
                                ? `${styleOptions?.bgColor}${Math.floor(bgOpacity / 100 * 255).toString(16).padStart(2, '0')}` 
                                : 'transparent',
                            borderRadius: '0px',
                            padding: `${scaledPaddingY}px ${scaledPaddingX}px`,
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                            borderColor: styleOptions?.hasBackground ? 'rgba(255,255,255,0.1)' : 'transparent',
                            lineHeight: '1.2',
                            fontWeight: styleOptions?.fontWeight || 'bold',
                            WebkitTextStroke: styleOptions?.hasStroke 
                                ? `${scaledStroke}px ${styleOptions?.strokeColor}` 
                                : (() => {
                                    const weight = styleOptions?.fontWeight;
                                    const weightNum = parseInt(weight);
                                    const isBold = weight === 'bold' || weight === 'black' || weightNum >= 700;
                                    if (isBold) {
                                        // If it's Janna LT, we need extra help since we don't have the bold file
                                        const isJanna = (styleOptions?.fontFamily || '').toLowerCase().includes('janna');
                                        const strokeWidth = isJanna 
                                            ? Math.max(0.7, scaledFontSize * 0.015) // Thicker stroke for Janna LT Bold simulation
                                            : Math.max(0.3, scaledFontSize * 0.005);
                                        return `${strokeWidth}px currentColor`;
                                    }
                                    return 'none';
                                })(),
                            paintOrder: 'stroke fill',
                            textShadow: textShadowValue,
                            direction: 'rtl', // specific to Arabic
                            textRendering: 'optimizeLegibility',
                            transform: `translate(${posX}px, calc(${posY}px + ${blockTranslateY}px)) scale(${blockScale})`
                        }}
                        dir="rtl"
                    >
                        <div
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                flexShrink: 0,
                                justifyContent: 'center',
                                alignItems: 'center',
                                paddingTop: '0.25rem',
                                paddingBottom: '0.25rem',
                                width: '100%',
                                gap: '1.5625em 0.625em'
                            }}
                        >
                             {activeCaption.text.split(' ').map((word: string, i: number, arr: string[]) => {
                                const isWordAnim = styleOptions?.animationMode === 'word' || styleOptions?.animationMode === 'highlight';
                                const duration = activeCaption.end - activeCaption.start;
                                const scaledDuration = duration / (styleOptions?.wordSpeedMultiplier ?? 1);
                                const wordStartTime = activeCaption.start + (i / arr.length) * scaledDuration;
                                const wordEndTime = activeCaption.start + ((i + 1) / arr.length) * scaledDuration;
                                
                                const wordStartFrame = Math.round(wordStartTime * fps);
                                const wordEndFrame = Math.round(wordEndTime * fps);
                                
                                const isHighlighted = isWordAnim && (currentTime >= wordStartTime && currentTime <= wordEndTime);
                                
                                const wordHighlightColor = styleOptions?.wordHighlightColor ?? '#3e81f6';

                                // Optimization: Only apply heavy transforms during active range
                                const isActive = frame >= wordStartFrame - 5 && frame <= wordEndFrame + 5;

                                let wordScale = 1;
                                if (isWordAnim && isActive) {
                                    if (frame >= wordStartFrame && frame < wordEndFrame) {
                                        wordScale = interpolate(
                                            frame - wordStartFrame,
                                            [0, 3], // small 3 frame pop
                                            [1, 1.15],
                                            { extrapolateRight: 'clamp' }
                                        );
                                    } else if (frame >= wordEndFrame) {
                                        wordScale = interpolate(
                                            frame - wordEndFrame,
                                            [0, 3], // 3 frame contract
                                            [1.15, 1],
                                            { extrapolateRight: 'clamp' }
                                        );
                                    }
                                }

                                return (
                                    <span
                                        key={i}
                                        style={{
                                            display: 'inline-block',
                                            fontWeight: styleOptions?.fontWeight || 'normal',
                                            color: isHighlighted ? wordHighlightColor : undefined,
                                            transform: wordScale !== 1 ? `scale(${wordScale})` : 'none',
                                            transformOrigin: 'center',
                                            WebkitFontSmoothing: 'antialiased'
                                        }}
                                    >
                                        {word}
                                    </span>
                                );
                            })}
                        </div>
                    </span>
                </div>
            )}
        </AbsoluteFill>
    );
};
