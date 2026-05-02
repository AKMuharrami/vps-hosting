import { registerRoot } from 'remotion';
import React from 'react';
import { Composition } from 'remotion';
import { CaptionsComposition } from './CaptionsComposition';

export const RemotionRoot: React.FC = () => {
    return (
        <>
            <Composition
                id="Captions"
                component={CaptionsComposition}
                durationInFrames={300}
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{
                    videoUrl: '',
                    captions: [],
                    styleOptions: {}
                }}
            />
        </>
    );
};

registerRoot(RemotionRoot);