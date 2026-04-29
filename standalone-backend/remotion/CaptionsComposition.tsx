import React, { useEffect, useState, useCallback } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Video, delayRender, continueRender, spring, interpolate } from 'remotion';

// Simple implementation simulating the App.tsx styles
export const CaptionsComposition = ({
    videoUrl,
    captions,
    styleOptions,
    videoHeight: propVideoHeight
}: any) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const currentTime = frame / fps;

    useEffect(() => {
        console.log('[CaptionsComposition] Render Frame:', { 
            frame, 
            fps, 
            currentTime, 
            captionsLength: Array.isArray(captions) ? captions.length : 'not an array',
            styleOptionsDefined: !!styleOptions
        });
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
    
    const displayFont = FONT_MAP[styleOptions.fontFamily] || styleOptions.fontFamily;

    useEffect(() => {
        if (!styleOptions.fontFamily) {
            setFontLoaded(true);
            continueRender(handle);
            return;
        }

        if (displayFont.includes('Janna')) {
            const font = new FontFace(displayFont, `url(https://hjrm8lbtnby37npy.public.blob.vercel-storage.com/Janna%20LT%20Regular.ttf)`, {
                weight: 'normal'
            });
            font.load().then(() => {
                document.fonts.add(font);
                setFontLoaded(true);
                continueRender(handle);
            }).catch((err) => {
                console.error('Failed to load font:', displayFont, err);
                setFontLoaded(true);
                continueRender(handle);
            });
        } else {
            const familyName = displayFont.replace(/ /g, '+');
            const weight = styleOptions.fontWeight || '400';
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `https://fonts.googleapis.com/css2?family=${familyName}:wght@${weight}&display=swap`;
            
            link.onload = () => {
                document.fonts.ready.then(() => {
                    setFontLoaded(true);
                    continueRender(handle);
                });
            };
            link.onerror = () => {
                console.error('Failed to load Google Font:', displayFont);
                setFontLoaded(true);
                continueRender(handle);
            };
            document.head.appendChild(link);
        }
    }, [displayFont, handle, styleOptions.fontWeight]);

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
    
    const posX = styleOptions?.captionPosition?.x ?? 0;
    const posY = styleOptions?.captionPosition?.y ?? 0;

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            <Video 
                src={videoUrl} 
                style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                muted
                onError={(e) => console.error('Video error:', e)}
            />
            
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
                        className="shadow-xl inline-block text-center px-4"
                        style={{
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
                            fontWeight: styleOptions?.fontWeight,
                            WebkitTextStroke: styleOptions?.hasStroke 
                                ? `${scaledStroke}px ${styleOptions?.strokeColor}` 
                                : 'none',
                            paintOrder: 'stroke fill',
                            textShadow: textShadowValue,
                            direction: 'rtl', // specific to Arabic
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
                                const isHighlighted = isWordAnim && (currentTime >= wordStartTime && currentTime <= (activeCaption.start + ((i + 1) / arr.length) * scaledDuration));
                                
                                const wordHighlightColor = styleOptions?.wordHighlightColor ?? '#3e81f6';

                                const wordScale = isHighlighted ? 1.15 : 1;

                                return (
                                    <span
                                        key={i}
                                        className="inline-block"
                                        style={{
                                            fontWeight: styleOptions?.fontWeight || 'normal',
                                            color: isHighlighted ? wordHighlightColor : undefined,
                                            transform: `scale(${wordScale})`,
                                            transformOrigin: 'center',
                                            transition: 'color 0.1s'
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
