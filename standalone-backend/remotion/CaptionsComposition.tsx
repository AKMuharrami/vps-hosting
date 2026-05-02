import React, { useEffect, useState } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Video } from 'remotion';

// Simple implementation simulating the App.tsx styles
export const CaptionsComposition = ({
    videoUrl,
    captions,
    styleOptions
}: any) => {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    const currentTimeMs = (frame / fps) * 1000;
	// Captions in App are using seconds.
	const currentTime = frame / fps;

    const activeCaption = captions.find((c: any) => currentTime >= c.start && currentTime <= c.end);

    const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

    const [fontLoaded, setFontLoaded] = useState(false);

    useEffect(() => {
        if (!styleOptions.fontFamily) {
            setFontLoaded(true);
            return;
        }
        
        let fontUrl = '';
        if (styleOptions.fontFamily.includes('Janna')) {
            fontUrl = 'https://hjrm8lbtnby37npy.public.blob.vercel-storage.com/Janna%20LT%20Regular.ttf';
        } else if (styleOptions.fontFamily.includes('Tajawal')) {
            fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/Tajawal-Bold.ttf';
        } else if (styleOptions.fontFamily.includes('Cairo')) {
            fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt%2Cwght%5D.ttf';
        }

        if (fontUrl) {
            const font = new FontFace(styleOptions.fontFamily, `url(${fontUrl})`);
            font.load().then(() => {
                document.fonts.add(font);
                setFontLoaded(true);
            }).catch(() => setFontLoaded(true)); // proceed anyway
        } else {
             setFontLoaded(true);
        }
    }, [styleOptions.fontFamily]);

    // Apply inline style logic from App.tsx
    const shadowOpacity = styleOptions?.shadowOpacity ?? 80;
    const bgOpacity = styleOptions?.bgOpacity ?? 0;
    const textOpacity = styleOptions?.textOpacity ?? 100;
    
    // Convert hex+opacity down if we want, or just rely on CSS
    const hasShadow = styleOptions?.hasShadow;
    const shadowSize = styleOptions?.shadowSize ?? 2;
    const shadowColorHex = styleOptions?.shadowColor || '#000000';
    const shadowColorStr = `${shadowColorHex}${Math.floor(shadowOpacity / 100 * 255).toString(16).padStart(2, '0')}`;

    const textShadowValue = hasShadow 
        ? `${shadowSize}px ${shadowSize}px 0px ${shadowColorStr}`
        : 'none';

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            <Video src={videoUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            
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
                            fontFamily: styleOptions?.fontFamily,
                            fontSize: `${styleOptions?.fontSize ?? 40}px`,
                            maxWidth: `${styleOptions?.containerWidth ?? 80}%`,
                            color: styleOptions?.textColor + Math.floor(textOpacity / 100 * 255).toString(16).padStart(2, '0'),
                            backgroundColor: styleOptions?.hasBackground 
                                ? `${styleOptions?.bgColor}${Math.floor(bgOpacity / 100 * 255).toString(16).padStart(2, '0')}` 
                                : 'transparent',
                            borderRadius: '0px',
                            padding: '8px 10px',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                            borderColor: styleOptions?.hasBackground ? 'rgba(255,255,255,0.1)' : 'transparent',
                            lineHeight: '1.2',
                            fontWeight: styleOptions?.fontWeight,
                            WebkitTextStroke: styleOptions?.hasStroke 
                                ? `${styleOptions?.strokeSize}px ${styleOptions?.strokeColor}` 
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
