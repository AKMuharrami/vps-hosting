import React, { useEffect, useState, useCallback } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Video, delayRender, continueRender } from 'remotion';

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

        let fontUrl = '';
        if (displayFont.includes('Janna')) {
            fontUrl = 'https://hjrm8lbtnby37npy.public.blob.vercel-storage.com/Janna%20LT%20Regular.ttf';
        } else if (displayFont.includes('Tajawal')) {
            fontUrl = 'https://fonts.gstatic.com/s/tajawal/v9/I8aup314nnSgg3mKVG07zYVvPDp7Lw.woff2';
        } else if (displayFont.includes('Cairo')) {
            fontUrl = 'https://fonts.gstatic.com/s/cairo/v28/SLXVc1_SR38EWH6XGA5bW_B8e8uGj99y2g.woff2';
        } else if (displayFont.includes('Amiri')) {
            fontUrl = 'https://fonts.gstatic.com/s/amiri/v26/J7afp99WK5S-44kI9Yk.woff2';
        } else if (displayFont.includes('IBM Plex Sans Arabic')) {
            fontUrl = 'https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Yq6R-DObY6Zc_5V_p_4L9F0u5hS6i-6T8u-rS5T6.woff2';
        } else if (displayFont.includes('Roboto')) {
            fontUrl = 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2';
        }

        if (fontUrl) {
            const font = new FontFace(displayFont, `url(${fontUrl})`, {
                weight: styleOptions.fontWeight || 'normal'
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
             setFontLoaded(true);
             continueRender(handle);
        }
    }, [displayFont, handle]);

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
                            transform: `translate(${styleOptions?.captionPosition?.x ?? 0}px, ${styleOptions?.captionPosition?.y ?? 0}px)`
                        }}
                        dir="rtl"
                    >
                        {styleOptions?.animationMode === 'word' || styleOptions?.animationMode === 'highlight' ? (
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
                                    gap: '1.5cqw 0.5cqw'
                                }}
                            >
                                {activeCaption.text.split(' ').map((word: string, i: number, arr: string[]) => {
                                    const duration = activeCaption.end - activeCaption.start;
                                    const scaledDuration = duration / (styleOptions?.wordSpeedMultiplier ?? 1);
                                    const wordStartTime = activeCaption.start + (i / arr.length) * scaledDuration;
                                    const isHighlighted = currentTime >= wordStartTime && currentTime <= (activeCaption.start + ((i + 1) / arr.length) * scaledDuration);
                                    
                                    const wordHighlightColor = styleOptions?.wordHighlightColor ?? '#3e81f6';

                                    return (
                                        <span
                                            key={i}
                                            className="inline-block px-1"
                                            style={{
                                                color: isHighlighted ? wordHighlightColor : undefined,
                                                transition: 'color 0.1s'
                                            }}
                                        >
                                            {word}
                                        </span>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{ width: '100%', textAlign: 'center' }}>
                                {activeCaption.text}
                            </div>
                        )}
                    </span>
                </div>
            )}
        </AbsoluteFill>
    );
};
